// The coordinator's pure state machine (SPEC sections 3.3 to 3.5, 7.3, 7.4).
//
// One RPC loads the whole run into a RunTx, applies the sweep and one
// operation in memory, re-derives the run status, dispatches ready tasks and
// hands the dirty rows, events and dispatches back to the Durable Object,
// which persists them inside the same transactionSync. Nothing here awaits.

import type { AgentRole, RunStatus, TaskStatus } from "../../../shared/domain.ts";
import { auditArgs } from "../../audit/redaction.ts";
import { materializePlan } from "../../planning/materialize.ts";
import { validatePlan } from "../../planning/planner.ts";
import { approvalFor } from "../../planning/policy.ts";
import { taskBackoff } from "../../queue/backoff.ts";
import { newApprovalId, newTaskId } from "../../util/ids.ts";
import { releaseReservation } from "./leases.ts";
import {
  KIND_FOR_ROLE,
  ROLE_FOR_KIND,
  SYSTEM,
  TERMINAL_TASK_STATUSES,
  type Actor,
  type ApprovalDecision,
  type ApprovalRecord,
  type CompletionReport,
  type ControlCommand,
  type ControlResult,
  type InitRunInput,
  type RunRecord,
  type RunState,
  type TaskRecord,
  type ToolCallTrace,
} from "./schema.ts";

export interface TxConfig {
  leaseTtlMs: number;
  plannerLeaseTtlMs: number;
  approvalTtlMs: number;
  retryBaseDelayS: number;
  retryMaxDelayS: number;
  faultInjection: boolean;
}

export interface PendingEvent {
  action: string;
  actorType: Actor["kind"];
  actorId: string;
  taskId: string | null;
  detail: Record<string, unknown>;
}

export interface PendingDispatch {
  taskId: string;
  role: AgentRole;
  dispatchId: string;
  attempt: number;
  delaySeconds: number;
  /** Simulation only: enqueue the same message twice. */
  duplicate: boolean;
}

export { SYSTEM };

const ACTIVE: ReadonlySet<RunStatus> = new Set(["queued", "planning", "running"]);
const DISPATCHING: ReadonlySet<RunStatus> = new Set(["queued", "planning", "running", "awaiting_approval"]);
const TERMINAL_RUN: ReadonlySet<RunStatus> = new Set(["succeeded", "rejected", "cancelled"]);

export class RunTx {
  readonly state: RunState;
  readonly now: number;
  readonly cfg: TxConfig;
  readonly statusAtStart: RunStatus;
  events: PendingEvent[] = [];
  dispatches: PendingDispatch[] = [];
  dirtyTasks = new Set<string>();
  dirtyApprovals = new Set<string>();
  runDirty = false;
  /** Leases reaped by this transaction's sweep: task id to the dispatch id it had. */
  reaped = new Map<string, string | null>();
  /** Delay (seconds) for a task's next dispatch, set by task-level retries. */
  retryDelays = new Map<string, number>();
  /** Accepted tool-call traces (mirrored to D1 by the outbox). */
  traces: ToolCallTrace[] = [];
  /** Accepted completion report, recorded in ab_reports by the caller. */
  acceptedReport: string | null = null;

  constructor(state: RunState, now: number, cfg: TxConfig) {
    this.state = state;
    this.now = now;
    this.cfg = cfg;
    this.statusAtStart = state.run.status;
  }

  get run(): RunRecord {
    return this.state.run;
  }

