import { describe, expect, it } from "vitest";
import type { TaskStatus } from "../../../src/shared/domain.ts";
import type { RunState, TaskRecord } from "../../../src/worker/agents/coordinator/schema.ts";
import { control, deriveRunStatus, newRunState, RunTx } from "../../../src/worker/agents/coordinator/transitions.ts";
import {
  claimMessage,
  completePlan,
  drain,
  events,
  fakeOutput,
  granted,
  planFor,
  readState,
  report,
  runInput,
  startManualRun,
  takeDispatches,
} from "../../helpers/runs.ts";

const OPERATOR = { kind: "user" as const, id: "ops.lead@agentboard.test" };
const ADMIN = { kind: "user" as const, id: "admin@agentboard.test" };
const TX_CFG = { leaseTtlMs: 3000, plannerLeaseTtlMs: 6000, approvalTtlMs: 60000, retryBaseDelayS: 0, retryMaxDelayS: 300, faultInjection: true };

function tasksByStep(state: RunState): Map<string, TaskRecord> {
  const out = new Map<string, TaskRecord>();
  for (const t of state.tasks.values()) out.set(t.kind === "plan" ? "plan" : `${t.kind === "execute" ? "x" : "v"}:${t.stepId}`, t);
  return out;
}

/** A synthetic in-memory run with a succeeded plan and one task per given status. */
function syntheticState(statuses: { kind: TaskRecord["kind"]; status: TaskStatus; holdReason?: TaskRecord["holdReason"] }[]): RunState {
  const state = newRunState(runInput(), 1_000);
  const base = (i: number, kind: TaskRecord["kind"], status: TaskStatus): TaskRecord => ({
    id: `tsk_${String(i).padStart(26, "0")}`,
    kind,
    stepId: kind === "plan" ? null : `s${i}`,
    tool: kind === "plan" ? null : "hris.update_address",
    args: null,
    dependsOn: [],
    status,
    holdReason: null,
    attempts: 0,
    maxAttempts: 3,
    generation: 0,
    requiresApproval: false,
    approvalId: null,
    dispatchId: null,
    leaseId: null,
    leaseOwner: null,
    leaseEpoch: 0,
    leaseExpiresAt: null,
    reservedCalls: 0,
    result: null,
    lastError: null,
    checkpointDone: false,
    version: 1,
    createdAt: 1_000 + i,
    updatedAt: 1_000 + i,
  });
  state.tasks.set("plan", { ...base(0, "plan", "succeeded"), id: "tsk_PLAN" });
  statuses.forEach((s, i) => {
    const task = { ...base(i + 1, s.kind, s.status), holdReason: s.holdReason ?? null };
    state.tasks.set(task.id, task);
  });
  return state;
}

