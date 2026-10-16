import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ageMs, formatDuration, formatDurationWords, useNow } from "../time.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("formatDuration", { tags: ["ui"] }, () => {
  it.each([
    [0, "under 1 min", "under 1 minute"],
    [59_999, "under 1 min", "under 1 minute"],
    [-5 * MIN, "under 1 min", "under 1 minute"],
    [Number.NaN, "under 1 min", "under 1 minute"],
    [MIN, "1 min", "1 minute"],
    [4 * MIN + 59_000, "4 min", "4 minutes"],
    [59 * MIN, "59 min", "59 minutes"],
    [HOUR, "1 h", "1 hour"],
    [2 * HOUR + 14 * MIN, "2 h 14 min", "2 hours 14 minutes"],
    [23 * HOUR + 59 * MIN, "23 h 59 min", "23 hours 59 minutes"],
    [DAY, "1 d", "1 day"],
    [2 * DAY + 23 * HOUR + 59 * MIN, "2 d 23 h", "2 days 23 hours"],
    [3 * DAY, "3 d", "3 days"],
  ])("%d ms reads %s", (ms, short, words) => {
    expect(formatDuration(ms)).toBe(short);
    expect(formatDurationWords(ms)).toBe(words);
  });

  it("ageMs is never negative and is 0 for an unreadable time", () => {
    const now = Date.parse("2026-10-16T12:00:00.000Z");
    expect(ageMs("2026-10-16T11:00:00.000Z", now)).toBe(HOUR);
    expect(ageMs("2026-10-16T13:00:00.000Z", now)).toBe(0);
    expect(ageMs("not a date", now)).toBe(0);
    expect(ageMs(null, now)).toBe(0);
  });
});

describe("useNow", { tags: ["ui"] }, () => {
  it("re-renders on its interval from the client clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    function Clock() {
      return <span data-testid="now">{new Date(useNow(30_000)).toISOString()}</span>;
    }
    render(<Clock />);
    expect(screen.getByTestId("now").textContent).toBe("2026-10-16T12:00:00.000Z");
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId("now").textContent).toBe("2026-10-16T12:00:30.000Z");
  });
});
