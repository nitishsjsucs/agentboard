import { useState } from "react";
import { Link } from "react-router";
import type { ApprovalListItem } from "../../shared/api-types.ts";
import { api, ApiRequestError } from "../api/client.ts";
import { useCan, useSession } from "../api/hooks.ts";
import { ErrorNotice } from "./ErrorNotice.tsx";
import { formatTime } from "./RunTable.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

export type Decision = "approve" | "reject";

/** The coordinator refused because the approval is no longer pending (someone decided first, or it expired). */
export function isDecisionConflict(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409 && (error.reason === "already_decided" || error.reason === "expired");
}

function decisionLine(approval: ApprovalListItem): string {
  if (approval.status === "pending") return `; expires ${formatTime(approval.expiresAt)}`;
  if (approval.status === "expired") return approval.decisionNote ? `; expired: ${approval.decisionNote}` : `; expired ${formatTime(approval.decidedAt ?? approval.expiresAt)}`;
  return `; decided by ${approval.decidedBy ?? "unknown"}${approval.decisionNote ? `: ${approval.decisionNote}` : ""}`;
}

/**
 * One approval with approve and reject. Decisions are disabled on the viewer's
 * own runs (separation of duties); the coordinator enforces the same rule.
 */
export function ApprovalCard({
  approval,
  onDecided,
  onConflict,
}: {
  approval: ApprovalListItem;
  onDecided: (decision: Decision, approval: ApprovalListItem) => void;
  /** Called instead of showing the refusal in the card when the approval was already decided or expired. */
  onConflict?: (error: unknown) => void;
}) {
  const { me } = useSession();
  const mayDecide = useCan("approvals:decide");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ownRun = me !== null && approval.requester.toLowerCase() === me.principal.id;
  const canAct = approval.canDecide && !ownRun && approval.status === "pending";
  const noteId = `note-${approval.id}`;
  const hintId = `note-hint-${approval.id}`;
  const decide = async (decision: Decision) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/approvals/${approval.id}/decision`, { decision, note: note.trim() });
      onDecided(decision, approval);
    } catch (e) {
      if (isDecisionConflict(e) && onConflict) onConflict(e);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card card__body stack" style={{ gap: "var(--space-2)" }} data-testid="approval-card" data-approval-id={approval.id}>
      <div className="row">
        <StatusBadge status={approval.status} />
        <span className={`badge ${approval.risk === "high" ? "badge--danger" : "badge--warning"}`}>{approval.risk} risk</span>
        <span className="mono small">{approval.tool}</span>
        <span className="spacer" />
        <Link to={`/runs/${approval.runId}`} className="small" title={approval.runId}>
          {approval.runTitle ?? <span className="mono">{approval.runId.slice(0, 14)}</span>}
        </Link>
      </div>
      <div style={{ fontWeight: 600 }}>{approval.summary}</div>
      <div className="small muted">
        requested by {approval.requester}, {formatTime(approval.requestedAt)}
        {decisionLine(approval)}
      </div>
      {approval.status === "pending" ? (
        ownRun || mayDecide ? (
          <>
            {ownRun ? <div className="notice notice--warning">You requested this run, so you cannot decide its approval.</div> : null}
            <div className="note-row" data-testid="note-row">
              <input
                id={noteId}
                className="input"
                placeholder="Decision note (required)"
                aria-label="Decision note"
                aria-describedby={hintId}
                data-note=""
                value={note}
                maxLength={500}
                disabled={!canAct}
                onChange={(e) => setNote(e.target.value)}
              />
              <button type="button" className="btn btn--primary" disabled={!canAct || busy || note.trim().length < 3} onClick={() => void decide("approve")}>
                Approve
              </button>
              <button type="button" className="btn btn--danger" disabled={!canAct || busy || note.trim().length < 3} onClick={() => void decide("reject")}>
                Reject
              </button>
            </div>
            <span id={hintId} className="small muted">
              At least 3 characters
            </span>
          </>
        ) : (
          <div className="small muted" data-testid="decide-elsewhere">
            Approvers and admins decide approvals.
          </div>
        )
      ) : null}
      {error ? <ErrorNotice error={error} action="decide approvals" /> : null}
    </div>
  );
}
