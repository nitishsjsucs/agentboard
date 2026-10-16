import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetMeter } from "../BudgetMeter.tsx";

afterEach(cleanup);

const fill = (label: string) => screen.getByLabelText(label).querySelector(".meter__fill") as HTMLElement;

describe("BudgetMeter", { tags: ["ui"] }, () => {
  it("fills in proportion, warns from 80 percent, turns full at the limit without overflowing, and labels the values", () => {
    const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
    render(
      <>
        <BudgetMeter label="Tool calls" used={10} max={24} />
        <BudgetMeter label="LLM tokens" used={5000} max={6000} />
        <BudgetMeter label="Active time" used={960_000} max={900_000} format={seconds} />
      </>,
    );
    expect(fill("Tool calls: 10 of 24").className).toBe("meter__fill");
    expect(fill("Tool calls: 10 of 24").style.width).toBe("42%");
    expect(fill("LLM tokens: 5000 of 6000").className).toBe("meter__fill meter__fill--warn");
    expect(fill("Active time: 960 s of 900 s").className).toBe("meter__fill meter__fill--full");
    expect(fill("Active time: 960 s of 900 s").style.width).toBe("100%");
    expect(screen.getByText("960 s / 900 s")).toBeTruthy();
  });

  it("exposes role meter with its values, keeping aria-valuenow within the range and the real value in aria-valuetext", () => {
    render(
      <>
        <BudgetMeter label="Tool calls" used={10} max={24} />
        <BudgetMeter label="Active time (s)" used={960} max={900} />
      </>,
    );
    const [calls, time] = screen.getAllByRole("meter");
    expect(calls?.getAttribute("aria-label")).toBe("Tool calls: 10 of 24");
    expect([calls?.getAttribute("aria-valuemin"), calls?.getAttribute("aria-valuenow"), calls?.getAttribute("aria-valuemax")]).toEqual(["0", "10", "24"]);
    expect(time?.getAttribute("aria-valuenow")).toBe("900");
    expect(time?.getAttribute("aria-valuetext")).toBe("960 of 900");
  });
});
