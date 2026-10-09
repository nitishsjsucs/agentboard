import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET } from "../../../src/shared/domain.ts";
import type { ClaimResult, ToolCallTrace } from "../../../src/worker/agents/coordinator/schema.ts";
import { estimateTokens, type LlmRequest } from "../../../src/worker/llm/provider.ts";
import { ScriptedProvider } from "../../../src/worker/llm/stub.ts";
import { datasetRun, inputFromDataset, runPlanner } from "../../helpers/agents.ts";
import { apiPost } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import { setCoordinatorClock } from "../../helpers/clock.ts";
import {
  claimMessage,
  completePlan,
  events,
  granted,
  planFor,
  readState,
  report,
  startManualRun,
  takeDispatches,
  type CoordinatorStub,
} from "../../helpers/runs.ts";

const ADMIN = { kind: "user" as const, id: "admin@agentboard.test" };
const OPERATOR = { kind: "user" as const, id: "ops.lead@agentboard.test" };

function traceFor(claimResult: ClaimResult, id: string, tool = "hris.get_employee"): ToolCallTrace {
  const lease = granted(claimResult);
  const now = Date.now();
  return {
    id,
    taskId: lease.context.taskId,
    leaseId: lease.lease.leaseId,
    epoch: lease.lease.epoch,
    stepId: lease.context.step?.stepId ?? null,
    agent: "executor-0",
    tool,
    args: lease.context.step?.args ?? {},
    idempotencyKey: lease.context.idempotencyKey,
    attempt: lease.context.attempt,
    generation: lease.context.generation,
    outcome: "ok",
    logical: false,
    result: { ok: true },
    error: null,
    startedAt: now,
    finishedAt: now,
    durationMs: 1,
  };
}

/** Claims the next dispatch, traces one call and completes it. */
async function runOne(stub: CoordinatorStub, traceId: string) {
  const [d] = await takeDispatches(stub);
  if (!d) throw new Error("no dispatch");
  const claimResult = await claimMessage(stub, d.message);
  if (!claimResult.ok) return { claimResult, dispatch: d };
  await stub.appendTrace(traceFor(claimResult, traceId));
  await report(stub, claimResult, { outcome: "succeeded", output: { ok: true }, evidence: { ok: true }, usage: {} });
  return { claimResult, dispatch: d };
}

