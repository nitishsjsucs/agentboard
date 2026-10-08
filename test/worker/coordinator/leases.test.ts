import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { describe, expect, it } from "vitest";
import { verifyIntegrationToken } from "../../../src/worker/auth/integration-tokens.ts";
import { argsHash, idempotencyKey } from "../../../src/worker/agents/coordinator/credentials.ts";
import type { RunCoordinator } from "../../../src/worker/agents/run-coordinator.ts";
import { disarmWake, setCoordinatorClock } from "../../helpers/clock.ts";
import { claimMessage, completePlan, events, granted, planFor, raw, readState, report, startManualRun, takeDispatches } from "../../helpers/runs.ts";

const KEY = Uint8Array.from(atob(env.INTEGRATION_SIGNING_KEY), (c) => c.charCodeAt(0));
const OPERATOR = { kind: "user" as const, id: "ops.lead@agentboard.test" };

async function wakeInfo(stub: Parameters<typeof raw>[0]) {
  return runInDurableObject(raw(stub), async (instance: RunCoordinator) => ({
    wakeAt: instance.sql<{ wake_at: number | null }>`SELECT wake_at FROM ab_run`[0]?.wake_at ?? null,
    schedules: (await instance.listSchedules()).map((s) => ({ callback: s.callback, payload: s.payload })),
  }));
}

