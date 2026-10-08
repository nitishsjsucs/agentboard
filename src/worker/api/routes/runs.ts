// Runs API (SPEC sections 9 and 9.2): launch with a per-requester idempotency
// reservation, run reads from the D1 mirrors with redaction by permission,
// the audit stream with chain verification, and the recovery commands.

import { Hono, type Context } from "hono";
import {
  BudgetPatchSchema,
  ControlRequestSchema,
  LaunchRunRequestSchema,
  RunListQuerySchema,
  type ApprovalListItem,
  type AuditEventView,
  type ControlResponse,
  type LaunchRunResponse,
  type Page,
  type RunDetailResponse,
  type RunSummary,
  type TaskView,
  type TimelineEntry,
  type ToolCallView,
} from "../../../shared/api-types.ts";
import { canonicalJson, compact } from "../../../shared/canonical-json.ts";
import type { SimDirectives } from "../../../shared/domain.ts";
import { DEFAULT_BUDGET, type Budget, type Priority, type RequestType, type RunStatus, type Usage } from "../../../shared/domain.ts";
import { REQUEST_TYPE_LABELS } from "../../../shared/synth/catalog.ts";
import type { ControlCommand, InitRunInput } from "../../agents/coordinator/schema.ts";
import { sha256Hex, verifyRunAudit } from "../../audit/hash-chain.ts";
import { redactIf } from "../../audit/redaction.ts";
import { directoryEntry } from "../../db/people.ts";
import { newRunId, RUN_ID_PATTERN } from "../../util/ids.ts";
import { coordinatorFor } from "../coordinator.ts";
import { decodeCursor, encodeCursor } from "../cursor.ts";
import { apiError } from "../middleware/errors.ts";
import { requirePermission } from "../middleware/rbac.ts";
import { validate } from "../middleware/validate.ts";
import type { AppEnv } from "../types.ts";
import { approvalFromRow, canDecide } from "./approvals.ts";
import { timelineSummary } from "./timeline.ts";

const ZERO_USAGE: Usage = { toolCalls: 0, toolCallsReserved: 0, llmTokens: 0, activeMs: 0, attempts: 0, replays: 0, skippedSteps: 0 };

interface RunRow {
  id: string;
  requester: string;
  client_request_id: string;
  request_hash: string;
  request_type: RequestType;
  title: string;
  request_text: string;
  subject_employee_id: string;
  priority: Priority;
  status: RunStatus;
  status_reason: string | null;
  budget_json: string;
  usage_json: string;
  synthetic_ref: string | null;
  requested_at: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  version: number;
  pending_approvals?: number;
}

export function runSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    title: row.title,
    requestType: row.request_type,
    status: row.status,
    statusReason: row.status_reason,
    requester: row.requester,
    subjectEmployeeId: row.subject_employee_id,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    budget: JSON.parse(row.budget_json) as Budget,
    usage: JSON.parse(row.usage_json) as Usage,
    pendingApprovals: row.pending_approvals ?? 0,
    syntheticRef: row.synthetic_ref,
  };
}

