// Readable sentences for the codes the coordinator stores (task lastError and
// run statusReason). The raw codes stay on the page next to them.

import type { TaskView } from "../../shared/api-types.ts";

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
