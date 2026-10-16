import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling, type PollOptions } from "../hooks.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Lets resolved promises and the resulting state updates settle. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("usePolling", { tags: ["ui"] }, () => {
  it("records when the last success finished, and keeps that data when a later poll fails", async () => {
    vi.setSystemTime(new Date("2026-10-15T12:00:00.000Z"));
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("third");
    const { result } = renderHook(() => usePolling(load, []));
    expect(result.current).toMatchObject({ data: null, error: null, loading: true, updatedAt: null });

    await flush();
    expect(result.current).toMatchObject({ data: "first", error: null, loading: false });
    expect(result.current.updatedAt?.toISOString()).toBe("2026-10-15T12:00:00.000Z");

    await tick(5000);
    expect(result.current.data).toBe("first");
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.updatedAt?.toISOString()).toBe("2026-10-15T12:00:00.000Z");

    await tick(5000);
    expect(result.current).toMatchObject({ data: "third", error: null });
    expect(result.current.updatedAt?.toISOString()).toBe("2026-10-15T12:00:10.000Z");
  });

  it("clears data and error as soon as resetKey changes, before the new answer arrives", async () => {
    let resolveSecond: (value: string) => void = () => undefined;
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("pending tab")
      .mockImplementationOnce(() => new Promise<string>((resolve) => (resolveSecond = resolve)));
    const { result, rerender } = renderHook(({ status }: { status: string }) => usePolling(load, [status], { resetKey: status }), { initialProps: { status: "pending" } });
    await flush();
    expect(result.current.data).toBe("pending tab");

    rerender({ status: "rejected" });
    expect(result.current).toMatchObject({ data: null, error: null, loading: true, updatedAt: null });
    await act(async () => resolveSecond("rejected tab"));
    expect(result.current.data).toBe("rejected tab");
  });

  it("clears a previous error on a resetKey change too", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("first tab failed")).mockImplementationOnce(() => new Promise<string>(() => undefined));
    const { result, rerender } = renderHook(({ key }: { key: string }) => usePolling(load, [key], { resetKey: key }), { initialProps: { key: "a" } });
    await flush();
    expect(result.current.error?.message).toBe("first tab failed");
    rerender({ key: "b" });
    expect(result.current).toMatchObject({ data: null, error: null, loading: true });
  });

  it("keeps the data on a plain deps change (a live version bump), with no loading state in between", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("version 1").mockImplementationOnce(() => new Promise<string>(() => undefined));
    const { result, rerender } = renderHook(({ version }: { version: number }) => usePolling(load, [version], { resetKey: "run_x" }), { initialProps: { version: 1 } });
    await flush();
    rerender({ version: 2 });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ data: "version 1", loading: false });
  });

  it("does not load while disabled", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("x");
    const { result, rerender } = renderHook(({ options }: { options: PollOptions }) => usePolling(load, [], options), { initialProps: { options: { enabled: false } } });
    await tick(10_000);
    expect(load).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    rerender({ options: { enabled: true } });
    await flush();
    expect(result.current.data).toBe("x");
  });
});
