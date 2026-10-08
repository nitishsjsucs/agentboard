// Domain enums shared by the worker, the console and the scripts (SPEC section 9.1).

export const ROLES = ["viewer", "operator", "approver", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "runs:read",
  "runs:launch",
  "runs:control",
  "tasks:retry",
  "tasks:release_lease",
  "tasks:skip",
  "budgets:edit",
  "approvals:decide",
  "search:read",
  "audit:read",
  "pii:read",
  "agents:read",
  "agents:toggle",
  "dlq:read",
  "dlq:replay",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const REQUEST_TYPES = [
  "address_change",
  "manager_change",
  "onboarding_access",
  "privileged_access",
  "offboarding",
  "access_revocation",
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const RUN_STATUSES = [
  "queued",
  "planning",
  "running",
  "awaiting_approval",
  "paused",
  "needs_attention",
  "succeeded",
  "rejected",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["succeeded", "rejected", "cancelled"];

export const TASK_STATUSES = [
  "pending",
  "ready",
  "leased",
  "awaiting_approval",
  "held",
  "succeeded",
  "failed",
  "rejected",
  "skipped",
  "cancelled",
  "dead_lettered",
  "budget_blocked",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_KINDS = ["plan", "execute", "verify"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const AGENT_ROLES = ["planner", "executor", "verifier"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Roles every employee may hold; `onboarding_access` may grant only these. */
export const BASELINE_ROLES = ["okta:employee", "slack:member", "github:member", "google:workspace-user"] as const;
/** Grants of these need approval; `privileged_access` may grant only these. */
export const PRIVILEGED_ROLES = ["workday:payroll-admin", "okta:super-admin", "github:org-owner", "aws:prod-admin"] as const;

export const NOTIFY_CHANNELS = ["email", "slack"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

export const NOTIFY_TEMPLATES = [
  "address_updated",
  "manager_updated",
  "onboarding_ready",
  "privileged_access_granted",
  "offboarding_complete",
  "access_revoked",
] as const;
export type NotifyTemplate = (typeof NOTIFY_TEMPLATES)[number];

export const TICKET_CATEGORIES = ["laptop_provision", "laptop_return", "access_issue"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const EMPLOYMENT_STATUSES = ["active", "terminated", "pending_start"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const FAULT_KINDS = ["transient_error", "permanent_error", "silent_noop", "crash_after_call"] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export interface SimFault {
  stepId: string;
  generation: number;
  attempt: number;
  kind: FaultKind;
}

export interface SimDirectives {
  faults?: SimFault[];
  duplicateDeliveryStep?: string;
  checkpointStep?: string;
}

export interface Budget {
  maxSteps: number;
  maxToolCalls: number;
  maxLlmTokens: number;
  maxAttemptsPerTask: number;
  maxActiveMs: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxSteps: 8,
  maxToolCalls: 24,
  maxLlmTokens: 6000,
  maxAttemptsPerTask: 3,
  maxActiveMs: 900_000,
};

export interface Usage {
  toolCalls: number;
  toolCallsReserved: number;
  llmTokens: number;
  activeMs: number;
  attempts: number;
  replays: number;
  skippedSteps: number;
}

export const ZERO_USAGE: Usage = {
  toolCalls: 0,
  toolCallsReserved: 0,
  llmTokens: 0,
  activeMs: 0,
  attempts: 0,
  replays: 0,
  skippedSteps: 0,
};

export interface Address {
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

/** One step of a plan, as the planner emits it (SPEC section 11.3). */
export interface PlanStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  dependsOn: string[];
}

export interface Plan {
  steps: PlanStep[];
}