  tasks(): TaskRecord[] {
    return [...this.state.tasks.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  task(id: string): TaskRecord | undefined {
    return this.state.tasks.get(id);
  }

  emit(action: string, actor: Actor, taskId: string | null, detail: Record<string, unknown> = {}): void {
    this.events.push({ action, actorType: actor.kind, actorId: actor.id, taskId, detail });
  }

  touchTask(task: TaskRecord): void {
    task.updatedAt = this.now;
    this.dirtyTasks.add(task.id);
  }

  touchRun(): void {
    this.runDirty = true;
  }

  touchApproval(approval: ApprovalRecord): void {
    this.dirtyApprovals.add(approval.id);
  }

  get changed(): boolean {
    return this.runDirty || this.events.length > 0 || this.dirtyTasks.size > 0 || this.dirtyApprovals.size > 0;
  }
}

// ---------------------------------------------------------------------------
// Construction

export function newRunState(input: InitRunInput, now: number): RunState {
  const run: RunRecord = {
    id: input.runId,
    request: input,
    status: "queued",
    paused: false,
    cancelled: false,
    statusReason: null,
    deadlineExceeded: false,
    budget: input.budget,
    usage: { toolCalls: 0, toolCallsReserved: 0, llmTokens: 0, activeMs: 0, attempts: 0, replays: 0, skippedSteps: 0 },
    activeSince: now,
    wakeAt: null,
    finishedAt: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
  return { run, tasks: new Map(), approvals: new Map() };
}

function newTask(tx: RunTx, fields: Partial<TaskRecord> & Pick<TaskRecord, "kind" | "status">): TaskRecord {
  const task: TaskRecord = {
    id: newTaskId(tx.now),
    stepId: null,
    tool: null,
    args: null,
    dependsOn: [],
    holdReason: null,
    attempts: 0,
    maxAttempts: tx.run.budget.maxAttemptsPerTask,
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
    version: 0,
    createdAt: tx.now,
    updatedAt: tx.now,
    ...fields,
  };
  tx.state.tasks.set(task.id, task);
  tx.touchTask(task);
  return task;
}

/** initRun on an empty coordinator: the run, its plan task (ready) and run.created. */
export function initRun(tx: RunTx, actor: Actor): void {
  tx.touchRun();
  tx.emit("run.created", actor, null, {
    requestType: tx.run.request.requestType,
    subjectEmployeeId: tx.run.request.subjectEmployeeId,
    requester: tx.run.request.requester,
    priority: tx.run.request.priority,
    syntheticRef: tx.run.request.syntheticRef,
    budget: tx.run.budget,
  });
  newTask(tx, { kind: "plan", status: "ready" });
}

// ---------------------------------------------------------------------------
// Derived run status (SPEC section 3.3)

export function deriveRunStatus(state: RunState): { status: RunStatus; reason: string | null } {
  const { run } = state;
  if (TERMINAL_RUN.has(run.status)) return { status: run.status, reason: run.statusReason };
  const tasks = [...state.tasks.values()];
  if ([...state.approvals.values()].some((a) => a.status === "rejected")) return { status: "rejected", reason: "approval_rejected" };
  if (run.cancelled) return { status: "cancelled", reason: "cancelled" };
  if (run.paused) return { status: "paused", reason: "paused" };

  const failed = tasks.find((t) => t.status === "failed");
  if (failed) return { status: "needs_attention", reason: `task_failed:${failed.lastError ?? "error"}` };
  if (tasks.some((t) => t.status === "budget_blocked")) return { status: "needs_attention", reason: "budget_exhausted" };
  if (tasks.some((t) => t.status === "dead_lettered")) return { status: "needs_attention", reason: "dead_lettered" };
  if (tasks.some((t) => t.status === "rejected")) return { status: "needs_attention", reason: "approval_expired" };
  if (run.deadlineExceeded) return { status: "needs_attention", reason: "deadline_exceeded" };

  const plan = tasks.find((t) => t.kind === "plan");
  if (!plan) return { status: "queued", reason: null };
  if (plan.status !== "succeeded") {
    return plan.status === "leased" || plan.attempts > 0 ? { status: "planning", reason: null } : { status: "queued", reason: null };
  }
  const work = tasks.filter((t) => t.kind !== "plan");
  const live = work.some((t) => t.status === "ready" || t.status === "leased" || t.status === "held");
  if (work.some((t) => t.status === "awaiting_approval") && !live) return { status: "awaiting_approval", reason: null };
  if (work.length > 0 && work.every((t) => t.status === "succeeded" || t.status === "skipped")) return { status: "succeeded", reason: null };
  return { status: "running", reason: null };
}

export function applyDerivedStatus(tx: RunTx): void {
  const run = tx.run;
  const next = deriveRunStatus(tx.state);
  if (next.status === run.status && next.reason === run.statusReason) return;
  const from = run.status;
  if (ACTIVE.has(from) && !ACTIVE.has(next.status) && run.activeSince !== null) {
    run.usage.activeMs += Math.max(0, tx.now - run.activeSince);
    run.activeSince = null;
  } else if (!ACTIVE.has(from) && ACTIVE.has(next.status)) {
    run.activeSince = tx.now;
  }
  run.status = next.status;
  run.statusReason = next.reason;
  if (TERMINAL_RUN.has(next.status)) run.finishedAt = tx.now;
  tx.touchRun();
  if (from !== next.status) tx.emit("run.status_changed", SYSTEM, null, { from, to: next.status, reason: next.reason });
}

export function isDispatching(status: RunStatus): boolean {
  return DISPATCHING.has(status);
}

// ---------------------------------------------------------------------------
// Readiness, approvals, checkpoints and dispatch

function depsDone(tx: RunTx, task: TaskRecord): boolean {
  return task.dependsOn.every((id) => {
    const dep = tx.task(id);
    return dep !== undefined && (dep.status === "succeeded" || dep.status === "skipped");
  });
}

export function approvalSummary(tool: string, args: Record<string, unknown>): string {
  const employee = String(args["employeeId"] ?? "?");
  switch (tool) {
    case "hris.update_manager":
      return `Change the manager of ${employee} to ${String(args["managerId"])}`;
    case "hris.set_employment_status":
      return `Set the employment status of ${employee} to ${String(args["status"])} effective ${String(args["effectiveDate"])}`;
    case "access.grant_role":
      return `Grant ${String(args["system"])}:${String(args["role"])} to ${employee}`;
    default:
      return `${tool} for ${employee}`;
  }
}

/** Moves pending tasks whose dependencies are done to ready, held (checkpoint) or awaiting_approval. */
export function promote(tx: RunTx): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tx.tasks()) {
      if (task.status !== "pending" || !depsDone(tx, task)) continue;
      changed = true;
      if (task.requiresApproval && task.kind === "execute") {
        const step = { tool: task.tool ?? "", args: task.args ?? {} };
        const risk = approvalFor(step).risk ?? "high";
        const approval: ApprovalRecord = {
          id: newApprovalId(tx.now),
          taskId: task.id,
          generation: task.generation,
          tool: step.tool,
          summary: approvalSummary(step.tool, step.args),
          risk,
          status: "pending",
          requestedAt: tx.now,
          expiresAt: tx.now + tx.cfg.approvalTtlMs,
          decidedBy: null,
          decidedAt: null,
          note: null,
          version: 0,
        };
        tx.state.approvals.set(approval.id, approval);
        tx.touchApproval(approval);
        task.status = "awaiting_approval";
        task.approvalId = approval.id;
        tx.touchTask(task);
        tx.emit("approval.requested", SYSTEM, task.id, { approvalId: approval.id, tool: approval.tool, risk, summary: approval.summary });
        continue;
      }
      makeReady(tx, task);
    }
  }
}

