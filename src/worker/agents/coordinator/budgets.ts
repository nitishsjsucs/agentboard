// Execution budgets (SPEC section 7.4). Usage changes only inside fenced,
// deduplicated coordinator transactions, so duplicate reports and traces never
// double count.

import type { Budget } from "../../../shared/domain.ts";
import type { BudgetGate } from "./leases.ts";
import { SYSTEM, type ControlCommand, type ControlResult } from "./schema.ts";
import type { RunTx } from "./transitions.ts";

/** A planner claim needs at least this many LLM tokens left. */
export const PLANNER_TOKEN_FLOOR = 1500;
/** Upper bound for one planning request's output. */
export const MAX_PLAN_OUTPUT_TOKENS = 800;
/** Below this output cap the planner fails with llm_budget_exhausted instead of calling the model. */
export const MIN_PLAN_OUTPUT_TOKENS = 200;

export const budgetGate: BudgetGate = (tx, task, reserve) => {
  const { budget, usage } = tx.run;
  if (task.attempts >= Math.min(task.maxAttempts, budget.maxAttemptsPerTask)) return { budget: "maxAttemptsPerTask" };
  if (usage.toolCalls + usage.toolCallsReserved + reserve > budget.maxToolCalls) return { budget: "maxToolCalls" };
  if (task.kind === "plan" && budget.maxLlmTokens - usage.llmTokens < PLANNER_TOKEN_FLOOR) return { budget: "maxLlmTokens" };
  return null;
};

/** maxOutputTokens = min(800, remaining - ceil(promptChars / 3)); null when that is below 200. */
export function plannerMaxOutputTokens(remainingLlmTokens: number, promptChars: number): number | null {
  const estimatedInput = Math.ceil(promptChars / 3);
  const cap = Math.min(MAX_PLAN_OUTPUT_TOKENS, remainingLlmTokens - estimatedInput);
  return cap < MIN_PLAN_OUTPUT_TOKENS ? null : cap;
}

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

/** raise_budget (admin): raises budget fields, clears the deadline flag, unblocks budget_blocked tasks. */
export function raiseBudget(tx: RunTx, cmd: Extract<ControlCommand, { type: "raise_budget" }>): ControlResult {
  const run = tx.run;
  const next: Budget = { ...run.budget };
  for (const field of RAISABLE) {
    const value = cmd.budget[field];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < run.budget[field]) return { accepted: false, reason: "not_a_raise" };
    next[field] = value;
  }
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
