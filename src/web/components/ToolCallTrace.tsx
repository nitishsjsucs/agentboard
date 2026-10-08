import { Fragment, useState } from "react";
import type { ToolCallView } from "../../shared/api-types.ts";
import { EmptyState } from "./EmptyState.tsx";
import { JsonView } from "./JsonView.tsx";
import { formatTime } from "./RunTable.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

export function ToolCallTrace({ calls }: { calls: readonly ToolCallView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (calls.length === 0) return <EmptyState title="No tool calls yet." />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Outcome</th>
            <th>Agent</th>
            <th>Attempt</th>
            <th>Duration</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <Fragment key={call.id}>
              <tr onClick={() => setOpen(open === call.id ? null : call.id)} style={{ cursor: "pointer" }}>
                <td>
                  <span className="mono">{call.tool}</span>
                  {call.stepId ? <span className="faint small"> {call.stepId}</span> : null}
                </td>
                <td>
                  <div className="row">
                    <StatusBadge status={call.outcome} />
                    {call.logical ? <span className="badge badge--accent">logical replay</span> : null}
                  </div>
                </td>
                <td className="mono small">{call.agent}</td>
                <td className="small">
                  {call.attempt} (gen {call.generation}, epoch {call.leaseEpoch})
                </td>
                <td className="small">{call.durationMs} ms</td>
                <td className="small muted">{formatTime(call.startedAt)}</td>
              </tr>
              {open === call.id ? (
                <tr>
                  <td colSpan={6}>
                    <div className="grid grid--two">
                      <div>
                        <div className="small muted">Arguments</div>
                        <JsonView value={call.args} />
                      </div>
                      <div>
                        <div className="small muted">{call.error ? "Error" : "Result"}</div>
                        <JsonView value={call.error ?? call.result} />
                      </div>
                    </div>
                    {call.idempotencyKey ? <div className="mono small faint" style={{ marginTop: 6 }}>idempotency key {call.idempotencyKey}</div> : null}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
