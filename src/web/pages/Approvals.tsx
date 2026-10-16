import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ApprovalListItem, Page } from "../../shared/api-types.ts";
import { api, query } from "../api/client.ts";
import { describeError } from "../api/describeError.ts";
import { useCan, usePolling, useSession } from "../api/hooks.ts";
import { formatDuration, useNow } from "../api/time.ts";
import { ApprovalCard, type Decision } from "../components/ApprovalCard.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { usePageTitle } from "../api/usePageTitle.ts";
import { PolledView } from "../components/PolledView.tsx";
import { TabList, TabPanel } from "../components/Tabs.tsx";

const STATUSES = ["pending", "approved", "rejected", "expired", ""] as const;
type StatusTab = (typeof STATUSES)[number];

/** ?status= holds the tab ("all" for every status); anything unknown falls back to pending. */
function statusFromParam(value: string | null): StatusTab {
  if (value === "all") return "";
  return STATUSES.find((s) => s !== "" && s === value) ?? "pending";
}

/**
 * The pending tab's one-line summary: how many wait, how many this principal can decide, how many are
 * high risk, and when the next expires (the list is soonest expiry first).
 */
export function queueSummary(page: Page<ApprovalListItem>, options: { canDecide: boolean; now: number }): string {
  const { items, nextCursor } = page;
  const head = nextCursor !== null ? `${items.length}+ waiting; showing the ${items.length} that expire soonest` : `${items.length} waiting`;
  const body = options.canDecide
    ? `${head}: ${items.filter((a) => a.canDecide).length} you can decide, ${items.filter((a) => a.risk === "high").length} high risk.`
    : `${head}. Approvers and admins decide them.`;
  const next = items.map((a) => Date.parse(a.expiresAt)).find((at) => at > options.now);
  return `${body} ${next !== undefined ? `Next expires in ${formatDuration(next - options.now)}.` : "Every one shown is past its expiry; the list updates shortly."}`;
}

type Announcement = { kind: "decided"; decision: Decision; approval: ApprovalListItem } | { kind: "conflict"; error: unknown };

const NOTE_INPUTS = 'input[data-note]:not(:disabled)';

export function Approvals() {
  usePageTitle("Approval queue");
  const { me } = useSession();
  const canDecide = useCan("approvals:decide");
  const now = useNow(30_000);
  const [params, setParams] = useSearchParams();
  const status = statusFromParam(params.get("status"));
  // Switching the status tab clears the previous tab's cards before the new answer arrives.
  const approvals = usePolling(() => api.get<Page<ApprovalListItem>>(`/api/approvals${query({ status, limit: 50 })}`), [status], { resetKey: status });
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  // Which cards have "What approving unlocks" open: kept here so it survives the 5 s list refresh.
  const [unlocksOpen, setUnlocksOpen] = useState<ReadonlySet<string>>(new Set());
  const toggleUnlocks = (id: string, open: boolean) =>
    setUnlocksOpen((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const statusRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // After a decision or a conflict: where focus goes once the refreshed list no longer offers that approval.
  const pendingFocus = useRef<{ decidedId: string; index: number } | null>(null);
  const setStatus = (next: StatusTab) => {
    if (next !== status) {
      // The status line and the pending focus describe the previous tab's list.
      setAnnouncement(null);
      pendingFocus.current = null;
    }
    const updated = new URLSearchParams(params);
    updated.set("status", next || "all");
    setParams(updated, { replace: true });
  };

  // An approval that left the list (decided, expired, another tab) drops its open state.
  useEffect(() => {
    const items = approvals.data?.items;
    if (!items) return;
    setUnlocksOpen((current) => {
      const kept = [...current].filter((id) => items.some((a) => a.id === id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [approvals.data]);

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

  /** Focus the next card's note (or the status line) once the refreshed list drops this approval. */
  const focusAfter = (approval: ApprovalListItem) => {
    const inputs = [...(listRef.current?.querySelectorAll<HTMLInputElement>(NOTE_INPUTS) ?? [])];
    const index = Math.max(0, inputs.findIndex((input) => input.closest("[data-approval-id]")?.getAttribute("data-approval-id") === approval.id));
    pendingFocus.current = { decidedId: approval.id, index };
  };
  const onDecided = (decision: Decision, approval: ApprovalListItem) => {
    focusAfter(approval);
    setAnnouncement({ kind: "decided", decision, approval });
    approvals.refresh();
  };
  // Someone else decided first (or it expired): the card leaves the list, so focus moves on the same way.
  const onConflict = (error: unknown, approval: ApprovalListItem) => {
    focusAfter(approval);
    setAnnouncement({ kind: "conflict", error });
    approvals.refresh();
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 tabIndex={-1}>Approval queue</h1>
          <p>Manager changes, terminations and privileged grants wait here. Only reads ran before each gate, so a rejection never leaves a write behind.</p>
        </div>
        <TabList
          id="approval-status"
          label="Approval status"
          tabs={STATUSES.map((s) => ({ key: s, label: s || "all" }))}
          selected={status}
          onSelect={setStatus}
          style={{ marginBottom: 0, borderBottom: 0 }}
        />
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
      {STATUSES.filter((s) => s !== status).map((s) => (
        <TabPanel key={s || "all"} id="approval-status" tabKey={s} selected={false} />
      ))}
      <TabPanel id="approval-status" tabKey={status} selected>
      <PolledView polled={approvals} loading="Loading approvals..." action="read approvals">
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState title={status ? `No ${status} approvals.` : "No approvals yet."} />
          ) : (
            <div className="stack" ref={listRef}>
              {status === "pending" ? (
                <p className="small muted queue-summary" data-testid="queue-summary">
                  {queueSummary(page, { canDecide, now })}
                </p>
              ) : null}
              {page.items.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  onDecided={onDecided}
                  onConflict={onConflict}
                  unlocksOpen={unlocksOpen.has(approval.id)}
                  onToggleUnlocks={(open) => toggleUnlocks(approval.id, open)}
                />
              ))}
            </div>
          )
        }
      </PolledView>
      </TabPanel>
    </div>
  );
}
