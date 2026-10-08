import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { argsHash } from "../../../src/worker/agents/coordinator/credentials.ts";
import { binding, call, executorToken, plannerToken, rawRpc, sideEffects, SIGNING_KEY, verifierToken, withClient, writeMeta } from "../../helpers/mcp.ts";

const SUBJECT = "E-1014";
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

async function errorCode(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { error?: { code?: string } }).error?.code;
}

describe("People Ops MCP endpoint authorization", { tags: ["authz"] }, () => {
  it("returns 401 without a bearer token, with a wrong audience, or with an expired token", async () => {
    const missing = await rawRpc(null, INIT);
    expect(missing.status).toBe(401);
    const claims = { kind: "executor", run_id: "run_x", task_id: "tsk_x", epoch: 1, lease_exp_ms: Date.now() + 60_000, scope: "hris:read", tool: "hris.get_employee" };
    const wrongAud = await new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuer("agentboard").setAudience("some-other-api").setSubject("executor-0").setIssuedAt().setExpirationTime("1m").sign(SIGNING_KEY);
    expect((await rawRpc(wrongAud, INIT)).status).toBe(401);
    const expired = await new SignJWT({ ...claims, lease_exp_ms: Date.now() - 120_000 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("agentboard")
      .setAudience("people-ops-mcp")
      .setSubject("executor-0")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 300)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 120)
      .sign(SIGNING_KEY);
    const expiredResponse = await rawRpc(expired, INIT);
    expect(expiredResponse.status).toBe(401);
    expect(await errorCode(expiredResponse)).toBe("invalid_token");
    const forged = await new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuer("agentboard").setAudience("people-ops-mcp").setSubject("executor-0").setExpirationTime("1m").sign(new TextEncoder().encode("x".repeat(48)));
    expect((await rawRpc(forged, INIT)).status).toBe(401);
  });

  it("a token whose lease_exp_ms has passed is refused with 401 lease_expired even though its exp is in the future", async () => {
    const token = await new SignJWT({ kind: "executor", run_id: "run_x", task_id: "tsk_x", epoch: 1, lease_exp_ms: Date.now() - 1, scope: "hris:read", tool: "hris.get_employee" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("agentboard")
      .setAudience("people-ops-mcp")
      .setSubject("executor-0")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(SIGNING_KEY);
    const response = await rawRpc(token, INIT);
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("lease_expired");
  });

  it("a verifier token calling a write tool, or reading another employee, is forbidden and causes no side effect", async () => {
    const before = (await sideEffects()).total;
    const scope = { runId: "run_01J00000000000000000000000", taskId: "tsk_01J00000000000000000000000", stepId: "s2" };
    const token = await verifierToken(["hris.get_employee"], SUBJECT, [], scope);
    const writeArgs = { employeeId: SUBJECT, status: "terminated", effectiveDate: "2026-10-30" };
    const write = await call(token, "hris.set_employment_status", writeArgs, { "agentboard/idempotencyKey": "ik_x" });
    expect(write.structuredContent).toMatchObject({ ok: false, errorClass: "forbidden", code: "tool_not_bound" });
    const other = await call(token, "hris.get_employee", { employeeId: "E-1005" });
    expect(other.structuredContent).toMatchObject({ ok: false, errorClass: "forbidden", code: "off_subject" });
    const own = await call(token, "hris.get_employee", { employeeId: SUBJECT });
    expect(own.structuredContent).toMatchObject({ ok: true });
    expect((await sideEffects()).total).toBe(before);
  });

  it("cross-tool: a token minted for hris.update_address cannot call hris.set_employment_status", async () => {
    const before = (await sideEffects()).total;
    const args = { employeeId: SUBJECT, address: { line1: "1 Quarry Road", city: "Austin", region: "TX", postalCode: "78701", country: "US" } };
    const b = binding("hris.update_address", args);
    const token = await executorToken("hris.update_address", args, b);
    const result = await call(token, "hris.set_employment_status", { employeeId: SUBJECT, status: "terminated", effectiveDate: "2026-10-30" }, writeMeta(b));
    expect(result.structuredContent).toMatchObject({ ok: false, errorClass: "forbidden", code: "tool_not_bound" });
    expect((await sideEffects()).total).toBe(before);
  });

  it("args tamper: a token for one address used with a different address is forbidden (args_mismatch)", async () => {
    const before = (await sideEffects()).total;
    const args = { employeeId: SUBJECT, address: { line1: "1 Quarry Road", city: "Austin", region: "TX", postalCode: "78701", country: "US" } };
    const b = binding("hris.update_address", args);
    const token = await executorToken("hris.update_address", args, b);
    const tampered = { employeeId: SUBJECT, address: { ...args.address, line1: "666 Elsewhere" } };
    expect(argsHash(tampered)).not.toBe(argsHash(args));
    const result = await call(token, "hris.update_address", tampered, writeMeta(b));
    expect(result.structuredContent).toMatchObject({ ok: false, errorClass: "forbidden", code: "args_mismatch" });
    expect((await sideEffects()).total).toBe(before);
  });

  it("_meta mismatch: a missing or different idempotency key, or a different runId, taskId or stepId, is forbidden", async () => {
    const before = (await sideEffects()).total;
    const args = { employeeId: SUBJECT, channel: "email", template: "address_updated" };
    const b = binding("notify.send", args, { stepId: "s3" });
    const token = await executorToken("notify.send", args, b);
    const variants: Record<string, unknown>[] = [
      {},
      writeMeta({ ...b, key: "ik_someone_else" }),
      writeMeta({ ...b, runId: "run_01J99999999999999999999999" }),
      writeMeta({ ...b, taskId: "tsk_01J99999999999999999999999" }),
      writeMeta({ ...b, stepId: "s9" }),
    ];
    for (const meta of variants) {
      const result = await call(token, "notify.send", args, meta);
      expect(result.structuredContent, JSON.stringify(meta)).toMatchObject({ ok: false, errorClass: "forbidden", code: "meta_mismatch" });
    }
    expect((await sideEffects()).total).toBe(before);
    // The exact binding goes through.
    expect((await call(token, "notify.send", args, writeMeta(b))).structuredContent).toMatchObject({ ok: true });
    expect((await sideEffects()).total).toBe(before + 1);
  });

  it("a planner token can list tools, but tools/call is refused at the endpoint", async () => {
    const token = await plannerToken("run_01J00000000000000000000000", "tsk_01J00000000000000000000000");
    const tools = await withClient(token, async (client) => (await client.listTools()).tools.map((t) => t.name));
    expect(tools).toHaveLength(12);
    expect(tools).toContain("hris.update_address");
    await expect(withClient(token, (client) => client.callTool({ name: "hris.get_employee", arguments: { employeeId: SUBJECT } }))).rejects.toThrow();
    const raw = await rawRpc(token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "hris.get_employee", arguments: { employeeId: SUBJECT } } });
    expect(raw.status).toBe(403);
    expect(await errorCode(raw)).toBe("method_not_allowed");
  });
});
