// Approval queue and decisions (SPEC section 9.2). The API never writes
// approvals: the coordinator decides separation of duties, state and expiry
// in one transaction, and D1 is its mirror.

import { validate } from "../middleware/validate.ts";
import { Hono } from "hono";
import { ApprovalListQuerySchema, DecisionRequestSchema, type ApprovalListItem, type ApprovalView, type Page } from "../../../shared/api-types.ts";
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

const REFUSAL_STATUS = { not_found: 404, already_decided: 409, expired: 409, self_approval: 403 } as const;

export const approvalRoutes = new Hono<AppEnv>()
  .get("/api/approvals", requirePermission("runs:read"), validate("query", ApprovalListQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const limit = query.limit ?? 50;
    const after = decodeCursor<{ at: string; id: string }>(query.cursor);
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (query.status) {
      clauses.push("status = ?");
      params.push(query.status);
    }
    if (after) {
      clauses.push("(requested_at < ? OR (requested_at = ? AND id < ?))");
      params.push(after.at, after.at, after.id);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { results } = await c.env.DB.prepare(`SELECT * FROM approvals ${where} ORDER BY requested_at DESC, id DESC LIMIT ?`)
      .bind(...params, limit + 1)
      .all<ApprovalRow>();
    const identity = c.get("identity");
    const items: ApprovalListItem[] = results.slice(0, limit).map((row) => {
      const view = approvalFromRow(row);
      return { ...view, canDecide: canDecide(view, identity) };
    });
    const last = results.length > limit ? results[limit - 1] : undefined;
    const page: Page<ApprovalListItem> = { items, nextCursor: last ? encodeCursor({ at: last.requested_at, id: last.id }) : null };
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
