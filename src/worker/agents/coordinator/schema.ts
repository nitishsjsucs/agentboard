// RunCoordinator types, DO SQLite schema and row mappers (SPEC sections 6.3, 7.1, 9.1).

import type {
  AgentRole,
  Budget,
  Priority,
  RequestType,
  RunStatus,
  SimDirectives,
  TaskKind,
  TaskStatus,
  Usage,
} from "../../../shared/domain.ts";

export const SCHEMA_VERSION = 1;

export const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ab_schema (version INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ab_run (id TEXT PRIMARY KEY, client_request_id TEXT NOT NULL, requester TEXT NOT NULL,
    request_json TEXT NOT NULL, status TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0, cancelled INTEGER NOT NULL DEFAULT 0, status_reason TEXT,
    deadline_exceeded INTEGER NOT NULL DEFAULT 0, budget_json TEXT NOT NULL, usage_json TEXT NOT NULL,
    active_since INTEGER, wake_at INTEGER, finished_at INTEGER, version INTEGER NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ab_tasks (id TEXT PRIMARY KEY, kind TEXT NOT NULL, step_id TEXT, tool TEXT, args_json TEXT,
    depends_on_json TEXT NOT NULL, status TEXT NOT NULL, hold_reason TEXT, attempts INTEGER NOT NULL, max_attempts INTEGER NOT NULL,
    generation INTEGER NOT NULL, requires_approval INTEGER NOT NULL, approval_id TEXT,
    dispatch_id TEXT, lease_id TEXT, lease_owner TEXT, lease_epoch INTEGER NOT NULL, lease_expires_at INTEGER,
    reserved_calls INTEGER NOT NULL DEFAULT 0, result_json TEXT, last_error TEXT, checkpoint_done INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ab_approvals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, generation INTEGER NOT NULL, tool TEXT NOT NULL,
    summary TEXT NOT NULL, risk TEXT NOT NULL, status TEXT NOT NULL, requested_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    decided_by TEXT, decided_at INTEGER, note TEXT, version INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ab_events (seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL,
    action TEXT NOT NULL, task_id TEXT, detail_json TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ab_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('d1','queue')),
    payload_json TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, sent_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS ab_reports (lease_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ab_traces (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)`,
];

// ---------------------------------------------------------------------------
// RPC types

export interface InitRunInput {
  runId: string;
  requester: string;
  clientRequestId: string;
  requestHash: string;
  requestType: RequestType;
  title: string;
  requestText: string;
  subjectEmployeeId: string;
  priority: Priority;
  budget: Budget;
  /** Dev-only simulation directives (accepted only when FAULT_INJECTION=on). */
  sim: SimDirectives | null;
  syntheticRef: string | null;
  /** Business timestamp (ISO). */
  requestedAt: string;
}

export interface Actor {
  kind: "user" | "service" | "agent" | "system";
  id: string;
}

export interface ClaimRequest {
  taskId: string;
  owner: string;
  dispatchId: string;
}

export type ClaimRefusal = "duplicate" | "stale_dispatch" | "in_flight" | "paused" | "cancelled" | "held" | "budget_exhausted" | "not_ready";

export interface TaskContext {
  runId: string;
  taskId: string;
  kind: TaskKind;
  role: AgentRole;
  attempt: number;
  generation: number;
  leaseId: string;
  epoch: number;
  leaseExpiresAt: number;
  request: { requestType: RequestType; subjectEmployeeId: string; requestText: string; title: string };
  step: { stepId: string; tool: string; args: Record<string, unknown> } | null;
  idempotencyKey: string | null;
  /** For verify tasks: the execute task's result (ids such as ticketId, deliveryId). */
  executeResult: unknown;
  budget: Budget;
  usage: Usage;
  remaining: { toolCalls: number; llmTokens: number };
  /** Fault directives for this step, generation and attempt; only when FAULT_INJECTION=on. */
  faults: ("transient_error" | "permanent_error" | "silent_noop" | "crash_after_call")[];
}

export interface Credential {
  token: string;
  leaseExpMs: number;
}

export type ClaimResult =
  | { ok: true; lease: { leaseId: string; epoch: number; expiresAt: number }; credential: Credential | null; context: TaskContext }
  | { ok: false; reason: ClaimRefusal };

export interface CompletionReport {
  taskId: string;
  leaseId: string;
  epoch: number;
  outcome: "succeeded" | "failed";
  retryable?: boolean;
  code?: string;
  message?: string;
  output?: unknown;
  evidence?: unknown;
  usage: { llmTokens?: number };
}

export type ToolCallOutcome = "ok" | "replayed" | "retryable_error" | "permanent_error" | "forbidden" | "in_progress" | "timeout";

export interface ToolCallTrace {
  id: string;
  taskId: string;
  leaseId: string;
  epoch: number;
  stepId: string | null;
  agent: string;
  tool: string;
  args: unknown;
  idempotencyKey: string | null;
  attempt: number;
  generation: number;
  outcome: ToolCallOutcome;
  logical: boolean;
  result: unknown;
  error: string | null;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export interface ApprovalDecision {
  approvalId: string;
  decision: "approve" | "reject";
  actor: Actor;
  note: string;
}

export type ControlCommand =
  | { type: "pause" | "resume" | "cancel"; actor: Actor; reason: string }
  | { type: "retry_task" | "skip_task" | "release_lease" | "replay_dead_letter"; actor: Actor; reason: string; taskId: string }
  | { type: "raise_budget"; actor: Actor; reason: string; budget: Partial<Budget> }
  | { type: "hold_role"; actor: Actor; reason: string; taskId: string; dispatchId: string; role: AgentRole }
  | { type: "release_role"; actor: Actor; reason: string; role: AgentRole }
  | { type: "dead_letter"; actor: Actor; reason: string; taskId: string; dispatchId: string };

export interface ControlResult {
  accepted: boolean;
  reason?: string;
}

export type { ApprovalView, RunSnapshot, TaskView } from "../../../shared/api-types.ts";
import type { ApprovalView, RunSnapshot } from "../../../shared/api-types.ts";

// ---------------------------------------------------------------------------
// In-memory records (one transaction loads the whole run)

export interface RunRecord {
  id: string;
  request: InitRunInput;
  status: RunStatus;
  paused: boolean;
  cancelled: boolean;
  statusReason: string | null;
  deadlineExceeded: boolean;
  budget: Budget;
  usage: Usage;
  activeSince: number | null;
  wakeAt: number | null;
  finishedAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  stepId: string | null;
  tool: string | null;
  args: Record<string, unknown> | null;
  dependsOn: string[];
  status: TaskStatus;
  holdReason: "role_disabled" | "checkpoint" | null;
  attempts: number;
  maxAttempts: number;
  generation: number;
  requiresApproval: boolean;
  approvalId: string | null;
  dispatchId: string | null;
  leaseId: string | null;
  leaseOwner: string | null;
  leaseEpoch: number;
  leaseExpiresAt: number | null;
  reservedCalls: number;
  result: unknown;
  lastError: string | null;
  checkpointDone: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ApprovalRecord {
  id: string;
  taskId: string;
  generation: number;
  tool: string;
  summary: string;
  risk: "medium" | "high";
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: number;
  expiresAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string | null;
  version: number;
}

export interface RunState {
  run: RunRecord;
  tasks: Map<string, TaskRecord>;
  approvals: Map<string, ApprovalRecord>;
}

// ---------------------------------------------------------------------------
// Row mappers

type Row = Record<string, string | number | boolean | null>;

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const json = <T>(v: unknown): T => JSON.parse(String(v)) as T;
const jsonOrNull = <T>(v: unknown): T | null => (v === null || v === undefined ? null : (JSON.parse(String(v)) as T));

export function runFromRow(row: Row): RunRecord {
  return {
    id: str(row["id"]),
    request: json<InitRunInput>(row["request_json"]),
    status: str(row["status"]) as RunStatus,
    paused: num(row["paused"]) === 1,
    cancelled: num(row["cancelled"]) === 1,
    statusReason: strOrNull(row["status_reason"]),
    deadlineExceeded: num(row["deadline_exceeded"]) === 1,
    budget: json<Budget>(row["budget_json"]),
    usage: json<Usage>(row["usage_json"]),
    activeSince: numOrNull(row["active_since"]),
    wakeAt: numOrNull(row["wake_at"]),
    finishedAt: numOrNull(row["finished_at"]),
    version: num(row["version"]),
    createdAt: num(row["created_at"]),
    updatedAt: num(row["updated_at"]),
  };
}

export function taskFromRow(row: Row): TaskRecord {
  return {
    id: str(row["id"]),
    kind: str(row["kind"]) as TaskKind,
    stepId: strOrNull(row["step_id"]),
    tool: strOrNull(row["tool"]),
    args: jsonOrNull<Record<string, unknown>>(row["args_json"]),
    dependsOn: json<string[]>(row["depends_on_json"]),
    status: str(row["status"]) as TaskStatus,
    holdReason: strOrNull(row["hold_reason"]) as TaskRecord["holdReason"],
    attempts: num(row["attempts"]),
    maxAttempts: num(row["max_attempts"]),
    generation: num(row["generation"]),
    requiresApproval: num(row["requires_approval"]) === 1,
    approvalId: strOrNull(row["approval_id"]),
    dispatchId: strOrNull(row["dispatch_id"]),
    leaseId: strOrNull(row["lease_id"]),
    leaseOwner: strOrNull(row["lease_owner"]),
    leaseEpoch: num(row["lease_epoch"]),
    leaseExpiresAt: numOrNull(row["lease_expires_at"]),
    reservedCalls: num(row["reserved_calls"]),
    result: jsonOrNull<unknown>(row["result_json"]),
    lastError: strOrNull(row["last_error"]),
    checkpointDone: num(row["checkpoint_done"]) === 1,
    version: num(row["version"]),
    createdAt: num(row["created_at"]),
    updatedAt: num(row["updated_at"]),
  };
}

export function approvalFromRow(row: Row): ApprovalRecord {
  return {
    id: str(row["id"]),
    taskId: str(row["task_id"]),
    generation: num(row["generation"]),
    tool: str(row["tool"]),
    summary: str(row["summary"]),
    risk: str(row["risk"]) as ApprovalRecord["risk"],
    status: str(row["status"]) as ApprovalRecord["status"],
    requestedAt: num(row["requested_at"]),
    expiresAt: num(row["expires_at"]),
    decidedBy: strOrNull(row["decided_by"]),
    decidedAt: numOrNull(row["decided_at"]),
    note: strOrNull(row["note"]),
    version: num(row["version"]),
  };
}

export const SYSTEM: Actor = { kind: "system", id: "coordinator" };

export const ROLE_FOR_KIND: Record<TaskKind, AgentRole> = { plan: "planner", execute: "executor", verify: "verifier" };
export const KIND_FOR_ROLE: Record<AgentRole, TaskKind> = { planner: "plan", executor: "execute", verifier: "verify" };

export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(["succeeded", "skipped", "cancelled", "failed", "rejected"]);

/**
 * The coordinator's RPC surface. Callers type stubs with this interface,
 * because the generated Rpc types collapse members that carry `unknown`
 * (tool arguments and results) to `never`.
 */
export interface RunCoordinatorRpc {
  initRun(input: InitRunInput): Promise<RunSnapshot>;
  claimTask(req: ClaimRequest): Promise<ClaimResult>;
  appendTrace(trace: ToolCallTrace): Promise<{ accepted: boolean; reason?: string }>;
  completeTask(report: CompletionReport): Promise<{ accepted: boolean; reason?: string }>;
  control(cmd: ControlCommand): Promise<ControlResult & { snapshot: RunSnapshot }>;
  getSnapshot(): Promise<RunSnapshot>;
  getTaskContext(taskId: string, leaseId: string): Promise<TaskContext | null>;
  resolveApproval(decision: ApprovalDecision): Promise<{
    accepted: boolean;
    reason?: "self_approval" | "already_decided" | "expired" | "not_found";
    approval: ApprovalView | null;
    snapshot: RunSnapshot;
  }>;
}