interface TaskRow {
  id: string;
  kind: TaskView["kind"];
  step_id: string | null;
  tool: string | null;
  args_json: string | null;
  depends_on_json: string;
  status: TaskView["status"];
  hold_reason: TaskView["holdReason"];
  attempts: number;
  generation: number;
  requires_approval: number;
  lease_owner: string | null;
  lease_epoch: number;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function taskFromRow(row: TaskRow, canReadPii: boolean): TaskView {
  const args = row.args_json === null ? null : (JSON.parse(row.args_json) as Record<string, unknown>);
  return {
    id: row.id,
    kind: row.kind,
    stepId: row.step_id,
    tool: row.tool,
    args: args === null ? null : (redactIf(args, canReadPii) as Record<string, unknown>),
    dependsOn: JSON.parse(row.depends_on_json) as string[],
    status: row.status,
    holdReason: row.hold_reason,
    attempts: row.attempts,
    generation: row.generation,
    requiresApproval: row.requires_approval === 1,
    lease: row.status === "leased" && row.lease_owner && row.lease_expires_at ? { owner: row.lease_owner, epoch: row.lease_epoch, expiresAt: row.lease_expires_at } : null,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

interface ToolCallRow {
  id: string;
  task_id: string;
  step_id: string | null;
  agent: string;
  tool: string;
  args_json: string;
  idempotency_key: string | null;
  attempt: number;
  generation: number;
  lease_epoch: number;
  outcome: ToolCallView["outcome"];
  result_json: string | null;
  error: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
}

function toolCallFromRow(row: ToolCallRow, canReadPii: boolean): ToolCallView {
  const stored = row.result_json === null ? null : (JSON.parse(row.result_json) as { value?: unknown; logical?: boolean });
  return {
    id: row.id,
    taskId: row.task_id,
    stepId: row.step_id,
    agent: row.agent,
    tool: row.tool,
    args: redactIf(JSON.parse(row.args_json) as unknown, canReadPii),
    idempotencyKey: row.idempotency_key,
    attempt: row.attempt,
    generation: row.generation,
    leaseEpoch: row.lease_epoch,
    outcome: row.outcome,
    logical: stored?.logical === true,
    result: redactIf(stored?.value ?? null, canReadPii),
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
  };
}

async function loadRun(c: Context<AppEnv>, runId: string): Promise<RunRow | null> {
  if (!RUN_ID_PATTERN.test(runId)) return null;
  return c.env.DB.prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM approvals a WHERE a.run_id = r.id AND a.status = 'pending') AS pending_approvals FROM runs r WHERE r.id = ?`,
  )
    .bind(runId)
    .first<RunRow>();
}

function initInput(runId: string, requester: string, body: ReturnType<typeof LaunchRunRequestSchema.parse>, title: string, requestHash: string, budget: Budget): InitRunInput {
  return {
    runId,
    requester,
    clientRequestId: body.clientRequestId,
    requestHash,
    requestType: body.requestType,
    title,
    requestText: body.requestText,
    subjectEmployeeId: body.subjectEmployeeId,
    priority: body.priority ?? "normal",
    budget,
    sim: body.sim ? (compact(body.sim) as SimDirectives) : null,
    syntheticRef: body.syntheticRef ?? null,
    requestedAt: body.requestedAt ?? new Date().toISOString(),
  };
}

/** Runs one recovery command on the run's coordinator; refusals answer 409 with the snapshot. */
async function runControl(c: Context<AppEnv>, runId: string, command: (actor: ControlCommand["actor"]) => ControlCommand): Promise<Response> {
  const run = await loadRun(c, runId);
  if (!run) return apiError(c, 404, "not_found", "no such run");
  const identity = c.get("identity");
  const coordinator = await coordinatorFor(c.env, runId);
  const result = await coordinator.control(command({ kind: identity.principal.kind, id: identity.principal.id }));
  const body: ControlResponse = { accepted: result.accepted, snapshot: result.snapshot, ...(result.reason ? { reason: result.reason } : {}) };
  return c.json(body, result.accepted ? 200 : 409);
}

export const runRoutes = new Hono<AppEnv>()
  .post("/api/runs", requirePermission("runs:launch"), validate("json", LaunchRunRequestSchema), async (c) => {
    const body = c.req.valid("json");
    const identity = c.get("identity");
    const config = c.get("config");
    if (body.budget && !identity.permissions.includes("budgets:edit")) return apiError(c, 403, "forbidden", "a launch budget needs budgets:edit", "missing_permission");
    if ((body.sim || body.syntheticRef || body.requestedAt) && !config.faultInjection) {
      return apiError(c, 400, "invalid_request", "simulation fields are accepted only with FAULT_INJECTION=on", "sim_not_allowed");
    }
    const subject = await directoryEntry(c.env.PEOPLE_DB, body.subjectEmployeeId);
    if (!subject) return apiError(c, 400, "invalid_request", `unknown employee ${body.subjectEmployeeId}`, "unknown_employee");

    const requester = identity.principal.id;
    const requestHash = sha256Hex(canonicalJson(body));
    const budget: Budget = { ...DEFAULT_BUDGET, ...(compact(body.budget ?? {}) as Partial<Budget>) };
    const title = `${REQUEST_TYPE_LABELS[body.requestType]} for ${subject.fullName} (${subject.id})`;
    const now = new Date().toISOString();
    const runId = newRunId();
    const input = initInput(runId, requester, body, title, requestHash, budget);
    // Layer 1 of duplicate-action prevention: reserve (requester, clientRequestId) before any coordinator exists.
    const reserved = await c.env.DB.prepare(
      `INSERT INTO runs (id, requester, client_request_id, request_hash, request_type, title, request_text, subject_employee_id, priority,
         status, status_reason, budget_json, usage_json, synthetic_ref, requested_at, created_at, updated_at, finished_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?, ?, NULL, 0)
       ON CONFLICT(requester, client_request_id) DO NOTHING RETURNING id`,
    )
      .bind(runId, requester, body.clientRequestId, requestHash, body.requestType, title, body.requestText, body.subjectEmployeeId, input.priority,
        JSON.stringify(budget), JSON.stringify(ZERO_USAGE), input.syntheticRef, input.requestedAt, now, now)
      .first<{ id: string }>();
    if (reserved) {
      const snapshot = await (await coordinatorFor(c.env, runId)).initRun(input);
      const response: LaunchRunResponse = { runId, status: snapshot.status, deduplicated: false };
      return c.json(response, 201);
    }
    const existing = await c.env.DB.prepare("SELECT id, request_hash FROM runs WHERE requester = ? AND client_request_id = ?")
      .bind(requester, body.clientRequestId)
      .first<{ id: string; request_hash: string }>();
    if (!existing) return apiError(c, 500, "internal", "reservation vanished");
    if (existing.request_hash !== requestHash) return apiError(c, 409, "conflict", "clientRequestId was used with a different request", "idempotency_conflict");
    // Same request: initRun is idempotent, and also heals a reservation whose first initRun failed.
    const snapshot = await (await coordinatorFor(c.env, existing.id)).initRun({ ...input, runId: existing.id });
    const response: LaunchRunResponse = { runId: existing.id, status: snapshot.status, deduplicated: true };
    return c.json(response, 200);
  })
  .get("/api/runs", requirePermission("runs:read"), validate("query", RunListQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const limit = query.limit ?? 25;
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (query.status) (clauses.push("r.status = ?"), params.push(query.status));
    if (query.type) (clauses.push("r.request_type = ?"), params.push(query.type));
    if (query.requester) (clauses.push("r.requester = ?"), params.push(query.requester.toLowerCase()));
    if (query.from) (clauses.push("r.created_at >= ?"), params.push(query.from));
    if (query.to) (clauses.push("r.created_at < ?"), params.push(query.to));
    const after = decodeCursor<{ at: string; id: string }>(query.cursor);
    if (after) (clauses.push("(r.created_at < ? OR (r.created_at = ? AND r.id < ?))"), params.push(after.at, after.at, after.id));
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { results } = await c.env.DB.prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM approvals a WHERE a.run_id = r.id AND a.status = 'pending') AS pending_approvals
       FROM runs r ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
      .bind(...params, limit + 1)
      .all<RunRow>();
    const last = results.length > limit ? results[limit - 1] : undefined;
    const page: Page<RunSummary> = { items: results.slice(0, limit).map(runSummary), nextCursor: last ? encodeCursor({ at: last.created_at, id: last.id }) : null };
    return c.json(page);
  })
  .get("/api/runs/:id", requirePermission("runs:read"), async (c) => {
    const run = await loadRun(c, c.req.param("id"));
    if (!run) return apiError(c, 404, "not_found", "no such run");
    const identity = c.get("identity");
    const pii = identity.permissions.includes("pii:read");
    const tasks = await c.env.DB.prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY created_at, id").bind(run.id).all<TaskRow>();
    const approvals = await c.env.DB.prepare("SELECT * FROM approvals WHERE run_id = ? ORDER BY requested_at").bind(run.id).all<Parameters<typeof approvalFromRow>[0]>();
    const detail: RunDetailResponse = {
      run: { ...runSummary(run), requestText: pii ? run.request_text : null },
      tasks: tasks.results.map((t) => taskFromRow(t, pii)),
      approvals: approvals.results.map((row): ApprovalListItem => {
        const view = approvalFromRow(row);
        return { ...view, canDecide: canDecide(view, identity) };
      }),
    };
    return c.json(detail);
  })
  .get("/api/runs/:id/tool-calls", requirePermission("runs:read"), async (c) => {
    const run = await loadRun(c, c.req.param("id"));
    if (!run) return apiError(c, 404, "not_found", "no such run");
    const pii = c.get("identity").permissions.includes("pii:read");
    const limit = 100;
    const after = decodeCursor<{ at: string; id: string }>(c.req.query("cursor"));
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM tool_calls WHERE run_id = ? ${after ? "AND (started_at > ? OR (started_at = ? AND id > ?))" : ""} ORDER BY started_at, id LIMIT ?`,
    )
      .bind(run.id, ...(after ? [after.at, after.at, after.id] : []), limit + 1)
      .all<ToolCallRow>();
    const last = results.length > limit ? results[limit - 1] : undefined;
    const page: Page<ToolCallView> = { items: results.slice(0, limit).map((r) => toolCallFromRow(r, pii)), nextCursor: last ? encodeCursor({ at: last.started_at, id: last.id }) : null };
    return c.json(page);
  })
  .get("/api/runs/:id/timeline", requirePermission("runs:read"), async (c) => {
    const run = await loadRun(c, c.req.param("id"));
    if (!run) return apiError(c, 404, "not_found", "no such run");
    const { results } = await c.env.DB.prepare("SELECT seq, ts, action, actor_type, actor_id, task_id, detail_json FROM audit_events WHERE stream = ? ORDER BY seq")
      .bind(`run:${run.id}`)
      .all<{ seq: number; ts: string; action: string; actor_type: TimelineEntry["actorType"]; actor_id: string; task_id: string | null; detail_json: string }>();
    const entries: TimelineEntry[] = results.map((e) => ({
      seq: e.seq,
      ts: e.ts,
      action: e.action,
      actorType: e.actor_type,
      actorId: e.actor_id,
      taskId: e.task_id,
      summary: timelineSummary(e.action, JSON.parse(e.detail_json) as Record<string, unknown>),
    }));
    return c.json(entries);
  })
  .get("/api/runs/:id/audit", requirePermission("audit:read"), async (c) => {
    const run = await loadRun(c, c.req.param("id"));
    if (!run) return apiError(c, 404, "not_found", "no such run");
    const audit = await verifyRunAudit(c.env.DB, run.id);
    const events: AuditEventView[] = audit.events.map((e) => ({ ...e }));
    return c.json({ events, chain: { valid: audit.valid, brokenAtSeq: audit.brokenAtSeq } });
  })
  .post("/api/runs/:id/:command{pause|resume|cancel}", requirePermission("runs:control"), validate("json", ControlRequestSchema), async (c) => {
    const type = c.req.param("command") as "pause" | "resume" | "cancel";
    const { reason } = c.req.valid("json");
    return runControl(c, c.req.param("id"), (actor) => ({ type, actor, reason }));
  })
  .post("/api/runs/:id/tasks/:taskId/retry", requirePermission("tasks:retry"), validate("json", ControlRequestSchema), async (c) => {
    const { reason } = c.req.valid("json");
    return runControl(c, c.req.param("id"), (actor) => ({ type: "retry_task", taskId: c.req.param("taskId"), actor, reason }));
  })
  .post("/api/runs/:id/tasks/:taskId/release-lease", requirePermission("tasks:release_lease"), validate("json", ControlRequestSchema), async (c) => {
    const { reason } = c.req.valid("json");
    return runControl(c, c.req.param("id"), (actor) => ({ type: "release_lease", taskId: c.req.param("taskId"), actor, reason }));
  })
  .post("/api/runs/:id/tasks/:taskId/skip", requirePermission("tasks:skip"), validate("json", ControlRequestSchema), async (c) => {
    const { reason } = c.req.valid("json");
    return runControl(c, c.req.param("id"), (actor) => ({ type: "skip_task", taskId: c.req.param("taskId"), actor, reason }));
  })
  .patch("/api/runs/:id/budget", requirePermission("budgets:edit"), validate("json", BudgetPatchSchema), async (c) => {
    const { reason, ...patch } = c.req.valid("json");
    const budget: Partial<Budget> = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    return runControl(c, c.req.param("id"), (actor) => ({ type: "raise_budget", budget, actor, reason }));
  });
