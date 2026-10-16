// Readable sentences for the codes the coordinator stores (task lastError and
// run statusReason). The raw codes stay on the page next to them.

import type { MeResponse, TaskView } from "../../shared/api-types.ts";
import type { RunStatus } from "../../shared/domain.ts";

const TASK_ERRORS: Record<string, string> = {
  agent_exception: "The agent raised an error instead of finishing the task.",
  plan_invalid: "The plan did not pass validation, so no step was created.",
  llm_budget_exhausted: "The planner ran out of LLM tokens before it produced a valid plan.",
  postcondition_failed: "The verifier read the record back and the write had not taken effect.",
  timeout: "The tool call took longer than the timeout.",
  transport_error: "The tool could not be reached.",
  malformed_result: "The tool answered with something that was not a result.",
  permanent_error: "The tool refused the call, so retrying it unchanged will fail again.",
  forbidden: "The tool refused the call's credentials.",
  approval_rejected: "An approver rejected this step.",
};

/** A sentence for a task's lastError code, or null for a code without one. */
export function taskErrorSentence(code: string | null): string | null {
  if (!code) return null;
  return TASK_ERRORS[code] ?? null;
}

/** "the plan task" or "step s2 (hris.update_address)". */
export function taskLabel(task: Pick<TaskView, "kind" | "stepId" | "tool">): string {
  if (task.kind === "plan") return "the plan task";
  return `step ${task.stepId ?? "?"}${task.kind === "verify" ? " verification" : ""}${task.tool ? ` (${task.tool})` : ""}`;
}

/** The agent role that works on a task kind. */
export const ROLE_FOR_KIND = { plan: "planner", execute: "executor", verify: "verifier" } as const;

/** Who can move a run that needs attention on, by its status reason, in the run notice's terms. */
export interface ReasonActor {
  /** Admins hold every operator permission too; "operator" means an operator or an admin. */
  actor: "operator" | "admin";
  /** Short and lower case, for a list row: "out of budget", "a task failed (timeout)". */
  sentence: string;
}

/**
 * Only an admin can raise a budget (budget_exhausted, deadline_exceeded); every other reason is a
 * retry or a cancel, which an operator or an admin can do. Matches NextStep's next-step lines.
 */
export function whoActsForReason(statusReason: string | null): ReasonActor {
  switch (statusReason) {
    case "budget_exhausted":
      return { actor: "admin", sentence: "out of budget" };
    case "deadline_exceeded":
      return { actor: "admin", sentence: "out of active time" };
    case "approval_expired":
      return { actor: "operator", sentence: "approval expired: retry the gated step" };
    case "dead_lettered":
      return { actor: "operator", sentence: "a task was dead-lettered: retry it" };
    case "task_failed:postcondition_failed":
      return { actor: "operator", sentence: "a write did not take effect: retry it" };
    case "task_failed:plan_invalid":
      return { actor: "operator", sentence: "the plan failed validation" };
    case "task_failed:permanent_error":
      return { actor: "operator", sentence: "the tool refused the call" };
    default:
      if (statusReason?.startsWith("task_failed:")) return { actor: "operator", sentence: `a task failed (${statusReason.slice("task_failed:".length)})` };
      return { actor: "operator", sentence: "needs attention" };
  }
}

/** Who has to act next on a run, as a list row shows it: a chip with the word and a short sentence. */
export interface RunActor {
  actor: "approver" | "operator" | "admin" | "nobody" | "done";
  /** "Approver", "Approver (not you)", "Operator", "Admin", "Nobody" or "Done". */
  chip: string;
  /** Lower case and short; empty when the status badge already says it all (a run that succeeded). */
  sentence: string;
  tone: "warning" | "danger" | "info" | "neutral";
}

/**
 * The run lists' "Waiting on" column. A queued, planning or running run with a task held by a disabled
 * role is waiting on an admin (only admins enable roles), which its status alone does not show.
 */
export function whoActs(run: { status: RunStatus; statusReason: string | null; requester: string; heldTasks: number }, me: MeResponse | null): RunActor {
  switch (run.status) {
    case "awaiting_approval": {
      // Separation of duties: the requester can never decide their own run's approval.
      const own = me !== null && run.requester.toLowerCase() === me.principal.id;
      return { actor: "approver", chip: own ? "Approver (not you)" : "Approver", sentence: "waiting for an approval", tone: "warning" };
    }
    case "paused":
      return { actor: "operator", chip: "Operator", sentence: "paused: resume to continue", tone: "warning" };
    case "needs_attention": {
      const reason = whoActsForReason(run.statusReason);
      return { actor: reason.actor, chip: reason.actor === "admin" ? "Admin" : "Operator", sentence: reason.sentence, tone: "danger" };
    }
    case "queued":
    case "planning":
    case "running":
      if (run.heldTasks > 0) return { actor: "admin", chip: "Admin", sentence: "held: a role is disabled", tone: "warning" };
      return { actor: "nobody", chip: "Nobody", sentence: "in progress", tone: "info" };
    case "succeeded":
      return { actor: "done", chip: "Done", sentence: "", tone: "neutral" };
    case "rejected":
      return { actor: "done", chip: "Done", sentence: "approval rejected", tone: "neutral" };
    case "cancelled":
      return { actor: "done", chip: "Done", sentence: "cancelled", tone: "neutral" };
  }
}
