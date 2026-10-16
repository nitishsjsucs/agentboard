import { Hono } from "hono";
import type { MetricsSummary, OpenRunStatus } from "../../../shared/api-types.ts";
import type { AgentRole, TaskKind } from "../../../shared/domain.ts";
import { ROLE_FOR_KIND } from "../../agents/coordinator/schema.ts";
import { listDirectory } from "../../db/people.ts";
import { OPEN_DLQ_CONDITION } from "./dlq.ts";
import { requirePermission } from "../middleware/rbac.ts";
import type { AppEnv } from "../types.ts";

export const OPEN_RUN_STATUSES: readonly OpenRunStatus[] = ["queued", "planning", "running", "awaiting_approval", "paused", "needs_attention"];
const OPEN_LIST = OPEN_RUN_STATUSES.map((s) => `'${s}'`).join(", ");

/**
 * The dashboard's counts in one D1 round trip. Every statement reads only open work through an index
 * (runs_status_updated, approvals_status, tasks_held; the EXPLAIN QUERY PLAN output is in PROGRESS.md),
 * so the cost does not grow with finished history except for the two all-time GROUP BY counts that
 * existed before. Nothing is cached: decidableByYou depends on the principal.
 */
export function summaryStatements(db: D1Database, principal: string, now: string, withDlq: boolean): D1PreparedStatement[] {
  const statements = [
    db.prepare("SELECT status AS k, COUNT(*) AS n FROM runs GROUP BY status"),
    db.prepare("SELECT request_type AS k, COUNT(*) AS n FROM runs GROUP BY request_type"),
    db.prepare(`SELECT status, COUNT(*) AS n, MIN(updated_at) AS oldest FROM runs WHERE status IN (${OPEN_LIST}) GROUP BY status`),
    db.prepare("SELECT status_reason AS reason, COUNT(*) AS n FROM runs WHERE status = 'needs_attention' GROUP BY status_reason"),
    // Mirrors canDecide in approvals.ts: not the requester's own run, and not past its expiry.
    db
      .prepare(
        `SELECT COUNT(*) AS pending, SUM(CASE WHEN lower(requester) <> ? AND expires_at > ? THEN 1 ELSE 0 END) AS decidable,
           MIN(CASE WHEN expires_at > ? THEN expires_at END) AS soonest FROM approvals WHERE status = 'pending'`,
      )
      .bind(principal, now, now),
    // Runs that would be moving but have a task held by a disabled role. Cancelling a run clears its holds,
    // and the status guard keeps needs-attention and paused runs out, so this never overlaps those counts.
    db.prepare(
      `SELECT t.kind AS kind, COUNT(DISTINCT t.run_id) AS runs FROM tasks t JOIN runs r ON r.id = t.run_id
       WHERE t.status = 'held' AND t.hold_reason = 'role_disabled' AND r.status IN ('queued', 'planning', 'running') GROUP BY t.kind`,
    ),
    db.prepare(
      `SELECT COUNT(DISTINCT t.run_id) AS runs FROM tasks t JOIN runs r ON r.id = t.run_id
       WHERE t.status = 'held' AND t.hold_reason = 'role_disabled' AND r.status IN ('queued', 'planning', 'running')`,
    ),
  ];
  // Dead-lettered tasks with an open dead letter (see OPEN_DLQ_CONDITION); a task counts once.
  if (withDlq) statements.push(db.prepare(`SELECT COUNT(DISTINCT d.task_id) AS n FROM dlq_messages d JOIN tasks t ON t.id = d.task_id WHERE ${OPEN_DLQ_CONDITION}`));
  return statements;
}

export const metricsRoutes = new Hono<AppEnv>()
  .get("/api/metrics/summary", requirePermission("runs:read"), async (c) => {
    const db = c.env.DB;
    const identity = c.get("identity");
    const canDecide = identity.permissions.includes("approvals:decide");
    // Viewers and approvers cannot open the dead-letter panel, so they get no count for it either.
    const canReadDlq = identity.permissions.includes("dlq:read");
    const results = await db.batch(summaryStatements(db, identity.principal.id, new Date().toISOString(), canReadDlq));
    const rows = <T,>(index: number) => (results[index]?.results ?? []) as T[];
    const toMap = (index: number) => Object.fromEntries(rows<{ k: string; n: number }>(index).map((r) => [r.k, r.n]));
    const statusCounts = toMap(0);
    const approvals = rows<{ pending: number; decidable: number | null; soonest: string | null }>(4)[0];
    const heldByKind = rows<{ kind: TaskKind; runs: number }>(5);
    const summary: MetricsSummary = {
      byStatus: statusCounts,
      byType: toMap(1),
      pendingApprovals: approvals?.pending ?? 0,
      needsAttention: statusCounts["needs_attention"] ?? 0,
      dlqOpen: canReadDlq ? (rows<{ n: number }>(7)[0]?.n ?? 0) : null,
      open: rows<{ status: OpenRunStatus; n: number; oldest: string }>(2).map((r) => ({ status: r.status, count: r.n, oldestUpdatedAt: r.oldest })),
      needsAttentionByReason: rows<{ reason: string | null; n: number }>(3).map((r) => ({ reason: r.reason, count: r.n })),
      approvals: {
        pending: approvals?.pending ?? 0,
        decidableByYou: canDecide ? (approvals?.decidable ?? 0) : null,
        soonestExpiry: approvals?.soonest ?? null,
      },
      heldRuns: {
        total: rows<{ runs: number }>(6)[0]?.runs ?? 0,
        byRole: heldByKind.map((r) => ({ role: ROLE_FOR_KIND[r.kind] as AgentRole, runs: r.runs })),
      },
    };
    return c.json(summary);
  })
  // The launch form's subject picker: a read-only directory (id, name, department) of the simulated HRIS.
  .get("/api/people/directory", requirePermission("runs:launch"), async (c) => c.json({ employees: await listDirectory(c.env.PEOPLE_DB) }));