/** A task becoming ready; the first readiness of the simulation's checkpoint step parks it instead. */
function makeReady(tx: RunTx, task: TaskRecord): void {
  const sim = tx.run.request.sim;
  if (
    tx.cfg.faultInjection &&
    sim?.checkpointStep !== undefined &&
    task.kind === "execute" &&
    task.stepId === sim.checkpointStep &&
    !task.checkpointDone
  ) {
    task.status = "held";
    task.holdReason = "checkpoint";
    task.checkpointDone = true;
    task.dispatchId = null;
    tx.touchTask(task);
    tx.emit("task.held", SYSTEM, task.id, { reason: "checkpoint", stepId: task.stepId });
    return;
  }
  task.status = "ready";
  task.holdReason = null;
  task.dispatchId = null;
  tx.touchTask(task);
}

function dispatchTask(tx: RunTx, task: TaskRecord): void {
  const previous = task.dispatchId;
  const dispatchId = crypto.randomUUID();
  const delaySeconds = tx.retryDelays.get(task.id) ?? 0;
  const sim = tx.run.request.sim;
  const duplicate =
    tx.cfg.faultInjection &&
    sim?.duplicateDeliveryStep !== undefined &&
    task.kind === "execute" &&
    task.stepId === sim.duplicateDeliveryStep &&
    previous === null &&
    task.attempts === 0 &&
    task.generation === 0;
  task.dispatchId = dispatchId;
  tx.touchTask(task);
  const attempt = task.attempts + 1;
  tx.dispatches.push({ taskId: task.id, role: ROLE_FOR_KIND[task.kind], dispatchId, attempt, delaySeconds, duplicate });
  tx.emit("task.dispatched", SYSTEM, task.id, { dispatchId, attempt, delaySeconds, ...(duplicate ? { duplicateDelivery: true } : {}) });
}

