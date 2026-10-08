const TONES: Record<string, string> = {
  succeeded: "success",
  approved: "success",
  ok: "success",
  sent: "success",
  running: "info",
  planning: "info",
  leased: "info",
  ready: "info",
  queued: "neutral",
  pending: "neutral",
  awaiting_approval: "warning",
  held: "warning",
  paused: "warning",
  budget_blocked: "warning",
  in_progress: "warning",
  replayed: "accent",
  needs_attention: "danger",
  failed: "danger",
  rejected: "danger",
  dead_lettered: "danger",
  expired: "danger",
  permanent_error: "danger",
  forbidden: "danger",
  retryable_error: "warning",
  timeout: "warning",
  cancelled: "neutral",
  skipped: "neutral",
  poison: "danger",
  ignored_stale: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONES[status] ?? "neutral";
  return <span className={`badge${tone === "neutral" ? "" : ` badge--${tone}`}`}>{status.replaceAll("_", " ")}</span>;
}
