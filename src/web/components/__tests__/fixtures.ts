import type { RunSnapshot, TaskView } from "../../../shared/api-types.ts";

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
