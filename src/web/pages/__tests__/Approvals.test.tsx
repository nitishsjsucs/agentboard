import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, pending, reply, stubApi } from "../../components/__tests__/api.ts";
import { approvalItem } from "../../components/__tests__/fixtures.ts";
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
    expect((await screen.findByRole("status")).textContent).toBe("Loading approvals...");
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
    expect((await screen.findByRole("status")).textContent).toBe("Loading approvals...");
  });
});
