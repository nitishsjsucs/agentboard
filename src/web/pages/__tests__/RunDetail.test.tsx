import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunDetailResponse } from "../../../shared/api-types.ts";
import { apiError, reply, stubApi } from "../../components/__tests__/api.ts";
import { auditEvent, runDetail } from "../../components/__tests__/fixtures.ts";
import { renderAt } from "../../components/__tests__/session.tsx";
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
