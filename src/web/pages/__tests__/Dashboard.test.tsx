import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, pending, reply, stubApi } from "../../components/__tests__/api.ts";
import { renderAt } from "../../components/__tests__/session.tsx";
import { Dashboard } from "../Dashboard.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SUMMARY = { byStatus: { succeeded: 4, running: 1 }, byType: {}, pendingApprovals: 2, needsAttention: 0, dlqOpen: 0 };

function api(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  return stubApi(({ path }) => {
    const override = Object.entries(overrides).find(([prefix]) => path.startsWith(prefix));
    if (override) return override[1]();
    if (path === "/api/metrics/summary") return reply(SUMMARY);
    if (path.startsWith("/api/runs")) return reply({ items: [], nextCursor: null });
    if (path === "/api/agents") return reply({ roles: [] });
    if (path === "/api/dlq") return reply({ items: [], nextCursor: null });
    return undefined;
  });
}

const statValues = () => screen.getAllByTestId("stat").map((card) => card.querySelector(".stat__value")?.textContent);

describe("Dashboard loading and failure states", { tags: ["ui"] }, () => {
  it("shows loading lines and no zeros or empty states while nothing has answered", async () => {
    api({ "/api": pending });
    render(renderAt("operator", <Dashboard />));
    const statuses = await screen.findAllByRole("status");
    const texts = statuses.map((s) => s.textContent);
    expect(texts).toEqual(expect.arrayContaining(["Loading counts...", "Loading runs...", "Loading agent roles...", "Loading dead letters..."]));
    expect(statValues().every((v) => v === "-not loaded")).toBe(true);
    expect(screen.getByRole("link", { name: "Pending approvals" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("No runs yet.");
    expect(document.body.textContent).not.toContain("Nothing dead-lettered.");
  });

  it("never shows a 0 when the summary fails, names the failure, and refetches on Try again", async () => {
    const calls = api({ "/api/metrics/summary": () => apiError(500, "internal", "internal error", undefined, "ray-123") });
    render(renderAt("operator", <Dashboard />));
    const notice = await screen.findByText(/Counts are unavailable right now\./);
    const alert = notice.closest("[role=alert]") as HTMLElement;
    expect(alert.textContent).toContain("AgentBoard could not finish this request.");
    expect(alert.textContent).toContain("Request id ray-123");
    expect(statValues()).not.toContain("0");
    expect(screen.getByRole("link", { name: "Pending approvals" })).toBeTruthy();

    const before = calls.paths().filter((p) => p === "/api/metrics/summary").length;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls.paths().filter((p) => p === "/api/metrics/summary").length).toBe(before + 1));
  });

  it("shows the counts and the pending-approvals number once the summary loads", async () => {
    api();
    render(renderAt("operator", <Dashboard />));
    expect(await screen.findByRole("link", { name: "2 pending approvals" })).toBeTruthy();
    expect(statValues()[0]).toBe("1");
    expect(await screen.findByText("No runs yet.")).toBeTruthy();
  });

  it("renders an Agent roles error card instead of dropping the panel when /api/agents fails", async () => {
    api({ "/api/agents": () => apiError(503, "internal", "upstream") });
    render(renderAt("viewer", <Dashboard />));
    const heading = await screen.findByRole("heading", { name: "Agent roles" });
    const card = heading.closest(".card") as HTMLElement;
    expect((await within(card).findByRole("alert")).textContent).toContain("AgentBoard could not finish this request.");
    expect(within(card).getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
