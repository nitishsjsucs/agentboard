import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, pending, reply, stubApi } from "../../components/__tests__/api.ts";
import { approvalItem } from "../../components/__tests__/fixtures.ts";
import { managerChange } from "../../components/__tests__/planFixtures.ts";
import { renderAt } from "../../components/__tests__/session.tsx";
import { Approvals } from "../Approvals.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const page = (url = "/approvals") => render(renderAt("approver", <Approvals />, { url, path: "/approvals", id: "approver.lee@agentboard.test" }));

describe("Approvals loading and failure states", { tags: ["ui"] }, () => {
  it("shows a loading line, not the empty state, while the first request is in flight", async () => {
    stubApi(() => pending());
    page();
    expect((await screen.findByText("Loading approvals...")).getAttribute("role")).toBe("status");
    expect(document.body.textContent).not.toContain("No pending approvals.");
  });

  it("shows the error with Try again and not the empty text when the list fails", async () => {
    stubApi(() => apiError(500, "internal", "internal error"));
    page();
    expect((await screen.findByRole("alert")).textContent).toContain("AgentBoard could not finish this request.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("No pending approvals.");
  });

  it("still shows the empty state for an empty answer", async () => {
    stubApi(() => reply({ items: [], nextCursor: null }));
    page();
    expect(await screen.findByText("No pending approvals.")).toBeTruthy();
  });

  it("keeps the cards and adds a stale line after a failed poll, and drops the line after the next good one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fail = false;
    stubApi(() => (fail ? apiError(502, "internal", "bad gateway") : reply({ items: [approvalItem()], nextCursor: null })));
    page();
    expect(await screen.findByText("Change the manager of E-1017 to E-1004")).toBeTruthy();
    fail = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect((await screen.findByTestId("stale-notice")).textContent).toMatch(/^Showing data from .+; the last refresh failed\./);
    expect(screen.getByText("Change the manager of E-1017 to E-1004")).toBeTruthy();
    fail = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await waitFor(() => expect(screen.queryByTestId("stale-notice")).toBeNull());
  });

  it("clears the previous tab's cards as soon as another status tab is chosen", async () => {
    stubApi(({ path }) => (path.includes("status=rejected") ? pending() : reply({ items: [approvalItem()], nextCursor: null })));
    page();
    expect(await screen.findByText("Change the manager of E-1017 to E-1004")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "rejected" }));
    expect(screen.queryByText("Change the manager of E-1017 to E-1004")).toBeNull();
    expect((await screen.findByText("Loading approvals...")).getAttribute("role")).toBe("status");
  });

});

