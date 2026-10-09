import { describe, expect, it } from "vitest";
import { argAccuracy, multisetF1, percentile, sequenceExact } from "./metrics.ts";

describe("evaluation math", { tags: ["eval"] }, () => {
  it("percentiles interpolate between closest ranks", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBeCloseTo(48);
    expect(percentile([5, 1, 3], 0)).toBe(1);
    expect(percentile([5, 1, 3], 100)).toBe(5);
  });

  it("F1 over tool multisets counts repeated tools once per occurrence", () => {
    expect(multisetF1(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(multisetF1(["a", "b"], ["a", "b", "c"])).toBeCloseTo(0.8);
    expect(multisetF1(["a", "a", "a"], ["a", "b"])).toBeCloseTo(0.4);
    expect(multisetF1([], ["a"])).toBe(0);
    expect(multisetF1([], [])).toBe(1);
  });

  it("exact match requires the same tools in the same order", () => {
    expect(sequenceExact(["a", "b"], ["a", "b"])).toBe(true);
    expect(sequenceExact(["b", "a"], ["a", "b"])).toBe(false);
    expect(sequenceExact(["a"], ["a", "b"])).toBe(false);
  });

  it("argument accuracy compares gold fields of steps matched by tool and position, after normalization", () => {
    const gold = [
      { tool: "hris.get_employee", args: { employeeId: "E-1014" } },
      { tool: "hris.update_address", args: { employeeId: "E-1014", address: { line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" } } },
      { tool: "notify.send", args: { employeeId: "E-1014", channel: "email", template: "address_updated" } },
    ];
    const predicted = [
      { tool: "hris.get_employee", args: { employeeId: "e-1014 " } },
      { tool: "hris.update_address", args: { employeeId: "E-1014", address: { line1: "1  main st", city: "Austin", region: "Texas", postalCode: "78701", country: "US" } } },
      { tool: "notify.send", args: { employeeId: "E-1014", channel: "slack", template: "address_updated" } },
    ];
    // Matched fields: 1 + 6 + 3 = 10; unequal: region, channel.
    expect(argAccuracy(predicted, gold)).toEqual({ matchedFields: 10, equalFields: 8 });
    // A step at the wrong position or with another tool is not matched at all.
    expect(argAccuracy([gold[2] as (typeof gold)[number]], gold)).toEqual({ matchedFields: 0, equalFields: 0 });
  });
});
