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

  it("moves between intervals with the arrow keys; the tooltip reads like the interval and the live region speaks only after a key", () => {
    render(<StatusTimeBar entries={SUCCEEDED} run={{ createdAt: at(0), status: "succeeded", finishedAt: at(1820) }} />);
    const bar = screen.getByTestId("status-bar");
    const tip = screen.getByTestId("status-tip");
    const announcer = screen.getByTestId("interval-announcer");
    const tipText = () => tip.firstChild?.textContent ?? "";
    expect(tip.textContent).toBe("");
    // The tooltip is for the eye only; the live region is a separate, visually hidden status.
    expect(tip.getAttribute("aria-hidden")).toBe("true");
    expect(tip.getAttribute("role")).toBeNull();
    expect(announcer.getAttribute("role")).toBe("status");
    fireEvent.focus(bar);
    // Focus starts on the latest interval and shows the arrow-key hint; focusing announces nothing beyond the bar's name.
    expect(tipText()).toBe(`running, ${time(1810)} to ${time(1820)} (10 s)`);
    expect(screen.getByTestId("status-keys").textContent).toBe("Left and right arrow keys: other intervals");
    expect(announcer.textContent).toBe("");
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(tipText()).toBe(`awaiting approval, ${time(10)} to ${time(1810)} (30 min)`);
    expect(announcer.textContent).toBe(`awaiting approval, ${time(10)} to ${time(1810)} (30 min)`);
    fireEvent.keyDown(bar, { key: "Home" });
    expect(tipText()).toBe(`queued, ${time(0)} to ${time(2)} (2 s)`);
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(announcer.textContent).toBe(`queued, ${time(0)} to ${time(2)} (2 s)`);
    fireEvent.keyDown(bar, { key: "End" });
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(tipText()).toBe(`running, ${time(1810)} to ${time(1820)} (10 s)`);
    fireEvent.blur(bar);
    expect(tip.textContent).toBe("");
    expect(announcer.textContent).toBe("");
  });

  it("shows the interval under the pointer without announcing it", () => {
    render(<StatusTimeBar entries={SUCCEEDED} run={{ createdAt: at(0), status: "succeeded", finishedAt: at(1820) }} />);
    const bar = screen.getByTestId("status-bar");
    bar.getBoundingClientRect = () => ({ left: 0, width: 1820, top: 0, right: 1820, bottom: 24, height: 24, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerMove(bar, { clientX: 900 });
    expect(screen.getByTestId("status-tip").textContent).toBe(`awaiting approval, ${time(10)} to ${time(1810)} (30 min)`);
    expect(screen.queryByTestId("status-keys")).toBeNull();
    expect(screen.getByTestId("interval-announcer").textContent).toBe("");
  });

  it("names the bar without key instructions, and lists every interval with its start, end and duration behind 'Each interval'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 3_600_000);
    const PAUSED = [created(), change(2, "queued", "planning"), change(5, "planning", "running"), change(10, "running", "paused"), change(70, "paused", "running"), change(80, "running", "awaiting_approval")];
    render(<StatusTimeBar entries={PAUSED} run={{ createdAt: at(0), status: "awaiting_approval", finishedAt: null }} />);
    const label = screen.getByTestId("status-bar").getAttribute("aria-label") ?? "";
    expect(label).toBe(`Time in each status from ${time(0)} to now. The table below gives each status's total, and Each interval lists every interval with its start and end.`);
    expect(label).not.toMatch(/arrow/i);
    const toggle = screen.getByRole("button", { name: "Each interval (6)" });
    const list = screen.getByTestId("status-intervals");
    expect([toggle.getAttribute("aria-expanded"), toggle.getAttribute("aria-controls"), list.hidden]).toEqual(["false", list.id, true]);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
    const table = within(list).getByRole("table", { name: "Each interval, in order" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Status", "When", "Duration"]);
    expect(within(list).getAllByTestId("interval-row").map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent))).toEqual([
      ["queued", `${time(0)} to ${time(2)}`, "2 s"],
      ["planning", `${time(2)} to ${time(5)}`, "3 s"],
      ["running", `${time(5)} to ${time(10)}`, "5 s"],
      ["paused", `${time(10)} to ${time(70)}`, "1 min"],
      ["running", `${time(70)} to ${time(80)}`, "10 s"],
      ["awaiting approval", `${time(80)} to now`, "58 min so far"],
    ]);
    // The swatch beside each status is the same class as its bar segment.
    expect(within(list).getAllByTestId("interval-row").map((r) => r.querySelector(".status-swatch")?.classList.contains(`status--${r.querySelector("td")?.textContent?.replace(" ", "_")}`))).toEqual([true, true, true, true, true, true]);
    fireEvent.click(toggle);
    expect(list.hidden).toBe(true);
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
