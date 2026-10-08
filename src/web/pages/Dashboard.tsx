import { Link } from "react-router";
import type { AgentRolesResponse, DlqMessageView, MetricsSummary, Page, RunSummary } from "../../shared/api-types.ts";
import { api } from "../api/client.ts";
import { useCan, usePolling } from "../api/hooks.ts";
import { AgentRolePanel } from "../components/AgentRolePanel.tsx";
import { DlqPanel } from "../components/DlqPanel.tsx";
import { RunTable } from "../components/RunTable.tsx";

const STAT_ORDER = ["running", "awaiting_approval", "needs_attention", "paused", "succeeded", "rejected", "cancelled"] as const;

export function Dashboard() {
  const canReadDlq = useCan("dlq:read");
  const summary = usePolling(() => api.get<MetricsSummary>("/api/metrics/summary"), []);
  const recent = usePolling(() => api.get<Page<RunSummary>>("/api/runs?limit=10"), []);
  const attention = usePolling(() => api.get<Page<RunSummary>>("/api/runs?status=needs_attention&limit=5"), []);
  const agents = usePolling(() => api.get<AgentRolesResponse>("/api/agents"), []);
  const dlq = usePolling(() => (canReadDlq ? api.get<Page<DlqMessageView>>("/api/dlq") : Promise.resolve({ items: [], nextCursor: null })), [canReadDlq]);

  const counts = summary.data?.byStatus ?? {};
  const active = (counts["queued"] ?? 0) + (counts["planning"] ?? 0) + (counts["running"] ?? 0);
  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Agent runs serving a simulated People-operations team.</p>
        </div>
        <Link to="/approvals" className="btn">
          {summary.data?.pendingApprovals ?? 0} pending approvals
        </Link>
      </div>

      <div className="grid grid--stats">
        {STAT_ORDER.map((status) => (
          <div className="card stat" key={status}>
            <div className="stat__value">{status === "running" ? active : (counts[status] ?? 0)}</div>
            <div className="stat__label">{status === "running" ? "active (queued, planning, running)" : status.replaceAll("_", " ")}</div>
          </div>
        ))}
        <div className="card stat">
          <div className="stat__value">{summary.data?.dlqOpen ?? 0}</div>
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
          <RunTable runs={attention.data.items} />
        </div>
      ) : null}

      <div className="card">
        <div className="card__header">
          <h3>Recent runs</h3>
          <Link to="/runs" className="small">
            all runs
          </Link>
        </div>
        {recent.error ? <div className="card__body error-text">{recent.error.message}</div> : <RunTable runs={recent.data?.items ?? []} />}
      </div>

      <div className="grid grid--two">
        {agents.data ? <AgentRolePanel roles={agents.data.roles} onChange={agents.refresh} /> : null}
        {canReadDlq ? <DlqPanel messages={dlq.data?.items ?? []} onChange={() => (dlq.refresh(), summary.refresh())} /> : null}
      </div>
    </div>
  );
}
