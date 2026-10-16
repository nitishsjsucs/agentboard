import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunDetailResponse } from "../../../shared/api-types.ts";
import { apiError, reply, stubApi } from "../../components/__tests__/api.ts";
import { auditEvent, runDetail, snapshot } from "../../components/__tests__/fixtures.ts";
import { renderAt } from "../../components/__tests__/session.tsx";
import { useRunLive } from "../../api/useRunLive.ts";
import { RunDetail } from "../RunDetail.tsx";

// The live WebSocket is replaced: these tests drive the page through its HTTP polls only.
vi.mock("../../api/useRunLive.ts", () => ({ useRunLive: vi.fn(() => ({ snapshot: null, connected: false })) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const RUN = "run_01J00000000000000000000000";

function serve(detail: RunDetailResponse) {
  return stubApi(({ path }) => {
    if (path === `/api/runs/${RUN}`) return reply(detail);
    if (path === `/api/runs/${RUN}/timeline`) return reply([]);
    if (path === `/api/runs/${RUN}/tool-calls`) return reply({ items: [], nextCursor: null });
    if (path === `/api/runs/${RUN}/audit`) return reply({ events: [], chain: { valid: true, brokenAtSeq: null } });
    return undefined;
  });
}

const page = (role: Parameters<typeof renderAt>[0] = "operator", url = `/runs/${RUN}`) => render(renderAt(role, <RunDetail />, { url, path: "/runs/:id" }));

describe("RunDetail layout", { tags: ["ui"] }, () => {
  it("lays out with the run-layout class instead of an inline grid, and puts Recovery first when the run needs attention", async () => {
    serve(runDetail({ status: "needs_attention" }));
    page();
    await screen.findByRole("heading", { level: 1 });
    const layout = screen.getByTestId("run-layout");
    expect(layout.classList.contains("run-layout")).toBe(true);
    expect(layout.style.gridTemplateColumns).toBe("");
    expect(layout.classList.contains("run-layout--recovery-first")).toBe(true);
  });

  it("keeps Recovery after the tabs for a run that succeeded", async () => {
    serve(runDetail({ status: "succeeded", statusReason: null }));
    page();
    await screen.findByRole("heading", { level: 1 });
    const layout = screen.getByTestId("run-layout");
    expect(layout.classList.contains("run-layout")).toBe(true);
    expect(layout.classList.contains("run-layout--recovery-first")).toBe(false);
  });
});

describe("RunDetail errors", { tags: ["ui"] }, () => {
  it("says which run id was not found and links to the run list and a history search, instead of the server's message", async () => {
    stubApi(({ path }) => (path.startsWith("/api/runs/run_missing") ? apiError(404, "not_found", "no such run") : undefined));
    page("operator", "/runs/run_missing");
    expect(await screen.findByText("No run with id run_missing.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse all runs" }).getAttribute("href")).toBe("/runs");
    expect(screen.getByRole("link", { name: "search the history for it" }).getAttribute("href")).toBe("/runs?q=run_missing");
    expect(document.body.textContent).not.toContain("no such run");
  });
});

describe("RunDetail tab loading", { tags: ["ui"] }, () => {
  it("shows loading lines in the Tool calls and Audit tabs while their first fetch is in flight, then rows or the empty state", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    stubApi(async ({ path }) => {
      if (path === `/api/runs/${RUN}`) return reply(runDetail());
      if (path === `/api/runs/${RUN}/timeline`) return reply([]);
      if (path === `/api/runs/${RUN}/tool-calls`) {
        await gate;
        return reply({ items: [], nextCursor: null });
      }
      if (path === `/api/runs/${RUN}/audit`) {
        await gate;
        return reply({ events: [auditEvent()], chain: { valid: true, brokenAtSeq: null } });
      }
      return undefined;
    });
    page();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("tab", { name: "Tool calls" }));
    expect((await screen.findByText("Loading tool calls...")).getAttribute("role")).toBe("status");
    expect(document.body.textContent).not.toContain("No tool calls yet.");
    fireEvent.click(screen.getByRole("tab", { name: "Audit" }));
    expect((await screen.findByText("Loading audit events...")).getAttribute("role")).toBe("status");
    expect(document.body.textContent).not.toContain("No audit events yet.");

    release?.();
    expect(await screen.findByText("Hash chain verified: 1 events, each linked to the previous one by SHA-256.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Tool calls" }));
    expect(await screen.findByText("No tool calls yet.")).toBeTruthy();
  });
});

