import { useState } from "react";
import { Link } from "react-router";
import type { DlqMessageView } from "../../shared/api-types.ts";
import { api } from "../api/client.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { RoleGate } from "./RoleGate.tsx";
import { formatTime } from "./RunTable.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

export function DlqPanel({ messages, onChange }: { messages: DlqMessageView[]; onChange: () => void }) {
  const [replaying, setReplaying] = useState<DlqMessageView | null>(null);
  return (
    <div className="card">
      <div className="card__header">
        <h3>Dead-letter queue</h3>
        <span className="small muted">{messages.filter((m) => m.outcome === "dead_lettered" && !m.replayedAt).length} open</span>
      </div>
      {messages.length === 0 ? (
        <EmptyState title="Nothing dead-lettered." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Message</th>
                <th>Outcome</th>
                <th>Run</th>
                <th>Received</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="mono small">{m.id.slice(0, 12)}</td>
                  <td>
                    <StatusBadge status={m.outcome} />
                    {m.replayedAt ? <div className="faint small">replayed by {m.replayedBy}</div> : null}
                  </td>
                  <td className="small">{m.runId ? <Link to={`/runs/${m.runId}`}>{m.runId.slice(0, 14)}</Link> : "none"}</td>
                  <td className="small muted">{formatTime(m.receivedAt)}</td>
                  <td>
                    {m.outcome === "dead_lettered" && !m.replayedAt ? (
                      <RoleGate permission="dlq:replay">
                        <button type="button" className="btn btn--small" onClick={() => setReplaying(m)}>
                          Replay
                        </button>
                      </RoleGate>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {replaying ? (
        <ConfirmDialog
          title="Replay dead-lettered task"
          confirmLabel="Replay"
          onCancel={() => setReplaying(null)}
          onConfirm={async (reason) => {
            await api.post(`/api/dlq/${replaying.id}/replay`, { reason });
            setReplaying(null);
            onChange();
          }}
        >
          <p className="small muted">The task is dispatched again with a new dispatch id; the old message stays fenced out.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
