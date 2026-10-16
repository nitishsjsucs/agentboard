// One-line, PII-free summaries of run audit events for the timeline.

import { RUN_STATUSES, type RunStatus } from "../../../shared/domain.ts";

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

const DECISION_PAST: Record<string, string> = { approve: "approved", reject: "rejected" };

/**
 * The stored validation issues as "code (stepId)". Only the enumerated code and the step id are used,
 * and each must look like one, so no planner message, policy text or request data can reach the summary.
 */
function issueList(issues: unknown): string {
  if (!Array.isArray(issues)) return "";
  return issues
    .map((issue) => {
      const { code, stepId } = (issue ?? {}) as { code?: unknown; stepId?: unknown };
      if (typeof code !== "string" || !/^[a-z_]{1,40}$/.test(code)) return null;
      return typeof stepId === "string" && /^s\d{1,2}$/.test(stepId) ? `${code} (${stepId})` : code;
    })
    .filter((item): item is string => item !== null)
    .join(", ");
}

export function timelineSummary(action: string, d: Record<string, unknown>): string {
  switch (action) {
    case "run.created":
      return `run created (${str(d["requestType"])} for ${str(d["subjectEmployeeId"])})`;
    case "run.status_changed":
      return `status ${str(d["from"])} to ${str(d["to"])}${d["reason"] ? ` (${str(d["reason"])})` : ""}`;
    case "run.paused":
    case "run.resumed":
    case "run.cancelled":
      return `${action.slice(4)}: ${str(d["reason"])}`;
    case "plan.accepted": {
      const steps = Array.isArray(d["steps"]) ? (d["steps"] as { stepId: string; tool: string }[]) : [];
      return `plan accepted: ${steps.map((s) => `${s.stepId} ${s.tool}`).join(", ")}`;
    }
    case "plan.rejected": {
      const issues = issueList(d["issues"]);
      return issues ? `plan rejected by validation: ${issues}` : "plan rejected by validation";
    }
    case "task.dispatched":
      return `dispatched (attempt ${str(d["attempt"])}${d["delaySeconds"] ? `, delay ${str(d["delaySeconds"])} s` : ""}${d["duplicateDelivery"] ? ", duplicate delivery" : ""})`;
    case "task.leased":
      return `leased (attempt ${str(d["attempt"])}, epoch ${str(d["epoch"])})`;
    case "task.claim_refused":
      return `claim refused: ${str(d["reason"])}`;
    case "task.lease_expired":
      return `lease expired (epoch ${str(d["epoch"])}, owner ${str(d["owner"])})`;
    case "task.lease_released":
      return `lease released: ${str(d["reason"])}`;
    case "task.succeeded":
      return `succeeded (attempt ${str(d["attempt"])})`;
    case "task.failed":
      return `failed: ${str(d["code"])}${d["willRetry"] ? " (will retry)" : ""}`;
    case "task.retried":
      return `retried to generation ${str(d["generation"])}${d["cascadeFrom"] ? " (cascade)" : ""}`;
    case "task.skipped":
      return `skipped${d["cascadeFrom"] ? " (cascade)" : ""}${d["unverified"] ? ", write left unverified" : ""}`;
    case "task.held":
      return `held: ${str(d["reason"])}`;
    case "task.released":
      return `released: ${str(d["reason"])}`;
    case "task.dead_lettered":
      return "dead-lettered";
    case "task.dead_letter_ignored":
      return "stale dead-letter ignored";
    case "tool.called":
      return `${str(d["tool"])}: ${str(d["outcome"])}${d["logical"] ? " (logical replay)" : ""} in ${str(d["durationMs"])} ms`;
    case "verify.passed":
      return `verification passed (${str(d["tool"])})`;
    case "verify.failed":
      return `verification failed (${str(d["tool"])})`;
    case "approval.requested":
      return `approval requested (${str(d["risk"])}): ${str(d["summary"])}`;
    case "approval.decided":
      return `approval ${DECISION_PAST[str(d["decision"])] ?? str(d["decision"])}: ${str(d["note"])}`;
    case "approval.expired":
      return `approval expired (${str(d["reason"])})`;
    case "budget.exhausted":
      return `budget exhausted: ${str(d["budget"])}`;
    case "budget.raised":
      return `budget raised: ${str(d["reason"])}`;
    case "dlq.replayed":
      return `dead letter replayed: ${str(d["reason"])}`;
    default:
      return action;
  }
}

const isRunStatus = (value: unknown): value is RunStatus => typeof value === "string" && (RUN_STATUSES as readonly string[]).includes(value);

/**
 * Structured fields a timeline entry carries besides its summary. Only run.status_changed has any: its
 * from and to statuses, each only when it is a run status, so nothing free-form reaches the console.
 */
export function timelineFields(action: string, d: Record<string, unknown>): { statusFrom?: RunStatus; statusTo?: RunStatus } {
  if (action !== "run.status_changed") return {};
  const fields: { statusFrom?: RunStatus; statusTo?: RunStatus } = {};
  if (isRunStatus(d["from"])) fields.statusFrom = d["from"];
  if (isRunStatus(d["to"])) fields.statusTo = d["to"];
  return fields;
}
