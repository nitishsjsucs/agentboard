import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import worker from "../../../src/worker/index.ts";
import { claim } from "../../../src/worker/agents/coordinator/leases.ts";
import { SYSTEM } from "../../../src/worker/agents/coordinator/schema.ts";
import { applyDerivedStatus, complete, dispatchReady, initRun, newRunState, promote, RunTx } from "../../../src/worker/agents/coordinator/transitions.ts";
import { backoff, taskBackoff } from "../../../src/worker/queue/backoff.ts";
import { handleQueueBatch, type ConsumerDeps } from "../../../src/worker/queue/consumer.ts";
import { batchMessage, testConfig } from "../../helpers/queue.ts";
import { claimMessage, completePlan, coordinator, events, granted, planFor, readState, report, runInput, startManualRun, takeDispatches } from "../../helpers/runs.ts";
import { setCoordinatorClock } from "../../helpers/clock.ts";
import { apiGet, apiPost, json } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import type { DlqMessageView, Page } from "../../../src/shared/api-types.ts";

describe("retry handling", { tags: ["orchestration"] }, () => {
  it("a retryable failure redispatches with delaySeconds from the capped exponential schedule; a non-retryable failure moves the run to needs_attention without redispatch", async () => {
    // The schedule itself: base * 2^(attempt - 1), capped.
    const schedule = { retryBaseDelayS: 2, retryMaxDelayS: 30 };
    expect([1, 2, 3, 4, 5, 6].map((a) => taskBackoff(a, schedule))).toEqual([2, 4, 8, 16, 30, 30]);

    const config = testConfig();
    const { stub } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    // s1 fails retryably on attempt 1, is redispatched as attempt 2 with the scheduled delay, then succeeds.
    const [first] = await takeDispatches(stub);
    if (!first) throw new Error("no dispatch");
    expect(first.message.attempt).toBe(1);
    await report(stub, await claimMessage(stub, first.message), { outcome: "failed", retryable: true, code: "upstream_timeout", usage: {} });
    const [next] = await takeDispatches(stub);
    if (!next) throw new Error("no redispatch");
    expect(next.message).toMatchObject({ taskId: first.message.taskId, attempt: 2 });
    expect(next.delaySeconds).toBe(taskBackoff(1, config));
    const failed = (await events(stub)).filter((e) => e.action === "task.failed");
    expect(failed.at(-1)?.detail).toMatchObject({ code: "upstream_timeout", retryable: true, willRetry: true, attempt: 1, delaySeconds: taskBackoff(1, config) });
    await report(stub, await claimMessage(stub, next.message), { outcome: "succeeded", output: { ok: true }, usage: {} });
    // A non-retryable failure on s2: no redispatch, the run needs attention.
    const [s2] = await takeDispatches(stub);
    if (!s2) throw new Error("no s2");
    await report(stub, await claimMessage(stub, s2.message), { outcome: "failed", retryable: false, code: "permanent", usage: {} });
    expect(await takeDispatches(stub)).toEqual([]);
    const state = await readState(stub);
    expect(state.tasks.get(s2.message.taskId)?.status).toBe("failed");
    expect(state.run.status).toBe("needs_attention");

    // The test project runs with RETRY_BASE_DELAY_S=0, so the delays above are 0. Drive the same pure
    // transitions the coordinator runs in each RPC with a 2 s base: the redispatch carries 2 s, then 4 s.
    const cfg = { leaseTtlMs: 3000, plannerLeaseTtlMs: 6000, approvalTtlMs: 60_000, retryBaseDelayS: 2, retryMaxDelayS: 30, faultInjection: false };
    const pure = newRunState(runInput(), 1_000);
    const transaction = (op: (tx: RunTx) => void): RunTx => {
      const tx = new RunTx(pure, 1_000, cfg);
      applyDerivedStatus(tx);
      op(tx);
      promote(tx);
      applyDerivedStatus(tx);
      dispatchReady(tx);
      return tx;
    };
    let dispatched = transaction((tx) => initRun(tx, SYSTEM)).dispatches;
    expect(dispatched.map((d) => [d.attempt, d.delaySeconds])).toEqual([[1, 0]]);
    for (const expectedDelay of [2, 4]) {
      const dispatch = dispatched[0];
      if (!dispatch) throw new Error("no dispatch");
      transaction((tx) => {
        const decision = claim(tx, { taskId: dispatch.taskId, owner: "planner-0", dispatchId: dispatch.dispatchId }, null);
        if (!decision.ok) throw new Error(`claim refused: ${decision.reason}`);
      });
      const task = pure.tasks.get(dispatch.taskId);
      dispatched = transaction((tx) => {
        complete(tx, { taskId: dispatch.taskId, leaseId: task?.leaseId ?? "", epoch: task?.leaseEpoch ?? 0, outcome: "failed", retryable: true, code: "upstream_timeout", usage: {} });
      }).dispatches;
      expect(dispatched.map((d) => [d.taskId, d.attempt, d.delaySeconds])).toEqual([[dispatch.taskId, dispatch.attempt + 1, expectedDelay]]);
    }
  });

  it("a consumer exception before the claim retries the message with backoff and consumes no task attempt", async () => {
    // The queue-level schedule adds deterministic jitter per message id.
    const schedule = { retryBaseDelayS: 2, retryMaxDelayS: 300 };
    expect(backoff(1, "message-a", schedule)).toBe(backoff(1, "message-a", schedule));
    expect(backoff(3, "message-a", schedule) - taskBackoff(3, schedule)).toBeLessThanOrEqual(2);

    // The test project runs with RETRY_BASE_DELAY_S=0; the consumer gets a 2 s base here so the delay is visible.
    const config = { ...testConfig(), retryBaseDelayS: 2 };
    const { stub } = await startManualRun();
    const [plan] = await takeDispatches(stub);
    if (!plan) throw new Error("no plan dispatch");
    const unreachable: ConsumerDeps = {
      coordinator: async (runId) => coordinator(runId),
      roleAgent: async () => {
        throw new Error("role agent unreachable");
      },
      isRoleDisabled: async () => false,
    };
    const message = batchMessage(plan.message, 2);
    const batch = createMessageBatch("agentboard-tasks", [message]);
    const ctx = createExecutionContext();
    // getQueueResult (vitest-plugin 1.4.0) records which messages were retried but not their delay,
    // so the delay is read from a spy on the message's retry().
    const delivered = batch.messages[0];
    if (!delivered) throw new Error("no message");
    const retrySpy = vi.spyOn(delivered, "retry");
    await handleQueueBatch(batch, env, config, unreachable);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toEqual([{ msgId: message.id }]);
    const expectedDelay = backoff(2, message.id, config);
    expect(expectedDelay).toBeGreaterThanOrEqual(4);
    expect(retrySpy).toHaveBeenCalledWith({ delaySeconds: expectedDelay });
    const task = (await readState(stub)).tasks.get(plan.message.taskId);
    expect([task?.status, task?.attempts, task?.leaseEpoch]).toEqual(["ready", 0, 0]);
    expect((await events(stub)).some((e) => e.action === "task.leased")).toBe(false);
  });

  it("an exception thrown inside role work after a claim is reported as a retryable task failure on the current lease", async () => {
    const config = testConfig();
    // A request the stub planner has no fixture for: planning throws inside the role work.
    const { stub } = await startManualRun({ requestText: "A request no fixture knows about" });
    const [plan] = await takeDispatches(stub);
    if (!plan) throw new Error("no plan dispatch");
    const message = batchMessage(plan.message);
    const batch = createMessageBatch("agentboard-tasks", [message]);
    const ctx = createExecutionContext();
    await handleQueueBatch(batch, env, config);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual([message.id]);
    expect(result.retryMessages).toEqual([]);
    const state = await readState(stub);
    const task = state.tasks.get(plan.message.taskId);
    expect([task?.status, task?.attempts, task?.leaseEpoch, task?.lastError]).toEqual(["ready", 1, 1, "agent_exception"]);
    const failed = (await events(stub)).find((e) => e.action === "task.failed");
    expect(failed?.detail).toMatchObject({ code: "agent_exception", retryable: true, willRetry: true, attempt: 1 });
    const [redispatch] = await takeDispatches(stub);
    expect(redispatch?.message).toMatchObject({ taskId: plan.message.taskId, attempt: 2 });
  });

  it("the DLQ consumer (queue name from DLQ_QUEUE_NAME) dead-letters a task only for its current dispatchId; a superseded dispatch is recorded as ignored_stale", async () => {
    const config = testConfig();
    expect(config.dlqQueueName).toBe("agentboard-tasks-dlq");
    // Current dispatch: recorded and dead-lettered.
    const live = await startManualRun();
    await completePlan(live.stub, planFor("address_change"));
    const [s1] = await takeDispatches(live.stub);
    if (!s1) throw new Error("no s1");
    const current = batchMessage(s1.message, 6);
    const batch = createMessageBatch(config.dlqQueueName, [current]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env);
    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual([current.id]);
    expect(await env.DB.prepare("SELECT outcome, dispatch_id, task_id FROM dlq_messages WHERE id = ?").bind(current.id).first()).toEqual({
      outcome: "dead_lettered",
      dispatch_id: s1.message.dispatchId,
      task_id: s1.message.taskId,
    });
    const state = await readState(live.stub);
    expect(state.tasks.get(s1.message.taskId)?.status).toBe("dead_lettered");
    expect(state.run.status).toBe("needs_attention");

    // Superseded dispatch (the lease expired and the task was redispatched): ignored, task untouched.
    const stale = await startManualRun();
    await completePlan(stale.stub, planFor("address_change"));
    const [old] = await takeDispatches(stale.stub);
    if (!old) throw new Error("no s1");
    granted(await claimMessage(stale.stub, old.message));
    await setCoordinatorClock(stale.stub, 3500);
    await stale.stub.getSnapshot();
    const before = (await readState(stale.stub)).tasks.get(old.message.taskId);
    const superseded = batchMessage(old.message, 6);
    // A preview-style queue name works the same way, because the name comes from config.
    const custom = createMessageBatch("agentboard-preview-tasks-dlq", [superseded]);
    const ctx2 = createExecutionContext();
    await handleQueueBatch(custom, env, { ...config, dlqQueueName: "agentboard-preview-tasks-dlq" });
    expect((await getQueueResult(custom, ctx2)).explicitAcks).toEqual([superseded.id]);
    expect(await env.DB.prepare("SELECT outcome FROM dlq_messages WHERE id = ?").bind(superseded.id).first()).toEqual({ outcome: "ignored_stale" });
    const after = (await readState(stale.stub)).tasks.get(old.message.taskId);
    expect([after?.status, after?.dispatchId]).toEqual([before?.status, before?.dispatchId]);
    expect((await events(stale.stub)).some((e) => e.action === "task.dead_letter_ignored")).toBe(true);
  });

  it("DLQ replay redispatches with a new dispatchId and audits the actor", async () => {
    const config = testConfig();
    const { stub, runId } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1");
    const message = batchMessage(s1.message, 6);
    const batch = createMessageBatch(config.dlqQueueName, [message]);
    await worker.queue(batch, env);
    await getQueueResult(batch, createExecutionContext());
    const listed = await json<Page<DlqMessageView>>(await apiGet(P.operator, "/api/dlq"));
    expect(listed.items.find((m) => m.id === message.id)).toMatchObject({ outcome: "dead_lettered", runId, replayedAt: null });
    // Operators can read the DLQ but only admins replay.
    expect((await apiPost(P.operator, `/api/dlq/${message.id}/replay`, { reason: "try again" })).status).toBe(403);
    const replay = await apiPost(P.admin, `/api/dlq/${message.id}/replay`, { reason: "downstream fixed" });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ accepted: true });
    const [redispatch] = await takeDispatches(stub);
    expect(redispatch?.message.taskId).toBe(s1.message.taskId);
    expect(redispatch?.message.dispatchId).not.toBe(s1.message.dispatchId);
    expect((await readState(stub)).run.status).toBe("running");
    const replayed = (await events(stub)).find((e) => e.action === "dlq.replayed");
    expect(replayed?.detail).toMatchObject({ reason: "downstream fixed" });
    const runAudit = await env.DB.prepare("SELECT actor_id FROM audit_events WHERE stream = ? AND action = 'dlq.replayed'").bind(`run:${runId}`).first<{ actor_id: string }>();
    expect(runAudit?.actor_id).toBe(P.admin);
    const globalAudit = await env.DB.prepare("SELECT actor_id FROM audit_events WHERE stream = 'global' AND action = 'dlq.replayed'").first<{ actor_id: string }>();
    expect(globalAudit?.actor_id).toBe(P.admin);
    expect(await env.DB.prepare("SELECT replayed_by FROM dlq_messages WHERE id = ?").bind(message.id).first()).toEqual({ replayed_by: P.admin });
    expect((await apiPost(P.admin, `/api/dlq/${message.id}/replay`, { reason: "again" })).status).toBe(409);
  });

  it("a schema-invalid (poison) message is acked and audited, not retried", async () => {
    const poison = batchMessage({ v: 1, runId: "not-a-run", role: "executor" });
    const batch = createMessageBatch("agentboard-tasks", [poison]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual([poison.id]);
    expect(result.retryMessages).toEqual([]);
    expect(result.retryBatch.retry).toBe(false);
    const row = await env.DB.prepare("SELECT outcome, attempts FROM dlq_messages WHERE id = ?").bind(poison.id).first();
    expect(row).toEqual({ outcome: "poison", attempts: 1 });
    const audit = await env.DB.prepare("SELECT action, detail_json FROM audit_events WHERE stream = 'global' AND action = 'message.poison'").all<{ action: string; detail_json: string }>();
    expect(audit.results.map((r) => JSON.parse(r.detail_json) as Record<string, unknown>)).toContainEqual({ messageId: poison.id, attempts: 1, reason: "invalid_body" });
  });
});
