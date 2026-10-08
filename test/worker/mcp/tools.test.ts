import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { verifyIntegrationToken } from "../../../src/worker/auth/integration-tokens.ts";
import { faultDirective } from "../../../src/worker/mcp/faults.ts";
import { runTool } from "../../../src/worker/mcp/server.ts";
import type { ToolSuccess } from "../../../src/worker/mcp/results.ts";
import { binding, call, executorToken, sideEffects, SIGNING_KEY, verifierToken, writeMeta } from "../../helpers/mcp.ts";
import { testConfig } from "../../helpers/queue.ts";

function data(result: { structuredContent: unknown }): Record<string, unknown> {
  const content = result.structuredContent as ToolSuccess;
  if (!content.ok) throw new Error(`tool failed: ${JSON.stringify(content)}`);
  return content.data;
}

async function write(tool: Parameters<typeof executorToken>[0], args: Record<string, unknown>, stepId = "s2", meta: Record<string, unknown> = {}) {
  const b = binding(tool, args, { stepId });
  return { b, result: await call(await executorToken(tool, args, b), tool, args, writeMeta(b, meta)) };
}

async function read(tool: Parameters<typeof executorToken>[0], args: Record<string, unknown>) {
  const b = binding(tool, args, { stepId: "s1" });
  return call(await executorToken(tool, args, b), tool, args);
}

