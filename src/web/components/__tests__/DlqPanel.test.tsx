import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DlqMessageView } from "../../../shared/api-types.ts";
import { DlqPanel } from "../DlqPanel.tsx";
import { withSession } from "./session.tsx";

afterEach(cleanup);

function message(overrides: Partial<DlqMessageView> & Pick<DlqMessageView, "id" | "outcome">): DlqMessageView {
  return {
    runId: "run_01J00000000000000000000000",
    taskId: "tsk_01J00000000000000000000000",
    dispatchId: "8b5a9c2e-1d3f-4b7a-9c1e-2f3a4b5c6d7e",
    attempts: 3,
    receivedAt: "2026-10-08T12:00:00.000Z",
    replayedAt: null,
    replayedBy: null,
    ...overrides,
  };
}

const messages = [
  message({ id: "msg-open-000001", outcome: "dead_lettered" }),
  message({ id: "msg-done-000002", outcome: "dead_lettered", replayedAt: "2026-10-08T12:05:00.000Z", replayedBy: "admin@agentboard.test" }),
  message({ id: "msg-stale-00003", outcome: "ignored_stale" }),
  message({ id: "msg-poison-0004", outcome: "poison", runId: null, taskId: null, dispatchId: null }),
];

describe("DlqPanel", { tags: ["ui"] }, () => {
  it("counts open dead letters and offers replay only for an unreplayed dead letter, only with dlq:replay", () => {
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
    // A poison message has no run to link to.
    expect(screen.getByText("poison").closest("tr")?.textContent).toContain("none");
  });
});
