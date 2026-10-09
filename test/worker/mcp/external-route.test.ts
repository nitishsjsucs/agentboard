import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { signIntegrationToken } from "../../../src/worker/auth/integration-tokens.ts";
import { INSPECTOR_LEASE_MS, inspectorReadClaims } from "../../../src/worker/mcp/inspector-token.ts";
import type { McpToolResult } from "../../../src/worker/mcp/results.ts";
import worker from "../../../src/worker/index.ts";
import { binding, executorToken, SIGNING_KEY } from "../../helpers/mcp.ts";

// The test project runs with ENVIRONMENT=test and MCP_EXTERNAL=off. The "on"
// cases call the production worker with a development env that turns the route
// on, exactly as a developer's .dev.vars would.
const devEnv = { ...env, ENVIRONMENT: "development", MCP_EXTERNAL: "on" } as Env;

/** A real HTTP client would send Host; requests built in tests carry none. */
function viaWorker(workerEnv: Env): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set("Host", new URL(request.url).host);
    return worker.fetch(new Request(request, { headers }), workerEnv, createExecutionContext());
  };
}

async function withInspector<T>(token: string, base: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: { token: async () => token }, fetch: viaWorker(devEnv) });
  const client = new Client({ name: "inspector-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

const initialize = (token: string) => ({
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
});

describe("external /mcp route (dev only, for MCP Inspector)", { tags: ["integration"] }, () => {
  it("answers 404 unless MCP_EXTERNAL is on and the host is loopback, even for a valid token", async () => {
    const token = await signIntegrationToken(inspectorReadClaims("hris.get_employee", { employeeId: "E-1001" }), SIGNING_KEY);
    // The test configuration has MCP_EXTERNAL=off: the route does not exist.
    expect((await exports.default.fetch("http://127.0.0.1:8784/mcp", initialize(token))).status).toBe(404);
    // MCP_EXTERNAL=on still refuses a non-loopback host (a deployed name, or DNS rebound to 127.0.0.1).
    expect((await viaWorker(devEnv)("http://agentboard.example.test/mcp", initialize(token))).status).toBe(404);
    // With the route on, the endpoint's own checks still apply: no token is 401.
    const anonymous = await viaWorker(devEnv)("http://127.0.0.1:8784/mcp", { ...initialize(token), headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" } });
    expect(anonymous.status).toBe(401);
  });

  it("serves an inspector token's one read over the route and refuses anything else", async () => {
    const now = Date.now();
    const claims = inspectorReadClaims("hris.get_employee", { employeeId: "E-1001" }, now);
    expect(claims).toMatchObject({ kind: "executor", tool: "hris.get_employee", scope: "hris:read", lease_exp_ms: now + INSPECTOR_LEASE_MS });
    expect(() => inspectorReadClaims("access.revoke_all_roles", { employeeId: "E-1001" })).toThrow(/read tools only/);
    expect(() => inspectorReadClaims("hris.get_employee", { employeeId: "E-1001", extra: true })).toThrow(/invalid/);
    const token = await signIntegrationToken(claims, SIGNING_KEY);

    await withInspector(token, "http://127.0.0.1:8784", async (client) => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(12);
      const read = (await client.callTool({ name: "hris.get_employee", arguments: { employeeId: "E-1001" } })) as unknown as McpToolResult;
      expect(read.structuredContent).toMatchObject({ ok: true, data: { employee: { id: "E-1001" } } });
      const other = (await client.callTool({ name: "hris.get_employee", arguments: { employeeId: "E-1002" } })) as unknown as McpToolResult;
      expect(other.structuredContent).toMatchObject({ ok: false, errorClass: "forbidden", code: "args_mismatch" });
      const write = (await client.callTool({ name: "access.revoke_all_roles", arguments: { employeeId: "E-1001" } })) as unknown as McpToolResult;
      expect(write.structuredContent).toMatchObject({ ok: false, errorClass: "forbidden", code: "tool_not_bound" });
    });

    // A coordinator-minted write token works over the route only as far as its own binding: same checks as in-process.
    const args = { employeeId: "E-1001" };
    const writeToken = await executorToken("access.revoke_all_roles", args, binding("access.revoke_all_roles", args));
    await withInspector(writeToken, "http://localhost:8784", async (client) => {
      const missingMeta = (await client.callTool({ name: "access.revoke_all_roles", arguments: args })) as unknown as McpToolResult;
      expect(missingMeta.structuredContent).toMatchObject({ ok: false, errorClass: "forbidden", code: "meta_mismatch" });
    });
  });
});
