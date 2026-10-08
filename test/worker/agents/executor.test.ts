import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { SimDirectives } from "../../../src/shared/domain.ts";
import { argsHash, idempotencyKey } from "../../../src/worker/agents/coordinator/credentials.ts";
import { classifyToolResult } from "../../../src/worker/agents/executor-agent.ts";
import { failure, success } from "../../../src/worker/mcp/results.ts";
import { datasetRun, inputFromDataset, journal, runExecutor, runPlanner } from "../../helpers/agents.ts";
import { events, readState, startManualRun, takeDispatches } from "../../helpers/runs.ts";

async function plannedRun(sim: SimDirectives | null = null) {
  const run = datasetRun("syn-0006");
  const started = await startManualRun(inputFromDataset(run, { sim }));
  const [plan] = await takeDispatches(started.stub);
  if (!plan) throw new Error("no plan dispatch");
  await runPlanner(plan.message);
  return { ...started, run };
}

describe("ExecutorAgent", { tags: ["orchestration"] }, () => {
  it("executes a step through MCP with the call-bound token from its claim and records one trace at finish with duration and outcome", async () => {
    const { stub, runId, run } = await plannedRun();
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1");
    expect(await runExecutor(s1.message, "executor-1")).toEqual({ kind: "ack" });
    const [s2] = await takeDispatches(stub);
    if (!s2) throw new Error("no s2");
    expect(await runExecutor(s2.message, "executor-0")).toEqual({ kind: "ack" });
    const state = await readState(stub);
    expect([state.tasks.get(s1.message.taskId)?.status, state.tasks.get(s2.message.taskId)?.status]).toEqual(["succeeded", "succeeded"]);
    const calls = await env.DB.prepare("SELECT task_id, agent, tool, outcome, idempotency_key, duration_ms, attempt, lease_epoch, started_at, finished_at FROM tool_calls WHERE run_id = ? AND tool != 'tools/list' ORDER BY started_at")
      .bind(runId)
      .all<{ task_id: string; agent: string; tool: string; outcome: string; idempotency_key: string | null; duration_ms: number; attempt: number; lease_epoch: number; started_at: string; finished_at: string }>();
    expect(calls.results.map((c) => [c.task_id, c.agent, c.tool, c.outcome, c.attempt, c.lease_epoch])).toEqual([
      [s1.message.taskId, "executor-1", "hris.get_employee", "ok", 1, 1],
      [s2.message.taskId, "executor-0", "hris.update_address", "ok", 1, 1],
    ]);
    expect(calls.results[0]?.idempotency_key).toBeNull();
    expect(calls.results[1]?.idempotency_key).toMatch(/^ik_/);
    for (const c of calls.results) {
      expect(c.duration_ms).toBeGreaterThanOrEqual(0);
      expect(Date.parse(c.finished_at)).toBeGreaterThanOrEqual(Date.parse(c.started_at));
    }
    // The write really happened, once, and the shard's journal knows it.
    const employee = await env.PEOPLE_DB.prepare("SELECT address_json FROM employees WHERE id = ?").bind(run.subjectEmployeeId).first<{ address_json: string }>();
    expect(JSON.parse(employee?.address_json ?? "{}")).toEqual(run.fields.address);
    expect(await env.PEOPLE_DB.prepare("SELECT COUNT(*) AS n FROM side_effects WHERE run_id = ?").bind(runId).first()).toEqual({ n: 1 });
    expect((await journal("executor-0")).find((j) => j.task_id === s2.message.taskId)?.state).toBe("succeeded");
  });

  it("maps retryable and in_progress errors to retryable failures, and permanent and forbidden to non-retryable ones", async () => {
    expect(classifyToolResult(failure("retryable", "upstream", "x"), null, false)).toMatchObject({ outcome: "retryable_error", retryable: true });
    expect(classifyToolResult(failure("in_progress", "in_progress", "x"), null, false)).toMatchObject({ outcome: "in_progress", retryable: true });
    expect(classifyToolResult(failure("permanent", "not_found", "x"), null, false)).toMatchObject({ outcome: "permanent_error", retryable: false });
    expect(classifyToolResult(failure("forbidden", "args_mismatch", "x"), null, false)).toMatchObject({ outcome: "forbidden", retryable: false });
    expect(classifyToolResult(null, new Error("socket closed"), false)).toMatchObject({ outcome: "retryable_error", retryable: true, code: "transport_error" });
    expect(classifyToolResult(success({ id: 1 }, true, true), null, false)).toEqual({ kind: "ok", data: { id: 1 }, replayed: true, logical: true });

    // Live: an injected transient error is retried; an injected permanent error is not.
    const transient = await plannedRun({ faults: [{ stepId: "s2", generation: 0, attempt: 1, kind: "transient_error" }] });
    const permanent = await plannedRun({ faults: [{ stepId: "s2", generation: 0, attempt: 1, kind: "permanent_error" }] });
    for (const [label, started] of [["transient", transient], ["permanent", permanent]] as const) {
      const [s1] = await takeDispatches(started.stub);
      if (!s1) throw new Error("no s1");
      await runExecutor(s1.message);
      const [s2] = await takeDispatches(started.stub);
      if (!s2) throw new Error("no s2");
      await runExecutor(s2.message);
      const failed = (await events(started.stub)).find((e) => e.action === "task.failed");
      if (label === "transient") {
        expect(failed?.detail).toMatchObject({ code: "injected_transient", retryable: true, willRetry: true });
        expect((await readState(started.stub)).tasks.get(s2.message.taskId)?.status).toBe("ready");
        const [retry] = await takeDispatches(started.stub);
        expect(retry?.message.attempt).toBe(2);
      } else {
        expect(failed?.detail).toMatchObject({ code: "injected_permanent", retryable: false, willRetry: false });
        expect((await readState(started.stub)).tasks.get(s2.message.taskId)?.status).toBe("failed");
        expect(await takeDispatches(started.stub)).toEqual([]);
      }
    }
    // in_progress: another holder owns the ledger key; the executor reports a retryable failure.
    const busy = await plannedRun();
    const [b1] = await takeDispatches(busy.stub);
    if (!b1) throw new Error("no s1");
    await runExecutor(b1.message);
    const [b2] = await takeDispatches(busy.stub);
    if (!b2) throw new Error("no s2");
    await env.PEOPLE_DB.prepare(
      `INSERT INTO idempotency (key, tool, args_hash, correlation_id, state, owner, locked_until, created_at)
       SELECT ?, 'hris.update_address', ?, ?, 'in_progress', 'executor-9:other:1', ?, ?`,
    )
      .bind(await ledgerKey(busy.stub, b2.message.taskId), await taskArgsHash(busy.stub, b2.message.taskId), `${busy.runId}:s2`, Date.now() + 60_000, new Date().toISOString())
      .run();
    await runExecutor(b2.message);
    const busyFailure = (await events(busy.stub)).find((e) => e.action === "task.failed");
    expect(busyFailure?.detail).toMatchObject({ code: "in_progress", retryable: true, willRetry: true });
  });

  it("aborts a call exceeding TOOL_TIMEOUT_MS and reports a retryable timeout before the lease expires", async () => {
    const { stub, runId } = await plannedRun();
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1");
    const started = Date.now();
    let aborted = false;
    await runExecutor(s1.message, "executor-0", (_token, _request, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      }),
    );
    const elapsed = Date.now() - started;
    expect(aborted).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(3000);
    const failed = (await events(stub)).find((e) => e.action === "task.failed");
    expect(failed?.detail).toMatchObject({ code: "timeout", retryable: true, willRetry: true });
    const call = await env.DB.prepare("SELECT outcome, duration_ms FROM tool_calls WHERE run_id = ? AND tool = 'hris.get_employee'").bind(runId).first<{ outcome: string; duration_ms: number }>();
    expect(call?.outcome).toBe("timeout");
    expect(call?.duration_ms).toBeGreaterThanOrEqual(1000);
    // Reported on the live lease: the task is ready again, not reaped.
    expect((await events(stub)).some((e) => e.action === "task.lease_expired")).toBe(false);
  });
});

async function ledgerKey(stub: Awaited<ReturnType<typeof startManualRun>>["stub"], taskId: string): Promise<string> {
  const state = await readState(stub);
  const task = state.tasks.get(taskId);
  return idempotencyKey(state.run.id, task?.stepId ?? "", task?.generation ?? 0, task?.tool ?? "", task?.args ?? {});
}

async function taskArgsHash(stub: Awaited<ReturnType<typeof startManualRun>>["stub"], taskId: string): Promise<string> {
  return argsHash((await readState(stub)).tasks.get(taskId)?.args ?? {});
}
