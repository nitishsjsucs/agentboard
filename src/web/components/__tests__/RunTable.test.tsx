import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunSummary } from "../../../shared/api-types.ts";
import { RunTable } from "../RunTable.tsx";
import { runSummaryItem } from "./fixtures.ts";
import { withSession } from "./session.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** matchMedia that answers `narrow` for the phone query. */
function stubMedia(narrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: narrow && query.includes("max-width"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

const RUNS: RunSummary[] = [
  runSummaryItem({ id: "run_a", title: "Address change A", status: "needs_attention", statusReason: "budget_exhausted" }),
  runSummaryItem({ id: "run_b", title: "Address change B", status: "needs_attention", statusReason: "task_failed:injected_permanent" }),
  runSummaryItem({ id: "run_c", title: "Manager change C", status: "awaiting_approval", statusReason: null, pendingApprovals: 1, requester: "admin@agentboard.test" }),
  runSummaryItem({ id: "run_d", title: "Address change D", status: "running", statusReason: null, heldTasks: 1 }),
  runSummaryItem({ id: "run_e", title: "Address change E", status: "running", statusReason: null }),
  runSummaryItem({ id: "run_f", title: "Address change F", status: "paused", statusReason: "paused" }),
  runSummaryItem({ id: "run_g", title: "Manager change G", status: "rejected", statusReason: "approval_rejected" }),
  runSummaryItem({ id: "run_h", title: "Address change H", status: "succeeded", statusReason: null }),
];

describe("RunTable", { tags: ["ui"] }, () => {
  it("adds a Waiting on column with the actor and a plain sentence, and no raw reason code anywhere", () => {
    stubMedia(false);
    render(withSession("operator", <RunTable runs={RUNS} />, "ops.lead@agentboard.test"));
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Run", "Type", "Status", "Waiting on", "Requester", "Tool calls", "Created"]);
    const rows = screen.getAllByRole("row").slice(1);
    const waiting = rows.map((row) => within(row).getAllByRole("cell")[3]?.textContent);
    expect(waiting).toEqual([
      "Adminout of budget",
      "Operatora task failed (injected_permanent)",
      "Approverwaiting for an approval",
      "Adminheld: a role is disabled",
      "Nobodyin progress",
      "Operatorpaused: resume to continue",
      "Doneapproval rejected",
      "Done",
    ]);
    const text = document.body.textContent ?? "";
    for (const code of ["budget_exhausted", "task_failed:", "approval_rejected"]) expect(text).not.toContain(code);
    // Status words stay as they were; the pending-approval badge stays too.
    expect(within(rows[2] as HTMLElement).getByText("awaiting approval")).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText("1 approval")).toBeTruthy();
    // The held run reads "held" in words next to its Admin chip, never by colour alone.
    expect(within(rows[3] as HTMLElement).getByTestId("waiting-on").className).toContain("badge--warning");
  });

  it("tells the requester of an awaiting-approval run that someone else must approve it", () => {
    stubMedia(false);
    render(withSession("admin", <RunTable runs={[RUNS[2] as RunSummary]} />, "admin@agentboard.test"));
    expect(screen.getByTestId("waiting-on").textContent).toBe("Approver (not you)");
  });

  it("renders cards instead of the table on a phone: status and Waiting on first, then the title link and the sentence", () => {
    stubMedia(true);
    render(withSession("operator", <RunTable runs={RUNS} />));
    expect(screen.queryByRole("table")).toBeNull();
    const cards = screen.getAllByTestId("run-card");
    expect(cards).toHaveLength(RUNS.length);
    const first = cards[0] as HTMLElement;
    expect(first.tagName).toBe("LI");
    expect(first.firstElementChild?.textContent).toBe("needs attentionWaiting onAdmin");
    expect(within(first).getAllByRole("link")[0]?.textContent).toBe("Address change A");
    expect(first.textContent).toContain("out of budget");
    expect(first.textContent).toContain("4 of 24 tool calls");
    expect(screen.getByRole("list", { name: "Runs" })).toBeTruthy();
  });

  it("keeps the table when matchMedia is missing, and the empty state for no runs", () => {
    vi.stubGlobal("matchMedia", undefined);
    const view = render(withSession("viewer", <RunTable runs={RUNS.slice(0, 1)} />));
    expect(screen.getByRole("table")).toBeTruthy();
    view.unmount();
    render(withSession("viewer", <RunTable runs={[]} empty="No runs match." />));
    expect(screen.getByText("No runs match.")).toBeTruthy();
  });
});
