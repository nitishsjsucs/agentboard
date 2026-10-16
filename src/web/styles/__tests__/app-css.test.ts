import { describe, expect, it } from "vitest";
import css from "../app.css?raw";

/** Every declaration block for `selector` in app.css, joined (a selector may appear in more than one rule). */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rules = [...css.matchAll(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`, "gm"))];
  return rules.map((rule) => rule[1] ?? "").join(";");
}

describe("app.css layout rules", { tags: ["ui"] }, () => {
  it("keeps a dialog within the viewport height and scrolls it inside, so its buttons stay reachable on short screens", () => {
    const dialog = declarations(".dialog");
    expect(dialog).toMatch(/max-height:\s*calc\(100dvh - 2 \* var\(--space-4\)\)/);
    expect(dialog).toMatch(/overflow-y:\s*auto/);
    // The backdrop's padding is what the max-height leaves room for.
    expect(declarations(".dialog-backdrop")).toMatch(/padding:\s*var\(--space-4\)/);
  });

  it("draws the nav link focus ring inside the link, where the sideways-scrolling link row cannot clip it", () => {
    expect(declarations(".nav__links")).toMatch(/overflow-x:\s*auto/);
    expect(declarations(".nav__link:focus-visible")).toMatch(/outline-offset:\s*-2px/);
  });
});