/**
 * Dispatches ready tasks when the run allows it. A task becoming ready gets
 * one dispatch. When the run leaves `paused` or `needs_attention` in this
 * transaction, every ready task is redispatched once with a new dispatchId
 * (its previous message was refused, or is superseded).
 */
export function dispatchReady(tx: RunTx): void {
  if (!isDispatching(tx.run.status)) return;
  const redispatchAll = tx.statusAtStart === "paused" || tx.statusAtStart === "needs_attention";
  for (const task of tx.tasks()) {
    if (task.status !== "ready") continue;
    if (task.dispatchId === null || redispatchAll) dispatchTask(tx, task);
  }
}

// ---------------------------------------------------------------------------
// Traces and completions

export function appendTrace(tx: RunTx, trace: ToolCallTrace): { accepted: boolean; reason?: string } {
  const task = tx.task(trace.taskId);
  if (!task || task.leaseId !== trace.leaseId || task.leaseEpoch !== trace.epoch || (task.status !== "leased" && task.status !== "cancelled")) {
    return { accepted: false, reason: "stale_lease" };
  }
  const usage = tx.run.usage;
  usage.toolCalls += 1;
  if (task.reservedCalls > 0) {
    task.reservedCalls -= 1;
    usage.toolCallsReserved = Math.max(0, usage.toolCallsReserved - 1);
    tx.touchTask(task);
  }
  if (trace.outcome === "replayed") usage.replays += 1;
  tx.touchRun();
  tx.traces.push(trace);
  tx.emit("tool.called", { kind: "agent", id: trace.agent }, task.id, {
    callId: trace.id,
    stepId: trace.stepId,
    outcome: trace.outcome,
    logical: trace.logical,
    durationMs: trace.durationMs,
    attempt: trace.attempt,
    generation: trace.generation,
    idempotencyKey: trace.idempotencyKey,
    ...auditArgs(trace.tool, (trace.args as Record<string, unknown> | null) ?? null),
  });
  return { accepted: true };
}

export function complete(tx: RunTx, report: CompletionReport): { accepted: boolean; reason?: string } {
  const task = tx.task(report.taskId);
  if (!task || task.leaseId !== report.leaseId || task.leaseEpoch !== report.epoch || task.status !== "leased") {
    return { accepted: false, reason: "stale_lease" };
  }
  tx.acceptedReport = report.leaseId;
  const agent: Actor = { kind: "agent", id: task.leaseOwner ?? "agent" };
  releaseReservation(tx, task);
  task.leaseExpiresAt = null;
  if (report.usage.llmTokens && report.usage.llmTokens > 0) {
    tx.run.usage.llmTokens += report.usage.llmTokens;
    tx.touchRun();
  }
  tx.touchTask(task);

  if (report.outcome === "succeeded") {
    if (task.kind === "plan") return acceptPlan(tx, task, report, agent);
    task.status = "succeeded";
    task.lastError = null;
    task.result = task.kind === "verify" ? (report.evidence ?? report.output ?? null) : (report.output ?? null);
    if (task.kind === "verify") tx.emit("verify.passed", agent, task.id, { stepId: task.stepId, tool: task.tool });
    else tx.emit("task.succeeded", agent, task.id, { stepId: task.stepId, kind: task.kind, attempt: task.attempts });
    return { accepted: true };
  }

  const code = report.code ?? "error";
  if (task.kind === "verify" && code === "postcondition_failed") {
    tx.emit("verify.failed", agent, task.id, { stepId: task.stepId, tool: task.tool, evidence: report.evidence ?? null });
  }
  failOrRetry(tx, task, code, report.retryable === true, agent, report.evidence);
  return { accepted: true };
}

