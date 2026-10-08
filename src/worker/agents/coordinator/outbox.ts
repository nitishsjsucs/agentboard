// Transactional outbox (SPEC section 7.6). Every coordinator transaction
// writes, in the same transactionSync as its state change, one `d1` row with
// the mirror statements (run, tasks, approvals, audit events, tool calls) and
// one `queue` row per dispatch. After the commit the coordinator flushes them;
// a failed delivery backs off up to 60 s and the wake retries it. Mirrors are
// version-guarded and audit inserts ignore (stream, seq) conflicts, so a
// re-flush never regresses or duplicates anything.

import type { PersistedEvent } from "../run-coordinator.ts";
import type { RunTx } from "./transitions.ts";

export interface D1Statement {
  sql: string;
  params: (string | number | null)[];
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function mirrorStatements(tx: RunTx, events: PersistedEvent[]): D1Statement[] {
  const run = tx.run;
  const request = run.request;
  const statements: D1Statement[] = [
    {
      sql: `INSERT INTO runs (id, requester, client_request_id, request_hash, request_type, title, request_text, subject_employee_id, priority,
              status, status_reason, budget_json, usage_json, synthetic_ref, requested_at, created_at, updated_at, finished_at, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET status = excluded.status, status_reason = excluded.status_reason, budget_json = excluded.budget_json,
              usage_json = excluded.usage_json, updated_at = excluded.updated_at, finished_at = excluded.finished_at, version = excluded.version
            WHERE excluded.version > runs.version`,
      params: [
        run.id,
        request.requester,
        request.clientRequestId,
        request.requestHash,
        request.requestType,
        request.title,
        request.requestText,
        request.subjectEmployeeId,
        request.priority,
        run.status,
        run.statusReason,
        JSON.stringify(run.budget),
        JSON.stringify(run.usage),
        request.syntheticRef,
        request.requestedAt,
        iso(run.createdAt),
        iso(run.updatedAt),
        iso(run.finishedAt),
        run.version,
      ],
    },
  ];
  for (const id of tx.dirtyTasks) {
    const t = tx.state.tasks.get(id);
    if (!t) continue;
    statements.push({
      sql: `INSERT INTO tasks (id, run_id, kind, step_id, tool, args_json, depends_on_json, status, hold_reason, attempts, generation,
              requires_approval, lease_owner, lease_epoch, lease_expires_at, last_error, created_at, updated_at, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET status = excluded.status, hold_reason = excluded.hold_reason, attempts = excluded.attempts,
              generation = excluded.generation, lease_owner = excluded.lease_owner, lease_epoch = excluded.lease_epoch,
              lease_expires_at = excluded.lease_expires_at, last_error = excluded.last_error, updated_at = excluded.updated_at,
              version = excluded.version
            WHERE excluded.version > tasks.version`,
      params: [
        t.id,
        run.id,
        t.kind,
        t.stepId,
        t.tool,
        t.args === null ? null : JSON.stringify(t.args),
        JSON.stringify(t.dependsOn),
        t.status,
        t.holdReason,
        t.attempts,
        t.generation,
        t.requiresApproval ? 1 : 0,
        t.leaseOwner,
        t.leaseEpoch,
        iso(t.leaseExpiresAt),
        t.lastError,
        iso(t.createdAt),
        iso(t.updatedAt),
        t.version,
      ],
    });
  }
  for (const id of tx.dirtyApprovals) {
    const a = tx.state.approvals.get(id);
    if (!a) continue;
    statements.push({
      sql: `INSERT INTO approvals (id, run_id, task_id, generation, tool, summary, risk, requester, status, requested_at, expires_at,
              decided_by, decided_at, decision_note, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at,
              decision_note = excluded.decision_note, version = excluded.version
            WHERE excluded.version > approvals.version`,
      params: [
        a.id,
        run.id,
        a.taskId,
        a.generation,
        a.tool,
        a.summary,
        a.risk,
        request.requester,
        a.status,
        iso(a.requestedAt),
        iso(a.expiresAt),
        a.decidedBy,
        iso(a.decidedAt),
        a.note,
        a.version,
      ],
    });
  }
  for (const trace of tx.traces) {
    statements.push({
      sql: `INSERT INTO tool_calls (id, run_id, task_id, step_id, agent, tool, args_json, idempotency_key, attempt, generation, lease_epoch,
              outcome, result_json, error, started_at, finished_at, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      params: [
        trace.id,
        run.id,
        trace.taskId,
        trace.stepId,
        trace.agent,
        trace.tool,
        JSON.stringify(trace.args ?? null),
        trace.idempotencyKey,
        trace.attempt,
        trace.generation,
        trace.epoch,
        trace.outcome,
        trace.result === undefined ? null : JSON.stringify({ value: trace.result, logical: trace.logical }),
        trace.error,
        iso(trace.startedAt),
        iso(trace.finishedAt),
        trace.durationMs,
      ],
    });
  }
  for (const event of events) {
    statements.push({
      sql: `INSERT INTO audit_events (stream, seq, ts, actor_type, actor_id, action, run_id, task_id, detail_json, prev_hash, hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(stream, seq) DO NOTHING`,
      params: [
        `run:${run.id}`,
        event.seq,
        event.ts,
        event.actorType,
        event.actorId,
        event.action,
        run.id,
        event.taskId,
        JSON.stringify(event.detail),
        event.prevHash,
        event.hash,
      ],
    });
  }
  return statements;
}

/** Exponential backoff for a failed outbox delivery, capped at 60 s. */
export function outboxBackoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempts - 1), 60_000);
}
