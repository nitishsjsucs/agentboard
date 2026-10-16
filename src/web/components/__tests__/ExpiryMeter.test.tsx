import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpiryMeter } from "../ExpiryMeter.tsx";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const show = (requestedAgo: number, leftMs: number) => render(<ExpiryMeter requestedAt={iso(NOW - requestedAgo)} expiresAt={iso(NOW + leftMs)} />);
const meter = () => screen.getByRole("meter", { name: "Time left to decide" });
const fill = () => meter().firstElementChild as HTMLElement;

describe("ExpiryMeter", { tags: ["ui"] }, () => {
  it("fills with the elapsed share of the window and says the time left in the text and in words", () => {
    show(60_000, 72 * HOUR - 60_000);
    expect(screen.getByTestId("expiry-text").textContent).toMatch(/^expires in 2 d 23 h \(.+\)$/);
    expect(meter().getAttribute("aria-valuetext")).toBe("2 days 23 hours left of 3 days");
    expect([meter().getAttribute("aria-valuemin"), meter().getAttribute("aria-valuemax"), meter().getAttribute("aria-valuenow")]).toEqual(["0", "100", "0"]);
    expect(fill().className).toBe("meter__fill");
  });

  it("turns to the warning tone under 24 hours left and the danger tone under 6, with the text always present", () => {
    const warn = show(50 * HOUR, 22 * HOUR);
    expect(fill().className).toBe("meter__fill meter__fill--warn");
    expect(meter().getAttribute("aria-valuenow")).toBe("69");
    expect(screen.getByTestId("expiry-text").textContent).toMatch(/^expires in 22 h /);
    warn.unmount();
    show(67 * HOUR, 5 * HOUR);
    expect(fill().className).toBe("meter__fill meter__fill--full");
    expect(meter().getAttribute("aria-valuetext")).toBe("5 hours left of 3 days");
  });

  it("moves with the clock without a request, and never shows a negative duration once the expiry passes", () => {
    show(72 * HOUR - 2 * 60_000, 2 * 60_000);
    expect(screen.getByTestId("expiry-text").textContent).toMatch(/^expires in 2 min /);
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(screen.getByTestId("expiry-text").textContent).toBe("expiry passed; the list updates shortly");
    expect(meter().getAttribute("aria-valuetext")).toBe("expiry passed");
    expect(meter().getAttribute("aria-valuenow")).toBe("100");
  });
});
