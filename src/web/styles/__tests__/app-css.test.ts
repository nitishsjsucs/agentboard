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

  it("puts the plan line on the plan map caption's row when it fits, and keeps the node canvas on a full-width row of its own", () => {
    const figure = declarations(".plan-map__figure");
    expect(figure).toMatch(/flex-direction:\s*row/);
    expect(figure).toMatch(/flex-wrap:\s*wrap/);
    // The scroller's -6px margins on each side are added back, so it spans the figure exactly.
    expect(declarations(".plan-map__scroll")).toMatch(/flex:\s*0 0 calc\(100% \+ 12px\)/);
  });

  it("strokes plan map connectors and arrowheads with --text-faint, which keeps 3:1 against the card in both themes", () => {
    expect(declarations(".plan-map__edges path")).toMatch(/stroke:\s*var\(--text-faint\)/);
    expect(declarations(".plan-map__edges .plan-map__arrow path")).toMatch(/fill:\s*var\(--text-faint\)/);
  });
});
