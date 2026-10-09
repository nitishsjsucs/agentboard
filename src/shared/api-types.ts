// HTTP API contract (SPEC section 9.1): zod schemas for requests and the
// response types shared by the worker and the console.

import { z } from "zod";
import {
  PRIORITIES,
  REQUEST_TYPES,
  RUN_STATUSES,
  type Budget,
  type Permission,
  type Priority,
  type RequestType,
  type Role,
  type RunStatus,
  type TaskKind,
  type TaskStatus,
  type Usage,
} from "./domain.ts";

// ---------------------------------------------------------------------------
// Requests

const reason = z.string().trim().min(3).max(500);

export const SimDirectivesSchema = z.strictObject({
  faults: z
    .array(
      z.strictObject({
        stepId: z.string().regex(/^s[1-9]\d?$/),
        generation: z.number().int().min(0),
        attempt: z.number().int().min(1),
        kind: z.enum(["transient_error", "permanent_error", "silent_noop", "crash_after_call"]),
      }),
    )
    .max(16)
    .optional(),
  duplicateDeliveryStep: z.string().regex(/^s[1-9]\d?$/).optional(),
  checkpointStep: z.string().regex(/^s[1-9]\d?$/).optional(),
});

export const BudgetOverrideSchema = z.strictObject({
  maxSteps: z.number().int().min(1).max(8).optional(),
  maxToolCalls: z.number().int().min(1).max(200).optional(),
  maxLlmTokens: z.number().int().min(0).max(100_000).optional(),
  maxAttemptsPerTask: z.number().int().min(1).max(10).optional(),
  maxActiveMs: z.number().int().min(1000).max(86_400_000).optional(),
});

export const LaunchRunRequestSchema = z.strictObject({
  clientRequestId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  requestType: z.enum(REQUEST_TYPES),
  requestText: z.string().trim().min(10).max(4000),
  subjectEmployeeId: z.string().regex(/^E-\d{4}$/),
  priority: z.enum(PRIORITIES).optional(),
  budget: BudgetOverrideSchema.optional(),
  sim: SimDirectivesSchema.optional(),
  /** Simulation bookkeeping (accepted only with FAULT_INJECTION=on, like `sim`). */
  syntheticRef: z.string().regex(/^syn-\d{4}$/).optional(),
  requestedAt: z.iso.datetime().optional(),
});
export type LaunchRunRequest = z.infer<typeof LaunchRunRequestSchema>;

export const ControlRequestSchema = z.strictObject({ reason });
export type ControlRequest = z.infer<typeof ControlRequestSchema>;

export const DecisionRequestSchema = z.strictObject({ decision: z.enum(["approve", "reject"]), note: reason });
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

export const BudgetPatchSchema = z
  .strictObject({
    maxToolCalls: z.number().int().min(1).max(200).optional(),
    maxLlmTokens: z.number().int().min(0).max(100_000).optional(),
    maxActiveMs: z.number().int().min(1000).max(86_400_000).optional(),
    maxAttemptsPerTask: z.number().int().min(1).max(10).optional(),
    reason,
  })
  .refine((patch) => patch.maxToolCalls !== undefined || patch.maxLlmTokens !== undefined || patch.maxActiveMs !== undefined || patch.maxAttemptsPerTask !== undefined, {
    message: "name at least one budget field to raise",
  });
export type BudgetPatch = z.infer<typeof BudgetPatchSchema>;

export const RunListQuerySchema = z.object({
  status: z.enum(RUN_STATUSES).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
  requester: z.string().max(200).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const ApprovalListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  docType: z.enum(["run", "task", "tool_call", "approval"]).optional(),
  status: z.string().max(40).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

// ---------------------------------------------------------------------------
// Responses

export interface ApiError {
  error: {
    code: "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid_request" | "misconfigured" | "internal";
    reason?: string;
    message: string;
    requestId: string;
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TaskView {
  id: string;
  kind: TaskKind;
  stepId: string | null;
  tool: string | null;
  args: Record<string, unknown> | null;
  dependsOn: string[];
  status: TaskStatus;
  holdReason: "role_disabled" | "checkpoint" | null;
  attempts: number;
  generation: number;
  requiresApproval: boolean;
  lease: { owner: string; epoch: number; expiresAt: string } | null;
  lastError: string | null;
  updatedAt: string;
}

export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  statusReason: string | null;
  budget: Budget;
  usage: Usage;
  tasks: TaskView[];
  recentEvents: { seq: number; ts: string; action: string; actorId: string; taskId: string | null }[];
  pendingApprovalIds: string[];
  version: number;
}

export interface ApprovalView {
  id: string;
  runId: string;
  taskId: string;
  tool: string;
  summary: string;
  risk: "medium" | "high";
  requester: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ApprovalListItem extends ApprovalView {
  canDecide: boolean;
}

export interface LaunchRunResponse {
  runId: string;
  status: RunStatus;
  deduplicated: boolean;
}

export interface RunSummary {
  id: string;
  title: string;
  requestType: RequestType;
  status: RunStatus;
  statusReason: string | null;
  requester: string;
  subjectEmployeeId: string;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  budget: Budget;
  usage: Usage;
  pendingApprovals: number;
  syntheticRef: string | null;
}

export interface RunDetailResponse {
  run: RunSummary & { requestText: string | null };
  tasks: TaskView[];
  approvals: ApprovalListItem[];
}

export interface ToolCallView {
  id: string;
  taskId: string;
  stepId: string | null;
  agent: string;
  tool: string;
  args: unknown;
  idempotencyKey: string | null;
  attempt: number;
  generation: number;
  leaseEpoch: number;
  outcome: "ok" | "replayed" | "retryable_error" | "permanent_error" | "forbidden" | "in_progress" | "timeout";
  logical: boolean;
  result: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface TimelineEntry {
  seq: number;
  ts: string;
  action: string;
  actorType: "user" | "service" | "agent" | "system";
  actorId: string;
  taskId: string | null;
  summary: string;
}

export interface AuditEventView {
  stream: string;
  seq: number;
  ts: string;
  actorType: string;
  actorId: string;
  action: string;
  runId: string | null;
  taskId: string | null;
  detail: unknown;
  prevHash: string;
  hash: string;
}

export interface SearchHit {
  runId: string;
  docType: "run" | "task" | "tool_call" | "approval";
  status: string | null;
  requestType: RequestType | null;
  /** Highlights delimited by U+0002 and U+0003, never HTML. */
  snippet: string;
  score: number;
  createdAt: string;
}

export interface ControlResponse {
  accepted: boolean;
  reason?: string;
  snapshot: RunSnapshot;
}

export interface MeResponse {
  principal: { kind: "user" | "service"; id: string; email: string | null };
  role: Role | null;
  permissions: Permission[];
  authMode: "access" | "dev";
  environment: string;
}

export interface AgentRolesResponse {
  roles: { role: "planner" | "executor" | "verifier"; disabled: boolean; reason: string | null; updatedBy: string; updatedAt: string; heldTasks: number }[];
}

export interface DlqMessageView {
  id: string;
  runId: string | null;
  taskId: string | null;
  dispatchId: string | null;
  attempts: number;
  outcome: "dead_lettered" | "ignored_stale" | "poison";
  receivedAt: string;
  replayedAt: string | null;
  replayedBy: string | null;
  /** The task's current status in the D1 mirror; null for a poison message. */
  taskStatus: TaskStatus | null;
  /** A dead letter that was not replayed and whose task is still dead_lettered: the only kind a replay can act on. */
  open: boolean;
}

export interface MetricsSummary {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  pendingApprovals: number;
  needsAttention: number;
  dlqOpen: number;
}
