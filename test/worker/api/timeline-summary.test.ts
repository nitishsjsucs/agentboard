import { describe, expect, it } from "vitest";
import { timelineSummary } from "../../../src/worker/api/routes/timeline.ts";

describe("timeline summaries", { tags: ["history"] }, () => {
  it("writes the past tense of both approval decisions", () => {
    expect(timelineSummary("approval.decided", { decision: "reject", note: "x" })).toBe("approval rejected: x");
    expect(timelineSummary("approval.decided", { decision: "approve", note: "x" })).toBe("approval approved: x");
  });

  it("lists a rejected plan's stored issue codes with their step ids", () => {
    expect(timelineSummary("plan.rejected", { issues: [{ code: "off_subject", stepId: "s2" }, { code: "missing_required_step", stepId: null }] })).toBe(
      "plan rejected by validation: off_subject (s2), missing_required_step",
    );
    expect(timelineSummary("plan.rejected", { issues: [{ code: "cycle", stepId: null }] })).toBe("plan rejected by validation: cycle");
    expect(timelineSummary("plan.rejected", { issues: [] })).toBe("plan rejected by validation");
    expect(timelineSummary("plan.rejected", {})).toBe("plan rejected by validation");
  });

  it("never puts policy text, planner messages or request data into a rejected plan's summary", () => {
    const summary = timelineSummary("plan.rejected", {
      issues: [
        { code: "off_subject", stepId: "s2", message: "employeeId must be the subject E-1048" },
        { code: "Halia Elsworth lives at 12 Elm Street", stepId: "s3" },
        { code: "tool_not_allowed", stepId: "<b>s4</b>" },
      ],
      policyViolations: [{ code: "off_subject", stepId: "s2", detail: "E-1048 Halia Elsworth, 12 Elm Street" }],
    });
    expect(summary).toBe("plan rejected by validation: off_subject (s2), tool_not_allowed");
    expect(summary).not.toMatch(/E-1048|Halia|Elm/);
  });
});
