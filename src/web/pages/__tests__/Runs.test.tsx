import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, pending, reply, stubApi } from "../../components/__tests__/api.ts";
import { renderAt } from "../../components/__tests__/session.tsx";
import { Runs } from "../Runs.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ZOD = '✖ Invalid option: expected one of "queued"|"planning"|"running"\n  → at status';

describe("Runs errors", { tags: ["ui"] }, () => {
  it("answers a rejected filter with a plain message and Clear filters, never the zod output", async () => {
    const api = stubApi(({ path }) => {
      if (path.startsWith("/api/runs?status=bogus")) return apiError(400, "invalid_request", ZOD);
      if (path.startsWith("/api/runs")) return reply({ items: [], nextCursor: null });
      return undefined;
    });
    render(renderAt("viewer", <Runs />, { url: "/runs?status=bogus", path: "/runs" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Some values were not accepted.");
    expect(document.body.textContent).not.toContain("Invalid option");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/runs"));
    await screen.findByText("No runs match.");
    expect(api.paths().at(-1)).toBe("/api/runs?limit=25");
  });

  it("shows loading lines, never 'No runs match.' or 'No matches.', while the list and the search are in flight", async () => {
    stubApi(() => pending());
    render(renderAt("viewer", <Runs />, { url: "/runs?q=Halia", path: "/runs" }));
    const statuses = (await screen.findAllByRole("status")).map((s) => s.textContent);
    expect(statuses).toEqual(expect.arrayContaining(["Loading runs...", "Searching..."]));
    expect(document.body.textContent).not.toContain("No runs match.");
    expect(document.body.textContent).not.toContain("No matches.");
  });
});
