import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { AuditEventView, Page, RunDetailResponse, RunSnapshot, TimelineEntry, ToolCallView } from "../../shared/api-types.ts";
import { api, ApiRequestError, query } from "../api/client.ts";
import { useCan, usePolling } from "../api/hooks.ts";
import { usePageTitle } from "../api/usePageTitle.ts";
import { useRunLive } from "../api/useRunLive.ts";
import { ApprovalCard } from "../components/ApprovalCard.tsx";
import { AuditTable } from "../components/AuditTable.tsx";
import { BudgetMeter } from "../components/BudgetMeter.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorNotice } from "../components/ErrorNotice.tsx";
import { LiveIndicator } from "../components/LiveIndicator.tsx";
import { NextStep } from "../components/NextStep.tsx";
import { PlanMap } from "../components/PlanMap.tsx";
import { LoadingLine, PolledView } from "../components/PolledView.tsx";
import { RecoveryControls } from "../components/RecoveryControls.tsx";
import { RunEvents } from "../components/RunEvents.tsx";
import { formatTime } from "../components/RunTable.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { StatusTimeBar } from "../components/StatusTimeBar.tsx";
import { TabList, TabPanel } from "../components/Tabs.tsx";
import { TaskTimeline } from "../components/TaskTimeline.tsx";
import { ToolCallTrace } from "../components/ToolCallTrace.tsx";

const TABS = ["timeline", "calls", "approvals", "audit"] as const;
type Tab = (typeof TABS)[number];

/** ?tab= holds the open tab, so a reload or a shared link keeps it; anything unknown is the timeline. */
function tabFromParam(value: string | null): Tab {
  return (TABS as readonly string[]).includes(value ?? "") ? (value as Tab) : "timeline";
}

/** Announces a status change pushed after the page loaded (not the first status shown). */
function useStatusAnnouncement(status: string | null): string {
  const previous = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (status === null) return;
    if (previous.current !== null && previous.current !== status) setAnnouncement(`Status: ${status.replaceAll("_", " ")}`);
    previous.current = status;
  }, [status]);
  return announcement;
}

