import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolCallView } from "../../../shared/api-types.ts";
import { ToolCallTrace } from "../ToolCallTrace.tsx";

afterEach(cleanup);

function call(overrides: Partial<ToolCallView> & Pick<ToolCallView, "id" | "tool">): ToolCallView {
  return {
    taskId: "tsk_01J00000000000000000000000",
    stepId: "s2",
    agent: "executor-1",
    args: { employeeId: "E-1007" },
    idempotencyKey: null,
    attempt: 1,
    generation: 0,
    leaseEpoch: 1,
    outcome: "ok",
    logical: false,
    result: { ok: true },
    error: null,
    startedAt: "2026-10-08T12:00:00.000Z",
    finishedAt: "2026-10-08T12:00:00.120Z",
    durationMs: 120,
    ...overrides,
  };
}

const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

describe("ToolCallTrace", { tags: ["ui"] }, () => {
  it("badges ledger replays and logical replays, and shows attempt, generation and lease epoch", () => {
    const calls = [
      call({ id: "call_a", tool: "hris.get_employee", stepId: "s1" }),
      call({ id: "call_b", tool: "hris.update_address", outcome: "replayed", attempt: 2, generation: 0, leaseEpoch: 2 }),
      call({ id: "call_c", tool: "notify.send", stepId: "s3", outcome: "replayed", logical: true, attempt: 1, generation: 1, leaseEpoch: 3 }),
    ];
    render(<ToolCallTrace calls={calls} />);
    expect(screen.getAllByText("replayed")).toHaveLength(2);
    // Only the cross-generation replay carries the logical badge, on its own row.
    expect(screen.getAllByText("logical replay")).toHaveLength(1);
    expect(rowOf("notify.send").textContent).toContain("logical replay");
    expect(rowOf("hris.update_address").textContent).not.toContain("logical replay");
    expect(rowOf("hris.update_address").textContent).toContain("2 (gen 0, epoch 2)");
    expect(rowOf("notify.send").textContent).toContain("1 (gen 1, epoch 3)");
  });

  it("expands a call to its arguments, result or error and idempotency key, and collapses it again", () => {
    const calls = [
      call({ id: "call_w", tool: "hris.update_address", idempotencyKey: "ik_abc123", args: { employeeId: "E-1007", address: { city: "Austin" } }, result: { ok: true, data: { updated: true } } }),
      call({ id: "call_e", tool: "notify.send", stepId: "s3", outcome: "permanent_error", result: null, error: "template_unknown" }),
    ];
    render(<ToolCallTrace calls={calls} />);
    expect(screen.queryByText("Arguments")).toBeNull();

    fireEvent.click(rowOf("hris.update_address"));
    expect(screen.getByText("Arguments")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
    expect(screen.getByText(/"city": "Austin"/)).toBeTruthy();
    expect(screen.getByText(/"updated": true/)).toBeTruthy();
    expect(screen.getByText("idempotency key ik_abc123")).toBeTruthy();

    // One call open at a time; a failed call shows its error instead of a result.
    fireEvent.click(rowOf("notify.send"));
    expect(screen.queryByText("idempotency key ik_abc123")).toBeNull();
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText('"template_unknown"')).toBeTruthy();

    fireEvent.click(rowOf("notify.send"));
    expect(screen.queryByText("Arguments")).toBeNull();
  });
});
