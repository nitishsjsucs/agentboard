import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { ApprovalListItem, Page } from "../../shared/api-types.ts";
import { api, query } from "../api/client.ts";
import { describeError } from "../api/describeError.ts";
import { usePolling, useSession } from "../api/hooks.ts";
import { ApprovalCard, type Decision } from "../components/ApprovalCard.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { PolledView } from "../components/PolledView.tsx";

const STATUSES = ["pending", "approved", "rejected", "expired", ""] as const;

type Announcement = { kind: "decided"; decision: Decision; approval: ApprovalListItem } | { kind: "conflict"; error: unknown };

const NOTE_INPUTS = 'input[data-note]:not(:disabled)';

export function Approvals() {
  const { me } = useSession();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  // Switching the status tab clears the previous tab's cards before the new answer arrives.
  const approvals = usePolling(() => api.get<Page<ApprovalListItem>>(`/api/approvals${query({ status, limit: 50 })}`), [status], { resetKey: status });
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // After a decision: where focus goes once the refreshed list no longer offers that approval.
  const pendingFocus = useRef<{ decidedId: string; index: number } | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || !approvals.data) return;
    if (approvals.data.items.some((a) => a.id === target.decidedId && a.status === "pending")) return;
    pendingFocus.current = null;
    const inputs = [...(listRef.current?.querySelectorAll<HTMLInputElement>(NOTE_INPUTS) ?? [])];
    const next = inputs[Math.min(target.index, inputs.length - 1)];
    if (next) next.focus();
    else statusRef.current?.focus();
  }, [approvals.data]);

  const onDecided = (decision: Decision, approval: ApprovalListItem) => {
    const inputs = [...(listRef.current?.querySelectorAll<HTMLInputElement>(NOTE_INPUTS) ?? [])];
    const index = Math.max(0, inputs.findIndex((input) => input.closest("[data-approval-id]")?.getAttribute("data-approval-id") === approval.id));
    pendingFocus.current = { decidedId: approval.id, index };
    setAnnouncement({ kind: "decided", decision, approval });
    approvals.refresh();
  };
  const onConflict = (error: unknown) => {
    setAnnouncement({ kind: "conflict", error });
    approvals.refresh();
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Approval queue</h1>
          <p>Manager changes, terminations and privileged grants wait here. Only reads ran before each gate, so a rejection never leaves a write behind.</p>
        </div>
        <div className="tabs" role="tablist" style={{ marginBottom: 0, borderBottom: 0 }}>
          {STATUSES.map((s) => (
            <button key={s || "all"} type="button" role="tab" className="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
              {s || "all"}
            </button>
          ))}
        </div>
      </div>
      <div role="status" tabIndex={-1} ref={statusRef} data-testid="decision-status" className="status-line">
        {announcement?.kind === "decided" ? (
          <div className="notice">
            {announcement.decision === "approve"
              ? `Approved: ${announcement.approval.summary}. ${announcement.approval.runTitle ?? "The run"} continues.`
              : `Rejected: ${announcement.approval.summary}. The run ends as rejected; no writes ran.`}{" "}
            <Link to={`/runs/${announcement.approval.runId}`}>Open the run</Link>
          </div>
        ) : announcement?.kind === "conflict" ? (
          <div className="notice notice--warning">{describeError(announcement.error, { me, action: "decide approvals" }).message}</div>
        ) : null}
      </div>
      <PolledView polled={approvals} loading="Loading approvals..." action="read approvals">
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState title={status ? `No ${status} approvals.` : "No approvals yet."} />
          ) : (
            <div className="stack" ref={listRef}>
              {page.items.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} onDecided={onDecided} onConflict={onConflict} />
              ))}
            </div>
          )
        }
      </PolledView>
    </div>
  );
}