describe("RunDetail next step", { tags: ["ui"] }, () => {
  it("explains why the run needs attention and keeps the raw statusReason and lastError codes visible", async () => {
    serve(runDetail());
    page("operator");
    expect((await screen.findByTestId("next-step")).textContent).toContain("The verifier found that the write of step s2 (hris.update_address) did not take effect.");
    expect(screen.getByText("task_failed:postcondition_failed")).toBeTruthy();
    expect(screen.getByTestId("last-error").textContent).toContain("postcondition_failed");
  });
});

describe("RunDetail keyboard and screen readers", { tags: ["ui"] }, () => {
  afterEach(() => {
    vi.mocked(useRunLive).mockReturnValue({ snapshot: null, connected: false });
  });

  it("opens the tab named by ?tab=, falls back to the timeline for an unknown one, and writes ?tab= on arrow keys", async () => {
    serve(runDetail());
    const view = page("operator", `/runs/${RUN}?tab=audit`);
    await screen.findByRole("heading", { level: 1 });
    const audit = screen.getByRole("tab", { name: "Audit" });
    expect(audit.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Audit" })).toBeTruthy();
    expect(await screen.findByText(/Hash chain verified/)).toBeTruthy();
    view.unmount();

    page("operator", `/runs/${RUN}?tab=bogus`);
    await screen.findByRole("heading", { level: 1 });
    const timeline = screen.getByRole("tab", { name: "Timeline" });
    expect(timeline.getAttribute("aria-selected")).toBe("true");
    timeline.focus();
    fireEvent.keyDown(timeline, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Tool calls" }));
    expect(screen.getByTestId("location").textContent).toBe(`/runs/${RUN}?tab=calls`);
    expect(screen.getByRole("tabpanel", { name: "Tool calls" })).toBeTruthy();
  });

  it("gives the Events table column headers", async () => {
    stubApi(({ path }) => {
      if (path === `/api/runs/${RUN}`) return reply(runDetail());
      if (path === `/api/runs/${RUN}/timeline`) return reply([{ seq: 1, ts: "2026-10-08T12:00:00.000Z", action: "run.created", actorType: "user", actorId: "ops.lead@agentboard.test", taskId: null, summary: "run created" }]);
      return undefined;
    });
    page();
    await screen.findByText("run created");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Seq", "Time", "Actor", "Event"]);
  });

  it("announces a status change pushed after the page loaded, but not the first status", async () => {
    serve(runDetail());
    vi.mocked(useRunLive).mockReturnValue({ snapshot: snapshot({ status: "running", statusReason: null, version: 3 }), connected: true });
    const view = page();
    await screen.findByRole("heading", { level: 1 });
    const announcer = screen.getByTestId("status-announcer");
    expect(announcer.getAttribute("role")).toBe("status");
    expect(announcer.textContent).toBe("");
    vi.mocked(useRunLive).mockReturnValue({ snapshot: snapshot({ status: "awaiting_approval", statusReason: null, version: 4 }), connected: true });
    view.rerender(renderAt("operator", <RunDetail />, { url: `/runs/${RUN}`, path: "/runs/:id" }));
    await waitFor(() => expect(announcer.textContent).toBe("Status: awaiting approval"));
  });

  it("sets the document title to the run's title", async () => {
    serve(runDetail());
    page();
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(document.title).toBe("Run: Address change for Halia Elsworth (E-1048) | AgentBoard"));
  });
});

describe("RunDetail for viewers", { tags: ["ui"] }, () => {
  it("tells a viewer the request text is hidden for their role, and shows operators the text with no notice", async () => {
    serve(runDetail({ requestText: null }));
    const viewer = page("viewer");
    expect((await screen.findByTestId("request-hidden")).textContent).toBe("Request text is hidden for your role (it needs personal-data access).");
    viewer.unmount();
    vi.unstubAllGlobals();

    serve(runDetail());
    page("operator");
    expect(await screen.findByText("Please update the home address for E-1048 to 12 Elm Street, Austin.")).toBeTruthy();
    expect(screen.queryByTestId("request-hidden")).toBeNull();
  });
});
