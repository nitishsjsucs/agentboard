// The sweep (SPEC section 7.3): synchronous and idempotent. It runs at the
// start of every coordinator transaction and in onStart, so lease, approval
// and deadline expiry never depend on a timer firing. The wake (an Agent
// schedule()) only triggers a sweep.

import { SYSTEM } from "./schema.ts";
import { releaseReservation } from "./leases.ts";
import type { RunTx } from "./transitions.ts";

export function reapExpired(tx: RunTx): void {
  const now = tx.now;
  // 1. Expired leases: reaped, reservation released, then ready (redispatched with attempt + 1
  //    when the run dispatches) or failed when attempts are exhausted.
  for (const task of tx.tasks()) {
    if (task.status !== "leased" || task.leaseExpiresAt === null || task.leaseExpiresAt > now) continue;
    tx.reaped.set(task.id, task.dispatchId);
    tx.emit("task.lease_expired", SYSTEM, task.id, { epoch: task.leaseEpoch, owner: task.leaseOwner, attempt: task.attempts });
    releaseReservation(tx, task);
    task.leaseExpiresAt = null;
    if (task.attempts < task.maxAttempts) {
      task.status = "ready";
      task.dispatchId = null;
    } else {
      task.status = "failed";
      task.lastError = "attempts_exhausted";
      tx.emit("task.failed", SYSTEM, task.id, { code: "attempts_exhausted", retryable: true, willRetry: false, attempt: task.attempts });
    }
    tx.touchTask(task);
  }
  // 2. Expired approvals: the task is rejected and the run needs attention.
  for (const approval of tx.state.approvals.values()) {
    if (approval.status !== "pending" || approval.expiresAt > now) continue;
    approval.status = "expired";
    approval.decidedAt = now;
    tx.touchApproval(approval);
    const task = tx.task(approval.taskId);
    if (task && task.status === "awaiting_approval") {
      task.status = "rejected";
      task.lastError = "approval_expired";
      tx.touchTask(task);
    }
    tx.emit("approval.expired", SYSTEM, approval.taskId, { approvalId: approval.id, reason: "ttl" });
  }
}

/** Extra deadlines the coordinator tracks outside the run record. */
export interface ExtraDeadlines {
  outboxNextAttemptAt: number | null;
  holdRecheckAt: number | null;
}

/** The earliest future deadline the next wake must cover, or null when none exists. */
export function nextDeadline(tx: Pick<RunTx, "state">, extras: ExtraDeadlines): number | null {
  const candidates: number[] = [];
  for (const task of tx.state.tasks.values()) {
    if (task.status === "leased" && task.leaseExpiresAt !== null) candidates.push(task.leaseExpiresAt);
  }
  for (const approval of tx.state.approvals.values()) {
    if (approval.status === "pending") candidates.push(approval.expiresAt);
  }
  if (extras.outboxNextAttemptAt !== null) candidates.push(extras.outboxNextAttemptAt);
  if (extras.holdRecheckAt !== null) candidates.push(extras.holdRecheckAt);
  return candidates.length === 0 ? null : Math.min(...candidates);
}