export function RunDetail() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = tabFromParam(params.get("tab"));
  const setTab = (next: Tab) => {
    const updated = new URLSearchParams(params);
    updated.set("tab", next);
    setParams(updated, { replace: true });
  };
  const canAudit = useCan("audit:read");
  const canReadPii = useCan("pii:read");
  const live = useRunLive(id);
  // Live version bumps refetch without clearing (no loading flash); a new run id or tab starts from loading.
  const detail = usePolling(() => api.get<RunDetailResponse>(`/api/runs/${id}`), [id, live.snapshot?.version], { resetKey: id });
  const timeline = usePolling(() => api.get<TimelineEntry[]>(`/api/runs/${id}/timeline`), [id, live.snapshot?.version], { resetKey: `${id}:${tab}`, enabled: tab === "timeline" });
  const calls = usePolling(() => api.get<Page<ToolCallView>>(`/api/runs/${id}/tool-calls`), [id, live.snapshot?.version], { resetKey: `${id}:${tab}`, enabled: tab === "calls" });
  const audit = usePolling(() => api.get<{ events: AuditEventView[]; chain: { valid: boolean; brokenAtSeq: number | null } }>(`/api/runs/${id}/audit`), [id], {
    resetKey: `${id}:${tab}`,
    enabled: tab === "audit" && canAudit,
  });
  usePageTitle(detail.data ? `Run: ${detail.data.run.title}` : "Run");
  const statusAnnouncement = useStatusAnnouncement(live.snapshot?.status ?? detail.data?.run.status ?? null);

  if (detail.error && !detail.data) {
    if (detail.error instanceof ApiRequestError && detail.error.status === 404) {
      return (
        <EmptyState title={`No run with id ${id}.`}>
          <span>
            It may have been mistyped, or it belongs to another environment. <Link to="/runs">Browse all runs</Link> or{" "}
            <Link to={`/runs${query({ q: id })}`}>search the history for it</Link>.
          </span>
        </EmptyState>
      );
    }
    return <ErrorNotice error={detail.error} action="read runs" onRetry={detail.refresh} />;
  }
  const data = detail.data;
  if (!data) return <LoadingLine text="Loading run..." />;
  const run = data.run;
  // The live snapshot (viewer-level, pushed on every coordinator commit) wins for status, usage and task states.
  const snapshot: RunSnapshot = live.snapshot ?? {
    runId: run.id,
    status: run.status,
    statusReason: run.statusReason,
    budget: run.budget,
    usage: run.usage,
    tasks: data.tasks,
    recentEvents: [],
    pendingApprovalIds: data.approvals.filter((a) => a.status === "pending").map((a) => a.id),
    version: 0,
  };
  const refresh = () => {
    detail.refresh();
    timeline.refresh();
    calls.refresh();
    audit.refresh();
  };

  return (
    <div className="stack">
      <div role="status" className="visually-hidden" data-testid="status-announcer">
        {statusAnnouncement}
      </div>
      <div className="page-header">
        <div>
          <div className="row small muted breadcrumb">
            <Link to="/runs">Runs</Link>
            <span>/</span>
            <span className="mono">{run.id}</span>
            <LiveIndicator connected={live.connected} />
          </div>
          <h1 tabIndex={-1}>{run.title}</h1>
          <div className="row" style={{ marginTop: 6 }}>
            <StatusBadge status={snapshot.status} />
            {snapshot.statusReason && snapshot.status !== "succeeded" ? <span className="small muted">{snapshot.statusReason}</span> : null}
            <span className="small muted">
              {run.requestType.replaceAll("_", " ")} for {run.subjectEmployeeId}, requested by {run.requester}, {formatTime(run.createdAt)}
            </span>
          </div>
        </div>
      </div>

      <NextStep snapshot={snapshot} approvals={data.approvals} requester={run.requester} onOpenApprovals={() => setTab("approvals")} />

      <div className="card card__body">
        <div className="row" style={{ gap: "var(--space-6)", alignItems: "flex-start" }}>
          <BudgetMeter label="Tool calls" used={snapshot.usage.toolCalls + snapshot.usage.toolCallsReserved} max={snapshot.budget.maxToolCalls} />
          <BudgetMeter label="LLM tokens" used={snapshot.usage.llmTokens} max={snapshot.budget.maxLlmTokens} />
          <BudgetMeter label="Active time (s)" used={Math.round(snapshot.usage.activeMs / 1000)} max={Math.round(snapshot.budget.maxActiveMs / 1000)} />
          <div className="small muted">
            attempts {snapshot.usage.attempts}, replays {snapshot.usage.replays}, skipped steps {snapshot.usage.skippedSteps}
          </div>
        </div>
        {run.requestText ? (
          <p className="small" style={{ marginBottom: 0 }}>
            <span className="muted">Request: </span>
            {run.requestText}
          </p>
        ) : !canReadPii ? (
          // The server sends no request text without pii:read; say so instead of leaving a gap.
          <p className="small muted" style={{ marginBottom: 0 }} data-testid="request-hidden">
            Request text is hidden for your role (it needs personal-data access).
          </p>
        ) : null}
      </div>

      {/* Stacked on narrow screens; the Recovery card comes first when recovery is the next step. */}
      <div className={`run-layout${snapshot.status === "needs_attention" || snapshot.status === "paused" ? " run-layout--recovery-first" : ""}`} data-testid="run-layout">
        <div>
          <TabList
            id="run-tabs"
            label="Run details"
            tabs={[
              { key: "timeline", label: "Timeline" },
              { key: "calls", label: "Tool calls" },
              { key: "approvals", label: `Approvals (${data.approvals.length})` },
              { key: "audit", label: "Audit" },
            ]}
            selected={tab}
            onSelect={setTab}
          />
          <TabPanel id="run-tabs" tabKey="timeline" selected={tab === "timeline"}>
            <div className="stack">
              <PlanMap tasks={snapshot.tasks} status={snapshot.status} />
              <PolledView polled={timeline} loading="Loading the status history..." action="read the run's events" card="Time in each status">
                {(entries) => <StatusTimeBar entries={entries} run={{ createdAt: run.createdAt, status: snapshot.status, finishedAt: run.finishedAt }} />}
              </PolledView>
              <TaskTimeline tasks={snapshot.tasks} />
              <RunEvents timeline={timeline} />
            </div>
          </TabPanel>
          <TabPanel id="run-tabs" tabKey="calls" selected={tab === "calls"}>
            <PolledView polled={calls} loading="Loading tool calls..." action="read tool calls">
              {(page) => <ToolCallTrace calls={page.items} />}
            </PolledView>
          </TabPanel>
          <TabPanel id="run-tabs" tabKey="approvals" selected={tab === "approvals"}>
            {data.approvals.length === 0 ? (
              <EmptyState title="No approvals for this run." />
            ) : (
              <div className="stack">
                {data.approvals.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} onDecided={refresh} tasks={snapshot.tasks} />
                ))}
              </div>
            )}
          </TabPanel>
          <TabPanel id="run-tabs" tabKey="audit" selected={tab === "audit"}>
            {canAudit ? (
              <PolledView polled={audit} loading="Loading audit events..." action="read the audit log">
                {(trail) => <AuditTable events={trail.events} chain={trail.chain} />}
              </PolledView>
            ) : (
              <EmptyState title="Needs audit:read." />
            )}
          </TabPanel>
        </div>
        <div className="card run-layout__recovery">
          <div className="card__header">
            <h3>Recovery</h3>
          </div>
          <div className="card__body">
            <RecoveryControls runId={run.id} snapshot={snapshot} onDone={refresh} />
          </div>
        </div>
      </div>
    </div>
  );
}
