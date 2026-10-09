import { listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { RunCoordinator } from "../../src/worker/agents/run-coordinator.ts";
import { loadConfig } from "../../src/worker/config.ts";
import { handleAgentRoute, WS_REAUTHORIZE_MS } from "../../src/worker/realtime.ts";
import { newRunId } from "../../src/worker/util/ids.ts";
import type { RunSnapshot } from "../../src/shared/api-types.ts";
import { authHeaders, P, signTestJwt } from "../helpers/auth.ts";
import { raw, startManualRun } from "../helpers/runs.ts";
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
    // The Agents SDK forwards a `/sub/{class}/{name}` tail under an allowed route to a sub-agent facet of any class;
    // the route is the coordinator's own path only, so these never reach the coordinator.
    const other = await startManualRun();
    for (const tail of ["sub/executor-agent/executor-0", "sub/planner-agent/probe", "sub/verifier-agent/verifier-0", `sub/run-coordinator/${other.runId}`]) {
      for (const principal of [P.viewer, P.admin]) {
        const ws = await upgrade(`/agents/run-coordinator/${runId}/${tail}`, await authHeaders(principal));
        expect(ws.status, `${tail} ws ${principal}`).toBe(404);
        expect(ws.webSocket).toBeNull();
      }
    }
    // Defense in depth: the coordinator itself refuses sub-agents, closing the socket (4404) before any frame.
    const direct = await env.RunCoordinator.get(env.RunCoordinator.idFromName(runId)).fetch(`http://127.0.0.1:8784/agents/run-coordinator/${runId}/sub/executor-agent/executor-0`, {
      headers: { Upgrade: "websocket" },
    });
    const socket = direct.webSocket;
    if (!socket) throw new Error(`no socket (status ${direct.status})`);
    const frames: string[] = [];
    const closed = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket was not closed")), 5000);
      socket.addEventListener("message", (event) => frames.push(String(event.data)));
      socket.addEventListener("close", (event) => {
        clearTimeout(timer);
        resolve(event.code);
      });
    });
    socket.accept();
    expect(await closed).toBe(4404);
    expect(frames).toEqual([]);
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

  it("a connected socket is closed once its identity token expires and receives no snapshot after that; a client cannot claim a longer session", async () => {
    const { stub, runId } = await startManualRun();
    const shortToken = await signTestJwt(P.viewer, { expiresIn: "2s" });
    // A forged session header is overwritten by the route with the verified token's expiry.
    const expiring = openSocket(
      await upgrade(`/agents/run-coordinator/${runId}`, { "Cf-Access-Jwt-Assertion": shortToken, "x-agentboard-session-expires": String(Date.now() + 3_600_000) }),
    );
    expect((await expiring.next("cf_agent_state")).state).toMatchObject({ runId });
    const live = openSocket(await upgrade(`/agents/run-coordinator/${runId}`, await authHeaders(P.viewer)));
    await live.next("cf_agent_state");
    const closed = new Promise<number>((resolve) => expiring.ws.addEventListener("close", (event) => resolve(event.code)));

    await new Promise((resolve) => setTimeout(resolve, 3_100));
    await stub.control({ type: "pause", actor: { kind: "user", id: P.operator }, reason: "after the token expired" });
    expect(await closed).toBe(4401);
    expect(expiring.frames.filter((f) => f.type === "cf_agent_state")).toEqual([]);
    // A socket with a live token still gets the update.
    const update = (await live.next("cf_agent_state", (f) => (f.state as RunSnapshot).status === "paused")).state as RunSnapshot;
    expect(update.status).toBe("paused");
    live.ws.close();

    // An already expired token is refused at the upgrade (outside the verifier's clock tolerance).
    const expired = await signTestJwt(P.viewer, { expiresIn: "2 minutes ago" });
    expect((await upgrade(`/agents/run-coordinator/${runId}`, { "Cf-Access-Jwt-Assertion": expired })).status).toBe(401);
  }, 15_000);

  it("a socket must be authorized again WS_REAUTHORIZE_MS after its upgrade: a removed role binding stops its snapshots and refuses the reconnect", async () => {
    const { stub, runId } = await startManualRun();
    const principal = "ws.revoked@agentboard.test";
    const at = new Date().toISOString();
    await env.DB.prepare("INSERT INTO role_bindings (principal, role, display_name, created_at, updated_at, updated_by) VALUES (?, 'viewer', 'Revoked Viewer', ?, ?, 'test')")
      .bind(principal, at, at)
      .run();
    const revokedToken = await signTestJwt(principal, { expiresIn: "12h" });

    // The production route: a 12-hour token keeps its expiry, and the socket is due for reauthorization after WS_REAUTHORIZE_MS.
    const routed = openSocket(await upgrade(`/agents/run-coordinator/${runId}`, { "Cf-Access-Jwt-Assertion": revokedToken }));
    await routed.next("cf_agent_state");
    const sessions = await runInDurableObject(raw(stub), (instance: RunCoordinator) =>
      [...instance.getConnections<{ sessionExpiresAt: number; reauthorizeAt: number }>()].map((connection) => connection.state),
    );
    expect(sessions).toHaveLength(1);
    const [session] = sessions;
    expect(session?.sessionExpiresAt).toBeGreaterThan(Date.now() + 11 * 3_600_000);
    expect(session?.reauthorizeAt).toBeGreaterThan(Date.now() + WS_REAUTHORIZE_MS - 10_000);
    expect(session?.reauthorizeAt).toBeLessThanOrEqual(Date.now() + WS_REAUTHORIZE_MS);
    routed.ws.close();

    // The same route with a 1.5 s interval (a forged reauthorization time is overwritten); one binding is removed meanwhile.
    const loaded = loadConfig(env);
    if (!loaded.ok) throw new Error(loaded.errors.join("; "));
    const open = async (token: string) => {
      const headers = { Upgrade: "websocket", "Cf-Access-Jwt-Assertion": token, "x-agentboard-reauthorize-at": String(Date.now() + 3_600_000) };
      const socket = openSocket(await handleAgentRoute(new Request(`http://127.0.0.1:8784/agents/run-coordinator/${runId}`, { headers }), env, loaded.config, 1_500));
      expect((await socket.next("cf_agent_state")).state).toMatchObject({ runId });
      return { socket, closed: new Promise<number>((resolve) => socket.ws.addEventListener("close", (event) => resolve(event.code))) };
    };
    const viewerToken = await signTestJwt(P.viewer, { expiresIn: "12h" });
    const revoked = await open(revokedToken);
    const kept = await open(viewerToken);
    await env.DB.prepare("DELETE FROM role_bindings WHERE principal = ?").bind(principal).run();
    await scheduler.wait(1_700);
    await stub.control({ type: "pause", actor: { kind: "user", id: P.operator }, reason: "after the reauthorization time" });
    // A normal closure, not the terminal 4401, so the client reconnects; neither socket gets the snapshot.
    expect([await revoked.closed, await kept.closed]).toEqual([1000, 1000]);
    expect([...revoked.socket.frames, ...kept.socket.frames].filter((f) => f.type === "cf_agent_state")).toEqual([]);
    // The reconnect is authorized against the current binding: refused for the removed one, accepted for the other.
    expect((await upgrade(`/agents/run-coordinator/${runId}`, { "Cf-Access-Jwt-Assertion": revokedToken })).status).toBe(403);
    const again = openSocket(await upgrade(`/agents/run-coordinator/${runId}`, { "Cf-Access-Jwt-Assertion": viewerToken }));
    expect(((await again.next("cf_agent_state")).state as RunSnapshot).status).toBe("paused");
    again.ws.close();
  }, 15_000);
});
