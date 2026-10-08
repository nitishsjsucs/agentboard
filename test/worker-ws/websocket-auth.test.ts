import { listDurableObjectIds } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { newRunId } from "../../src/worker/util/ids.ts";
import { authHeaders, P } from "../helpers/auth.ts";
import { startManualRun } from "../helpers/runs.ts";
import { openSocket, upgrade } from "../helpers/ws.ts";

describe("WebSocket authorization", { tags: ["authz"] }, () => {
  it("a WebSocket upgrade without identity is refused with 401", async () => {
    const { runId } = await startManualRun();
    const response = await upgrade(`/agents/run-coordinator/${runId}`);
    expect(response.status).toBe(401);
    expect(response.webSocket).toBeNull();
  });

  it("a viewer can connect for an existing run; a nonexistent run id returns 404 without creating a Durable Object", async () => {
    const { runId } = await startManualRun();
    const ok = await upgrade(`/agents/run-coordinator/${runId}`, await authHeaders(P.viewer));
    expect(ok.status).toBe(101);
    const socket = openSocket(ok);
    expect((await socket.next("cf_agent_state")).state).toMatchObject({ runId });
    socket.ws.close();

    const ghost = newRunId();
    const ghostId = env.RunCoordinator.idFromName(ghost).toString();
    const missing = await upgrade(`/agents/run-coordinator/${ghost}`, await authHeaders(P.viewer));
    expect(missing.status).toBe(404);
    const ids = (await listDurableObjectIds(env.RunCoordinator)).map((id) => id.toString());
    expect(ids).not.toContain(ghostId);
    // An unbound principal cannot connect at all.
    expect((await upgrade(`/agents/run-coordinator/${runId}`, await authHeaders(P.unbound))).status).toBe(403);
  });

  it("HTTP and WebSocket routes to planner-agent, executor-agent and verifier-agent are refused for every role", async () => {
    for (const agent of ["planner-agent", "executor-agent", "verifier-agent"]) {
      for (const principal of [P.viewer, P.operator, P.approver, P.admin]) {
        const headers = await authHeaders(principal);
        const ws = await upgrade(`/agents/${agent}/${agent.split("-")[0]}-0`, headers);
        expect(ws.status, `${agent} ws ${principal}`).toBe(403);
        expect(ws.webSocket).toBeNull();
        const http = await exports.default.fetch(`http://127.0.0.1:8784/agents/${agent}/${agent.split("-")[0]}-0`, { headers });
        expect(http.status, `${agent} http ${principal}`).toBe(404);
      }
    }
    // Plain HTTP to the coordinator route is refused too: browsers only get read-only WebSockets.
    const { runId } = await startManualRun();
    const http = await exports.default.fetch(`http://127.0.0.1:8784/agents/run-coordinator/${runId}`, { headers: await authHeaders(P.admin) });
    expect(http.status).toBe(404);
  });

  it("an upgrade whose Origin is not in ALLOWED_ORIGINS is refused with 403, even with a valid dev cookie", async () => {
    const { runId } = await startManualRun();
    const login = await exports.default.fetch("http://127.0.0.1:8784/api/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AgentBoard-Client": "web" },
      body: JSON.stringify({ principal: P.admin }),
    });
    const cookie = (login.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
    expect(cookie.startsWith("CF_Authorization=")).toBe(true);
    const evil = await upgrade(`/agents/run-coordinator/${runId}`, { Cookie: cookie, Origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.webSocket).toBeNull();
    const allowed = await upgrade(`/agents/run-coordinator/${runId}`, { Cookie: cookie, Origin: "http://127.0.0.1:5173" });
    expect(allowed.status).toBe(101);
    openSocket(allowed).ws.close();
  });
});
