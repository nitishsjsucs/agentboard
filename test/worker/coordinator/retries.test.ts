import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import worker from "../../../src/worker/index.ts";
import { backoff, taskBackoff } from "../../../src/worker/queue/backoff.ts";
import { handleQueueBatch, type ConsumerDeps } from "../../../src/worker/queue/consumer.ts";
import { batchMessage, testConfig } from "../../helpers/queue.ts";
import { claimMessage, completePlan, coordinator, events, planFor, readState, report, startManualRun, takeDispatches } from "../../helpers/runs.ts";

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
