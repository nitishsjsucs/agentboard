// RunSnapshot: the state broadcast to browsers over WebSocket. It is shared by
// every viewer of the run, so task arguments always get viewer-level redaction.

import { redactForViewer } from "../../audit/redaction.ts";
import type { ApprovalRecord, ApprovalView, RunSnapshot, RunState, TaskRecord, TaskView } from "./schema.ts";

export function taskView(task: TaskRecord, canReadPii: boolean): TaskView {
  return {
    id: task.id,
    kind: task.kind,
    stepId: task.stepId,
    tool: task.tool,
    args: task.args === null ? null : ((canReadPii ? task.args : redactForViewer(task.args)) as Record<string, unknown>),
    dependsOn: task.dependsOn,
    status: task.status,
    holdReason: task.holdReason,
    attempts: task.attempts,
    generation: task.generation,
    requiresApproval: task.requiresApproval,
    lease:
      task.status === "leased" && task.leaseOwner && task.leaseExpiresAt !== null
        ? { owner: task.leaseOwner, epoch: task.leaseEpoch, expiresAt: new Date(task.leaseExpiresAt).toISOString() }
        : null,
    lastError: task.lastError,
    updatedAt: new Date(task.updatedAt).toISOString(),
  };
}

export function approvalView(approval: ApprovalRecord, runId: string, requester: string): ApprovalView {
  return {
    id: approval.id,
    runId,
    taskId: approval.taskId,
    tool: approval.tool,
    summary: approval.summary,
    risk: approval.risk,
    requester,
    status: approval.status,
    requestedAt: new Date(approval.requestedAt).toISOString(),
    expiresAt: new Date(approval.expiresAt).toISOString(),
    decidedBy: approval.decidedBy,
    decidedAt: approval.decidedAt === null ? null : new Date(approval.decidedAt).toISOString(),
    decisionNote: approval.note,
  };
}

export function sortedTasks(state: RunState): TaskRecord[] {
  return [...state.tasks.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function buildSnapshot(state: RunState, recentEvents: RunSnapshot["recentEvents"]): RunSnapshot {
  return {
    runId: state.run.id,
    status: state.run.status,
    statusReason: state.run.statusReason,
    budget: state.run.budget,
    usage: state.run.usage,
    tasks: sortedTasks(state).map((t) => taskView(t, false)),
    recentEvents,
    pendingApprovalIds: [...state.approvals.values()].filter((a) => a.status === "pending").map((a) => a.id),
    version: state.run.version,
  };
}

export function emptySnapshot(runId: string): RunSnapshot {
  return {
    runId,
    status: "queued",
    statusReason: null,
    budget: { maxSteps: 0, maxToolCalls: 0, maxLlmTokens: 0, maxAttemptsPerTask: 0, maxActiveMs: 0 },
    usage: { toolCalls: 0, toolCallsReserved: 0, llmTokens: 0, activeMs: 0, attempts: 0, replays: 0, skippedSteps: 0 },
    tasks: [],
    recentEvents: [],
    pendingApprovalIds: [],
    version: 0,
  };
}
