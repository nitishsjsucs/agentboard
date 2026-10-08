import { useState } from "react";
import { useSearchParams } from "react-router";
import type { Page, RunSummary, SearchHit } from "../../shared/api-types.ts";
import { REQUEST_TYPES, RUN_STATUSES } from "../../shared/domain.ts";
import { api, query } from "../api/client.ts";
import { usePolling } from "../api/hooks.ts";
import { RunTable } from "../components/RunTable.tsx";
import { SearchBar } from "../components/SearchBar.tsx";
import { SearchResults } from "../components/SearchResults.tsx";

export function Runs() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const type = params.get("type") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setCursors([]);
  };
  const isoDay = (day: string, end = false) => (day ? new Date(`${day}T${end ? "23:59:59.999" : "00:00:00.000"}Z`).toISOString() : undefined);

  const runs = usePolling(
    () => api.get<Page<RunSummary>>(`/api/runs${query({ status, type, from: isoDay(from), to: isoDay(to, true), cursor, limit: 25 })}`),
    [status, type, from, to, cursor],
  );
  const hits = usePolling(
    () => (q ? api.get<{ items: SearchHit[] }>(`/api/search${query({ q, status, type, from: isoDay(from), to: isoDay(to, true), limit: 20 })}`) : Promise.resolve({ items: [] })),
    [q, status, type, from, to],
    0,
  );

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Runs</h1>
          <p>Search the history (runs, tasks, tool calls, approvals) or filter the run list.</p>
        </div>
      </div>
      <SearchBar initial={q} onSearch={(value) => set("q", value)} />
      <div className="row">
        <select className="select" style={{ width: "auto" }} aria-label="Status" value={status} onChange={(e) => set("status", e.target.value)}>
          <option value="">Any status</option>
          {RUN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: "auto" }} aria-label="Request type" value={type} onChange={(e) => set("type", e.target.value)}>
          <option value="">Any type</option>
          {REQUEST_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <label className="small muted">
          From <input className="input" style={{ width: "auto" }} type="date" value={from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="small muted">
          To <input className="input" style={{ width: "auto" }} type="date" value={to} onChange={(e) => set("to", e.target.value)} />
        </label>
      </div>

      {q ? (
        <div className="stack">
          <h2>Search results</h2>
          {hits.error ? <div className="error-text">{hits.error.message}</div> : <SearchResults hits={hits.data?.items ?? []} />}
        </div>
      ) : null}

      <div className="card">
        <div className="card__header">
          <h3>Run list</h3>
          <div className="row">
            <button type="button" className="btn btn--small" disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>
              Newer
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={!runs.data?.nextCursor}
              onClick={() => runs.data?.nextCursor && setCursors((c) => [...c, runs.data?.nextCursor ?? ""])}
            >
              Older
            </button>
          </div>
        </div>
        {runs.error ? <div className="card__body error-text">{runs.error.message}</div> : <RunTable runs={runs.data?.items ?? []} empty="No runs match." />}
      </div>
    </div>
  );
}
