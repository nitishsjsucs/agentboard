// The run's Events card: key events by default, every audit event on request.

import { useState } from "react";
import type { TimelineEntry } from "../../shared/api-types.ts";
import type { Polled } from "../api/hooks.ts";
import { EmptyState } from "./EmptyState.tsx";
import { PolledView } from "./PolledView.tsx";

/** Actions that change what the run is doing or who acts; leases, dispatches and tool calls are the rest. */
export const KEY_ACTIONS: ReadonlySet<string> = new Set([
  "run.created",
  "run.status_changed",
  "run.paused",
  "run.resumed",
  "run.cancelled",
  "plan.accepted",
  "plan.rejected",
  "approval.requested",
  "approval.decided",
  "approval.expired",
  "task.failed",
  "verify.failed",
  "task.retried",
  "task.skipped",
  "task.held",
  "task.released",
  "task.dead_lettered",
  "budget.exhausted",
  "budget.raised",
  "dlq.replayed",
]);

/** A key event; a task failure only when it will not be retried (its summary does not end with "(will retry)"). */
export function isKeyEvent(entry: TimelineEntry): boolean {
  if (!KEY_ACTIONS.has(entry.action)) return false;
  return entry.action !== "task.failed" || !entry.summary.endsWith("(will retry)");
}

export function RunEvents({ timeline }: { timeline: Polled<TimelineEntry[]> }) {
  const [view, setView] = useState<"key" | "all">("key");
  const entries = timeline.data;
  const keyCount = entries ? entries.filter(isKeyEvent).length : null;
  return (
    <div className="card">
      <div className="card__header">
        <h3>Events</h3>
        <div className="row" role="group" aria-label="Events shown">
          <button type="button" className="btn btn--small" aria-pressed={view === "key"} onClick={() => setView("key")}>
            {keyCount === null ? "Key events" : `Key events (${keyCount})`}
          </button>
          <button type="button" className="btn btn--small" aria-pressed={view === "all"} onClick={() => setView("all")}>
            {entries === null ? "All events" : `All events (${entries.length})`}
          </button>
        </div>
      </div>
      <PolledView polled={timeline} loading="Loading events..." action="read the run's events" padded>
        {(all) => {
          const shown = view === "key" ? all.filter(isKeyEvent) : all;
          if (all.length === 0) return <EmptyState title="No events yet." />;
          if (shown.length === 0) return <EmptyState title="No key events yet." />;
          return (
            <div className="table-wrap">
              <table className="table events-table">
                <thead>
                  <tr>
                    <th>Seq</th>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Event</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((entry) => (
                    <tr key={entry.seq}>
                      <td className="small faint events-table__seq">{entry.seq}</td>
                      <td className="small mono nowrap">{new Date(entry.ts).toLocaleTimeString()}</td>
                      <td className="small events-table__actor">{entry.actorId}</td>
                      <td className="small events-table__event">
                        <span className="mono">{entry.action}</span> {entry.summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </PolledView>
    </div>
  );
}
