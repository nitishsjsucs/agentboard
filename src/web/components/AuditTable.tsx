import type { AuditEventView } from "../../shared/api-types.ts";
import { EmptyState } from "./EmptyState.tsx";

export function AuditTable({ events, chain }: { events: readonly AuditEventView[]; chain: { valid: boolean; brokenAtSeq: number | null } | null }) {
  return (
    <div className="stack">
      {chain ? (
        <div className={`notice${chain.valid ? "" : " notice--danger"}`}>
          {chain.valid
            ? `Hash chain verified: ${events.length} events, each linked to the previous one by SHA-256.`
            : `Hash chain broken at seq ${chain.brokenAtSeq}.`}
        </div>
      ) : null}
      {events.length === 0 ? (
        <EmptyState title="No audit events yet." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Seq</th>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={`${e.stream}-${e.seq}`}>
                  <td>{e.seq}</td>
                  <td className="small mono">{e.ts}</td>
                  <td className="small">
                    {e.actorId} <span className="faint">({e.actorType})</span>
                  </td>
                  <td className="mono small">{e.action}</td>
                  <td className="mono small faint" title={e.hash}>
                    {e.hash.slice(0, 12)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
