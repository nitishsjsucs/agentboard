import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { SyntheticRun } from "../../../src/shared/synth/generator.ts";
import type { PlannerAgent } from "../../../src/worker/agents/planner-agent.ts";
import { estimateTokens } from "../../../src/worker/llm/provider.ts";
import { ScriptedProvider } from "../../../src/worker/llm/stub.ts";
import { validatePlan } from "../../../src/worker/planning/planner.ts";
import { datasetRun, distinctRuns, firstRunOfType, inputFromDataset, plannerAgent, planningLog, runPlanner } from "../../helpers/agents.ts";
import { claimMessage, events, readState, report, startManualRun, takeDispatches, type CoordinatorStub } from "../../helpers/runs.ts";

describe("PlannerAgent", { tags: ["orchestration"] }, () => {
  it("accepts a valid stub plan and validates its arguments against the registry schemas", async () => {
    const run = datasetRun("syn-0006");
    const { stub, runId } = await startManualRun(inputFromDataset(run));
    const [plan] = await takeDispatches(stub);
    if (!plan) throw new Error("no plan dispatch");
    expect(await runPlanner(plan.message)).toEqual({ kind: "ack" });
    const state = await readState(stub);
    const planTask = [...state.tasks.values()].find((t) => t.kind === "plan");
    expect(planTask?.status).toBe("succeeded");
    const executes = [...state.tasks.values()].filter((t) => t.kind === "execute").sort((a, b) => (a.stepId ?? "").localeCompare(b.stepId ?? ""));
    expect(executes.map((t) => [t.stepId, t.tool, t.args])).toEqual(run.goldPlan.steps.map((s) => [s.id, s.tool, s.args]));
    expect(state.run.usage.llmTokens).toBeGreaterThan(0);
    const log = (await planningLog()).filter((row) => row.task_id === plan.message.taskId);
    expect(log).toEqual([{ task_id: plan.message.taskId, valid_first_pass: 1, repaired: 0, error: null, provider: "stub" }]);
    const traced = await env.DB.prepare("SELECT tool, agent FROM tool_calls WHERE run_id = ?").bind(runId).all<{ tool: string; agent: string }>();
    expect(traced.results.every((r) => r.tool === "tools/list" && r.agent === "planner-0")).toBe(true);

    // Registry schemas are strict: an unknown argument or a malformed id is invalid_args.
    const ctx = { requestType: run.requestType, subjectEmployeeId: run.subjectEmployeeId, maxSteps: 8 };
    const extraArg = { steps: [{ id: "s1", tool: "hris.get_employee", args: { employeeId: run.subjectEmployeeId, includeSalary: true }, dependsOn: [] }] };
    const badId = { steps: [{ id: "s1", tool: "hris.get_employee", args: { employeeId: "1014" }, dependsOn: [] }] };
    for (const candidate of [extraArg, badId]) {
      const result = validatePlan(JSON.stringify(candidate), ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.map((i) => i.code)).toContain("invalid_args");
    }
  });

  it("invalid output triggers exactly one repair prompt that includes the validation errors; a valid repair is accepted", async () => {
    const run = datasetRun("syn-0006");
    const { stub } = await startManualRun(inputFromDataset(run));
    const [plan] = await takeDispatches(stub);
    if (!plan) throw new Error("no plan dispatch");
    const bad = JSON.stringify({ steps: [{ id: "s1", tool: "hris.update_address", args: { employeeId: run.subjectEmployeeId, address: { line1: "x" } }, dependsOn: [] }] });
    const scripted = new ScriptedProvider([bad, JSON.stringify(run.goldPlan)]);
    await runPlanner(plan.message, scripted);
    expect(scripted.requests.map((r) => r.purpose)).toEqual(["plan", "plan_repair"]);
    const repairPrompt = scripted.requests[1]?.user ?? "";
    expect(repairPrompt).toContain("It was rejected for these reasons:");
    expect(repairPrompt).toContain("invalid_args (s1)");
    expect(repairPrompt).toContain(bad);
    const state = await readState(stub);
    expect([...state.tasks.values()].find((t) => t.kind === "plan")?.status).toBe("succeeded");
    expect([...state.tasks.values()].filter((t) => t.kind === "execute")).toHaveLength(run.goldPlan.steps.length);
    expect((await planningLog()).filter((r) => r.task_id === plan.message.taskId).map((r) => [r.valid_first_pass, r.repaired])).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it("two invalid outputs fail the plan task as non-retryable with the errors attached", async () => {
    const run = datasetRun("syn-0006");
    const { stub } = await startManualRun(inputFromDataset(run));
    const [plan] = await takeDispatches(stub);
    if (!plan) throw new Error("no plan dispatch");
    const scripted = new ScriptedProvider(["not json at all", JSON.stringify({ steps: [{ id: "s1", tool: "hris.fire_everyone", args: {}, dependsOn: [] }] })]);
    await runPlanner(plan.message, scripted);
    expect(scripted.requests).toHaveLength(2);
    const state = await readState(stub);
    const planTask = state.tasks.get(plan.message.taskId);
    expect([planTask?.status, planTask?.lastError]).toEqual(["failed", "plan_invalid"]);
    expect([...state.tasks.values()]).toHaveLength(1);
    expect(state.run.status).toBe("needs_attention");
    expect(await takeDispatches(stub)).toEqual([]);
    const failed = (await events(stub)).find((e) => e.action === "task.failed");
    expect(failed?.detail).toMatchObject({ code: "plan_invalid", retryable: false, willRetry: false });
    expect((failed?.detail["evidence"] as { issues: { code: string }[] }).issues.map((i) => i.code)).toEqual(["unknown_tool", "missing_required_step"]);
  });

  it("a plan without the request type's required write is repaired once, and fails the plan task when the repair still lacks it", async () => {
    const run = firstRunOfType("manager_change");
    const ctx = { requestType: run.requestType, subjectEmployeeId: run.subjectEmployeeId, maxSteps: 8 };
    // Valid on every per-step rule: without the plan-level check it materialized one read, the run succeeded and no approval was asked.
    const readOnly = JSON.stringify({ steps: [{ id: "s1", tool: "hris.get_employee", args: { employeeId: run.subjectEmployeeId }, dependsOn: [] }] });
    const direct = validatePlan(readOnly, ctx);
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.issues).toEqual([{ code: "missing_required_step", message: "a manager_change plan must include hris.update_manager" }]);

    // The repair names the missing write; a repair that adds it is accepted, and the write waits for an approver.
    const repaired = await startManualRun(inputFromDataset(run));
    const [first] = await takeDispatches(repaired.stub);
    if (!first) throw new Error("no plan dispatch");
    const fixed = new ScriptedProvider([readOnly, JSON.stringify(run.goldPlan)]);
    await runPlanner(first.message, fixed);
    expect(fixed.requests[0]?.user).not.toContain("missing_required_step");
    expect(fixed.requests[1]?.user).toContain("missing_required_step: a manager_change plan must include hris.update_manager");
    let state = await readState(repaired.stub);
    expect([...state.tasks.values()].filter((t) => t.kind === "execute").map((t) => [t.tool, t.requiresApproval]).sort()).toEqual([
      ["hris.get_employee", false],
      ["hris.update_manager", true],
      ["notify.send", false],
    ]);

    // Two plans without the write: the plan task fails non-retryable and nothing is materialized.
    const rejected = await startManualRun(inputFromDataset(run));
    const [second] = await takeDispatches(rejected.stub);
    if (!second) throw new Error("no plan dispatch");
    await runPlanner(second.message, new ScriptedProvider([readOnly, readOnly]));
    state = await readState(rejected.stub);
    expect([...state.tasks.values()].map((t) => [t.kind, t.status, t.lastError])).toEqual([["plan", "failed", "plan_invalid"]]);
    expect(state.run.status).toBe("needs_attention");
    const failed = (await events(rejected.stub)).find((e) => e.action === "task.failed");
    expect((failed?.detail["evidence"] as { issues: { code: string }[] }).issues.map((i) => i.code)).toEqual(["missing_required_step"]);
  });

  it("a model call that throws after an earlier call still reports that call's tokens: the retry is counted against the LLM budget", async () => {
    const run = datasetRun("syn-0006");
    const { stub } = await startManualRun(inputFromDataset(run));
    const [plan] = await takeDispatches(stub);
    if (!plan) throw new Error("no plan dispatch");
    // The first output is invalid; the repair call then throws (the scripted provider has no second output).
    const bad = JSON.stringify({ steps: [{ id: "s1", tool: "hris.get_employee", args: { employeeId: run.subjectEmployeeId }, dependsOn: [] }] });
    const scripted = new ScriptedProvider([bad]);
    expect(await runPlanner(plan.message, scripted)).toEqual({ kind: "ack" });
    expect(scripted.requests.map((r) => r.purpose)).toEqual(["plan", "plan_repair"]);
    const first = scripted.requests[0];
    if (!first) throw new Error("no first request");
    const firstCallTokens = estimateTokens(`${first.system}\n${first.user}`) + estimateTokens(bad);
    const state = await readState(stub);
    expect(state.run.usage.llmTokens).toBe(firstCallTokens);
    const task = state.tasks.get(plan.message.taskId);
    expect([task?.status, task?.attempts, task?.lastError]).toEqual(["ready", 1, "agent_exception"]);
    const failed = (await events(stub)).find((e) => e.action === "task.failed");
    expect(failed?.detail).toMatchObject({ code: "agent_exception", retryable: true, willRetry: true });
    const log = (await planningLog()).filter((row) => row.task_id === plan.message.taskId);
    expect(log.map((row) => [row.repaired, row.error])).toEqual([
      [0, "llm_error"],
      [1, "llm_error"],
    ]);
  });

  it("approval flags come from policy: a privileged grant requires approval even when the model says it does not", async () => {
    const run = firstRunOfType("privileged_access");
    const { stub } = await startManualRun(inputFromDataset(run));
    const [plan] = await takeDispatches(stub);
    if (!plan) throw new Error("no plan dispatch");
    const steps = run.goldPlan.steps.map((s) => ({ ...s, requiresApproval: false, risk: "low" }));
    await runPlanner(plan.message, new ScriptedProvider([JSON.stringify({ steps })]));
    let state = await readState(stub);
    const grant = [...state.tasks.values()].find((t) => t.kind === "execute" && t.tool === "access.grant_role");
    expect(grant?.requiresApproval).toBe(true);
    // Once the read step is done, the grant waits for an approver (risk from policy: high).
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1");
    await report(stub, await claimMessage(stub, s1.message), { outcome: "succeeded", output: { ok: true }, usage: {} });
    state = await readState(stub);
    expect(state.tasks.get(grant?.id ?? "")?.status).toBe("awaiting_approval");
    expect([...state.approvals.values()].map((a) => [a.tool, a.risk, a.status])).toEqual([["access.grant_role", "high", "pending"]]);
    expect(state.run.status).toBe("awaiting_approval");
  });

  it("planner tasks that reach a shard while its catalog read is in flight share that read and its outcome: one tools/list call is traced", async () => {
    // No other test in this file uses this shard, so its catalog cache starts empty.
    const agent = await plannerAgent("planner-1");
    let reads = 0;
    let gate = Promise.withResolvers<void>();
    let fail = true;
    await runInDurableObject(agent as unknown as DurableObjectStub<PlannerAgent>, (instance: PlannerAgent) => {
      instance.catalogReadOverride = async (read) => {
        reads += 1;
        await gate.promise;
        if (fail) throw new Error("catalog read failed");
        return read();
      };
    });
    const planTasks = async (stubs: CoordinatorStub[]) => Promise.all(stubs.map(async (stub) => [...(await readState(stub)).tasks.values()].find((t) => t.kind === "plan")));
    // Holds the first read open until every task is leased and has had time to reach its catalog lookup.
    const concurrently = async (runs: SyntheticRun[]) => {
      const started = await Promise.all(runs.map((run) => startManualRun(inputFromDataset(run))));
      const messages = await Promise.all(
        started.map(async ({ stub }) => {
          const [plan] = await takeDispatches(stub);
          if (!plan) throw new Error("no plan dispatch");
          return plan.message;
        }),
      );
      const handled = Promise.all(messages.map((message) => agent.handleTask(message)));
      for (let i = 0; i < 100 && !(await planTasks(started.map((s) => s.stub))).every((t) => t?.status === "leased"); i++) await scheduler.wait(20);
      await scheduler.wait(300);
      gate.resolve();
      expect(await handled).toEqual(messages.map(() => ({ kind: "ack" })));
      return started;
    };
    const tracedCatalogReads = async (runIds: string[]) =>
      (await env.DB.prepare(`SELECT run_id FROM tool_calls WHERE tool = 'tools/list' AND run_id IN (${runIds.map(() => "?").join(", ")})`).bind(...runIds).all<{ run_id: string }>()).results;
    const [a, b, c, d, e] = distinctRuns("address_change", 5);
    if (!a || !b || !c || !d || !e) throw new Error("not enough runs");

    // A failed read fails every task that waited for it, retryably; nothing is cached or traced.
    const failed = await concurrently([a, b]);
    expect(reads).toBe(1);
    expect((await planTasks(failed.map((s) => s.stub))).map((t) => [t?.status, t?.lastError])).toEqual([
      ["ready", "agent_exception"],
      ["ready", "agent_exception"],
    ]);
    expect(await tracedCatalogReads(failed.map((s) => s.runId))).toEqual([]);

    // A successful read is shared: three tasks plan with one read, and it is traced once.
    reads = 0;
    fail = false;
    gate = Promise.withResolvers<void>();
    const shared = await concurrently([c, d, e]);
    expect(reads).toBe(1);
    expect((await planTasks(shared.map((s) => s.stub))).map((t) => t?.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(await tracedCatalogReads(shared.map((s) => s.runId))).toHaveLength(1);
  });
});
