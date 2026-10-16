// Approval queue and decisions (SPEC section 9.2). The API never writes
// approvals: the coordinator decides separation of duties, state and expiry
// in one transaction, and D1 is its mirror.

import { validate } from "../middleware/validate.ts";
import { Hono } from "hono";
import { ApprovalListQuerySchema, DecisionRequestSchema, type ApprovalListItem, type ApprovalView, type Page } from "../../../shared/api-types.ts";
import type { RequestType } from "../../../shared/domain.ts";
import { coordinatorFor } from "../coordinator.ts";
import { decodeCursor, encodeCursor } from "../cursor.ts";
import { apiError } from "../middleware/errors.ts";
import { requirePermission } from "../middleware/rbac.ts";
import type { AppEnv, Identity } from "../types.ts";

interface ApprovalRow {
  id: string;
  run_id: string;
  task_id: string;
  tool: string;
  summary: string;
  risk: "medium" | "high";
  requester: string;
  status: ApprovalView["status"];
  requested_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export function approvalFromRow(row: ApprovalRow): ApprovalView {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    tool: row.tool,
    summary: row.summary,
    risk: row.risk,
    requester: row.requester,
    status: row.status,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
  };
}

/** Whether this principal could decide the approval now (the coordinator still decides for real). */
export function canDecide(approval: ApprovalView, identity: Identity, now: number = Date.now()): boolean {
  return (
    identity.permissions.includes("approvals:decide") &&
    approval.status === "pending" &&
    approval.requester.toLowerCase() !== identity.principal.id &&
    Date.parse(approval.expiresAt) > now
  );
}

/** A decoded keyset cursor with exactly the sort key `key` and the id, both strings. */
function isCursor(value: Record<string, string> | null, key: "at" | "exp"): value is Record<string, string> {
  return value !== null && typeof value === "object" && Object.keys(value).length === 2 && typeof value[key] === "string" && typeof value["id"] === "string";
}

const REFUSAL_STATUS = { not_found: 404, already_decided: 409, expired: 409, self_approval: 403 } as const;

export const approvalRoutes = new Hono<AppEnv>()
  .get("/api/approvals", requirePermission("runs:read"), validate("query", ApprovalListQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const limit = query.limit ?? 50;
    // Pending approvals list soonest expiry first (the order an approver should decide them in, and the
    // ones closest to expiring are never cut off by the page size); every other list is newest first.
    const byExpiry = query.status === "pending";
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (query.status) {
      clauses.push("a.status = ?");
      params.push(query.status);
    }
    if (query.cursor) {
      const after = decodeCursor<Record<string, string>>(query.cursor);
      const key = byExpiry ? "exp" : "at";
      if (!isCursor(after, key)) return apiError(c, 400, "invalid_request", "the cursor does not belong to this list and order", "invalid_cursor");
      if (byExpiry) clauses.push("(a.expires_at > ? OR (a.expires_at = ? AND a.id > ?))");
      else clauses.push("(a.requested_at < ? OR (a.requested_at = ? AND a.id < ?))");
      const sortKey = String(after[key]);
      params.push(sortKey, sortKey, String(after["id"]));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const order = byExpiry ? "a.expires_at ASC, a.id ASC" : "a.requested_at DESC, a.id DESC";
    // The run's title and type come from the runs mirror, which runs:read already exposes through /api/runs.
    const { results } = await c.env.DB.prepare(
      `SELECT a.*, r.title AS run_title, r.request_type AS run_request_type FROM approvals a LEFT JOIN runs r ON r.id = a.run_id
       ${where} ORDER BY ${order} LIMIT ?`,
    )
      .bind(...params, limit + 1)
      .all<ApprovalRow & { run_title: string | null; run_request_type: RequestType | null }>();
    const identity = c.get("identity");
    const items: ApprovalListItem[] = results.slice(0, limit).map((row) => {
      const view = approvalFromRow(row);
      return { ...view, canDecide: canDecide(view, identity), runTitle: row.run_title, requestType: row.run_request_type };
    });
    const last = results.length > limit ? results[limit - 1] : undefined;
    const nextCursor = last ? encodeCursor(byExpiry ? { exp: last.expires_at, id: last.id } : { at: last.requested_at, id: last.id }) : null;
    const page: Page<ApprovalListItem> = { items, nextCursor };
    return c.json(page);
  })
  .post("/api/approvals/:id/decision", requirePermission("approvals:decide"), validate("json", DecisionRequestSchema), async (c) => {
    const approvalId = c.req.param("id");
    const body = c.req.valid("json");
    const row = await c.env.DB.prepare("SELECT run_id FROM approvals WHERE id = ?").bind(approvalId).first<{ run_id: string }>();
    if (!row) return apiError(c, 404, "not_found", "no such approval");
    const identity = c.get("identity");
    const coordinator = await coordinatorFor(c.env, row.run_id);
    const result = await coordinator.resolveApproval({
      approvalId,
      decision: body.decision,
      actor: { kind: identity.principal.kind, id: identity.principal.id },
      note: body.note,
    });
    if (!result.accepted) {
      const reason = result.reason ?? "not_found";
      const status = REFUSAL_STATUS[reason];
      return apiError(c, status, status === 404 ? "not_found" : status === 403 ? "forbidden" : "conflict", `decision refused: ${reason}`, reason);
    }
    if (!result.approval) return apiError(c, 500, "internal", "approval missing after decision");
    // The coordinator's view is authoritative; the D1 mirror may lag by one flush.
    return c.json({ ...result.approval, canDecide: false });
  });
