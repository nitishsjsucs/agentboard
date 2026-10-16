import { useState } from "react";
import { Link } from "react-router";
import type { ApprovalListItem, RunDetailResponse, TaskView } from "../../shared/api-types.ts";
import { api, ApiRequestError } from "../api/client.ts";
import { useCan, usePolling, useSession } from "../api/hooks.ts";
import { ErrorNotice } from "./ErrorNotice.tsx";
import { buildPlanGraph, dependentsOf, type StepNode } from "./planGraph.ts";
import { LoadingLine } from "./PolledView.tsx";
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

const stepItem = (node: StepNode) => `${node.stepId} ${node.tool}, ${node.write ? "write" : "read"}`;

/**
 * What the run has done and what approving this step releases, from the run's task graph. Only step
 * ids, tools and states are shown, never arguments or request text.
 */
export function UnlockGroups({ approval, tasks }: { approval: ApprovalListItem; tasks: readonly TaskView[] }) {
  const graph = buildPlanGraph(tasks);
  const gated = graph.nodes.find((node) => node.execute.id === approval.taskId);
  if (!gated) {
    return (
      <p className="small muted" data-testid="unlocks-missing">
        The plan for this approval is not available yet.
      </p>
    );
  }
  const after = dependentsOf(graph, gated.stepId).filter((node) => node.state !== "done");
  const afterIds = new Set(after.map((node) => node.stepId));
  const ran = graph.nodes.filter((node) => node.stepId !== gated.stepId && node.state === "done");
  const other = graph.nodes.filter((node) => node.stepId !== gated.stepId && node.state !== "done" && !afterIds.has(node.stepId));
  const group = (title: string, nodes: StepNode[], testId: string) =>
    nodes.length === 0 ? null : (
      <div className="unlocks__group" data-testid={testId}>
        <h4>{title}</h4>
        <ul>
          {nodes.map((node) => (
            <li key={node.stepId}>{stepItem(node)}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="unlocks__groups">
      {group("Already ran", ran, "unlocks-ran")}
      <div className="unlocks__group" data-testid="unlocks-gated">
        <h4>Needs this approval</h4>
        <ul>
          <li>
            {stepItem(gated)}: {approval.summary}
          </li>
        </ul>
      </div>
      {after.length > 0 ? (
        group("Runs after approval", after, "unlocks-after")
      ) : (
        <p className="small muted" data-testid="unlocks-after">
          No other step waits for this approval.
        </p>
      )}
      {group("Not waiting on this approval", other, "unlocks-other")}
      <p className="small muted">If you reject, the run ends as rejected and no step that has not run yet will run.</p>
    </div>
  );
}

/** The groups from `tasks` when the page has them (the run's Approvals tab), else from one run detail request. */
function ApprovalUnlocks({ approval, tasks }: { approval: ApprovalListItem; tasks: readonly TaskView[] | undefined }) {
  // Loaded once when opened (intervalMs 0), never polled; not at all when the page already holds the tasks.
  const run = usePolling(() => api.get<RunDetailResponse>(`/api/runs/${approval.runId}`), [approval.runId], { intervalMs: 0, enabled: tasks === undefined });
  if (tasks) return <UnlockGroups approval={approval} tasks={tasks} />;
  if (run.data === null) {
    return run.error ? <ErrorNotice error={run.error} title="The plan could not be loaded." action="read runs" onRetry={run.refresh} /> : <LoadingLine text="Loading the plan..." />;
  }
  return <UnlockGroups approval={approval} tasks={run.data.tasks} />;
}

/**
 * One approval with approve and reject. Decisions are disabled on the viewer's
 * own runs (separation of duties); the coordinator enforces the same rule.
 */
export function ApprovalCard({
  approval,
  onDecided,
  onConflict,
  tasks,
  unlocksOpen,
  onToggleUnlocks,
}: {
  approval: ApprovalListItem;
  onDecided: (decision: Decision, approval: ApprovalListItem) => void;
  /** Called instead of showing the refusal in the card when the approval was already decided or expired. */
  onConflict?: (error: unknown, approval: ApprovalListItem) => void;
  /** The run's tasks when the page already has them; otherwise "What approving unlocks" loads the run once. */
  tasks?: readonly TaskView[];
  /** Controlled open state of "What approving unlocks" (the approval queue keeps it across list refreshes). */
  unlocksOpen?: boolean;
  onToggleUnlocks?: (open: boolean) => void;
}) {
  const { me } = useSession();
  const mayDecide = useCan("approvals:decide");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ownRun = me !== null && approval.requester.toLowerCase() === me.principal.id;
  const canAct = approval.canDecide && !ownRun && approval.status === "pending";
  const [localOpen, setLocalOpen] = useState(false);
  const open = unlocksOpen ?? localOpen;
  const toggleUnlocks = () => (onToggleUnlocks ? onToggleUnlocks(!open) : setLocalOpen(!open));
  const unlocksId = `unlocks-${approval.id}`;
  const noteId = `note-${approval.id}`;
  const hintId = `note-hint-${approval.id}`;
  const decide = async (decision: Decision) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/approvals/${approval.id}/decision`, { decision, note: note.trim() });
      onDecided(decision, approval);
    } catch (e) {
      if (isDecisionConflict(e) && onConflict) onConflict(e, approval);
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
        <div className="unlocks">
          <button type="button" className="link-button small unlocks__toggle" aria-expanded={open} aria-controls={unlocksId} onClick={toggleUnlocks}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="unlocks__chevron">
              <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            What approving unlocks
          </button>
          <div id={unlocksId} hidden={!open} data-testid="unlocks">
            {open ? <ApprovalUnlocks approval={approval} tasks={tasks} /> : null}
          </div>
        </div>
      ) : null}
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
