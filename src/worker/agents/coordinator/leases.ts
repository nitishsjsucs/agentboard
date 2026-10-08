// Leases (SPEC section 7.3): claim rules, grants with fencing epochs and
// tool-call reservations. Runs inside the coordinator transaction.

import { isToolName, TOOL_SPECS } from "../../planning/tool-registry.ts";
import { ROLE_FOR_KIND, SYSTEM, TERMINAL_TASK_STATUSES, type ClaimRefusal, type ClaimRequest, type TaskRecord } from "./schema.ts";
import type { RunTx } from "./transitions.ts";

export function leaseTtl(tx: RunTx, task: TaskRecord): number {
  return task.kind === "plan" ? tx.cfg.plannerLeaseTtlMs : tx.cfg.leaseTtlMs;
}

/** Tool calls a claim reserves: execute 1, verify the registry's read count, planner 1 (tools/list). */
export function reservationFor(task: TaskRecord): number {
  if (task.kind === "verify") {
    const tool = task.tool ?? "";
    return isToolName(tool) ? (TOOL_SPECS[tool].verify?.reads ?? 1) : 1;
  }
  return 1;
}

export type ClaimDecision = { ok: true; task: TaskRecord } | { ok: false; reason: ClaimRefusal };

/** Budget gate (section 7.4): a refusal names the exhausted budget, null grants. */
export type BudgetGate = (tx: RunTx, task: TaskRecord, reserve: number) => { budget: string } | null;

export function claim(tx: RunTx, req: ClaimRequest, budgetGate: BudgetGate | null): ClaimDecision {
  const run = tx.run;
  // 1. Run-level refusals; the task stays ready and resume or a recovery command redispatches it.
  if (run.status === "cancelled" || run.status === "rejected") return { ok: false, reason: "cancelled" };
  if (run.status === "paused") return { ok: false, reason: "paused" };
  if (run.status === "needs_attention") return { ok: false, reason: "not_ready" };

  const task = tx.task(req.taskId);
  if (!task) return { ok: false, reason: "duplicate" };
  const refuse = (reason: ClaimRefusal): ClaimDecision => {
    tx.emit("task.claim_refused", { kind: "agent", id: req.owner }, task.id, { reason, dispatchId: req.dispatchId });
    return { ok: false, reason };
  };
  // 2 to 5. Terminal, superseded, not claimable, or a redelivery of a live dispatch.
  if (TERMINAL_TASK_STATUSES.has(task.status)) return refuse("duplicate");
  if (task.dispatchId !== req.dispatchId) return refuse("stale_dispatch");
  if (task.status === "held") return refuse("held");
  if (task.status === "budget_blocked") return refuse("budget_exhausted");
  if (task.status === "pending" || task.status === "awaiting_approval" || task.status === "dead_lettered") return refuse("not_ready");
  if (task.status === "leased") return refuse("in_flight");
  if (!req.owner.startsWith(`${ROLE_FOR_KIND[task.kind]}-`)) return refuse("not_ready");

  // 6. Budgets.
  const reserve = reservationFor(task);
  const blocked = budgetGate ? budgetGate(tx, task, reserve) : null;
  if (blocked) {
    task.status = "budget_blocked";
    tx.touchTask(task);
    tx.emit("budget.exhausted", SYSTEM, task.id, { budget: blocked.budget });
    return { ok: false, reason: "budget_exhausted" };
  }

  // 7. Grant: new lease id, epoch + 1, attempt + 1, expiry, reservation.
  task.status = "leased";
  task.leaseId = crypto.randomUUID();
  task.leaseEpoch += 1;
  task.attempts += 1;
  task.leaseOwner = req.owner;
  task.leaseExpiresAt = tx.now + leaseTtl(tx, task);
  task.reservedCalls = reserve;
  run.usage.toolCallsReserved += reserve;
  run.usage.attempts += 1;
  tx.touchRun();
  tx.touchTask(task);
  tx.emit("task.leased", { kind: "agent", id: req.owner }, task.id, {
    epoch: task.leaseEpoch,
    attempt: task.attempts,
    expiresAt: new Date(task.leaseExpiresAt).toISOString(),
    reservedCalls: reserve,
  });
  return { ok: true, task };
}

/** Returns a task's unused tool-call reservation to the run. */
export function releaseReservation(tx: RunTx, task: TaskRecord): void {
  if (task.reservedCalls > 0) {
    tx.run.usage.toolCallsReserved = Math.max(0, tx.run.usage.toolCallsReserved - task.reservedCalls);
    task.reservedCalls = 0;
    tx.touchRun();
    tx.touchTask(task);
  }
}