function failOrRetry(tx: RunTx, task: TaskRecord, code: string, retryable: boolean, actor: Actor, evidence?: unknown): void {
  const willRetry = retryable && task.attempts < task.maxAttempts;
  task.lastError = code;
  if (willRetry) {
    task.status = "ready";
    task.dispatchId = null;
    tx.retryDelays.set(task.id, taskBackoff(task.attempts, tx.cfg));
  } else {
    task.status = "failed";
  }
  tx.touchTask(task);
  tx.emit("task.failed", actor, task.id, {
    code,
    retryable,
    willRetry,
    attempt: task.attempts,
    ...(willRetry ? { delaySeconds: tx.retryDelays.get(task.id) } : {}),
    ...(!willRetry && retryable ? { reason: "attempts_exhausted" } : {}),
    ...(evidence !== undefined && evidence !== null ? { evidence } : {}),
  });
  if (evidence !== undefined && evidence !== null && task.kind === "plan") task.result = evidence;
}

function acceptPlan(tx: RunTx, task: TaskRecord, report: CompletionReport, agent: Actor): { accepted: boolean; reason?: string } {
  const output = report.output as { plan?: unknown } | null | undefined;
  const validation = validatePlan(output?.plan ?? null, {
    requestType: tx.run.request.requestType,
    subjectEmployeeId: tx.run.request.subjectEmployeeId,
    maxSteps: tx.run.budget.maxSteps,
  });
  if (!validation.ok) {
    task.status = "failed";
    task.lastError = "plan_invalid";
    task.result = { issues: validation.issues };
    tx.touchTask(task);
    tx.emit("plan.rejected", agent, task.id, { issues: validation.issues.map((i) => ({ code: i.code, stepId: i.stepId ?? null })), policyViolations: validation.policyViolations });
    return { accepted: true };
  }
  const graph = materializePlan(validation.plan);
  if (!graph.ok) {
    task.status = "failed";
    task.lastError = "plan_invalid";
    tx.touchTask(task);
    tx.emit("plan.rejected", agent, task.id, { issues: [{ code: "cycle", stepId: null }] });
    return { accepted: true };
  }
  task.status = "succeeded";
  task.lastError = null;
  task.result = { plan: validation.plan };
  const ids = new Map<string, string>();
  for (const spec of graph.tasks) ids.set(spec.key, newTaskId(tx.now));
  for (const spec of graph.tasks) {
    const created = newTask(tx, {
      id: ids.get(spec.key) ?? newTaskId(tx.now),
      kind: spec.kind,
      stepId: spec.stepId,
      tool: spec.tool,
      args: spec.args,
      dependsOn: spec.dependsOn.map((key) => ids.get(key) ?? key),
      status: "pending",
      requiresApproval: spec.requiresApproval,
    });
    void created;
  }
  tx.emit("plan.accepted", agent, task.id, {
    steps: validation.plan.steps.map((s) => ({ stepId: s.id, tool: s.tool, dependsOn: s.dependsOn })),
    gated: graph.tasks.filter((t) => t.requiresApproval).map((t) => t.stepId),
    tasks: graph.tasks.length,
  });
  return { accepted: true };
}

// ---------------------------------------------------------------------------
// Recovery commands (SPEC section 3.5)

function verifyTaskFor(tx: RunTx, execute: TaskRecord): TaskRecord | undefined {
  return tx.tasks().find((t) => t.kind === "verify" && t.stepId === execute.stepId);
}

function executeTaskFor(tx: RunTx, verify: TaskRecord): TaskRecord | undefined {
  return tx.tasks().find((t) => t.kind === "execute" && t.stepId === verify.stepId);
}

function resetForRetry(tx: RunTx, task: TaskRecord, status: TaskStatus): void {
  task.status = status;
  task.generation += 1;
  task.attempts = 0;
  task.lastError = null;
  task.result = null;
  task.holdReason = null;
  task.dispatchId = null;
  task.leaseExpiresAt = null;
  if (status === "pending") task.approvalId = null;
  tx.touchTask(task);
}