describe("leases, fencing, sweep and wake", { tags: ["orchestration"] }, () => {
  it("a claim grants a lease with epoch 1, expiry now plus the role TTL and a call-bound credential, and arms one wake at the ceiling second", async () => {
    const { stub, runId } = await startManualRun();
    const [plan] = await takeDispatches(stub);
    if (!plan) throw new Error("no plan dispatch");
    const before = Date.now();
    const claimResult = granted(await claimMessage(stub, plan.message));
    expect(claimResult.lease.epoch).toBe(1);
    expect(claimResult.lease.expiresAt).toBeGreaterThanOrEqual(before + 6000);
    expect(claimResult.lease.expiresAt).toBeLessThanOrEqual(Date.now() + 6000);
    const planClaims = await verifyIntegrationToken(claimResult.credential?.token ?? "", KEY);
    expect(planClaims).toMatchObject({ kind: "planner", scope: "catalog:read", run_id: runId, task_id: plan.message.taskId, epoch: 1, sub: "planner-0" });
    expect(planClaims.lease_exp_ms).toBe(claimResult.lease.expiresAt);
    expect(planClaims.exp).toBe(Math.ceil(claimResult.lease.expiresAt / 1000));
    const wake = await wakeInfo(stub);
    expect(wake.wakeAt).toBe(Math.ceil(claimResult.lease.expiresAt / 1000) * 1000);
    expect(wake.schedules).toEqual([{ callback: "onWake", payload: { at: wake.wakeAt } }]);

    // An executor credential for a write binds the tool, the canonical args hash and the idempotency key.
    await report(stub, claimResult, { outcome: "succeeded", output: { plan: planFor("address_change") }, usage: {} });
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1 dispatch");
    await report(stub, await claimMessage(stub, s1.message), { outcome: "succeeded", output: { ok: true }, usage: {} });
    const [s2] = await takeDispatches(stub);
    if (!s2) throw new Error("no s2 dispatch");
    const write = granted(await claimMessage(stub, s2.message, 1));
    const claims = await verifyIntegrationToken(write.credential?.token ?? "", KEY);
    const args = write.context.step?.args ?? {};
    expect(claims).toMatchObject({ kind: "executor", tool: "hris.update_address", scope: "hris:write", step_id: "s2", sub: "executor-1", epoch: 1 });
    expect(claims.args_sha256).toBe(argsHash(args));
    expect(claims.idem_key).toBe(idempotencyKey(runId, "s2", 0, "hris.update_address", args));
    expect(write.context.idempotencyKey).toBe(claims.idem_key);
    expect(write.lease.expiresAt - Date.now()).toBeLessThanOrEqual(3000);
  });

  it("concurrent delivery of the same dispatch grants exactly one claim; the other is refused in_flight", async () => {
    const { stub } = await startManualRun();
    const [plan] = await takeDispatches(stub);
    if (!plan) throw new Error("no plan dispatch");
    const results = await Promise.all([claimMessage(stub, plan.message, 0), claimMessage(stub, plan.message, 1), claimMessage(stub, plan.message, 0)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? null : r.reason))).toEqual(["in_flight", "in_flight"]);
    const state = await readState(stub);
    const task = state.tasks.get(plan.message.taskId);
    expect([task?.leaseEpoch, task?.attempts]).toEqual([1, 1]);
    expect((await events(stub)).filter((e) => e.action === "task.leased")).toHaveLength(1);
    expect((await events(stub)).filter((e) => e.action === "task.claim_refused").map((e) => e.detail["reason"])).toEqual(["in_flight", "in_flight"]);
  });

  it("a superseded dispatchId is refused stale_dispatch, including the original message after a sweep redispatch", async () => {
    const { stub } = await startManualRun();
    const [plan] = await takeDispatches(stub);
    if (!plan) throw new Error("no plan dispatch");
    expect(await stub.claimTask({ taskId: plan.message.taskId, owner: "planner-0", dispatchId: crypto.randomUUID() })).toEqual({ ok: false, reason: "stale_dispatch" });
    granted(await claimMessage(stub, plan.message));
    await setCoordinatorClock(stub, 7000);
    await stub.getSnapshot();
    const [redispatch] = await takeDispatches(stub);
    expect(redispatch?.message.taskId).toBe(plan.message.taskId);
    expect(redispatch?.message.dispatchId).not.toBe(plan.message.dispatchId);
    expect(await claimMessage(stub, plan.message)).toEqual({ ok: false, reason: "stale_dispatch" });
    if (!redispatch) throw new Error("no redispatch");
    expect((await claimMessage(stub, redispatch.message)).ok).toBe(true);
  });

  it("the sweep (injected clock) reaps an expired lease, releases its reservation and redispatches with a new dispatchId and attempt + 1", async () => {
    const { stub } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1 dispatch");
    expect(s1.message.attempt).toBe(1);
    granted(await claimMessage(stub, s1.message));
    expect((await readState(stub)).run.usage.toolCallsReserved).toBe(1);
    // Not yet expired: nothing happens.
    await setCoordinatorClock(stub, 2000);
    await stub.getSnapshot();
    expect((await readState(stub)).tasks.get(s1.message.taskId)?.status).toBe("leased");
    await setCoordinatorClock(stub, 3500);
    await stub.getSnapshot();
    const state = await readState(stub);
    const task = state.tasks.get(s1.message.taskId);
    expect([task?.status, task?.attempts]).toEqual(["ready", 1]);
    expect(state.run.usage.toolCallsReserved).toBe(0);
    const [again] = await takeDispatches(stub);
    expect(again?.message).toMatchObject({ taskId: s1.message.taskId, attempt: 2 });
    expect(again?.message.dispatchId).not.toBe(s1.message.dispatchId);
    expect((await events(stub)).filter((e) => e.action === "task.lease_expired")).toHaveLength(1);
    // The sweep is idempotent: running it again changes nothing.
    await stub.getSnapshot();
    expect((await events(stub)).filter((e) => e.action === "task.lease_expired")).toHaveLength(1);
    expect(await takeDispatches(stub)).toEqual([]);
  });

  it("crash window: a lease granted with no wake armed is reaped by the next RPC's sweep, and by onStart after eviction", async () => {
    const { stub, runId } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1 dispatch");
    granted(await claimMessage(stub, s1.message));
    await disarmWake(stub);
    expect((await wakeInfo(stub)).schedules).toEqual([]);
    await setCoordinatorClock(stub, 4000);
    await stub.getSnapshot();
    expect((await readState(stub)).tasks.get(s1.message.taskId)?.status).toBe("ready");

    // Again, but this time the object is evicted before any RPC arrives.
    await setCoordinatorClock(stub, 0);
    const [redispatch] = await takeDispatches(stub);
    if (!redispatch) throw new Error("no redispatch");
    granted(await claimMessage(stub, redispatch.message));
    await disarmWake(stub);
    await runInDurableObject(raw(stub), (instance: RunCoordinator) => {
      instance.sql`UPDATE ab_tasks SET lease_expires_at = ${Date.now() - 1000} WHERE id = ${s1.message.taskId}`;
    });
    await evictDurableObject(raw(stub));
    // getAgentByName starts the Agent (onStart); no RunCoordinator RPC is called.
    await getAgentByName(env.RunCoordinator, runId);
    const state = await runInDurableObject(raw(stub), (instance: RunCoordinator) => instance.loadState());
    expect(state?.tasks.get(s1.message.taskId)?.status).toBe("ready");
    expect(state?.tasks.get(s1.message.taskId)?.attempts).toBe(2);
    expect((await events(stub)).filter((e) => e.action === "task.lease_expired")).toHaveLength(2);
  });

  it("real alarm: with the 3 s TTL the armed wake fires and reaps the lease with no other RPC (within 6 s)", async () => {
    const { stub } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1 dispatch");
    const claimedAt = Date.now();
    granted(await claimMessage(stub, s1.message));
    let status: string | undefined;
    while (Date.now() - claimedAt < 6000) {
      status = await runInDurableObject(raw(stub), (instance: RunCoordinator) => instance.sql<{ status: string }>`SELECT status FROM ab_tasks WHERE id = ${s1.message.taskId}`[0]?.status);
      if (status === "ready") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(status).toBe("ready");
    expect(Date.now() - claimedAt).toBeGreaterThanOrEqual(3000);
    expect((await events(stub)).some((e) => e.action === "task.lease_expired" && e.task_id === s1.message.taskId)).toBe(true);
  }, 15_000);

  it("fencing: a completion carrying an old epoch after a reclaim is refused; release-lease frees a live lease and redispatches", async () => {
    const { stub } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1 dispatch");
    const zombie = granted(await claimMessage(stub, s1.message, 0));
    await setCoordinatorClock(stub, 3500);
    await stub.getSnapshot();
    const [redispatch] = await takeDispatches(stub);
    if (!redispatch) throw new Error("no redispatch");
    const current = granted(await claimMessage(stub, redispatch.message, 1));
    expect(current.lease.epoch).toBe(2);
    expect(await report(stub, zombie, { outcome: "succeeded", output: { ok: true }, usage: {} })).toEqual({ accepted: false, reason: "stale_lease" });
    const zombieTrace = await stub.appendTrace({
      id: "call_zombie",
      taskId: s1.message.taskId,
      leaseId: zombie.lease.leaseId,
      epoch: zombie.lease.epoch,
      stepId: "s1",
      agent: "executor-0",
      tool: "hris.get_employee",
      args: {},
      idempotencyKey: null,
      attempt: 1,
      generation: 0,
      outcome: "ok",
      logical: false,
      result: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      durationMs: 1,
    });
    expect(zombieTrace).toEqual({ accepted: false, reason: "stale_lease" });
    expect((await readState(stub)).tasks.get(s1.message.taskId)?.status).toBe("leased");

    const released = await stub.control({ type: "release_lease", taskId: s1.message.taskId, actor: OPERATOR, reason: "worker is stuck" });
    expect(released.accepted).toBe(true);
    const task = (await readState(stub)).tasks.get(s1.message.taskId);
    expect([task?.status, task?.reservedCalls]).toEqual(["ready", 0]);
    const [fresh] = await takeDispatches(stub);
    expect(fresh?.message.taskId).toBe(s1.message.taskId);
    expect(fresh?.message.dispatchId).not.toBe(redispatch.message.dispatchId);
    expect(await report(stub, current, { outcome: "succeeded", output: { ok: true }, usage: {} })).toEqual({ accepted: false, reason: "stale_lease" });
    expect((await events(stub)).filter((e) => e.action === "task.lease_released")).toHaveLength(1);
  });

  it("a claim on a completed task returns duplicate with no side effects; a claim while the run is paused returns paused and the task stays ready", async () => {
    const { stub } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const plan = [...(await readState(stub)).tasks.values()].find((t) => t.kind === "plan");
    const before = await readState(stub);
    const duplicate = await stub.claimTask({ taskId: plan?.id ?? "", owner: "planner-0", dispatchId: plan?.dispatchId ?? "" });
    expect(duplicate).toEqual({ ok: false, reason: "duplicate" });
    const after = await readState(stub);
    expect(after.tasks.get(plan?.id ?? "")).toEqual(before.tasks.get(plan?.id ?? ""));
    expect(after.run.usage).toEqual(before.run.usage);

    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1 dispatch");
    await stub.control({ type: "pause", actor: OPERATOR, reason: "pause before claim" });
    expect(await claimMessage(stub, s1.message)).toEqual({ ok: false, reason: "paused" });
    const task = (await readState(stub)).tasks.get(s1.message.taskId);
    expect([task?.status, task?.attempts, task?.leaseEpoch]).toEqual(["ready", 0, 0]);
  });
});
