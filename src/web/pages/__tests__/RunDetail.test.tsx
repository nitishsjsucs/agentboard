import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunDetailResponse } from "../../../shared/api-types.ts";
import { reply, stubApi } from "../../components/__tests__/api.ts";
import { runDetail } from "../../components/__tests__/fixtures.ts";
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