const OPEN_FOR_CANCEL: ReadonlySet<TaskStatus> = new Set(["pending", "ready", "leased", "held", "awaiting_approval", "budget_blocked", "dead_lettered"]);

export function control(tx: RunTx, cmd: ControlCommand, budgetRaise: ((tx: RunTx, cmd: Extract<ControlCommand, { type: "raise_budget" }>) => ControlResult) | null): ControlResult {
  const run = tx.run;
  const terminal = TERMINAL_RUN.has(run.status);
  const commandDetail = { reason: cmd.reason };
  switch (cmd.type) {
    case "pause": {
      if (terminal || run.paused || !["queued", "planning", "running", "needs_attention"].includes(run.status)) return { accepted: false, reason: "invalid_state" };
      run.paused = true;
      tx.touchRun();
      tx.emit("run.paused", cmd.actor, null, commandDetail);
      return { accepted: true };
    }
    case "resume": {
      if (!run.paused) return { accepted: false, reason: "invalid_state" };
      run.paused = false;
      tx.touchRun();
      tx.emit("run.resumed", cmd.actor, null, commandDetail);
      for (const task of tx.tasks()) {
        if (task.status === "held" && task.holdReason === "checkpoint") {
          task.status = "ready";
          task.holdReason = null;
          task.dispatchId = null;
          tx.touchTask(task);
          tx.emit("task.released", cmd.actor, task.id, { reason: "checkpoint", cascadeFrom: null });
        }
      }
      return { accepted: true };
    }
    case "cancel": {
      if (terminal) return { accepted: false, reason: "invalid_state" };
      const cancelled: string[] = [];
      for (const task of tx.tasks()) {
        if (!OPEN_FOR_CANCEL.has(task.status)) continue;
        if (task.status === "leased") releaseReservation(tx, task);
        task.status = "cancelled";
        task.holdReason = null;
        tx.touchTask(task);
        cancelled.push(task.id);
      }
      for (const approval of tx.state.approvals.values()) {
        if (approval.status !== "pending") continue;
        approval.status = "expired";
        approval.note = "run cancelled";
        approval.decidedAt = tx.now;
        tx.touchApproval(approval);
        tx.emit("approval.expired", cmd.actor, approval.taskId, { approvalId: approval.id, reason: "run_cancelled" });
      }
      run.cancelled = true;
      tx.touchRun();
      tx.emit("run.cancelled", cmd.actor, null, { ...commandDetail, cancelledTasks: cancelled.length });
      return { accepted: true };
    }
    case "retry_task":
      return retryTask(tx, cmd.taskId, cmd.actor, cmd.reason);
    case "skip_task":
      return skipTask(tx, cmd.taskId, cmd.actor, cmd.reason);
    case "release_lease": {
      const task = tx.task(cmd.taskId);
      if (!task) return { accepted: false, reason: "not_found" };
      if (task.status !== "leased") return { accepted: false, reason: "invalid_state" };
      releaseReservation(tx, task);
      task.status = "ready";
      task.dispatchId = null;
      task.leaseExpiresAt = null;
      tx.touchTask(task);
      tx.emit("task.lease_released", cmd.actor, task.id, { ...commandDetail, epoch: task.leaseEpoch, owner: task.leaseOwner });
      return { accepted: true };
    }
    case "raise_budget":
      if (terminal) return { accepted: false, reason: "invalid_state" };
      return budgetRaise ? budgetRaise(tx, cmd) : { accepted: false, reason: "unsupported" };
    case "hold_role": {
      const task = tx.task(cmd.taskId);
      if (!task || task.dispatchId !== cmd.dispatchId || task.status !== "ready" || ROLE_FOR_KIND[task.kind] !== cmd.role) {
        return { accepted: false, reason: "stale_dispatch" };
      }
      task.status = "held";
      task.holdReason = "role_disabled";
      task.dispatchId = null;
      tx.touchTask(task);
      tx.emit("task.held", cmd.actor, task.id, { reason: "role_disabled", role: cmd.role });
      return { accepted: true };
    }
    case "release_role": {
      let released = 0;
      for (const task of tx.tasks()) {
        if (task.status !== "held" || task.holdReason !== "role_disabled" || task.kind !== KIND_FOR_ROLE[cmd.role]) continue;
        task.status = "ready";
        task.holdReason = null;
        task.dispatchId = null;
        tx.touchTask(task);
        tx.emit("task.released", cmd.actor, task.id, { reason: "role_enabled", role: cmd.role });
        released += 1;
      }
      return { accepted: true, reason: released === 0 ? "nothing_held" : `released:${released}` };
    }
    case "dead_letter": {
      const task = tx.task(cmd.taskId);
      const reapedFrom = tx.reaped.get(cmd.taskId);
      const current = task !== undefined && task.status === "ready" && (task.dispatchId === cmd.dispatchId || reapedFrom === cmd.dispatchId);
      if (!task || !current) {
        if (task) tx.emit("task.dead_letter_ignored", cmd.actor, task.id, { dispatchId: cmd.dispatchId });
        return { accepted: false, reason: "stale_dispatch" };
      }
      // A redispatch queued by this transaction's sweep is superseded by the dead-letter.
      tx.dispatches = tx.dispatches.filter((d) => d.taskId !== task.id);
      task.status = "dead_lettered";
      task.dispatchId = cmd.dispatchId;
      tx.touchTask(task);
      tx.emit("task.dead_lettered", cmd.actor, task.id, { dispatchId: cmd.dispatchId });
      return { accepted: true };
    }
    case "replay_dead_letter": {
      const task = tx.task(cmd.taskId);
      if (!task) return { accepted: false, reason: "not_found" };
      if (task.status !== "dead_lettered") return { accepted: false, reason: "invalid_state" };
      task.status = "ready";
      task.dispatchId = null;
      tx.touchTask(task);
      tx.emit("dlq.replayed", cmd.actor, task.id, commandDetail);
      return { accepted: true };
    }
  }
}

