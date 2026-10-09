// Dead-letter queue bookkeeping and replay (SPEC section 7.2).

import { Hono } from "hono";
import { ControlRequestSchema, type DlqMessageView, type Page } from "../../../shared/api-types.ts";
import type { TaskStatus } from "../../../shared/domain.ts";
import { appendGlobalAudit } from "../../db/console.ts";
import { coordinatorFor } from "../coordinator.ts";
import { decodeCursor, encodeCursor } from "../cursor.ts";
import { apiError } from "../middleware/errors.ts";
import { requirePermission } from "../middleware/rbac.ts";
import { validate } from "../middleware/validate.ts";
import type { AppEnv } from "../types.ts";

interface DlqRow {
  id: string;
  run_id: string | null;
  task_id: string | null;
  dispatch_id: string | null;
  attempts: number;
  outcome: DlqMessageView["outcome"];
  received_at: string;
  replayed_at: string | null;
  replayed_by: string | null;
}

/**
 * A dead letter is open while it was not replayed and its task is still dead_lettered (the D1 mirror).
 * An operator can recover the task without a replay (retry, skip, cancel), which leaves the row as it
 * was; such a row is history, not open work. `/api/metrics/summary` counts open dead letters the same way.
 */
export const OPEN_DLQ_CONDITION = "d.outcome = 'dead_lettered' AND d.replayed_at IS NULL AND t.status = 'dead_lettered'";

function dlqView(row: DlqRow & { task_status: TaskStatus | null }): DlqMessageView {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    attempts: row.attempts,
    outcome: row.outcome,
    receivedAt: row.received_at,
    replayedAt: row.replayed_at,
    replayedBy: row.replayed_by,
    taskStatus: row.task_status,
    open: row.outcome === "dead_lettered" && row.replayed_at === null && row.task_status === "dead_lettered",
  };
}

export const dlqRoutes = new Hono<AppEnv>()
  .get("/api/dlq", requirePermission("dlq:read"), async (c) => {
    const limit = 50;
    const after = decodeCursor<{ at: string; id: string }>(c.req.query("cursor"));
    const { results } = await c.env.DB.prepare(
      `SELECT d.id, d.run_id, d.task_id, d.dispatch_id, d.attempts, d.outcome, d.received_at, d.replayed_at, d.replayed_by, t.status AS task_status
       FROM dlq_messages d LEFT JOIN tasks t ON t.id = d.task_id
       ${after ? "WHERE (d.received_at < ? OR (d.received_at = ? AND d.id < ?))" : ""} ORDER BY d.received_at DESC, d.id DESC LIMIT ?`,
    )
      .bind(...(after ? [after.at, after.at, after.id] : []), limit + 1)
      .all<DlqRow & { task_status: TaskStatus | null }>();
    const last = results.length > limit ? results[limit - 1] : undefined;
    const page: Page<DlqMessageView> = { items: results.slice(0, limit).map(dlqView), nextCursor: last ? encodeCursor({ at: last.received_at, id: last.id }) : null };
    return c.json(page);
  })
  .post("/api/dlq/:id/replay", requirePermission("dlq:replay"), validate("json", ControlRequestSchema), async (c) => {
    const row = await c.env.DB.prepare("SELECT * FROM dlq_messages WHERE id = ?").bind(c.req.param("id")).first<DlqRow>();
    if (!row || !row.run_id || !row.task_id) return apiError(c, 404, "not_found", "no such dead-lettered message");
    if (row.outcome !== "dead_lettered") return apiError(c, 409, "conflict", `message is ${row.outcome}`, row.outcome);
    if (row.replayed_at) return apiError(c, 409, "conflict", "message was already replayed", "already_replayed");
    const identity = c.get("identity");
    const { reason } = c.req.valid("json");
    const coordinator = await coordinatorFor(c.env, row.run_id);
    const result = await coordinator.control({
      type: "replay_dead_letter",
      taskId: row.task_id,
      actor: { kind: identity.principal.kind, id: identity.principal.id },
      reason,
    });
    if (result.accepted) {
      await c.env.DB.prepare("UPDATE dlq_messages SET replayed_at = ?, replayed_by = ? WHERE id = ?").bind(new Date().toISOString(), identity.principal.id, row.id).run();
      await appendGlobalAudit(c.env.DB, {
        actorType: identity.principal.kind,
        actorId: identity.principal.id,
        action: "dlq.replayed",
        runId: row.run_id,
        taskId: row.task_id,
        detail: { messageId: row.id, reason },
      });
    }
    return c.json(result, result.accepted ? 200 : 409);
  });
