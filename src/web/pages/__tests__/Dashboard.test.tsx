import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, pending, reply, stubApi } from "../../components/__tests__/api.ts";
import { metricsSummary, runSummaryItem } from "../../components/__tests__/fixtures.ts";
import { renderAt } from "../../components/__tests__/session.tsx";
import { Dashboard } from "../Dashboard.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
const SUMMARY = metricsSummary({
  byStatus: { succeeded: 87, rejected: 6, cancelled: 4, running: 1, needs_attention: 4, paused: 1, awaiting_approval: 3 },
  pendingApprovals: 3,
  needsAttention: 4,
  dlqOpen: 0,
  open: [
    { status: "running", count: 1, oldestUpdatedAt: ago(4 * MIN + 10_000) },
    { status: "queued", count: 2, oldestUpdatedAt: ago(9 * MIN + 10_000) },
    { status: "needs_attention", count: 4, oldestUpdatedAt: ago(2 * 60 * MIN + 30_000) },
    { status: "paused", count: 1, oldestUpdatedAt: ago(14 * MIN + 10_000) },
    { status: "awaiting_approval", count: 3, oldestUpdatedAt: ago(MIN) },
  ],
  needsAttentionByReason: [
    { reason: "task_failed:permanent_error", count: 2 },
    { reason: "budget_exhausted", count: 1 },
    { reason: "dead_lettered", count: 1 },
  ],
  approvals: { pending: 3, decidableByYou: null, soonestExpiry: ahead((2 * 24 + 23) * 60 * MIN + 30_000) },
  heldRuns: { total: 1, byRole: [{ role: "executor", runs: 1 }] },
});

