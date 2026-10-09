// Execution budgets (SPEC section 7.4). Usage changes only inside fenced,
// deduplicated coordinator transactions, so duplicate reports and traces never
// double count.

import type { Budget } from "../../../shared/domain.ts";
import type { BudgetGate } from "./leases.ts";
import { SYSTEM, type ControlCommand, type ControlResult } from "./schema.ts";
import type { RunTx } from "./transitions.ts";

/**
 * A planner claim needs at least this many LLM tokens left. Each model request's own output
 * cap (and the llm_budget_exhausted failure below it) is `outputCap` in planning/planner.ts.
 */
export const PLANNER_TOKEN_FLOOR = 1500;

export const budgetGate: BudgetGate = (tx, task, reserve) => {
  const { budget, usage } = tx.run;
  if (task.attempts >= Math.min(task.maxAttempts, budget.maxAttemptsPerTask)) return { budget: "maxAttemptsPerTask" };
  if (usage.toolCalls + usage.toolCallsReserved + reserve > budget.maxToolCalls) return { budget: "maxToolCalls" };
  if (task.kind === "plan" && budget.maxLlmTokens - usage.llmTokens < PLANNER_TOKEN_FLOOR) return { budget: "maxLlmTokens" };
  return null;
};

/** Sweep step 3: the active-time deadline (queued, planning and running time only). */
export function checkActiveDeadline(tx: RunTx): void {
  const run = tx.run;
  if (run.deadlineExceeded || run.activeSince === null) return;
  if (run.usage.activeMs + (tx.now - run.activeSince) >= run.budget.maxActiveMs) {
    run.deadlineExceeded = true;
    tx.touchRun();
    tx.emit("budget.exhausted", SYSTEM, null, { budget: "maxActiveMs", activeMs: run.usage.activeMs + (tx.now - run.activeSince) });
  }
}

/** The active-time deadline for the wake, when the run is accruing active time. */
export function activeDeadline(tx: Pick<RunTx, "state">): number | null {
  const run = tx.state.run;
  if (run.deadlineExceeded || run.activeSince === null) return null;
  return run.activeSince + Math.max(0, run.budget.maxActiveMs - run.usage.activeMs);
}

const RAISABLE = ["maxToolCalls", "maxLlmTokens", "maxActiveMs", "maxAttemptsPerTask"] as const;

/**
 * raise_budget (admin): raises budget fields, clears the deadline flag, unblocks budget_blocked tasks.
 * At least one field must strictly increase and none may decrease; anything else is `not_a_raise`
 * (an empty or equal patch would clear the deadline and redispatch tasks the next claim blocks again).
 */
export function raiseBudget(tx: RunTx, cmd: Extract<ControlCommand, { type: "raise_budget" }>): ControlResult {
  const run = tx.run;
  const next: Budget = { ...run.budget };
  let raised = false;
  for (const field of RAISABLE) {
    const value = cmd.budget[field];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < run.budget[field]) return { accepted: false, reason: "not_a_raise" };
    if (value > run.budget[field]) raised = true;
    next[field] = value;
  }
  if (!raised) return { accepted: false, reason: "not_a_raise" };
  const from = run.budget;
  run.budget = next;
  run.deadlineExceeded = false;
  tx.touchRun();
  let unblocked = 0;
  for (const task of tx.tasks()) {
    if (task.maxAttempts !== next.maxAttemptsPerTask) {
      task.maxAttempts = next.maxAttemptsPerTask;
      tx.touchTask(task);
    }
    if (task.status === "budget_blocked") {
      task.status = "ready";
      task.dispatchId = null;
      tx.touchTask(task);
      unblocked += 1;
    }
  }
  tx.emit("budget.raised", cmd.actor, null, { reason: cmd.reason, from, to: next, unblocked });
  return { accepted: true };
}
