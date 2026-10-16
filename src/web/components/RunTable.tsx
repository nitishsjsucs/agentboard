import { Link } from "react-router";
import type { RunSummary } from "../../shared/api-types.ts";
import { useSession } from "../api/hooks.ts";
import { useMediaQuery } from "../api/useMediaQuery.ts";
import { EmptyState } from "./EmptyState.tsx";
import { whoActs, type RunActor } from "./explain.ts";
import { StatusBadge } from "./StatusBadge.tsx";

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The narrow layout's breakpoint, the same as the stylesheet's phone rules. */
export const NARROW = "(max-width: 720px)";

function ActorChip({ who }: { who: RunActor }) {
  return (
    <span className={`badge${who.tone === "neutral" ? "" : ` badge--${who.tone}`}`} data-testid="waiting-on">
      {who.chip}
    </span>
  );
}

function PendingBadge({ run }: { run: RunSummary }) {
  return run.pendingApprovals > 0 ? <span className="badge badge--warning">{run.pendingApprovals} approval</span> : null;
}

/**
 * Runs as a table on wide screens and as a list of cards on phones (only one of the two is rendered),
 * with a "Waiting on" chip that says who acts next in words.
 */
export function RunTable({ runs, empty = "No runs yet." }: { runs: RunSummary[]; empty?: string }) {
  const narrow = useMediaQuery(NARROW);
  const { me } = useSession();
  if (runs.length === 0) return <EmptyState title={empty} />;
  if (narrow) {
    return (
      <ul className="run-cards" aria-label="Runs">
        {runs.map((run) => {
          const who = whoActs(run, me);
          return (
            <li key={run.id} className="run-card" data-testid="run-card">
              <div className="row">
                <StatusBadge status={run.status} />
                <PendingBadge run={run} />
                {who.actor === "done" ? null : <span className="small muted">Waiting on</span>}
                <ActorChip who={who} />
              </div>
              <Link to={`/runs/${run.id}`} className="run-card__title">
                {run.title}
              </Link>
              {who.sentence ? <div className="small">{who.sentence}</div> : null}
              <div className="small muted">
                {run.requestType.replaceAll("_", " ")} · {run.requester} · {formatTime(run.createdAt)} · {run.usage.toolCalls} of {run.budget.maxToolCalls} tool calls
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Type</th>
            <th>Status</th>
            <th>Waiting on</th>
            <th>Requester</th>
            <th>Tool calls</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const who = whoActs(run, me);
            return (
              <tr key={run.id}>
                <td>
                  <Link to={`/runs/${run.id}`}>{run.title}</Link>
                  <div className="mono faint small">{run.id}</div>
                </td>
                <td>{run.requestType.replaceAll("_", " ")}</td>
                <td>
                  <div className="row">
                    <StatusBadge status={run.status} />
                    <PendingBadge run={run} />
                  </div>
                </td>
                <td>
                  <ActorChip who={who} />
                  {who.sentence ? <div className="small muted">{who.sentence}</div> : null}
                </td>
                <td className="small">{run.requester}</td>
                <td className="small nowrap">
                  {run.usage.toolCalls} / {run.budget.maxToolCalls}
                </td>
                <td className="small nowrap">{formatTime(run.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
