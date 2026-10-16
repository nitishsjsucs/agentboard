import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../../../shared/api-types.ts";
import type { RunStatus } from "../../../shared/domain.ts";
import { shareText, statusIntervals, statusTotals } from "../statusIntervals.ts";

const T0 = Date.parse("2026-10-16T10:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
let seq = 0;
const created = (s = 0): TimelineEntry => ({ seq: ++seq, ts: at(s), action: "run.created", actorType: "user", actorId: "ops.lead@agentboard.test", taskId: null, summary: "run created" });
const change = (s: number, from: RunStatus, to: RunStatus): TimelineEntry => ({ seq: ++seq, ts: at(s), action: "run.status_changed", actorType: "system", actorId: "coordinator", taskId: null, summary: `status ${from} to ${to}`, statusFrom: from, statusTo: to });
const other = (s: number): TimelineEntry => ({ seq: ++seq, ts: at(s), action: "task.leased", actorType: "agent", actorId: "executor-0", taskId: "t", summary: "leased" });
const run = (status: RunStatus, finishedAt: string | null = null) => ({ createdAt: at(0), status, finishedAt });
const brief = (h: ReturnType<typeof statusIntervals>) => h.intervals.map((i) => [i.status, (i.start - T0) / 1000, (i.end - T0) / 1000, i.soFar]);

describe("statusIntervals", { tags: ["ui"] }, () => {
  it("cuts an ordinary run into its statuses and ends the bar at the terminal status", () => {
    const entries = [created(0), change(2, "queued", "planning"), other(3), change(5, "planning", "running"), change(10, "running", "awaiting_approval"), change(70, "awaiting_approval", "running"), change(80, "running", "succeeded")];
    const history = statusIntervals(entries, run("succeeded", at(80)), T0 + 500_000);
    expect(brief(history)).toEqual([
      ["queued", 0, 2, false],
      ["planning", 2, 5, false],
      ["running", 5, 10, false],
      ["awaiting_approval", 10, 70, false],
      ["running", 70, 80, false],
    ]);
    expect([history.finished, (history.end - T0) / 1000]).toEqual([true, 80]);
    const totals = statusTotals(history);
    expect(totals.map((t) => [t.status, t.totalMs / 1000, t.intervals, t.share])).toEqual([
      // 2.5%, 3.75%, 18.75% and 75%: the two largest remainders get the two leftover points.
      ["queued", 2, 1, 2],
      ["planning", 3, 1, 4],
      ["running", 15, 2, 19],
      ["awaiting_approval", 60, 1, 75],
    ]);
    expect(totals.reduce((sum, t) => sum + t.share, 0)).toBe(100);
  });

  it("counts a retry from needs attention and a pause and resume as separate intervals", () => {
    const entries = [
      created(0),
      change(1, "queued", "planning"),
      change(2, "planning", "running"),
      change(4, "running", "needs_attention"),
      change(40, "needs_attention", "running"),
      change(42, "running", "paused"),
      change(60, "paused", "running"),
      change(62, "running", "succeeded"),
    ];
    const totals = statusTotals(statusIntervals(entries, run("succeeded"), T0));
    expect(totals.map((t) => [t.status, t.intervals, t.totalMs / 1000])).toEqual([
      ["queued", 1, 1],
      ["planning", 1, 1],
      ["running", 3, 2 + 2 + 2],
      ["needs_attention", 1, 36],
      ["paused", 1, 18],
    ]);
  });

  it("ends the open interval at the client clock and marks it 'so far'", () => {
    const history = statusIntervals([created(0), change(2, "queued", "planning"), change(4, "planning", "running"), change(10, "running", "awaiting_approval")], run("awaiting_approval"), T0 + 3_600_000);
    expect(brief(history).at(-1)).toEqual(["awaiting_approval", 10, 3600, true]);
    expect(history.finished).toBe(false);
    const open = statusTotals(history).at(-1);
    expect(open).toMatchObject({ status: "awaiting_approval", soFar: true });
  });

  it("never gives a negative duration when the client clock is behind the server", () => {
    const history = statusIntervals([created(0), change(5, "queued", "planning"), other(30)], run("planning"), T0 + 1000);
    expect(brief(history)).toEqual([
      ["queued", 0, 5, false],
      ["planning", 5, 30, true],
    ]);
    for (const interval of history.intervals) expect(interval.end).toBeGreaterThanOrEqual(interval.start);
  });

  it("starts as queued at the run's createdAt when the timeline is empty, and ends at finishedAt when the snapshot is ahead of the timeline", () => {
    expect(brief(statusIntervals([], run("queued"), T0 + 4000))).toEqual([["queued", 0, 4, true]]);
    const ahead = statusIntervals([created(0), change(1, "queued", "planning"), change(2, "planning", "running")], run("succeeded", at(9)), T0 + 60_000);
    expect(brief(ahead).at(-1)).toEqual(["running", 2, 9, false]);
    expect(ahead.finished).toBe(true);
  });

  it("shows '<1%' for a status that took time but under one percent", () => {
    const totals = statusTotals(statusIntervals([created(0), change(1, "queued", "running"), change(500, "running", "succeeded")], run("succeeded"), T0));
    expect(totals.map((t) => [t.status, shareText(t)])).toEqual([
      ["queued", "<1%"],
      ["running", "100%"],
    ]);
  });
});
