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
});
