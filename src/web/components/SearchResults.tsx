import { Fragment } from "react";
import { Link } from "react-router";
import type { SearchHit } from "../../shared/api-types.ts";
import { EmptyState } from "./EmptyState.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

const START = "\u0002";
const END = "\u0003";

/**
 * Renders a search snippet whose highlights are delimited by U+0002 and U+0003.
 * Highlights become <mark> elements built by React; the text is never parsed as HTML.
 */
export function Snippet({ text }: { text: string }) {
  const parts: { text: string; marked: boolean }[] = [];
  let rest = text;
  while (rest.length > 0) {
    const start = rest.indexOf(START);
    if (start < 0) {
      parts.push({ text: rest, marked: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), marked: false });
    const end = rest.indexOf(END, start + 1);
    const inner = end < 0 ? rest.slice(start + 1) : rest.slice(start + 1, end);
    parts.push({ text: inner, marked: true });
    rest = end < 0 ? "" : rest.slice(end + 1);
  }
  return (
    <span className="snippet">
      {parts.map((part, i) => (part.marked ? <mark key={i}>{part.text}</mark> : <Fragment key={i}>{part.text}</Fragment>))}
    </span>
  );
}

export function SearchResults({ hits }: { hits: SearchHit[] }) {
  if (hits.length === 0) return <EmptyState title="No matches." />;
  return (
    <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: "var(--space-3)" }}>
      {hits.map((hit, i) => (
        <li key={`${hit.runId}-${i}`} className="card card__body">
          <div className="row small">
            <span className="badge">{hit.docType.replace("_", " ")}</span>
            {hit.status ? <StatusBadge status={hit.status} /> : null}
            {hit.requestType ? <span className="muted">{hit.requestType.replaceAll("_", " ")}</span> : null}
            <span className="spacer" />
            <Link to={`/runs/${hit.runId}`} className="mono">
              {hit.runId}
            </Link>
          </div>
          <div style={{ marginTop: 6 }}>
            <Snippet text={hit.snippet} />
          </div>
        </li>
      ))}
    </ul>
  );
}
