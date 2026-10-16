import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../../../src/shared/api-types.ts";
import { distinctRuns, driveAgents, inputFromDataset } from "../../helpers/agents.ts";
import { apiGet, apiPost, json } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import { events, readState, startManualRun } from "../../helpers/runs.ts";
import { timelineFields, timelineSummary } from "../../../src/worker/api/routes/timeline.ts";

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

describe("timeline fields", { tags: ["history"] }, () => {
  it("gives run.status_changed its from and to statuses only when each is a run status, and other actions nothing", () => {
    expect(timelineFields("run.status_changed", { from: "running", to: "awaiting_approval", reason: null })).toEqual({ statusFrom: "running", statusTo: "awaiting_approval" });
    expect(timelineFields("run.status_changed", { from: "needs_attention", to: "running", reason: "task_failed:timeout" })).toEqual({ statusFrom: "needs_attention", statusTo: "running" });
    // A forged or unknown value is dropped, field by field.
    expect(timelineFields("run.status_changed", { from: "<img src=x>", to: "succeeded" })).toEqual({ statusTo: "succeeded" });
    expect(timelineFields("run.status_changed", { from: "running", to: "E-1048 Halia Elsworth" })).toEqual({ statusFrom: "running" });
    expect(timelineFields("run.status_changed", { from: 3, to: ["paused"] })).toEqual({});
    expect(timelineFields("run.paused", { from: "running", to: "paused" })).toEqual({});
    expect(timelineFields("task.failed", { code: "timeout" })).toEqual({});
  });
});

describe("timeline status fields from a driven run", { tags: ["history"] }, () => {
  it("a viewer's timeline carries statusFrom and statusTo on each run.status_changed, matching the coordinator's transitions, and nothing on other entries", async () => {
    const [manager] = distinctRuns("manager_change", 1);
    if (!manager) throw new Error("no manager change");
    const started = await startManualRun(inputFromDataset(manager, { requester: P.operator }));
    await driveAgents(started.stub);
    const approval = [...(await readState(started.stub)).approvals.values()][0];
    if (!approval) throw new Error("no approval");
    expect((await apiPost(P.approver, `/api/approvals/${approval.id}/decision`, { decision: "approve", note: "checked" })).status).toBe(200);
    await driveAgents(started.stub);
    expect((await readState(started.stub)).run.status).toBe("succeeded");

    const transitions = (await events(started.stub)).filter((e) => e.action === "run.status_changed").map((e) => [e.detail["from"], e.detail["to"]]);
    expect(transitions).toEqual([
      ["queued", "planning"],
      ["planning", "running"],
      ["running", "awaiting_approval"],
      ["awaiting_approval", "running"],
      ["running", "succeeded"],
    ]);
    const timeline = await json<TimelineEntry[]>(await apiGet(P.viewer, `/api/runs/${started.runId}/timeline`));
    const changes = timeline.filter((e) => e.action === "run.status_changed");
    expect(changes.map((e) => [e.statusFrom, e.statusTo])).toEqual(transitions);
    expect(changes.map((e) => e.summary)).toEqual(transitions.map(([from, to]) => `status ${String(from)} to ${String(to)}`));
    for (const entry of timeline.filter((e) => e.action !== "run.status_changed")) {
      expect(Object.keys(entry).sort()).toEqual(["action", "actorId", "actorType", "seq", "summary", "taskId", "ts"]);
    }
  });
});
