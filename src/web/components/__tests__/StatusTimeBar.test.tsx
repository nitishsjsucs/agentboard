import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "../../../shared/api-types.ts";
import type { RunStatus } from "../../../shared/domain.ts";
import { StatusTimeBar } from "../StatusTimeBar.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const T0 = Date.parse("2026-10-16T10:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const time = (s: number) => new Date(T0 + s * 1000).toLocaleTimeString();
let seq = 0;
const created = (): TimelineEntry => ({ seq: ++seq, ts: at(0), action: "run.created", actorType: "user", actorId: "ops.lead@agentboard.test", taskId: null, summary: "run created" });
const change = (s: number, from: RunStatus, to: RunStatus): TimelineEntry => ({ seq: ++seq, ts: at(s), action: "run.status_changed", actorType: "system", actorId: "coordinator", taskId: null, summary: `status ${from} to ${to}`, statusFrom: from, statusTo: to });

const SUCCEEDED = [created(), change(2, "queued", "planning"), change(5, "planning", "running"), change(10, "running", "awaiting_approval"), change(1810, "awaiting_approval", "running"), change(1820, "running", "succeeded")];
const rows = () => screen.getAllByTestId("status-row").map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));

describe("StatusTimeBar", { tags: ["ui"] }, () => {
  it("is a figure named 'Time in each status' with a table of each status's total, share and intervals", () => {
    render(<StatusTimeBar entries={SUCCEEDED} run={{ createdAt: at(0), status: "succeeded", finishedAt: at(1820) }} />);
    expect(screen.getByRole("figure", { name: "Time in each status" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Status", "Total time", "Share", "Intervals"]);
    expect(rows()).toEqual([
      ["queued", "2 s", "<1%", "1"],
      ["planning", "3 s", "<1%", "1"],
      ["running", "15 s", "<1%", "2"],
      ["awaiting approval", "30 min", "99%", "1"],
    ]);
    // One segment per interval, each named by status for styling; the bar itself is a single labelled image.
    const bar = screen.getByTestId("status-bar");
    expect(bar.getAttribute("role")).toBe("img");
    expect(bar.getAttribute("tabindex")).toBe("0");
    expect([...bar.querySelectorAll("rect[data-status]")].map((r) => r.getAttribute("data-status"))).toEqual(["queued", "planning", "running", "awaiting_approval", "running"]);
    expect(bar.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("colours each segment and its table swatch by its own status, so a swatch matches one status only", () => {
    const PAUSED = [created(), change(2, "queued", "planning"), change(5, "planning", "running"), change(10, "running", "paused"), change(70, "paused", "running"), change(80, "running", "awaiting_approval"), change(200, "awaiting_approval", "needs_attention")];
    render(<StatusTimeBar entries={PAUSED} run={{ createdAt: at(0), status: "needs_attention", finishedAt: null }} />);
    const segments = [...screen.getByTestId("status-bar").querySelectorAll("rect[data-status]")];
    expect(segments.map((r) => [r.getAttribute("data-status"), r.getAttribute("class")])).toEqual([
      ["queued", "status-seg status--queued"],
      ["planning", "status-seg status--planning"],
      ["running", "status-seg status--running"],
      ["paused", "status-seg status--paused"],
      ["running", "status-seg status--running"],
      ["awaiting_approval", "status-seg status--awaiting_approval"],
      ["needs_attention", "status-seg status--needs_attention"],
    ]);
    const swatches = screen.getAllByTestId("status-row").map((row) => [row.querySelector("td")?.textContent, row.querySelector(".status-swatch")?.getAttribute("class")]);
    expect(swatches).toEqual([
      ["queued", "status-swatch status--queued"],
      ["planning", "status-swatch status--planning"],
      ["running", "status-swatch status--running"],
      ["paused", "status-swatch status--paused"],
      ["awaiting approval", "status-swatch status--awaiting_approval"],
      ["needs attention", "status-swatch status--needs_attention"],
    ]);
  });

  it("moves between intervals with the arrow keys, and the tooltip reads like the interval", () => {
    render(<StatusTimeBar entries={SUCCEEDED} run={{ createdAt: at(0), status: "succeeded", finishedAt: at(1820) }} />);
    const bar = screen.getByTestId("status-bar");
    const tip = screen.getByTestId("status-tip");
    expect(tip.textContent).toBe("");
    fireEvent.focus(bar);
    // Focus starts on the latest interval.
    expect(tip.textContent).toBe(`running, ${time(1810)} to ${time(1820)} (10 s)`);
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(tip.textContent).toBe(`awaiting approval, ${time(10)} to ${time(1810)} (30 min)`);
    expect(tip.getAttribute("role")).toBe("status");
    fireEvent.keyDown(bar, { key: "Home" });
    expect(tip.textContent).toBe(`queued, ${time(0)} to ${time(2)} (2 s)`);
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(tip.textContent).toBe(`queued, ${time(0)} to ${time(2)} (2 s)`);
    fireEvent.keyDown(bar, { key: "End" });
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(tip.textContent).toBe(`running, ${time(1810)} to ${time(1820)} (10 s)`);
    fireEvent.blur(bar);
    expect(tip.textContent).toBe("");
  });

  it("marks the open interval 'so far' and grows it from the client clock without a request", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 3_600_000);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<StatusTimeBar entries={SUCCEEDED.slice(0, 4)} run={{ createdAt: at(0), status: "awaiting_approval", finishedAt: null }} />);
    expect(rows().at(-1)).toEqual(["awaiting approval", "59 min so far", "100%", "1"]);
    expect(within(screen.getByRole("figure")).getByText("now")).toBeTruthy();
    vi.unstubAllGlobals();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says 'Queued since' for a run that was just created", () => {
    render(<StatusTimeBar entries={[created()]} run={{ createdAt: at(0), status: "queued", finishedAt: null }} />);
    expect(screen.getByText(`Queued since ${time(0)}`)).toBeTruthy();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.[0]).toBe("queued");
  });
});