describe("execution budgets", { tags: ["orchestration"] }, () => {
  it("claims reserve tool calls and are refused at maxToolCalls (task budget_blocked, run needs_attention); appendTrace counts a call whose report was lost", async () => {
    const { stub } = await startManualRun({ budget: { ...DEFAULT_BUDGET, maxToolCalls: 3 } });
    await completePlan(stub, planFor("address_change"));
    // s1: a call whose report is lost (trace, then no completion); the lease expires.
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1");
    const lost = await claimMessage(stub, s1.message);
    expect((await readState(stub)).run.usage).toMatchObject({ toolCalls: 0, toolCallsReserved: 1 });
    await stub.appendTrace(traceFor(lost, "call_lost"));
    expect((await readState(stub)).run.usage).toMatchObject({ toolCalls: 1, toolCallsReserved: 0 });
    await setCoordinatorClock(stub, 3500);
    await stub.getSnapshot();
    expect((await readState(stub)).run.usage).toMatchObject({ toolCalls: 1, toolCallsReserved: 0 });
    // s1 again, then s2: three calls in total.
    await runOne(stub, "call_s1_retry");
    await runOne(stub, "call_s2");
    expect((await readState(stub)).run.usage.toolCalls).toBe(3);
    // The verify claim would reserve a fourth call: refused.
    const [verify] = await takeDispatches(stub);
    if (!verify) throw new Error("no verify dispatch");
    expect(await claimMessage(stub, verify.message)).toEqual({ ok: false, reason: "budget_exhausted" });
    const state = await readState(stub);
    expect(state.tasks.get(verify.message.taskId)?.status).toBe("budget_blocked");
    expect(state.run.status).toBe("needs_attention");
    expect(state.run.statusReason).toBe("budget_exhausted");
    expect((await events(stub)).filter((e) => e.action === "budget.exhausted").map((e) => e.detail["budget"])).toEqual(["maxToolCalls"]);
  });

  it("plan-time limits: more than maxSteps steps is rejected, each model request's maxOutputTokens is capped to the LLM budget left (repair included), a cap below 200 fails the plan task without a model call, and a planner claim below the 1500-token floor is refused", async () => {
    const { stub } = await startManualRun({ budget: { ...DEFAULT_BUDGET, maxSteps: 2 } });
    await completePlan(stub, planFor("address_change"));
    const state = await readState(stub);
    const plan = [...state.tasks.values()].find((t) => t.kind === "plan");
    expect([plan?.status, plan?.lastError]).toEqual(["failed", "plan_invalid"]);
    expect([...state.tasks.values()]).toHaveLength(1);
    expect(state.run.status).toBe("needs_attention");
    expect((await events(stub)).find((e) => e.action === "plan.rejected")?.detail["issues"]).toEqual([{ code: "too_many_steps", stepId: null }]);

    // The output cap, through a real PlannerAgent and a scripted model: min(800, remaining - ceil(promptChars / 3)),
    // where remaining is the run's LLM budget minus what this planning attempt already used.
    const request = datasetRun("syn-0006");
    const readOnly = JSON.stringify({ steps: [{ id: "s1", tool: "hris.get_employee", args: { employeeId: request.subjectEmployeeId }, dependsOn: [] }] });
    const gold = JSON.stringify(request.goldPlan);
    const promptChars = (r: LlmRequest) => r.system.length + r.user.length;
    const callTokens = (r: LlmRequest, output: string) => estimateTokens(`${r.system}\n${r.user}`) + estimateTokens(output);
    async function planWith(maxLlmTokens: number, outputs: string[], requestText = request.requestText) {
      const started = await startManualRun(inputFromDataset(request, { requestText, budget: { ...DEFAULT_BUDGET, maxLlmTokens } }));
      const [d] = await takeDispatches(started.stub);
      if (!d) throw new Error("no plan dispatch");
      const model = new ScriptedProvider(outputs);
      expect(await runPlanner(d.message, model)).toEqual({ kind: "ack" });
      const after = await readState(started.stub);
      return { model, state: after, planTask: after.tasks.get(d.message.taskId), stub: started.stub };
    }

    // The default budget (6000) leaves room, so both requests get the 800 ceiling. This run also yields the prompts.
    const probe = await planWith(DEFAULT_BUDGET.maxLlmTokens, [readOnly, gold]);
    const [firstPrompt, repairPrompt] = probe.model.requests;
    if (!firstPrompt || !repairPrompt) throw new Error("expected a plan and a repair request");
    expect([firstPrompt.maxOutputTokens, repairPrompt.maxOutputTokens]).toEqual([800, 800]);
    expect(probe.planTask?.status).toBe("succeeded");

    // A budget that leaves 600 tokens after the prompt: the first request is capped at 600.
    const capped = await planWith(Math.ceil(promptChars(firstPrompt) / 3) + 600, [gold]);
    expect(capped.model.requests.map((r) => [r.user === firstPrompt.user, r.maxOutputTokens])).toEqual([[true, 600]]);
    expect(capped.planTask?.status).toBe("succeeded");

    // The repair's cap subtracts the first call's tokens: a budget that leaves exactly 500 for the repair.
    const repairBudget = callTokens(firstPrompt, readOnly) + Math.ceil(promptChars(repairPrompt) / 3) + 500;
    expect(repairBudget).toBeGreaterThanOrEqual(1500);
    const repaired = await planWith(repairBudget, [readOnly, gold]);
    expect(repaired.model.requests.map((r) => [r.purpose, r.maxOutputTokens])).toEqual([
      ["plan", Math.min(800, repairBudget - Math.ceil(promptChars(firstPrompt) / 3))],
      ["plan_repair", 500],
    ]);
    expect(repaired.planTask?.status).toBe("succeeded");

    // The claim floor (1500) passes, but a long request leaves a cap below 200: the plan task fails
    // non-retryably with llm_budget_exhausted and the model is never called.
    const padding = " Please keep the rest of the employee record as it is.".repeat(60);
    expect(Math.min(800, 1500 - Math.ceil((promptChars(firstPrompt) + padding.length) / 3))).toBeLessThan(200);
    const exhausted = await planWith(1500, [gold], request.requestText + padding);
    expect(exhausted.model.requests).toEqual([]);
    expect([exhausted.planTask?.status, exhausted.planTask?.lastError]).toEqual(["failed", "llm_budget_exhausted"]);
    expect(exhausted.state.run.status).toBe("needs_attention");
    expect(exhausted.state.run.usage.llmTokens).toBe(0);
    expect((await events(exhausted.stub)).find((e) => e.action === "task.failed")?.detail).toMatchObject({ code: "llm_budget_exhausted", retryable: false, willRetry: false });

    const poor = await startManualRun({ budget: { ...DEFAULT_BUDGET, maxLlmTokens: 1400 } });
    const [planDispatch] = await takeDispatches(poor.stub);
    if (!planDispatch) throw new Error("no plan dispatch");
    expect(await claimMessage(poor.stub, planDispatch.message)).toEqual({ ok: false, reason: "budget_exhausted" });
    expect((await events(poor.stub)).find((e) => e.action === "budget.exhausted")?.detail["budget"]).toBe("maxLlmTokens");
  });

  it("a task is not redispatched after maxAttemptsPerTask attempts, by either the retry path or the sweep", async () => {
    const retried = await startManualRun();
    await completePlan(retried.stub, planFor("address_change"));
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [d] = await takeDispatches(retried.stub);
      if (!d) throw new Error(`no dispatch for attempt ${attempt}`);
      expect(d.message.attempt).toBe(attempt);
      await report(retried.stub, await claimMessage(retried.stub, d.message), { outcome: "failed", retryable: true, code: "upstream_unavailable", usage: {} });
    }
    expect(await takeDispatches(retried.stub)).toEqual([]);
    const failed = [...(await readState(retried.stub)).tasks.values()].find((t) => t.stepId === "s1");
    expect([failed?.status, failed?.attempts]).toEqual(["failed", 3]);

    const swept = await startManualRun();
    await completePlan(swept.stub, planFor("address_change"));
    let offset = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [d] = await takeDispatches(swept.stub);
      if (!d) throw new Error(`no dispatch for attempt ${attempt}`);
      granted(await claimMessage(swept.stub, d.message));
      offset += 3500;
      await setCoordinatorClock(swept.stub, offset);
      await swept.stub.getSnapshot();
    }
    expect(await takeDispatches(swept.stub)).toEqual([]);
    const reaped = [...(await readState(swept.stub)).tasks.values()].find((t) => t.stepId === "s1");
    expect([reaped?.status, reaped?.lastError]).toEqual(["failed", "attempts_exhausted"]);
    expect((await readState(swept.stub)).run.status).toBe("needs_attention");
  });

  it("the active-time deadline (injected clock) moves a running run to needs_attention; awaiting_approval and paused time is not counted", async () => {
    const budget = { ...DEFAULT_BUDGET, maxActiveMs: 10_000 };
    // Paused time does not count.
    const paused = await startManualRun({ budget });
    await completePlan(paused.stub, planFor("address_change"));
    await paused.stub.control({ type: "pause", actor: OPERATOR, reason: "lunch" });
    await setCoordinatorClock(paused.stub, 30_000);
    await paused.stub.getSnapshot();
    await paused.stub.control({ type: "resume", actor: OPERATOR, reason: "back" });
    expect((await readState(paused.stub)).run.status).toBe("running");
    await setCoordinatorClock(paused.stub, 41_000);
    await paused.stub.getSnapshot();
    const exceeded = await readState(paused.stub);
    expect(exceeded.run.status).toBe("needs_attention");
    expect(exceeded.run.statusReason).toBe("deadline_exceeded");
    expect((await events(paused.stub)).filter((e) => e.action === "budget.exhausted").map((e) => e.detail["budget"])).toEqual(["maxActiveMs"]);

    // Awaiting-approval time does not count.
    const gated = await startManualRun({ requestType: "manager_change", budget });
    await completePlan(gated.stub, planFor("manager_change"));
    const [s1] = await takeDispatches(gated.stub);
    if (!s1) throw new Error("no s1");
    await report(gated.stub, await claimMessage(gated.stub, s1.message), { outcome: "succeeded", output: { ok: true }, usage: {} });
    expect((await readState(gated.stub)).run.status).toBe("awaiting_approval");
    await setCoordinatorClock(gated.stub, 50_000);
    await gated.stub.getSnapshot();
    const waiting = await readState(gated.stub);
    expect(waiting.run.status).toBe("awaiting_approval");
    expect(waiting.run.deadlineExceeded).toBe(false);
    expect(waiting.run.usage.activeMs).toBeLessThan(10_000);
  });

  it("an admin budget raise unblocks budget_blocked tasks and dispatches them; duplicate reports and traces never double count usage", async () => {
    const { stub, runId } = await startManualRun({ budget: { ...DEFAULT_BUDGET, maxToolCalls: 2 } });
    const [planDispatch] = await takeDispatches(stub);
    if (!planDispatch) throw new Error("no plan dispatch");
    const planLease = await claimMessage(stub, planDispatch.message);
    const planTrace = { ...traceFor(planLease, "call_catalog", "tools/list"), agent: "planner-0", stepId: null };
    await stub.appendTrace(planTrace);
    await stub.appendTrace(planTrace);
    const planReport = { outcome: "succeeded" as const, output: { plan: planFor("address_change") }, usage: { llmTokens: 700 } };
    expect((await report(stub, planLease, planReport)).accepted).toBe(true);
    expect(await report(stub, planLease, planReport)).toEqual({ accepted: false, reason: "duplicate_report" });
    let usage = (await readState(stub)).run.usage;
    expect([usage.toolCalls, usage.llmTokens]).toEqual([1, 700]);

    await runOne(stub, "call_s1");
    const [s2] = await takeDispatches(stub);
    if (!s2) throw new Error("no s2");
    expect(await claimMessage(stub, s2.message)).toEqual({ ok: false, reason: "budget_exhausted" });
    expect((await readState(stub)).run.status).toBe("needs_attention");

    // Operators cannot raise; the coordinator also refuses a lowering, an empty patch and a patch that changes nothing,
    // which would otherwise clear the deadline and redispatch tasks the next claim blocks again.
    expect(await stub.control({ type: "raise_budget", budget: { maxToolCalls: 1 }, actor: ADMIN, reason: "lower" })).toMatchObject({ accepted: false, reason: "not_a_raise" });
    expect(await stub.control({ type: "raise_budget", budget: {}, actor: ADMIN, reason: "empty" })).toMatchObject({ accepted: false, reason: "not_a_raise" });
    expect(await stub.control({ type: "raise_budget", budget: { maxToolCalls: 2 }, actor: ADMIN, reason: "same" })).toMatchObject({ accepted: false, reason: "not_a_raise" });
    expect((await readState(stub)).tasks.get(s2.message.taskId)?.status).toBe("budget_blocked");
    expect(await takeDispatches(stub)).toEqual([]);
    const emptyPatch = await apiPost(P.admin, `/api/runs/${runId}/budget`, { reason: "no field" }, "PATCH");
    expect(emptyPatch.status).toBe(400);
    const raised = await stub.control({ type: "raise_budget", budget: { maxToolCalls: 24 }, actor: ADMIN, reason: "more calls" });
    expect(raised.accepted).toBe(true);
    const state = await readState(stub);
    expect(state.tasks.get(s2.message.taskId)?.status).toBe("ready");
    expect(state.run.status).toBe("running");
    const [unblocked] = await takeDispatches(stub);
    expect(unblocked?.message.taskId).toBe(s2.message.taskId);
    expect(unblocked?.message.dispatchId).not.toBe(s2.message.dispatchId);
    usage = (await readState(stub)).run.usage;
    expect([usage.toolCalls, usage.llmTokens]).toEqual([2, 700]);
    expect((await events(stub)).filter((e) => e.action === "budget.raised")).toHaveLength(1);
  });
});
