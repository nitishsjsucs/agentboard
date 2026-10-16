import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reply, stubApi } from "../../components/__tests__/api.ts";
import { renderAt } from "../../components/__tests__/session.tsx";
import { Launch } from "../Launch.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EMPLOYEES = [
  { id: "E-1007", fullName: "Halia Elsworth", department: "Finance", employmentStatus: "active" },
  { id: "E-1017", fullName: "Rosalind Galloway", department: "Support", employmentStatus: "active" },
];

function serve() {
  return stubApi(({ path }) => {
    if (path === "/api/people/directory") return reply({ employees: EMPLOYEES });
    if (path === "/api/dev/samples") return reply({ samples: [] });
    if (path === "/api/agents") return reply({ roles: [] });
    return undefined;
  });
}

describe("Launch layout", { tags: ["ui"] }, () => {
  it("puts both field rows in form-two grids with no inline column template, so they stack on narrow screens", async () => {
    serve();
    render(renderAt("operator", <Launch />, { url: "/launch", path: "/launch" }));
    await screen.findByRole("option", { name: /Halia Elsworth/ });
    const typeRow = screen.getByLabelText("Request type").closest(".field")?.parentElement as HTMLElement;
    const priorityRow = screen.getByLabelText("Priority").closest(".field")?.parentElement as HTMLElement;
    for (const row of [typeRow, priorityRow]) {
      expect(row.classList.contains("form-two")).toBe(true);
      expect(row.style.gridTemplateColumns).toBe("");
    }
  });
});
