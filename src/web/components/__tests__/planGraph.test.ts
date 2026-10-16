import { describe, expect, it } from "vitest";
import type { TaskView } from "../../../shared/api-types.ts";
import { buildPlanGraph, dependentsOf, listSteps, planSummary, stepState } from "../planGraph.ts";
import { task } from "./fixtures.ts";
import { addressChange, offboardingGated } from "./planFixtures.ts";

const x = (status: TaskView["status"], extra: Partial<TaskView> = {}) => task({ id: "x", kind: "execute", stepId: "s2", tool: "hris.update_address", status, ...extra });
const v = (status: TaskView["status"], extra: Partial<TaskView> = {}) => task({ id: "v", kind: "verify", stepId: "s2", tool: "hris.update_address", status, dependsOn: ["x"], ...extra });

describe("buildPlanGraph", { tags: ["ui"] }, () => {
  it("folds each step's execute and verify task into one node, maps dependsOn task ids to steps and drops self and duplicate edges", () => {
    const graph = buildPlanGraph(offboardingGated());
    expect(graph.plan?.id).toBe("tsk_plan");
    expect(graph.nodes.map((n) => n.stepId)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    const s2 = graph.nodes.find((n) => n.stepId === "s2");
    expect([s2?.execute.id, s2?.verify?.id, s2?.write, s2?.gated]).toEqual(["tsk_x2", "tsk_v2", true, true]);
    expect(graph.nodes.find((n) => n.stepId === "s1")).toMatchObject({ write: false, verify: null, gated: false });
    // s2's verify task depends on its own execute task: no s2 -> s2 edge.
    expect(graph.edges).toEqual([
      { from: "s1", to: "s2" },
      { from: "s2", to: "s3" },
      { from: "s2", to: "s4" },
      { from: "s2", to: "s5" },
    ]);
    const dup = offboardingGated({}, { tsk_x3: { dependsOn: ["tsk_v2", "tsk_x2", "tsk_v2"] } });
    expect(buildPlanGraph(dup).edges.filter((e) => e.to === "s3")).toEqual([{ from: "s2", to: "s3" }]);
  });

  it("places the gating fixture in three columns (s1; s2; s3 to s5) with rows inside each column", () => {
    const graph = buildPlanGraph(offboardingGated());
    expect(graph.nodes.map((n) => [n.stepId, n.depth, n.row])).toEqual([
      ["s1", 0, 0],
      ["s2", 1, 0],
      ["s3", 2, 0],
      ["s4", 2, 1],
      ["s5", 2, 2],
    ]);
    expect(graph.nodes.find((n) => n.stepId === "s4")?.after).toEqual(["s2"]);
  });

  it("orders a linear address change by depth, and steps numerically (s10 after s9) inside a column", () => {
    expect(buildPlanGraph(addressChange()).nodes.map((n) => [n.stepId, n.depth])).toEqual([
      ["s1", 0],
      ["s2", 1],
      ["s3", 2],
    ]);
    const wide = [
      task({ id: "p", kind: "plan", status: "succeeded" }),
      task({ id: "a", kind: "execute", stepId: "s10", tool: "notify.send" }),
      task({ id: "b", kind: "execute", stepId: "s9", tool: "hris.get_employee" }),
    ];
    expect(buildPlanGraph(wide).nodes.map((n) => [n.stepId, n.depth, n.row])).toEqual([
      ["s9", 0, 0],
      ["s10", 0, 1],
    ]);
  });

  it("uses the longest path for depth", () => {
    // s3 depends on s1 and on s2, which depends on s1: s3 sits in column 2, not 1.
    const tasks = [
      task({ id: "x1", kind: "execute", stepId: "s1", tool: "hris.get_employee" }),
      task({ id: "x2", kind: "execute", stepId: "s2", tool: "access.list_roles", dependsOn: ["x1"] }),
      task({ id: "x3", kind: "execute", stepId: "s3", tool: "notify.send", dependsOn: ["x1", "x2"] }),
    ];
    expect(buildPlanGraph(tasks).nodes.map((n) => n.depth)).toEqual([0, 1, 2]);
  });

  it("has no nodes and no plan before planning", () => {
    expect(buildPlanGraph([])).toEqual({ plan: null, nodes: [], edges: [], blocker: null, extraBlockers: 0 });
  });
});

describe("stepState precedence", { tags: ["ui"] }, () => {
  const cases: [string, TaskView, TaskView | null, string, string][] = [
    ["a failed execute task", x("failed"), v("pending"), "failed", "failed"],
    ["a failed verify task", x("succeeded"), v("failed"), "verification_failed", "verification failed"],
    ["failed beats dead-lettered", x("failed"), v("dead_lettered"), "failed", "failed"],
    ["dead-lettered", x("dead_lettered"), v("pending"), "dead_lettered", "dead-lettered"],
    ["out of budget", x("budget_blocked"), v("pending"), "out_of_budget", "out of budget"],
    ["dead-lettered beats out of budget", x("budget_blocked"), v("dead_lettered"), "dead_lettered", "dead-lettered"],
    ["held by a disabled role (named)", x("held", { holdReason: "role_disabled" }), v("pending"), "held", "held: executor role disabled"],
    ["held verify task names the verifier", x("succeeded"), v("held", { holdReason: "role_disabled" }), "held", "held: verifier role disabled"],
    ["held at a checkpoint", x("held", { holdReason: "checkpoint" }), v("pending"), "held", "held at checkpoint"],
    ["out of budget beats held", x("held", { holdReason: "role_disabled" }), v("budget_blocked"), "out_of_budget", "out of budget"],
    ["rejected", x("rejected"), v("cancelled"), "rejected", "rejected"],
    ["waiting for approval", x("awaiting_approval"), v("pending"), "awaiting_approval", "waiting for approval"],
    ["in progress", x("leased"), v("pending"), "in_progress", "in progress"],
    ["verifying while the verify task is leased", x("succeeded"), v("leased"), "verifying", "verifying"],
    ["ready to run", x("ready"), v("pending"), "ready", "ready to run"],
    ["verifying while the verify task is ready after the write", x("succeeded"), v("ready"), "verifying", "verifying"],
    ["cancelled", x("cancelled"), v("cancelled"), "cancelled", "cancelled"],
    ["skipped", x("skipped"), v("skipped"), "skipped", "skipped"],
    ["skipped verification of a finished write", x("succeeded"), v("skipped"), "skipped", "skipped"],
    ["done", x("succeeded"), v("succeeded"), "done", "done"],
    ["a read that succeeded", x("succeeded"), null, "done", "done"],
    ["verifying while the verify task is pending after the write", x("succeeded"), v("pending"), "verifying", "verifying"],
    ["not started", x("pending"), v("pending"), "not_started", "not started"],
  ];
  it.each(cases)("%s", (_name, execute, verify, state, word) => {
    expect(stepState(execute, verify)).toEqual({ state, word });
  });
});

describe("blocker", { tags: ["ui"] }, () => {
  it("is the gated step while it waits for approval", () => {
    const graph = buildPlanGraph(offboardingGated());
    expect(graph.blocker?.stepId).toBe("s2");
    expect(graph.extraBlockers).toBe(0);
  });

  it.each([
    ["held", { tsk_x2: "held" as const }, { tsk_x2: { holdReason: "role_disabled" as const } }],
    ["out of budget", { tsk_x2: "budget_blocked" as const }, {}],
    ["failed", { tsk_x2: "failed" as const }, {}],
    ["verification failed", { tsk_x2: "succeeded" as const, tsk_v2: "failed" as const }, {}],
    ["dead-lettered", { tsk_x2: "dead_lettered" as const }, {}],
    ["rejected", { tsk_x2: "rejected" as const }, {}],
  ])("is the first blocking step in topological order when it is %s", (_name, status, extra) => {
    const graph = buildPlanGraph(offboardingGated(status, extra));
    expect(graph.blocker?.stepId).toBe("s2");
  });

  it("counts the other blocking steps, and has none for a moving or finished run", () => {
    const two = buildPlanGraph(offboardingGated({ tsk_x2: "succeeded", tsk_v2: "succeeded", tsk_x3: "failed", tsk_x4: "budget_blocked", tsk_x5: "dead_lettered" }));
    expect([two.blocker?.stepId, two.extraBlockers]).toEqual(["s3", 2]);
    expect(buildPlanGraph(addressChange({ a_x3: "leased" })).blocker).toBeNull();
    expect(buildPlanGraph(addressChange({ a_x3: "succeeded", a_v3: "succeeded" })).blocker).toBeNull();
  });
});

describe("dependentsOf", { tags: ["ui"] }, () => {
  it("returns every step that waits for a step, directly or transitively, in topological order", () => {
    const gated = buildPlanGraph(offboardingGated());
    expect(dependentsOf(gated, "s2").map((n) => n.stepId)).toEqual(["s3", "s4", "s5"]);
    expect(dependentsOf(gated, "s1").map((n) => n.stepId)).toEqual(["s2", "s3", "s4", "s5"]);
    expect(dependentsOf(gated, "s5")).toEqual([]);
    const linear = buildPlanGraph(addressChange());
    expect(dependentsOf(linear, "s1").map((n) => n.stepId)).toEqual(["s2", "s3"]);
  });
});

describe("words", { tags: ["ui"] }, () => {
  it("lists steps and summarizes states in a fixed order", () => {
    expect(listSteps(["s3"])).toBe("s3");
    expect(listSteps(["s3", "s4"])).toBe("s3 and s4");
    expect(listSteps(["s3", "s4", "s5"])).toBe("s3, s4 and s5");
    expect(planSummary(buildPlanGraph(offboardingGated()).nodes)).toBe("5 steps: 1 done, 1 waiting for approval, 3 not started.");
    expect(planSummary(buildPlanGraph(offboardingGated({ tsk_x2: "succeeded", tsk_v2: "succeeded" })).nodes)).toBe("5 steps: 2 done, 3 not started.");
    expect(planSummary([])).toBe("0 steps.");
  });
});
