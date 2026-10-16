// Time in each status: one bar on a real time axis from the run's creation to its finish (or now),
// and the table under it as the text alternative. Data: the run's timeline, which the page already loads.

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TimelineEntry } from "../../shared/api-types.ts";
import type { RunStatus } from "../../shared/domain.ts";
import { formatElapsed, useNow } from "../api/time.ts";
import { formatTime } from "./RunTable.tsx";
import { shareText, statusIntervals, statusTotals, type StatusInterval } from "./statusIntervals.ts";

const BAR_HEIGHT = 12;
const DAY = 86_400_000;

/** The colour family of each status on the bar (the table names every status in words). */
export const STATUS_TONE: Record<RunStatus, "faint" | "info" | "warning" | "danger" | "success"> = {
  queued: "faint",
  planning: "info",
  running: "info",
  awaiting_approval: "warning",
  paused: "warning",
  needs_attention: "danger",
  succeeded: "success",
  rejected: "danger",
  cancelled: "faint",
};

const label = (status: RunStatus) => status.replaceAll("_", " ");

function clock(ms: number, longSpan: boolean): string {
  return longSpan ? formatTime(new Date(ms).toISOString()) : new Date(ms).toLocaleTimeString();
}

/** "awaiting approval, 10:42:05 to 12:56:31 (2 h 14 min)", or "... to now (... so far)" for the open one. */
export function intervalText(interval: StatusInterval, longSpan: boolean): string {
  const span = formatElapsed(interval.end - interval.start);
  return interval.soFar
    ? `${label(interval.status)}, ${clock(interval.start, longSpan)} to now (${span} so far)`
    : `${label(interval.status)}, ${clock(interval.start, longSpan)} to ${clock(interval.end, longSpan)} (${span})`;
}

/** The bar's width in px, kept in step with its box (600 where ResizeObserver is missing, as in tests). */
function useWidth(): [number, (node: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(600);
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  const ref = (node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const measured = node.getBoundingClientRect().width;
    if (measured > 0) setWidth(measured);
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (next > 0) setWidth(next);
    });
    observer.current.observe(node);
  };
  return [width, ref];
}

export function StatusTimeBar({ entries, run }: { entries: readonly TimelineEntry[]; run: { createdAt: string; status: RunStatus; finishedAt: string | null } }) {
  // The open interval grows from the client clock every 30 s, without a request (and without announcing it).
  const now = useNow(30_000);
  const titleId = useId();
  const clipId = useId();
  const tipId = useId();
  const [width, measure] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const history = statusIntervals(entries, run, now);
  const rows = statusTotals(history);
  const span = Math.max(1, history.end - history.start);
  const longSpan = history.end - history.start > DAY;
  const x = (t: number) => ((t - history.start) / span) * width;
  const last = history.intervals.length - 1;
  const shown = active !== null && active <= last ? active : null;
  const queuedOnly = history.intervals.length === 1 && history.intervals[0]?.status === "queued" && history.intervals[0].soFar;

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = shown ?? last;
    const next = event.key === "ArrowRight" ? Math.min(last, current + 1) : event.key === "ArrowLeft" ? Math.max(0, current - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) {
      if (event.key === "Escape") setActive(null);
      return;
    }
    event.preventDefault();
    setActive(next);
  };
  // The pointer only has to be over the bar's band, not on a 12 px mark: the interval under its x wins.
  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const t = history.start + ((event.clientX - box.left) / Math.max(1, box.width)) * span;
    const index = history.intervals.findIndex((i) => t >= i.start && t <= i.end);
    setActive(index >= 0 ? index : null);
  };

  const tipInterval = shown !== null ? history.intervals[shown] : undefined;
  const tipText = tipInterval ? intervalText(tipInterval, longSpan) : "";
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipWidth, setTipWidth] = useState(0);
  useLayoutEffect(() => {
    const measured = tipRef.current?.offsetWidth ?? 0;
    if (measured !== tipWidth) setTipWidth(measured);
  }, [tipText, width, tipWidth]);
  // Centred over its segment, but clamped so it never leaves the bar's width (and so the card).
  const tipCenter = tipInterval ? (x(tipInterval.start) + x(tipInterval.end)) / 2 : 0;
  const tipLeft = Math.max(0, Math.min(width - tipWidth, tipCenter - tipWidth / 2));

  return (
    <figure className="card status-time" aria-labelledby={titleId} data-testid="status-time">
      <figcaption className="status-time__caption">
        <h3 id={titleId}>Time in each status</h3>
        {queuedOnly ? <span className="small muted">Queued since {clock(history.start, false)}</span> : null}
        {rows.length > 1 ? <span className="small muted">Shares are rounded to whole percents.</span> : null}
      </figcaption>
      <div className="status-time__plot">
        {/* Always mounted, so a screen reader hears each interval as the arrow keys move; empty when hidden. */}
        <div
          id={tipId}
          ref={tipRef}
          className={`status-time__tip${tipInterval ? " status-time__tip--shown" : ""}`}
          role="status"
          data-testid="status-tip"
          style={{ left: tipLeft }}
        >
          {tipText}
        </div>
        <div
          ref={measure}
          className="status-time__bar"
          tabIndex={0}
          role="img"
          aria-label={`Time in each status from ${clock(history.start, longSpan)} to ${history.finished ? clock(history.end, longSpan) : "now"}. The table below lists each status. Left and right arrow keys show each interval.`}
          data-testid="status-bar"
          onKeyDown={onKey}
          onFocus={() => (setFocused(true), setActive((a) => a ?? last))}
          onBlur={() => (setFocused(false), setActive(null))}
          onPointerMove={onPointer}
          onPointerLeave={() => (focused ? undefined : setActive(null))}
        >
          <svg width={width} height={BAR_HEIGHT} aria-hidden="true">
            <defs>
              <clipPath id={clipId}>
                <rect x={0} y={0} width={width} height={BAR_HEIGHT} rx={4} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clipId})`}>
              {history.intervals.map((interval, i) => {
                // A 2 px surface gap between neighbours: each side gives up 1 px.
                const x0 = x(interval.start) + (i > 0 ? 1 : 0);
                const x1 = x(interval.end) - (i < last ? 1 : 0);
                return (
                  <rect
                    key={`${interval.status}-${interval.start}`}
                    className={`status-seg tone-fill--${STATUS_TONE[interval.status]}${shown === i ? " status-seg--active" : ""}`}
                    data-status={interval.status}
                    x={x0}
                    y={0}
                    width={Math.max(1, x1 - x0)}
                    height={BAR_HEIGHT}
                  />
                );
              })}
            </g>
          </svg>
        </div>
        <div className="status-time__axis small muted" aria-hidden="true">
          <span>{clock(history.start, longSpan)}</span>
          <span>{history.finished ? clock(history.end, longSpan) : "now"}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table status-time__table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Total time</th>
              <th>Share</th>
              <th>Intervals</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.status} data-testid="status-row">
                <td>
                  <span className="status-time__name">
                    <span className={`status-swatch tone-bg--${STATUS_TONE[row.status]}`} aria-hidden="true" />
                    <span>{label(row.status)}</span>
                  </span>
                </td>
                <td className="nowrap">{row.soFar ? `${formatElapsed(row.totalMs)} so far` : formatElapsed(row.totalMs)}</td>
                <td className="num">{shareText(row)}</td>
                <td className="num">{row.intervals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
