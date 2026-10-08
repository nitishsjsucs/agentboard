import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchHit } from "../../../shared/api-types.ts";
import { SearchResults, Snippet } from "../SearchResults.tsx";

afterEach(cleanup);

const hit = (snippet: string): SearchHit => ({
  runId: "run_01J00000000000000000000000",
  docType: "run",
  status: "succeeded",
  requestType: "address_change",
  snippet,
  score: 3.2,
  createdAt: "2026-10-01T00:00:00.000Z",
});

describe("SearchResults", { tags: ["ui"] }, () => {
  it("renders U+0002/U+0003 highlights as <mark> elements", () => {
    const { container } = render(
      <MemoryRouter>
        <SearchResults hits={[hit("Address change for \u0002Halia\u0003 \u0002Elsworth\u0003 (E-1048)")]} />
      </MemoryRouter>,
    );
    const marks = [...container.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual(["Halia", "Elsworth"]);
    expect(container.textContent).toContain("Address change for Halia Elsworth (E-1048)");
    expect(container.textContent).not.toContain("\u0002");
    expect(screen.getByRole("link", { name: "run_01J00000000000000000000000" })).toBeTruthy();
  });

  it("renders snippet text safely: markup in indexed text stays text and is never parsed as HTML", () => {
    const { container } = render(<Snippet text={"note \u0002<img src=x onerror=alert(1)>\u0003 and <b>bold</b> \u0002unterminated"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("note <img src=x onerror=alert(1)> and <b>bold</b> unterminated");
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["<img src=x onerror=alert(1)>", "unterminated"]);
  });
});
