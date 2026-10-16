import { Link } from "react-router";
import type { AgentRolesResponse, DlqMessageView, MetricsSummary, Page, RunSummary } from "../../shared/api-types.ts";
import { api } from "../api/client.ts";
import { useCan, usePolling } from "../api/hooks.ts";
import { AgentRolePanel } from "../components/AgentRolePanel.tsx";
import { DlqPanel } from "../components/DlqPanel.tsx";
import { ErrorNotice } from "../components/ErrorNotice.tsx";
import { LoadingLine, PolledView, StaleNotice } from "../components/PolledView.tsx";
import { usePageTitle } from "../api/usePageTitle.ts";
import { RunTable } from "../components/RunTable.tsx";

const STAT_ORDER = ["running", "awaiting_approval", "needs_attention", "paused", "succeeded", "rejected", "cancelled"] as const;

/** A count, or a dash while the summary has never loaded (never a 0 that is not real). */
function StatValue({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="stat__value">
        <span aria-hidden="true">-</span>
        <span className="visually-hidden">not loaded</span>
      </div>
    );
  }
  return <div className="stat__value">{value}</div>;
}

export function Dashboard() {
  usePageTitle("Dashboard");
  const canReadDlq = useCan("dlq:read");
  const summary = usePolling(() => api.get<MetricsSummary>("/api/metrics/summary"), []);
  const recent = usePolling(() => api.get<Page<RunSummary>>("/api/runs?limit=10"), []);
  const attention = usePolling(() => api.get<Page<RunSummary>>("/api/runs?status=needs_attention&limit=5"), []);
  const agents = usePolling(() => api.get<AgentRolesResponse>("/api/agents"), []);
  const dlq = usePolling(() => api.get<Page<DlqMessageView>>("/api/dlq"), [canReadDlq], { enabled: canReadDlq });

  const counts = summary.data?.byStatus ?? null;
  const count = (status: (typeof STAT_ORDER)[number]): number | null => {
    if (counts === null) return null;
    if (status === "running") return (counts["queued"] ?? 0) + (counts["planning"] ?? 0) + (counts["running"] ?? 0);
    return counts[status] ?? 0;
  };
  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 tabIndex={-1}>Dashboard</h1>
          <p>Agent runs serving a simulated People-operations team.</p>
        </div>
        <Link to="/approvals" className="btn">
          {summary.data ? `${summary.data.pendingApprovals} pending approvals` : "Pending approvals"}
        </Link>
      </div>

      {summary.data === null ? (
        summary.error ? (
          <ErrorNotice error={summary.error} title="Counts are unavailable right now." action="read the run counts" onRetry={summary.refresh} />
        ) : (
          <LoadingLine text="Loading counts..." />
        )
      ) : summary.error ? (
        <StaleNotice updatedAt={summary.updatedAt} onRetry={summary.refresh} />
      ) : null}

      <div className="grid grid--stats">
        {STAT_ORDER.map((status) => (
          <div className="card stat" key={status} data-testid="stat">
            <StatValue value={count(status)} />
            <div className="stat__label">{status === "running" ? "active (queued, planning, running)" : status.replaceAll("_", " ")}</div>
          </div>
        ))}
        <div className="card stat" data-testid="stat">
          <StatValue value={summary.data ? summary.data.dlqOpen : null} />
          <div className="stat__label">open dead letters</div>
        </div>
      </div>

      {attention.data && attention.data.items.length > 0 ? (
        <div className="card">
          <div className="card__header">
            <h3>Needs attention</h3>
            <Link to="/runs?status=needs_attention" className="small">
              all
            </Link>
          </div>
          {attention.error ? (
            <div className="card__body">
              <StaleNotice updatedAt={attention.updatedAt} onRetry={attention.refresh} />
            </div>
          ) : null}
          <RunTable runs={attention.data.items} />
        </div>
      ) : attention.error && !attention.data ? (
        <PolledView polled={attention} loading="Loading runs that need attention..." action="read runs" card="Needs attention">
          {() => null}
        </PolledView>
      ) : null}

      <div className="card">
        <div className="card__header">
          <h3>Recent runs</h3>
          <Link to="/runs" className="small">
            all runs
          </Link>
        </div>
        <PolledView polled={recent} loading="Loading runs..." action="read runs" padded>
          {(page) => <RunTable runs={page.items} />}
        </PolledView>
      </div>

      <div className="grid grid--two">
        <PolledView polled={agents} loading="Loading agent roles..." action="read agent roles" card="Agent roles">
          {(data) => <AgentRolePanel roles={data.roles} onChange={agents.refresh} />}
        </PolledView>
        {canReadDlq ? (
          <PolledView polled={dlq} loading="Loading dead letters..." action="read the dead-letter queue" card="Dead-letter queue">
            {(page) => <DlqPanel messages={page.items} onChange={() => (dlq.refresh(), summary.refresh())} />}
          </PolledView>
        ) : null}
      </div>
    </div>
  );
}