function retryTask(tx: RunTx, taskId: string, actor: Actor, reason: string): ControlResult {
  if (TERMINAL_RUN.has(tx.run.status)) return { accepted: false, reason: "invalid_state" };
  const task = tx.task(taskId);
  if (!task) return { accepted: false, reason: "not_found" };
  const detail = (extra: Record<string, unknown>) => ({ reason, ...extra });

  if (task.status === "rejected") {
    const approval = task.approvalId ? tx.state.approvals.get(task.approvalId) : undefined;
    if (!approval || approval.status !== "expired") return { accepted: false, reason: "not_retryable" };
    resetForRetry(tx, task, "pending");
    tx.emit("task.retried", actor, task.id, detail({ generation: task.generation, from: "rejected", to: "pending" }));
    return { accepted: true };
  }

  if (task.kind === "execute") {
    const verify = verifyTaskFor(tx, task);
    const eligible = task.status === "failed" || task.status === "dead_lettered" || (task.status === "succeeded" && verify?.status === "failed");
    if (!eligible) return { accepted: false, reason: "not_retryable" };
    const from = task.status;
    resetForRetry(tx, task, "ready");
    tx.emit("task.retried", actor, task.id, detail({ generation: task.generation, from, to: "ready" }));
    if (verify && verify.status !== "pending") {
      const verifyFrom = verify.status;
      resetForRetry(tx, verify, "pending");
      tx.emit("task.retried", actor, verify.id, detail({ generation: verify.generation, from: verifyFrom, to: "pending", cascadeFrom: task.id }));
    } else if (verify) {
      verify.generation += 1;
      tx.touchTask(verify);
      tx.emit("task.retried", actor, verify.id, detail({ generation: verify.generation, from: "pending", to: "pending", cascadeFrom: task.id }));
    }
    return { accepted: true };
  }

  if (task.kind === "verify") {
    const execute = executeTaskFor(tx, task);
    if (task.status !== "failed" || execute?.status !== "succeeded") return { accepted: false, reason: "not_retryable" };
    resetForRetry(tx, task, "ready");
    tx.emit("task.retried", actor, task.id, detail({ generation: task.generation, from: "failed", to: "ready" }));
    return { accepted: true };
  }

  // plan
  if (task.status !== "failed" && task.status !== "dead_lettered") return { accepted: false, reason: "not_retryable" };
  const from = task.status;
  resetForRetry(tx, task, "ready");
  tx.emit("task.retried", actor, task.id, detail({ generation: task.generation, from, to: "ready" }));
  return { accepted: true };
}

