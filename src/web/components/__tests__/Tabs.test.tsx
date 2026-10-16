import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TabList, TabPanel } from "../Tabs.tsx";

afterEach(cleanup);

const TABS = [
  { key: "timeline", label: "Timeline" },
  { key: "calls", label: "Tool calls" },
  { key: "audit", label: "Audit" },
] as const;
type Key = (typeof TABS)[number]["key"];

function Harness() {
  const [selected, setSelected] = useState<Key>("timeline");
  return (
    <>
      <TabList id="t" label="Run details" tabs={TABS} selected={selected} onSelect={setSelected} />
      {TABS.map((tab) => (
        <TabPanel key={tab.key} id="t" tabKey={tab.key} selected={selected === tab.key}>
          {tab.label} content
        </TabPanel>
      ))}
    </>
  );
}

describe("Tabs", { tags: ["ui"] }, () => {
  it("wires tabs and panels with roles, aria-controls, aria-labelledby and a roving tabindex", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Run details" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel", { name: "Timeline" });
    expect(panel.id).toBe(tabs[0]?.getAttribute("aria-controls"));
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0]?.id);
    expect(panel.textContent).toBe("Timeline content");
    // The other panels exist (so aria-controls resolves) but are hidden and empty.
    const hidden = document.getElementById(tabs[1]?.getAttribute("aria-controls") ?? "");
    expect(hidden?.hidden).toBe(true);
    expect(hidden?.textContent).toBe("");
  });

  it("moves with ArrowRight, ArrowLeft, Home and End, selecting and focusing the tab, and wraps around", () => {
    render(<Harness />);
    const tab = (name: string) => screen.getByRole("tab", { name });
    tab("Timeline").focus();
    fireEvent.keyDown(tab("Timeline"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("Tool calls"));
    expect(tab("Tool calls").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Tool calls content");
    fireEvent.keyDown(tab("Tool calls"), { key: "End" });
    expect(document.activeElement).toBe(tab("Audit"));
    fireEvent.keyDown(tab("Audit"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("Timeline"));
    fireEvent.keyDown(tab("Timeline"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab("Audit"));
    fireEvent.keyDown(tab("Audit"), { key: "Home" });
    expect(document.activeElement).toBe(tab("Timeline"));
    expect(tab("Timeline").getAttribute("tabindex")).toBe("0");
    expect(tab("Audit").getAttribute("tabindex")).toBe("-1");
  });
});
