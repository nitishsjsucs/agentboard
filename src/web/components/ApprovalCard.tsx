import { useState } from "react";
import { Link } from "react-router";
import type { ApprovalListItem } from "../../shared/api-types.ts";
import { api } from "../api/client.ts";
import { useSession } from "../api/hooks.ts";
import { formatTime } from "./RunTable.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

/**
 * One approval with approve and reject. Decisions are disabled on the viewer's
 * own runs (separation of duties); the coordinator enforces the same rule.
 */
export function ApprovalCard({ approval, onDecided }: { approval: ApprovalListItem; onDecided: () => void }) {
  const { me } = useSession();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownRun = me !== null && approval.requester.toLowerCase() === me.principal.id;
  const canAct = approval.canDecide && !ownRun && approval.status === "pending";
  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/approvals/${approval.id}/decision`, { decision, note: note.trim() });
      onDecided();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card card__body stack" style={{ gap: "var(--space-2)" }} data-testid="approval-card">
      <div className="row">
        <StatusBadge status={approval.status} />
        <span className={`badge ${approval.risk === "high" ? "badge--danger" : "badge--warning"}`}>{approval.risk} risk</span>
        <span className="mono small">{approval.tool}</span>
        <span className="spacer" />
        <Link to={`/runs/${approval.runId}`} className="small mono">
          {approval.runId.slice(0, 14)}
        </Link>
      </div>
      <div style={{ fontWeight: 600 }}>{approval.summary}</div>
      <div className="small muted">
        requested by {approval.requester}, {formatTime(approval.requestedAt)}; expires {formatTime(approval.expiresAt)}
        {approval.decidedBy ? `; decided by ${approval.decidedBy}: ${approval.decisionNote ?? ""}` : ""}
      </div>
      {approval.status === "pending" ? (
        <>
          {ownRun ? <div className="notice notice--warning">You requested this run, so you cannot decide its approval.</div> : null}
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input
              className="input"
              placeholder="Decision note (required)"
              aria-label="Decision note"
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
        </>
      ) : null}
      {error ? <div className="error-text">{error}</div> : null}
    </div>
  );
}