describe("Approvals decisions", { tags: ["ui"] }, () => {
  const first = approvalItem();
  const second = approvalItem({
    id: "apr_01J00000000000000000000002",
    runId: "run_01J00000000000000000000002",
    tool: "access.grant_role",
    summary: "Grant okta:super-admin to E-1024",
    risk: "high",
    runTitle: "Privileged access for Dorian Oakhurst (E-1024)",
    requestType: "privileged_access",
  });

  it("announces an approval with the run's title and moves focus to the next card's note", async () => {
    let decided = false;
    stubApi(({ method, path }) => {
      if (method === "POST" && path === `/api/approvals/${first.id}/decision`) {
        decided = true;
        return reply({ ...first, status: "approved", canDecide: false });
      }
      if (path.startsWith("/api/approvals")) return reply({ items: decided ? [second] : [first, second], nextCursor: null });
      return undefined;
    });
    page();
    const [note] = await screen.findAllByLabelText("Decision note");
    fireEvent.change(note as HTMLElement, { target: { value: "Checked against the reorg plan." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0] as HTMLElement);

    const status = screen.getByTestId("decision-status");
    await waitFor(() => expect(status.textContent).toContain("Approved: Change the manager of E-1017 to E-1004. Manager change for Rosalind Galloway (E-1017) continues."));
    expect(status.getAttribute("role")).toBe("status");
    expect(screen.getByRole("link", { name: "Open the run" }).getAttribute("href")).toBe(`/runs/${first.runId}`);
    await waitFor(() => expect(screen.queryByText(first.summary, { selector: "div" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Decision note")));
    expect(document.activeElement?.closest("[data-approval-id]")?.getAttribute("data-approval-id")).toBe(second.id);
  });

  it("announces a rejection and moves focus to the status line when no card is left", async () => {
    let decided = false;
    stubApi(({ method, path }) => {
      if (method === "POST") {
        decided = true;
        return reply({ ...second, status: "rejected", canDecide: false });
      }
      if (path.startsWith("/api/approvals")) return reply({ items: decided ? [] : [second], nextCursor: null });
      return undefined;
    });
    page();
    fireEvent.change(await screen.findByLabelText("Decision note"), { target: { value: "Rejected: no business justification." } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const status = screen.getByTestId("decision-status");
    await waitFor(() => expect(status.textContent).toContain("Rejected: Grant okta:super-admin to E-1024. The run ends as rejected; no writes ran."));
    await screen.findByText("No pending approvals.");
    await waitFor(() => expect(document.activeElement).toBe(status));
  });

  it("refreshes the list and explains it when someone else decided first, instead of the raw refusal", async () => {
    let refused = false;
    const api = stubApi(({ method, path }) => {
      if (method === "POST") {
        refused = true;
        return apiError(409, "conflict", "decision refused: already_decided", "already_decided");
      }
      if (path.startsWith("/api/approvals")) return reply({ items: refused ? [] : [first], nextCursor: null });
      return undefined;
    });
    page();
    fireEvent.change(await screen.findByLabelText("Decision note"), { target: { value: "looks right" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByTestId("decision-status").textContent).toBe("This approval was already decided or has expired. The list now shows its current state."));
    await screen.findByText("No pending approvals.");
    expect(document.body.textContent).not.toContain("decision refused");
    expect(api.paths().filter((p) => p.startsWith("/api/approvals?")).length).toBeGreaterThanOrEqual(2);
    // No card is left, so focus is on the status line, not the page body.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("decision-status")));
  });

  it("after a conflict, moves focus to the next card's note like a decision does", async () => {
    let refused = false;
    stubApi(({ method, path }) => {
      if (method === "POST") {
        refused = true;
        return apiError(409, "conflict", "decision refused: already_decided", "already_decided");
      }
      if (path.startsWith("/api/approvals")) return reply({ items: refused ? [second] : [first, second], nextCursor: null });
      return undefined;
    });
    page();
    const [note] = await screen.findAllByLabelText("Decision note");
    fireEvent.change(note as HTMLElement, { target: { value: "looks right" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByText(first.summary, { selector: "div" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Decision note")));
    expect(document.activeElement?.closest("[data-approval-id]")?.getAttribute("data-approval-id")).toBe(second.id);
  });

  it("clears the status line when another status tab is chosen, since it described the previous list", async () => {
    let refused = false;
    stubApi(({ method, path }) => {
      if (method === "POST") {
        refused = true;
        return apiError(409, "conflict", "decision refused: already_decided", "already_decided");
      }
      if (path.startsWith("/api/approvals")) return reply({ items: refused || !path.includes("status=pending") ? [] : [first], nextCursor: null });
      return undefined;
    });
    page();
    fireEvent.change(await screen.findByLabelText("Decision note"), { target: { value: "looks right" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const status = screen.getByTestId("decision-status");
    await waitFor(() => expect(status.textContent).toContain("This approval was already decided or has expired."));
    fireEvent.click(screen.getByRole("tab", { name: "rejected" }));
    await screen.findByText("No rejected approvals.");
    expect(status.textContent).toBe("");
  });
});

describe("Approvals status in the URL", { tags: ["ui"] }, () => {
  it("opens the tab named by ?status= and writes ?status= when another tab is chosen", async () => {
    const api = stubApi(() => reply({ items: [], nextCursor: null }));
    page("/approvals?status=rejected");
    expect(await screen.findByText("No rejected approvals.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "rejected" }).getAttribute("aria-selected")).toBe("true");
    expect(api.paths()[0]).toBe("/api/approvals?status=rejected&limit=50");
    fireEvent.click(screen.getByRole("tab", { name: "all" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/approvals?status=all"));
    expect(await screen.findByText("No approvals yet.")).toBeTruthy();
    expect(api.paths().at(-1)).toBe("/api/approvals?limit=50");
    fireEvent.click(screen.getByRole("tab", { name: "expired" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/approvals?status=expired"));
  });

  it("falls back to pending for an unknown ?status=", async () => {
    stubApi(() => reply({ items: [], nextCursor: null }));
    page("/approvals?status=bogus");
    expect(await screen.findByText("No pending approvals.")).toBeTruthy();
  });
});

describe("Approvals: what approving unlocks", { tags: ["ui"] }, () => {
  const first = approvalItem({ taskId: "m_x2" });
  const second = approvalItem({ id: "apr_01J00000000000000000000002", runId: "run_01J00000000000000000000002", taskId: "m_x2", summary: "Change the manager of E-1048 to E-1003" });

  it("loads each opened card's run once, keeps it open across list polls, and still moves focus to the next note after a decision", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let decided = false;
    const api = stubApi(({ method, path }) => {
      if (method === "POST") {
        decided = true;
        return reply({ ...first, status: "approved", canDecide: false });
      }
      if (path.startsWith("/api/runs/")) return reply({ run: {}, tasks: managerChange(), approvals: [] });
      if (path.startsWith("/api/approvals")) return reply({ items: decided ? [second] : [first, second], nextCursor: null });
      return undefined;
    });
    page();
    const [toggle] = await screen.findAllByRole("button", { name: "What approving unlocks" });
    fireEvent.click(toggle as HTMLElement);
    expect(await screen.findByTestId("unlocks-after")).toBeTruthy();
    const runFetches = () => api.paths().filter((p) => p.startsWith("/api/runs/"));
    expect(runFetches()).toEqual([`/api/runs/${first.runId}`]);
    // Two list polls later the card is still open and its run was not fetched again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.paths().filter((p) => p.startsWith("/api/approvals?")).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByRole("button", { name: "What approving unlocks" })[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(runFetches()).toEqual([`/api/runs/${first.runId}`]);
    // Deciding the open card still moves focus to the next card's note.
    const [note] = screen.getAllByLabelText("Decision note");
    fireEvent.change(note as HTMLElement, { target: { value: "Checked against the reorg plan." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0] as HTMLElement);
    await waitFor(() => expect(document.activeElement?.closest("[data-approval-id]")?.getAttribute("data-approval-id")).toBe(second.id));
    expect(document.activeElement).toBe(screen.getByLabelText("Decision note"));
    // The remaining card was never opened, so it made no request.
    expect(screen.getByRole("button", { name: "What approving unlocks" }).getAttribute("aria-expanded")).toBe("false");
    expect(runFetches()).toEqual([`/api/runs/${first.runId}`]);
  });
});