function api(overrides: Record<string, () => Response | Promise<Response>> = {}, summary: object = SUMMARY) {
  return stubApi(({ path }) => {
    const override = Object.entries(overrides).find(([prefix]) => path.startsWith(prefix));
    if (override) return override[1]();
    if (path === "/api/metrics/summary") return reply(summary);
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
    expect(screen.getByRole("link", { name: "Pending approvals, not loaded" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Needs attention, not loaded" })).toBeTruthy();
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
    expect(screen.getByRole("link", { name: "Pending approvals, not loaded" })).toBeTruthy();

    const before = calls.paths().filter((p) => p === "/api/metrics/summary").length;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls.paths().filter((p) => p === "/api/metrics/summary").length).toBe(before + 1));
  });

  it("keeps the counts and adds the stale line when a later summary poll fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fail = false;
    api({ "/api/metrics/summary": () => (fail ? apiError(502, "internal", "bad gateway") : reply(SUMMARY)) });
    render(renderAt("operator", <Dashboard />));
    await screen.findByRole("link", { name: /^Needs attention: 4 runs/ });
    fail = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect((await screen.findAllByTestId("stale-notice"))[0]?.textContent).toMatch(/the last refresh failed/);
    expect(screen.getByRole("link", { name: /^Needs attention: 4 runs/ })).toBeTruthy();
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

const tile = (key: string) => document.querySelector<HTMLElement>(`[data-tile="${key}"]`);
const lines = (key: string) => [...(tile(key)?.querySelectorAll(".stat__line") ?? [])].map((l) => l.textContent);

describe("Dashboard Needs a person", { tags: ["ui"] }, () => {
  it("shows the operator who acts on runs that need attention, with the oldest age, and the split sums to the count", async () => {
    api();
    render(renderAt("operator", <Dashboard />));
    const link = await screen.findByRole("link", { name: "Needs attention: 4 runs, oldest unchanged for 2 hours, 3 need an operator and 1 an admin" });
    expect(link.getAttribute("href")).toBe("/runs?status=needs_attention");
    expect(tile("needs_attention")?.querySelector(".stat__value")?.textContent).toBe("4");
    expect(lines("needs_attention")).toEqual(["oldest unchanged for 2 h", "3 need an operator, 1 an admin"]);
    expect(screen.getByRole("heading", { level: 2, name: "Needs a person" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Moving" })).toBeTruthy();
  });

  it("starts every tile's accessible name with its visible label, so a voice command with the label finds it", async () => {
    api();
    render(renderAt("admin", <Dashboard />));
    await screen.findByRole("link", { name: /^Needs attention: 4 runs/ });
    const tiles = [...document.querySelectorAll<HTMLElement>("a[data-tile]")];
    expect(tiles.map((t) => t.dataset["tile"])).toEqual(["approvals", "needs_attention", "held", "paused", "dlq"]);
    for (const t of tiles) {
      const label = t.querySelector(".stat__label")?.textContent ?? "";
      expect([label, t.getAttribute("aria-label")?.startsWith(`${label}: `)]).toEqual([label, true]);
    }
  });

  it("puts the run lists and the agent panels under h2s of their own, not under 'Moving'", async () => {
    api({ "/api/runs?status=needs_attention": () => reply({ items: [runSummaryItem({ status: "needs_attention" })], nextCursor: null }) });
    render(renderAt("admin", <Dashboard />));
    await screen.findByRole("link", { name: /^Needs attention: 4 runs/ });
    await screen.findByRole("heading", { level: 3, name: "Needs attention" });
    const outline = [...document.querySelectorAll("h1, h2, h3")].map((h) => `${h.tagName} ${h.textContent}`);
    expect(outline).toEqual(["H1 Dashboard", "H2 Needs a person", "H2 Moving", "H2 Runs", "H3 Needs attention", "H3 Recent runs", "H2 Agents and dead letters", "H3 Agent roles", "H3 Dead-letter queue"]);
    // The new headings name their sections for screen readers; on screen the cards' own headings do.
    expect(screen.getByRole("heading", { level: 2, name: "Runs" }).classList.contains("visually-hidden")).toBe(true);
    expect(screen.getByRole("region", { name: "Runs" }).contains(screen.getByRole("heading", { name: "Recent runs" }))).toBe(true);
  });

  it("tells an operator or a viewer who decides approvals, and an approver how many they can decide and when the next expires", async () => {
    api();
    const operator = render(renderAt("operator", <Dashboard />));
    const pending = await screen.findByRole("link", { name: "Pending approvals: 3, approvers and admins decide these" });
    expect(pending.getAttribute("href")).toBe("/approvals");
    expect(lines("approvals")).toEqual(["Approvers and admins decide these"]);
    operator.unmount();
    vi.unstubAllGlobals();

    api({}, { ...SUMMARY, approvals: { ...SUMMARY.approvals, decidableByYou: 2 } });
    render(renderAt("approver", <Dashboard />));
    const decide = await screen.findByRole("link", { name: "Approvals you can decide: 2, of 3 pending, next expires in 2 days 23 hours" });
    expect(decide.getAttribute("href")).toBe("/approvals");
    expect(tile("approvals")?.querySelector(".stat__label")?.textContent).toBe("Approvals you can decide");
    expect(lines("approvals")).toEqual(["of 3 pending", "next expires in 2 d 23 h"]);
  });

  it("names the disabled role that holds runs, links to the Agent roles card, and the paused tile to the paused runs", async () => {
    api();
    render(renderAt("operator", <Dashboard />));
    const held = await screen.findByRole("link", { name: "Held by a disabled role: 1 run, executor role disabled, an admin can enable it" });
    expect(held.getAttribute("href")).toBe("#agent-roles");
    expect(lines("held")).toEqual(["executor role disabled; an admin can enable it"]);
    expect(document.getElementById("agent-roles")).toBeTruthy();
    const paused = screen.getByRole("link", { name: "Paused: 1 run, oldest paused for 14 minutes" });
    expect(paused.getAttribute("href")).toBe("/runs?status=paused");
    const dlq = screen.getByRole("link", { name: "Open dead letters: 0" });
    expect(dlq.getAttribute("href")).toBe("#dead-letters");
  });

  it("shows no dead-letter tile to a viewer, whose summary has dlqOpen null", async () => {
    api({}, { ...SUMMARY, dlqOpen: null });
    render(renderAt("viewer", <Dashboard />));
    await screen.findByRole("link", { name: /^Needs attention: 4 runs/ });
    expect(tile("dlq")).toBeNull();
    expect(screen.queryByRole("link", { name: /dead letter/ })).toBeNull();
  });

  it("puts active runs in one Moving tile with the longest time without a change and the held ones, and finished runs in one line", async () => {
    api();
    render(renderAt("operator", <Dashboard />));
    await screen.findByRole("link", { name: /^Needs attention: 4 runs/ });
    const moving = tile("active");
    expect(moving?.tagName).toBe("DIV");
    expect(moving?.querySelector(".stat__value")?.textContent).toBe("3");
    expect(lines("active")).toEqual(["longest without a change: 9 min", "includes 1 held"]);
    expect(screen.getByTestId("finished-line").textContent).toBe("87 succeeded, 6 rejected, 4 cancelled (all time).");
    // No header button any more: the approvals tile replaces it.
    expect(screen.queryByRole("link", { name: /^Pending approvals/ })?.classList.contains("btn") ?? false).toBe(false);
  });

  it("says plainly when nothing needs a person", async () => {
    api({}, metricsSummary({ approvals: { pending: 0, decidableByYou: null, soonestExpiry: null } }));
    render(renderAt("operator", <Dashboard />));
    expect(await screen.findByRole("link", { name: "Needs attention: 0 runs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pending approvals: 0, approvers and admins decide these" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Held by a disabled role: 0 runs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Paused: 0 runs" })).toBeTruthy();
    expect(lines("needs_attention")).toEqual(["none right now"]);
    expect(lines("held")).toEqual(["No runs are held"]);
    expect(lines("paused")).toEqual(["none paused"]);
    expect(lines("active")).toEqual(["nothing is moving"]);
  });
});
