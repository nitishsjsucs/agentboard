import { Link } from "react-router";
import type { RunSummary } from "../../shared/api-types.ts";
import { EmptyState } from "./EmptyState.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function RunTable({ runs, empty = "No runs yet." }: { runs: RunSummary[]; empty?: string }) {
  if (runs.length === 0) return <EmptyState title={empty} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Type</th>
            <th>Status</th>
            <th>Requester</th>
            <th>Tool calls</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Link to={`/runs/${run.id}`}>{run.title}</Link>
                <div className="mono faint small">{run.id}</div>
              </td>
              <td>{run.requestType.replaceAll("_", " ")}</td>
              <td>
                <div className="row">
                  <StatusBadge status={run.status} />
                  {run.pendingApprovals > 0 ? <span className="badge badge--warning">{run.pendingApprovals} approval</span> : null}
                </div>
                {run.statusReason && run.status !== "succeeded" ? <div className="faint small">{run.statusReason}</div> : null}
              </td>
              <td className="small">{run.requester}</td>
              <td className="small">
                {run.usage.toolCalls} / {run.budget.maxToolCalls}
              </td>
              <td className="small">{formatTime(run.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
