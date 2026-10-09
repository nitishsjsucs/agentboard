import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DlqMessageView } from "../../../shared/api-types.ts";
import { DlqPanel } from "../DlqPanel.tsx";
import { withSession } from "./session.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function message(overrides: Partial<DlqMessageView> & Pick<DlqMessageView, "id" | "outcome">): DlqMessageView {
  return {
    runId: "run_01J00000000000000000000000",
    taskId: "tsk_01J00000000000000000000000",
    dispatchId: "8b5a9c2e-1d3f-4b7a-9c1e-2f3a4b5c6d7e",
    attempts: 3,
    receivedAt: "2026-10-08T12:00:00.000Z",
    replayedAt: null,
    replayedBy: null,
    taskStatus: "dead_lettered",
    open: false,
    ...overrides,
  };
}

const messages = [
  message({ id: "msg-open-000001", outcome: "dead_lettered", open: true }),
  message({ id: "msg-done-000002", outcome: "dead_lettered", replayedAt: "2026-10-08T12:05:00.000Z", replayedBy: "admin@agentboard.test", taskStatus: "succeeded" }),
  message({ id: "msg-stale-00003", outcome: "ignored_stale", taskStatus: "succeeded" }),
  message({ id: "msg-poison-0004", outcome: "poison", runId: null, taskId: null, dispatchId: null, taskStatus: null }),
  // Recovered without a replay (an operator retried the task): history, not open work.
  message({ id: "msg-recov-00005", outcome: "dead_lettered", taskStatus: "ready" }),
];

describe("DlqPanel", { tags: ["ui"] }, () => {
  it("counts open dead letters and offers replay only for an open one (unreplayed, task still dead-lettered), only with dlq:replay", () => {
    const operator = render(withSession("operator", <DlqPanel messages={messages} onChange={() => undefined} />));
    expect(screen.getByText("1 open")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "Replay" })).toHaveLength(0);
    operator.unmount();

    render(withSession("admin", <DlqPanel messages={messages} onChange={() => undefined} />));
    const replays = screen.getAllByRole("button", { name: "Replay" });
    expect(replays).toHaveLength(1);
    expect(replays[0]?.closest("tr")?.textContent).toContain("msg-open-000");
    expect(screen.getByText("replayed by admin@agentboard.test")).toBeTruthy();
    expect(screen.getByText("ignored stale")).toBeTruthy();
    expect(screen.getByText("task now ready").closest("tr")?.textContent).toContain("msg-recov-00");
    // A poison message has no run to link to.
    expect(screen.getByText("poison").closest("tr")?.textContent).toContain("none");
  });

  it("reports a refused replay instead of closing silently", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ accepted: false, reason: "invalid_state" }), { status: 409, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();
    render(withSession("admin", <DlqPanel messages={messages} onChange={onChange} />));
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    fireEvent.change(screen.getByLabelText("Reason (recorded in the audit log)"), { target: { value: "try again" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Replay" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Refused: invalid_state."));
    expect(fetchMock).toHaveBeenCalledWith("/api/dlq/msg-open-000001/replay", expect.objectContaining({ method: "POST" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
