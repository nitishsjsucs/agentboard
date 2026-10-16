// A run's life as intervals in each status, from its timeline's run.created and run.status_changed
// entries (statusTo is an enum value the API checks). Pure; the clock is passed in.

import type { TimelineEntry } from "../../shared/api-types.ts";
import { TERMINAL_RUN_STATUSES, type RunStatus } from "../../shared/domain.ts";

export interface StatusInterval {
  status: RunStatus;
  start: number;
  end: number;
  /** The current status: it ends at the client's clock and keeps growing. */
  soFar: boolean;
}

export interface StatusHistory {
  start: number;
  end: number;
  intervals: StatusInterval[];
  /** The run reached succeeded, rejected or cancelled; the bar ends there. */
  finished: boolean;
}

export interface StatusTotal {
  status: RunStatus;
  totalMs: number;
  /** Whole percents that add up to 100 (largest remainder); see shareText for "<1%". */
  share: number;
  /** The exact share, 0 to 1. */
  ratio: number;
  intervals: number;
  soFar: boolean;
}

const parse = (iso: string | null | undefined): number | null => {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) ? at : null;
};

/**
 * The first interval starts at run.created (or the run's createdAt) as queued; each status change starts
 * the next. A terminal status ends the bar at its time. Otherwise the open interval ends at the later of
 * `now` and the last event, so a client clock behind the server never gives a negative duration.
 */
export function statusIntervals(entries: readonly TimelineEntry[], run: { createdAt: string; status: RunStatus; finishedAt: string | null }, now: number): StatusHistory {
  const createdEntry = entries.find((e) => e.action === "run.created");
  const start = parse(createdEntry?.ts) ?? parse(run.createdAt) ?? now;
  const intervals: StatusInterval[] = [];
  let current: RunStatus = "queued";
  let since = start;
  let lastTs = start;
  let finishedAt: number | null = null;
  for (const entry of entries) {
    const ts = parse(entry.ts);
    if (ts !== null) lastTs = Math.max(lastTs, ts);
    if (finishedAt !== null || entry.action !== "run.status_changed" || !entry.statusTo || ts === null) continue;
    const at = Math.max(since, ts);
    intervals.push({ status: current, start: since, end: at, soFar: false });
    current = entry.statusTo;
    since = at;
    if (TERMINAL_RUN_STATUSES.includes(current)) finishedAt = at;
  }
  if (finishedAt === null && TERMINAL_RUN_STATUSES.includes(run.status)) {
    // The snapshot already says finished but the timeline has not caught up: end at the run's finish.
    const finished = parse(run.finishedAt);
    if (finished !== null) finishedAt = Math.max(since, finished);
    if (finishedAt !== null) intervals.push({ status: current, start: since, end: finishedAt, soFar: false });
  } else if (finishedAt === null) {
    intervals.push({ status: current, start: since, end: Math.max(now, lastTs, since), soFar: true });
  }
  const kept = intervals.filter((i) => i.end > i.start || i.soFar);
  const end = finishedAt ?? kept.at(-1)?.end ?? start;
  return { start, end, intervals: kept, finished: finishedAt !== null };
}

/** One row per status, in order of first occurrence, with whole-percent shares that sum to 100. */
export function statusTotals(history: StatusHistory): StatusTotal[] {
  const span = history.end - history.start;
  const rows: StatusTotal[] = [];
  for (const interval of history.intervals) {
    let row = rows.find((r) => r.status === interval.status);
    if (!row) {
      row = { status: interval.status, totalMs: 0, share: 0, ratio: 0, intervals: 0, soFar: false };
      rows.push(row);
    }
    row.totalMs += interval.end - interval.start;
    row.intervals += 1;
    row.soFar ||= interval.soFar;
  }
  if (span <= 0) {
    for (const row of rows) [row.ratio, row.share] = [1 / rows.length, Math.round(100 / rows.length)];
    return rows;
  }
  for (const row of rows) row.ratio = row.totalMs / span;
  // Largest remainder: floor every share, then give the leftover points to the largest remainders.
  const floors = rows.map((row) => Math.floor(row.ratio * 100));
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = rows.map((row, i) => ({ i, rest: row.ratio * 100 - (floors[i] ?? 0) })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  rows.forEach((row, i) => (row.share = floors[i] ?? 0));
  return rows;
}

/** "42%", or "<1%" for a status that took time but less than one percent of the run. */
export function shareText(row: Pick<StatusTotal, "share" | "ratio" | "totalMs">): string {
  if (row.totalMs > 0 && row.ratio < 0.01) return "<1%";
  return `${row.share}%`;
}