describe("RunCoordinator state machine", { tags: ["orchestration"] }, () => {
  it("initRun is idempotent per run id and creates exactly one plan task", async () => {
    const { stub, input } = await startManualRun();
    const again = await stub.initRun({ ...input, title: "a different title" });
    expect(again.runId).toBe(input.runId);
    const state = await readState(stub);
    expect([...state.tasks.values()].map((t) => [t.kind, t.status])).toEqual([["plan", "ready"]]);
    expect(state.run.request.title).toBe(input.title);
    const all = await events(stub);
    expect(all.filter((e) => e.action === "run.created")).toHaveLength(1);
    expect(all.filter((e) => e.action === "task.dispatched")).toHaveLength(1);
    expect(await takeDispatches(stub)).toHaveLength(1);
  });

  it("completing the plan materializes one execute task per step, verify tasks only for writes, and gating edges to the approval-gated step's verify task", async () => {
    const { stub } = await startManualRun({ requestType: "offboarding" });
    await completePlan(stub, planFor("offboarding"));
    const state = await readState(stub);
    const byStep = tasksByStep(state);
    const executes = [...state.tasks.values()].filter((t) => t.kind === "execute");
    const verifies = [...state.tasks.values()].filter((t) => t.kind === "verify");
    expect(executes.map((t) => t.stepId).sort()).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    // s1 (hris.get_employee) is a read: no verify task.
    expect(verifies.map((t) => t.stepId).sort()).toEqual(["s2", "s3", "s4", "s5"]);
    const id = (key: string) => byStep.get(key)?.id;
    expect(byStep.get("x:s2")?.requiresApproval).toBe(true);
    expect(byStep.get("x:s2")?.dependsOn).toEqual([id("x:s1")]);
    for (const step of ["s3", "s4", "s5"]) expect(byStep.get(`x:${step}`)?.dependsOn).toContain(id("v:s2"));
    for (const step of ["s2", "s3", "s4", "s5"]) expect(byStep.get(`v:${step}`)?.dependsOn).toEqual([id(`x:${step}`)]);
    expect(byStep.get("x:s1")?.status).toBe("ready");
    expect(state.run.status).toBe("running");
  });

  it("a task becomes ready only when every dependsOn task is succeeded or skipped", async () => {
    const { stub } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const statusOf = async (key: string) => tasksByStep(await readState(stub)).get(key)?.status;
    expect(await statusOf("x:s1")).toBe("ready");
    expect(await statusOf("x:s2")).toBe("pending");
    expect(await statusOf("x:s3")).toBe("pending");
    // Run s1 only.
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1 dispatch");
    await report(stub, await claimMessage(stub, s1.message), { outcome: "succeeded", output: { ok: true }, usage: {} });
    expect(await statusOf("x:s2")).toBe("ready");
    expect(await statusOf("x:s3")).toBe("pending");
    // Execute s2: its verify task becomes ready, s3 still waits for the verify.
    const [s2] = await takeDispatches(stub);
    if (!s2) throw new Error("no s2 dispatch");
    await report(stub, await claimMessage(stub, s2.message), { outcome: "succeeded", output: { ok: true }, usage: {} });
    expect(await statusOf("v:s2")).toBe("ready");
    expect(await statusOf("x:s3")).toBe("pending");
    const [v2] = await takeDispatches(stub);
    if (!v2) throw new Error("no verify dispatch");
    await report(stub, await claimMessage(stub, v2.message), { outcome: "succeeded", evidence: { matched: true }, usage: {} });
    expect(await statusOf("x:s3")).toBe("ready");
  });

  it("refuses illegal transitions, and a terminal run refuses further transitions and reports", async () => {
    const { stub } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1 dispatch");
    const lease = await claimMessage(stub, s1.message);
    await report(stub, lease, { outcome: "succeeded", output: { ok: true }, usage: {} });
    const s1Task = granted(lease).context.taskId;
    // succeeded -> ready without a retry command: a redelivered claim is a duplicate, and retry is refused.
    expect(await claimMessage(stub, s1.message)).toEqual({ ok: false, reason: "duplicate" });
    expect(await stub.control({ type: "retry_task", taskId: s1Task, actor: OPERATOR, reason: "try again" })).toMatchObject({ accepted: false, reason: "not_retryable" });
    const plan = [...(await readState(stub)).tasks.values()].find((t) => t.kind === "plan");
    expect(await stub.control({ type: "skip_task", taskId: plan?.id ?? "", actor: ADMIN, reason: "skip plan" })).toMatchObject({ accepted: false, reason: "not_skippable" });
    // A second report for the same lease is ignored.
    expect(await report(stub, lease, { outcome: "failed", retryable: false, code: "late", usage: {} })).toEqual({ accepted: false, reason: "duplicate_report" });

    const [s2] = await takeDispatches(stub);
    if (!s2) throw new Error("no s2 dispatch");
    const s2Lease = await claimMessage(stub, s2.message);
    expect((await stub.control({ type: "cancel", actor: OPERATOR, reason: "operator cancel" })).accepted).toBe(true);
    const after = await readState(stub);
    expect(after.run.status).toBe("cancelled");
    // Terminal: no claims, no reports, no recovery commands.
    expect(await report(stub, s2Lease, { outcome: "succeeded", output: { ok: true }, usage: {} })).toMatchObject({ accepted: false });
    expect(await claimMessage(stub, s2.message)).toEqual({ ok: false, reason: "cancelled" });
    for (const type of ["pause", "cancel"] as const) {
      expect(await stub.control({ type, actor: OPERATOR, reason: "again" })).toMatchObject({ accepted: false, reason: "invalid_state" });
    }
    expect(await stub.control({ type: "retry_task", taskId: granted(s2Lease).context.taskId, actor: OPERATOR, reason: "again" })).toMatchObject({ accepted: false });
    expect((await readState(stub)).run.status).toBe("cancelled");
  });

  it("derives the run status with the SPEC 3.3 precedence; a run succeeds only when every execute and verify task is succeeded or skipped", async () => {
    const cases: [Parameters<typeof syntheticState>[0], string, { paused?: boolean; deadline?: boolean }?][] = [
      [[{ kind: "execute", status: "succeeded" }, { kind: "verify", status: "succeeded" }], "succeeded"],
      [[{ kind: "execute", status: "skipped" }, { kind: "verify", status: "skipped" }], "succeeded"],
      [[{ kind: "execute", status: "succeeded" }, { kind: "verify", status: "pending" }], "running"],
      [[{ kind: "execute", status: "succeeded" }, { kind: "verify", status: "ready" }], "running"],
      [[{ kind: "execute", status: "awaiting_approval" }], "awaiting_approval"],
      [[{ kind: "execute", status: "awaiting_approval" }, { kind: "execute", status: "ready" }], "running"],
      [[{ kind: "execute", status: "awaiting_approval" }, { kind: "execute", status: "held", holdReason: "checkpoint" }], "running"],
      [[{ kind: "execute", status: "failed" }, { kind: "execute", status: "ready" }], "needs_attention"],
      [[{ kind: "execute", status: "budget_blocked" }], "needs_attention"],
      [[{ kind: "execute", status: "dead_lettered" }], "needs_attention"],
      [[{ kind: "execute", status: "rejected" }], "needs_attention"],
      [[{ kind: "execute", status: "ready" }], "needs_attention", { deadline: true }],
      [[{ kind: "execute", status: "failed" }], "paused", { paused: true }],
      [[{ kind: "execute", status: "ready" }], "paused", { paused: true }],
    ];
    for (const [tasks, expected, flags] of cases) {
      const state = syntheticState(tasks);
      state.run.status = "running";
      state.run.paused = flags?.paused ?? false;
      state.run.deadlineExceeded = flags?.deadline ?? false;
      expect(deriveRunStatus(state).status, JSON.stringify({ tasks, flags })).toBe(expected);
    }
    // Planning precedence: an unfinished plan is queued before its first lease, planning after.
    const queued = syntheticState([]);
    const plan = queued.tasks.get("plan") as TaskRecord;
    plan.status = "ready";
    expect(deriveRunStatus(queued).status).toBe("queued");
    plan.attempts = 1;
    plan.status = "leased";
    expect(deriveRunStatus(queued).status).toBe("planning");
    // Terminal stays terminal.
    const done = syntheticState([{ kind: "execute", status: "failed" }]);
    done.run.status = "succeeded";
    expect(deriveRunStatus(done).status).toBe("succeeded");

    // Live: the run is not succeeded until the last verify task succeeds.
    const { stub } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    expect(await drain(stub)).toEqual([]);
    const state = await readState(stub);
    expect([...state.tasks.values()].every((t) => t.status === "succeeded")).toBe(true);
    expect(state.run.status).toBe("succeeded");
    expect(state.run.finishedAt).not.toBeNull();
  });

  it("cancel cancels pending, ready, leased, held, awaiting-approval, budget-blocked and dead-lettered tasks and refuses the holder's completion", async () => {
    const open: TaskStatus[] = ["pending", "ready", "leased", "held", "awaiting_approval", "budget_blocked", "dead_lettered"];
    const state = syntheticState([...open.map((status) => ({ kind: "execute" as const, status })), { kind: "execute", status: "succeeded" }]);
    state.run.status = "running";
    const tx = new RunTx(state, 2_000, TX_CFG);
    expect(control(tx, { type: "cancel", actor: OPERATOR, reason: "stop" }, null)).toEqual({ accepted: true });
    const statuses = [...state.tasks.values()].filter((t) => t.kind === "execute").map((t) => t.status);
    expect(statuses).toEqual([...open.map(() => "cancelled"), "succeeded"]);
    expect(deriveRunStatus(state).status).toBe("cancelled");

    const { stub } = await startManualRun();
    const [planDispatch] = await takeDispatches(stub);
    if (!planDispatch) throw new Error("no plan dispatch");
    const holder = await claimMessage(stub, planDispatch.message);
    expect(holder.ok).toBe(true);
    await stub.control({ type: "cancel", actor: OPERATOR, reason: "stop" });
    expect(await report(stub, holder, { outcome: "succeeded", output: { plan: planFor("address_change") }, usage: {} })).toMatchObject({ accepted: false });
    const live = await readState(stub);
    expect([...live.tasks.values()].map((t) => t.status)).toEqual(["cancelled"]);
    expect(live.run.status).toBe("cancelled");
  });

  it("pause stops dispatch of newly ready tasks; resume releases checkpoint holds and dispatches each ready task exactly once", async () => {
    // Pause while s1 is leased: completing it makes s2 ready, but nothing is dispatched until resume.
    const { stub } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1 dispatch");
    const lease = await claimMessage(stub, s1.message);
    expect((await stub.control({ type: "pause", actor: OPERATOR, reason: "hold on" })).accepted).toBe(true);
    await report(stub, lease, { outcome: "succeeded", output: fakeOutput("hris.get_employee"), usage: {} });
    expect((await readState(stub)).run.status).toBe("paused");
    expect(await takeDispatches(stub)).toEqual([]);
    expect((await stub.control({ type: "resume", actor: OPERATOR, reason: "go" })).accepted).toBe(true);
    const resumed = await takeDispatches(stub);
    expect(resumed.map((d) => d.message.role)).toEqual(["executor"]);
    expect(await takeDispatches(stub)).toEqual([]);

    // Checkpoint: s2 is parked when it first becomes ready; pause and resume release it with one dispatch.
    const parked = await startManualRun({ sim: { checkpointStep: "s2" } });
    await completePlan(parked.stub, planFor("address_change"));
    const [p1] = await takeDispatches(parked.stub);
    if (!p1) throw new Error("no s1 dispatch");
    await report(parked.stub, await claimMessage(parked.stub, p1.message), { outcome: "succeeded", output: { ok: true }, usage: {} });
    const held = tasksByStep(await readState(parked.stub)).get("x:s2");
    expect([held?.status, held?.holdReason]).toEqual(["held", "checkpoint"]);
    expect(await takeDispatches(parked.stub)).toEqual([]);
    await parked.stub.control({ type: "pause", actor: OPERATOR, reason: "inspect" });
    expect((await readState(parked.stub)).run.status).toBe("paused");
    await parked.stub.control({ type: "resume", actor: OPERATOR, reason: "continue" });
    const released = await takeDispatches(parked.stub);
    expect(released).toHaveLength(1);
    expect(released[0]?.message.taskId).toBe(held?.id);
    expect(tasksByStep(await readState(parked.stub)).get("x:s2")?.status).toBe("ready");
    expect((await events(parked.stub)).filter((e) => e.action === "task.released")).toHaveLength(1);
  });

  it("skip cascade: skipping a failed notify.send execute task also skips its verify task, writes both task.skipped events, and the run succeeds", async () => {
    // Everything succeeds except notify.send (s3), which fails permanently.
    const second = await startManualRun();
    await completePlan(second.stub, planFor("address_change"));
    const s3Id = tasksByStep(await readState(second.stub)).get("x:s3")?.id;
    await drain(second.stub, (m) => m.taskId === s3Id);
    // drain left the s3 dispatch untaken; take it now and fail it permanently.
    const s3 = (await readState(second.stub)).tasks.get(s3Id ?? "");
    expect(s3?.status).toBe("ready");
    const lease = await second.stub.claimTask({ taskId: s3Id ?? "", owner: "executor-0", dispatchId: s3?.dispatchId ?? "" });
    await report(second.stub, lease, { outcome: "failed", retryable: false, code: "permanent", usage: {} });
    let state = await readState(second.stub);
    expect(state.run.status).toBe("needs_attention");
    const result = await second.stub.control({ type: "skip_task", taskId: s3Id ?? "", actor: ADMIN, reason: "notification not needed" });
    expect(result.accepted).toBe(true);
    state = await readState(second.stub);
    const byStep = tasksByStep(state);
    expect(byStep.get("x:s3")?.status).toBe("skipped");
    expect(byStep.get("v:s3")?.status).toBe("skipped");
    const skipped = (await events(second.stub)).filter((e) => e.action === "task.skipped");
    expect(skipped.map((e) => e.task_id)).toEqual([byStep.get("x:s3")?.id, byStep.get("v:s3")?.id]);
    expect(skipped[1]?.detail["cascadeFrom"]).toBe(byStep.get("x:s3")?.id);
    expect(new Set(skipped.map((e) => e.seq)).size).toBe(2);
    expect(state.run.status).toBe("succeeded");
    expect(state.run.usage.skippedSteps).toBe(1);
  });

  it("retry cascade: retrying an execute task whose verify failed resets the verify task to pending at generation + 1; a direct retry of that pending verify is refused", async () => {
    const { stub } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    // s1 and s2 succeed; the verify of s2 fails its postcondition.
    for (let i = 0; i < 2; i++) {
      const [d] = await takeDispatches(stub);
      if (!d) throw new Error("missing dispatch");
      await report(stub, await claimMessage(stub, d.message), { outcome: "succeeded", output: { ok: true }, usage: {} });
    }
    const [verify] = await takeDispatches(stub);
    if (!verify) throw new Error("no verify dispatch");
    expect(verify.message.role).toBe("verifier");
    await report(stub, await claimMessage(stub, verify.message), { outcome: "failed", retryable: false, code: "postcondition_failed", evidence: { expected: "x", actual: "y" }, usage: {} });
    let byStep = tasksByStep(await readState(stub));
    expect(byStep.get("v:s2")?.status).toBe("failed");
    expect((await readState(stub)).run.status).toBe("needs_attention");

    const x2 = byStep.get("x:s2");
    const result = await stub.control({ type: "retry_task", taskId: x2?.id ?? "", actor: OPERATOR, reason: "re-run the write" });
    expect(result.accepted).toBe(true);
    byStep = tasksByStep(await readState(stub));
    expect([byStep.get("x:s2")?.status, byStep.get("x:s2")?.generation, byStep.get("x:s2")?.attempts]).toEqual(["ready", 1, 0]);
    expect([byStep.get("v:s2")?.status, byStep.get("v:s2")?.generation, byStep.get("v:s2")?.lastError]).toEqual(["pending", 1, null]);
    const retried = (await events(stub)).filter((e) => e.action === "task.retried");
    expect(retried.map((e) => e.task_id)).toEqual([x2?.id, byStep.get("v:s2")?.id]);
    expect(retried[1]?.detail["cascadeFrom"]).toBe(x2?.id);
    // The verify task is pending now: a direct retry is refused.
    expect(await stub.control({ type: "retry_task", taskId: byStep.get("v:s2")?.id ?? "", actor: OPERATOR, reason: "retry verify" })).toMatchObject({
      accepted: false,
      reason: "not_retryable",
    });
    // The run is back to running with the execute task redispatched once.
    expect((await readState(stub)).run.status).toBe("running");
    expect((await takeDispatches(stub)).map((d) => d.message.taskId)).toEqual([x2?.id]);
  });
});
