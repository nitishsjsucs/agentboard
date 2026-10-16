import { Fragment, useState } from "react";
import type { ToolCallView } from "../../shared/api-types.ts";
import { EmptyState } from "./EmptyState.tsx";
import { JsonView } from "./JsonView.tsx";
import { LoadingLine } from "./PolledView.tsx";
import { formatTime } from "./RunTable.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

/** `calls` is null while the first load is in flight, so "No tool calls yet." only ever means an empty answer. */
export function ToolCallTrace({ calls }: { calls: readonly ToolCallView[] | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (calls === null) return <LoadingLine text="Loading tool calls..." />;
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
          {calls.map((call) => {
            const expanded = open === call.id;
            const toggle = () => setOpen(expanded ? null : call.id);
            const detailsId = `call-details-${call.id}`;
            return (
            <Fragment key={call.id}>
              <tr onClick={toggle} style={{ cursor: "pointer" }}>
                <td>
                  {/* The row stays clickable; this button makes the details reachable from the keyboard. */}
                  <button
                    type="button"
                    className="link-button mono"
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle();
                    }}
                  >
                    {call.tool}
                  </button>
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
              {expanded ? (
                <tr id={detailsId}>
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
