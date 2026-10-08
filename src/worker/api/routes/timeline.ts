// One-line, PII-free summaries of run audit events for the timeline.

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

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
    case "plan.rejected":
      return "plan rejected by validation";
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
      return `approval ${str(d["decision"])}d: ${str(d["note"])}`;
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
