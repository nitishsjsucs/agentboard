import type { ApprovalListItem, AuditEventView, MetricsSummary, RunDetailResponse, RunSnapshot, RunSummary, TaskView } from "../../../shared/api-types.ts";

export function task(overrides: Partial<TaskView> & Pick<TaskView, "id" | "kind">): TaskView {
  return {
    stepId: null,
    tool: null,
    args: null,
    dependsOn: [],
    status: "pending",
    holdReason: null,
    attempts: 0,
    generation: 0,
    requiresApproval: false,
    lease: null,
    lastError: null,
    updatedAt: "2026-10-08T12:00:00.000Z",
    ...overrides,
  };
}

/** A run that needs attention: s2's write succeeded but its verification failed, and s3 is leased. */
export function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    runId: "run_01J00000000000000000000000",
    status: "needs_attention",
    statusReason: "task_failed:postcondition_failed",
    budget: { maxSteps: 8, maxToolCalls: 24, maxLlmTokens: 6000, maxAttemptsPerTask: 3, maxActiveMs: 900000 },
    usage: { toolCalls: 4, toolCallsReserved: 1, llmTokens: 900, activeMs: 4000, attempts: 5, replays: 0, skippedSteps: 0 },
    tasks: [
      task({ id: "tsk_plan", kind: "plan", status: "succeeded", attempts: 1 }),
      task({ id: "tsk_x1", kind: "execute", stepId: "s1", tool: "hris.get_employee", status: "succeeded", attempts: 1 }),
      task({ id: "tsk_x2", kind: "execute", stepId: "s2", tool: "hris.update_address", status: "succeeded", attempts: 1 }),
      task({ id: "tsk_v2", kind: "verify", stepId: "s2", tool: "hris.update_address", status: "failed", attempts: 1, lastError: "postcondition_failed" }),
      task({
        id: "tsk_x3",
        kind: "execute",
        stepId: "s3",
        tool: "notify.send",
        status: "leased",
        attempts: 2,
        lease: { owner: "executor-1", epoch: 2, expiresAt: "2026-10-08T12:00:30.000Z" },
      }),
    ],
    recentEvents: [],
    pendingApprovalIds: [],
    version: 9,
    ...overrides,
  };
}

/** A run detail response for the snapshot above (status, budget, usage and tasks taken from it). */
export function runDetail(overrides: { status?: RunSnapshot["status"]; statusReason?: string | null; requester?: string; requestText?: string | null; approvals?: ApprovalListItem[]; tasks?: TaskView[] } = {}): RunDetailResponse {
  const snap = snapshot();
  return {
    run: {
      id: snap.runId,
      title: "Address change for Halia Elsworth (E-1048)",
      requestType: "address_change",
      status: overrides.status ?? snap.status,
      statusReason: overrides.statusReason === undefined ? snap.statusReason : overrides.statusReason,
      requester: overrides.requester ?? "ops.lead@agentboard.test",
      subjectEmployeeId: "E-1048",
      priority: "normal",
      createdAt: "2026-10-08T12:00:00.000Z",
      updatedAt: "2026-10-08T12:01:00.000Z",
      finishedAt: null,
      budget: snap.budget,
      usage: snap.usage,
      pendingApprovals: 0,
      heldTasks: 0,
      syntheticRef: null,
      requestText: overrides.requestText === undefined ? "Please update the home address for E-1048 to 12 Elm Street, Austin." : overrides.requestText,
    },
    tasks: overrides.tasks ?? snap.tasks,
    approvals: overrides.approvals ?? [],
  };
}

/** A pending manager-change approval requested by Ops Lead. */
export function approvalItem(overrides: Partial<ApprovalListItem> = {}): ApprovalListItem {
  return {
    id: "apr_01J00000000000000000000001",
    runId: "run_01J00000000000000000000001",
    taskId: "tsk_01J00000000000000000000001",
    tool: "hris.update_manager",
    summary: "Change the manager of E-1017 to E-1004",
    risk: "medium",
    requester: "ops.lead@agentboard.test",
    status: "pending",
    requestedAt: "2026-10-15T12:00:00.000Z",
    expiresAt: "2026-10-18T12:00:00.000Z",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    canDecide: true,
    runTitle: "Manager change for Rosalind Galloway (E-1017)",
    requestType: "manager_change",
    ...overrides,
  };
}

export function auditEvent(overrides: Partial<AuditEventView> = {}): AuditEventView {
  return {
    stream: "run:run_01J00000000000000000000000",
    seq: 1,
    ts: "2026-10-08T12:00:01.000Z",
    actorType: "user",
    actorId: "ops.lead@agentboard.test",
    action: "run.created",
    runId: "run_01J00000000000000000000000",
    taskId: null,
    detail: {},
    prevHash: "0".repeat(64),
    hash: "a".repeat(64),
    ...overrides,
  };
}

/** An empty metrics summary (every count 0), with overrides. */
export function metricsSummary(overrides: Partial<MetricsSummary> = {}): MetricsSummary {
  return {
    byStatus: {},
    byType: {},
    pendingApprovals: 0,
    needsAttention: 0,
    dlqOpen: 0,
    open: [],
    needsAttentionByReason: [],
    approvals: { pending: 0, decidableByYou: null, soonestExpiry: null },
    heldRuns: { total: 0, byRole: [] },
    ...overrides,
  };
}

/** A run list item (RunSummary), with overrides. */
export function runSummaryItem(overrides: Partial<RunSummary> = {}): RunSummary {
  const { run } = runDetail();
  const { requestText: _text, ...summary } = run;
  return { ...summary, ...overrides };
}