describe("People Ops MCP tools", { tags: ["integration"] }, () => {
  it("HRIS tools read and update the simulated HRIS", async () => {
    const SUBJECT = "E-1014";
    const effectsBefore = (await sideEffects()).total;
    const before = data(await read("hris.get_employee", { employeeId: SUBJECT }))["employee"] as Record<string, unknown>;
    expect(before).toMatchObject({ id: SUBJECT, employmentStatus: "active" });
    const address = { line1: "1 Juniper Court", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
    expect(data((await write("hris.update_address", { employeeId: SUBJECT, address })).result)).toEqual({ employeeId: SUBJECT, address });
    expect(data((await write("hris.update_manager", { employeeId: SUBJECT, managerId: "E-1003" })).result)).toEqual({ employeeId: SUBJECT, managerId: "E-1003" });
    expect(data((await write("hris.set_employment_status", { employeeId: SUBJECT, status: "terminated", effectiveDate: "2026-10-30" })).result)).toMatchObject({ status: "terminated" });
    const after = data(await read("hris.get_employee", { employeeId: SUBJECT }))["employee"] as Record<string, unknown>;
    expect(after).toMatchObject({ address, managerId: "E-1003", employmentStatus: "terminated" });
    expect((await sideEffects()).total - effectsBefore).toBe(3);
    const missing = await read("hris.get_employee", { employeeId: "E-9999" });
    expect(missing.structuredContent).toMatchObject({ ok: false, errorClass: "permanent", code: "not_found" });
  });

  it("ITSM and notification tools create records that the verifier's reads find", async () => {
    const SUBJECT = "E-1020";
    const ticket = data((await write("itsm.create_ticket", { employeeId: SUBJECT, category: "laptop_provision", summary: "Laptop provisioning for E-1014" })).result);
    const delivery = data((await write("notify.send", { employeeId: SUBJECT, channel: "slack", template: "onboarding_ready" }, "s4")).result);
    const scope = { runId: "run_01J00000000000000000000000", taskId: "tsk_01J00000000000000000000000", stepId: "s2" };
    const token = await verifierToken(["itsm.get_ticket", "notify.get_delivery"], SUBJECT, [String(ticket["ticketId"]), String(delivery["deliveryId"])], scope);
    const foundTicket = data(await call(token, "itsm.get_ticket", { ticketId: String(ticket["ticketId"]) }))["ticket"];
    expect(foundTicket).toMatchObject({ ticketId: ticket["ticketId"], category: "laptop_provision", status: "open", employeeId: SUBJECT });
    const foundDelivery = data(await call(token, "notify.get_delivery", { deliveryId: String(delivery["deliveryId"]) }))["delivery"];
    expect(foundDelivery).toMatchObject({ deliveryId: delivery["deliveryId"], status: "sent", channel: "slack", template: "onboarding_ready" });
  });

  it("access tools list, grant and revoke roles", async () => {
    const SUBJECT = "E-1030";
    const roles = async () => data(await read("access.list_roles", { employeeId: SUBJECT }))["roles"] as string[];
    const initial = await roles();
    expect(initial).toHaveLength(3);
    await write("access.grant_role", { employeeId: SUBJECT, system: "aws", role: "prod-admin" });
    expect(await roles()).toContain("aws:prod-admin");
    const [system, role] = (initial[0] ?? ":").split(":");
    await write("access.revoke_role", { employeeId: SUBJECT, system, role });
    expect(await roles()).not.toContain(initial[0]);
    const all = data((await write("access.revoke_all_roles", { employeeId: SUBJECT })).result);
    expect(all).toEqual({ employeeId: SUBJECT, revoked: 3 });
    expect(await roles()).toEqual([]);
  });

  it("the ledger replays a completed key with its stored result, and refuses the key with different arguments", async () => {
    const SUBJECT = "E-1040";
    const effectsBefore = (await sideEffects()).total;
    const args = { employeeId: SUBJECT, category: "access_issue", summary: "VPN access broken" };
    const b = binding("itsm.create_ticket", args);
    const token = await executorToken("itsm.create_ticket", args, b);
    const first = await call(token, "itsm.create_ticket", args, writeMeta(b));
    const second = await call(token, "itsm.create_ticket", args, writeMeta(b));
    expect(first.structuredContent).toMatchObject({ ok: true, replayed: false });
    expect(second.structuredContent).toMatchObject({ ok: true, replayed: true });
    expect(data(second)).toEqual(data(first));
    expect((await sideEffects()).total - effectsBefore).toBe(1);
    const tickets = await env.PEOPLE_DB.prepare("SELECT COUNT(*) AS n FROM tickets WHERE employee_id = ?").bind(SUBJECT).first<{ n: number }>();
    expect(tickets?.n).toBe(1);

    // The same key with different arguments (a token minted for them) is a permanent conflict.
    const other = { ...args, summary: "Different summary" };
    const conflictToken = await executorToken("itsm.create_ticket", other, b);
    const conflict = await call(conflictToken, "itsm.create_ticket", other, writeMeta(b));
    expect(conflict.structuredContent).toMatchObject({ ok: false, errorClass: "permanent", code: "idempotency_conflict" });
    expect((await sideEffects()).total - effectsBefore).toBe(1);
  });

  it("silent_noop completes the ledger with an ok result but applies nothing and records no side effect", async () => {
    const SUBJECT = "E-1045";
    const effectsBefore = (await sideEffects()).total;
    const before = data(await read("hris.get_employee", { employeeId: SUBJECT }))["employee"] as Record<string, unknown>;
    const address = { line1: "9 Granite Row", city: "Boise", region: "ID", postalCode: "83701", country: "US" };
    const { b, result } = await write("hris.update_address", { employeeId: SUBJECT, address }, "s2", { "agentboard/fault": "silent_noop" });
    expect(result.structuredContent).toMatchObject({ ok: true, replayed: false });
    expect((await sideEffects()).total - effectsBefore).toBe(0);
    const after = data(await read("hris.get_employee", { employeeId: SUBJECT }))["employee"] as Record<string, unknown>;
    expect(after["address"]).toEqual(before["address"]);
    const ledger = await env.PEOPLE_DB.prepare("SELECT state FROM idempotency WHERE key = ?").bind(b.key).first<{ state: string }>();
    expect(ledger?.state).toBe("completed");
  });

  it("fault directives are ignored when FAULT_INJECTION=off", async () => {
    const SUBJECT = "E-1050";
    const effectsBefore = (await sideEffects()).total;
    expect(faultDirective({ "agentboard/fault": "transient_error" }, false)).toBeNull();
    expect(faultDirective({ "agentboard/fault": "transient_error" }, true)).toBe("transient_error");
    const off = { ...testConfig(), faultInjection: false };
    for (const kind of ["transient_error", "permanent_error", "silent_noop"]) {
      const args = { employeeId: SUBJECT, channel: "email", template: "address_updated" };
      const b = binding("notify.send", args, { stepId: "s3" });
      const claims = await verifyIntegrationToken(await executorToken("notify.send", args, b), SIGNING_KEY);
      const result = await runTool("notify.send", args, writeMeta(b, { "agentboard/fault": kind }), claims, env, off);
      expect(result.structuredContent, kind).toMatchObject({ ok: true, replayed: false });
    }
    expect((await sideEffects()).total - effectsBefore).toBe(3);
    // With FAULT_INJECTION=on (the test default) the same directive does fail the call.
    const args = { employeeId: SUBJECT, channel: "email", template: "address_updated" };
    const b = binding("notify.send", args, { stepId: "s3" });
    const failed = await call(await executorToken("notify.send", args, b), "notify.send", args, writeMeta(b, { "agentboard/fault": "transient_error" }));
    expect(failed.structuredContent).toMatchObject({ ok: false, errorClass: "retryable", code: "injected_transient" });
    expect((await sideEffects()).total - effectsBefore).toBe(3);
  });
});