function skipTask(tx: RunTx, taskId: string, actor: Actor, reason: string): ControlResult {
  if (TERMINAL_RUN.has(tx.run.status)) return { accepted: false, reason: "invalid_state" };
  const task = tx.task(taskId);
  if (!task) return { accepted: false, reason: "not_found" };
  if (task.kind === "plan" || task.requiresApproval) return { accepted: false, reason: "not_skippable" };
  if (task.kind === "execute") {
    if (task.status !== "failed" && task.status !== "dead_lettered") return { accepted: false, reason: "invalid_state" };
    task.status = "skipped";
    tx.touchTask(task);
    tx.run.usage.skippedSteps += 1;
    tx.touchRun();
    tx.emit("task.skipped", actor, task.id, { reason, stepId: task.stepId, tool: task.tool });
    const verify = verifyTaskFor(tx, task);
    if (verify && !TERMINAL_TASK_STATUSES.has(verify.status)) {
      verify.status = "skipped";
      tx.touchTask(verify);
      tx.emit("task.skipped", actor, verify.id, { reason, stepId: verify.stepId, cascadeFrom: task.id });
    }
    return { accepted: true };
  }
  // verify
  if (task.status !== "failed") return { accepted: false, reason: "invalid_state" };
  task.status = "skipped";
  tx.touchTask(task);
  tx.emit("task.skipped", actor, task.id, { reason, stepId: task.stepId, unverified: true });
  return { accepted: true };
}

// ---------------------------------------------------------------------------
// Approvals (SPEC section 9.2): the coordinator is the only writer.

export type ApprovalRefusal = "self_approval" | "already_decided" | "expired" | "not_found";

export function resolveApproval(tx: RunTx, decision: ApprovalDecision): { accepted: boolean; reason?: ApprovalRefusal } {
  const approval = tx.state.approvals.get(decision.approvalId);
  if (!approval) return { accepted: false, reason: "not_found" };
  // The sweep already ran in this transaction, so an approval past its expiry is expired here.
  if (approval.status === "expired") return { accepted: false, reason: "expired" };
  if (approval.status !== "pending") return { accepted: false, reason: "already_decided" };
  if (decision.actor.id.toLowerCase() === tx.run.request.requester.toLowerCase()) return { accepted: false, reason: "self_approval" };
  const task = tx.task(approval.taskId);
  if (!task || task.status !== "awaiting_approval") return { accepted: false, reason: "already_decided" };

  approval.status = decision.decision === "approve" ? "approved" : "rejected";
  approval.decidedBy = decision.actor.id;
  approval.decidedAt = tx.now;
  approval.note = decision.note;
  tx.touchApproval(approval);
  tx.emit("approval.decided", decision.actor, task.id, { approvalId: approval.id, decision: decision.decision, note: decision.note, tool: approval.tool });
  if (decision.decision === "approve") {
    makeReady(tx, task);
    return { accepted: true };
  }
  // Reject: the gated task is rejected and every other open task is cancelled; the run is rejected.
  task.status = "rejected";
  task.lastError = "approval_rejected";
  tx.touchTask(task);
  for (const other of tx.tasks()) {
    if (other.id === task.id || !OPEN_FOR_CANCEL.has(other.status)) continue;
    if (other.status === "leased") releaseReservation(tx, other);
    other.status = "cancelled";
    other.holdReason = null;
    tx.touchTask(other);
  }
  return { accepted: true };
}

/** Reads every value a stub's status depends on; exported for tests and the snapshot. */
export function openTaskCount(state: RunState): number {
  return [...state.tasks.values()].filter((t) => !TERMINAL_TASK_STATUSES.has(t.status)).length;
}
