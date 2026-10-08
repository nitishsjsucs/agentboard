import { describe, expect, it } from "vitest";
import type { RunSnapshot } from "../../src/shared/api-types.ts";
import { authHeaders, P } from "../helpers/auth.ts";
import { readState, startManualRun } from "../helpers/runs.ts";
import { openSocket, upgrade } from "../helpers/ws.ts";

const OPERATOR = { kind: "user" as const, id: "ops.lead@agentboard.test" };

describe("live run updates", { tags: ["orchestration"] }, () => {
  it("a WebSocket client on /agents/run-coordinator/:runId receives the snapshot on connect and an update after a transition", async () => {
    const { stub, runId } = await startManualRun();
    const socket = openSocket(await upgrade(`/agents/run-coordinator/${runId}`, await authHeaders(P.viewer)));
    const initial = (await socket.next("cf_agent_state")).state as RunSnapshot;
    expect(initial).toMatchObject({ runId, status: "queued" });
    expect(initial.tasks.map((t) => [t.kind, t.status])).toEqual([["plan", "ready"]]);
    await stub.control({ type: "pause", actor: OPERATOR, reason: "watch the update" });
    const update = (await socket.next("cf_agent_state", (f) => (f.state as RunSnapshot).status === "paused")).state as RunSnapshot;
    expect(update.status).toBe("paused");
    expect(update.version).toBeGreaterThan(initial.version);
    expect(update.recentEvents.map((e) => e.action)).toContain("run.paused");
    socket.ws.close();
  });

  it("a client-originated state update is rejected (cf_agent_state_error) and the state is unchanged", async () => {
    const { stub, runId } = await startManualRun();
    const socket = openSocket(await upgrade(`/agents/run-coordinator/${runId}`, await authHeaders(P.admin)));
    const initial = (await socket.next("cf_agent_state")).state as RunSnapshot;
    socket.ws.send(JSON.stringify({ type: "cf_agent_state", state: { ...initial, status: "succeeded", tasks: [] } }));
    const refusal = await socket.next("cf_agent_state_error");
    expect(refusal.error).toBe("Connection is readonly");
    const snapshot = await stub.getSnapshot();
    expect(snapshot.status).toBe("queued");
    expect(snapshot.tasks).toHaveLength(1);
    expect((await readState(stub)).run.status).toBe("queued");
    socket.ws.close();
  });
});
