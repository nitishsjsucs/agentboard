import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskView } from "../../../shared/api-types.ts";
import type { RunStatus } from "../../../shared/domain.ts";
import { COL_PITCH, NODE_H, NODE_W, PlanMap, ROW_PITCH } from "../PlanMap.tsx";
import { TaskTimeline } from "../TaskTimeline.tsx";
import { task } from "./fixtures.ts";
import { addressChange, offboardingGated, offboardingLinear } from "./planFixtures.ts";
import { withSession } from "./session.tsx";

afterEach(cleanup);

const show = (tasks: TaskView[], status: RunStatus = "awaiting_approval") => render(withSession("viewer", <PlanMap tasks={tasks} status={status} />));
const names = () => screen.getAllByTestId("plan-node").map((n) => n.getAttribute("aria-label"));
const sentence = () => screen.queryByTestId("plan-blocker")?.textContent ?? null;

type Point = [number, number];

/** Points along an SVG path made of absolute M, L, Q and C commands (the only ones the plan map writes). */
function samplePath(d: string, steps = 40): Point[] {
  const tokens = d.match(/[MLQC]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: Point[] = [];
  let at: Point = [0, 0];
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === "M") {
      at = [num(), num()];
      points.push(at);
      continue;
    }
    const control: Point[] = [];
    const count = command === "L" ? 1 : command === "Q" ? 2 : 3;
    for (let k = 0; k < count; k++) control.push([num(), num()]);
    const pts = [at, ...control];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      // De Casteljau on the segment's control points.
      let layer = pts;
      while (layer.length > 1) layer = layer.slice(1).map((p, k) => [p[0] * t + (layer[k] as Point)[0] * (1 - t), p[1] * t + (layer[k] as Point)[1] * (1 - t)] as Point);
      points.push(layer[0] as Point);
    }
    at = control.at(-1) as Point;
  }
  return points;
}

/** Each step's box in the canvas, from its --col and --row. */
function boxes(): Map<string, { x: number; y: number }> {
  return new Map(
    [...document.querySelectorAll<HTMLElement>(".plan-map__item")].map((li) => [
      li.dataset["step"] ?? "",
      { x: Number(li.style.getPropertyValue("--col")) * COL_PITCH, y: Number(li.style.getPropertyValue("--row")) * ROW_PITCH },
    ]),
  );
}

/** For every connector, the steps (other than its own two) that one of its points falls inside. */
function crossings(): Record<string, string[]> {
  const all = boxes();
  const result: Record<string, string[]> = {};
  for (const path of screen.getByTestId("plan-edges").querySelectorAll<SVGPathElement>("path[data-edge]")) {
    const edge = path.getAttribute("data-edge") ?? "";
    const [from, to] = edge.split("-");
    const hit = new Set<string>();
    for (const [x, y] of samplePath(path.getAttribute("d") ?? "")) {
      for (const [step, box] of all) {
        if (step === from || step === to) continue;
        if (x > box.x && x < box.x + NODE_W && y > box.y && y < box.y + NODE_H) hit.add(step);
      }
    }
    result[edge] = [...hit];
  }
  return result;
}

/** A plan of read steps with the given step dependencies (no verify tasks), for layout tests. */
function plan(steps: [string, string[]][]): TaskView[] {
  return [
    task({ id: "p", kind: "plan", status: "succeeded", attempts: 1 }),
    ...steps.map(([stepId, deps]) => task({ id: `x_${stepId}`, kind: "execute", stepId, tool: "hris.get_employee", dependsOn: deps.map((d) => `x_${d}`), status: "succeeded", attempts: 1 })),
  ];
}

describe("PlanMap", { tags: ["ui"] }, () => {
  it("is a figure named 'Plan map' with a summary sentence, and one node per step (no verify nodes)", () => {
    show(offboardingGated());
    const figure = screen.getByRole("figure", { name: "Plan map" });
    expect(figure.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByTestId("plan-summary").textContent).toBe("5 steps: 1 done, 1 waiting for approval, 3 not started.");
    expect(screen.getByTestId("plan-line").textContent).toBe("Plan accepted");
    expect(screen.getAllByTestId("plan-node")).toHaveLength(5);
  });

  it("names each node by step, tool, read or write, approval, state and what it runs after", () => {
    show(offboardingGated());
    expect(names()).toEqual([
      "s1 hris.get_employee, read, done",
      "s2 hris.set_employment_status, write, needs approval, waiting for approval, blocking the run, runs after s1",
      "s3 access.revoke_all_roles, write, not started, runs after s2",
      "s4 itsm.create_ticket, write, not started, runs after s2",
      "s5 notify.send, write, not started, runs after s2",
    ]);
    // The state word is visible text in every node, so no state relies on colour.
    for (const node of screen.getAllByTestId("plan-node")) expect(node.querySelector(".plan-node__state")?.textContent).toMatch(/\w/);
    // The tool is truncated visually; its full name is in the title.
    expect(screen.getAllByTestId("plan-node")[1]?.querySelector(".plan-node__tool")?.getAttribute("title")).toBe("hris.set_employment_status");
  });

  it("positions nodes from --col and --row, and draws the connectors in an aria-hidden SVG", () => {
    show(offboardingGated());
    const items = [...document.querySelectorAll<HTMLElement>(".plan-map__item")];
    expect(items.map((li) => [li.dataset["step"], li.style.getPropertyValue("--col"), li.style.getPropertyValue("--row")])).toEqual([
      ["s1", "0", "0"],
      ["s2", "1", "0"],
      ["s3", "2", "0"],
      ["s4", "2", "1"],
      ["s5", "2", "2"],
    ]);
    const canvas = document.querySelector<HTMLElement>(".plan-map__canvas");
    expect([canvas?.style.getPropertyValue("--cols"), canvas?.style.getPropertyValue("--rows")]).toEqual(["3", "3"]);
    const edges = screen.getByTestId("plan-edges");
    expect(edges.getAttribute("aria-hidden")).toBe("true");
    expect(edges.querySelectorAll("path[data-edge]")).toHaveLength(4);
  });

  it("arcs a gating edge that skips over steps from the source's top edge to the target's, above the row, and leaves room for it", () => {
    show(offboardingLinear());
    expect(names().slice(3)).toEqual(["s4 itsm.create_ticket, write, not started, runs after s2 and s3", "s5 notify.send, write, not started, runs after s2 and s4"]);
    const canvas = document.querySelector<HTMLElement>(".plan-map__canvas");
    expect(canvas?.style.getPropertyValue("--cols")).toBe("5");
    const pad = Number.parseInt(canvas?.style.getPropertyValue("--arc-pad") ?? "0", 10);
    const edges = screen.getByTestId("plan-edges");
    const d = (edge: string) => edges.querySelector(`path[data-edge="${edge}"]`)?.getAttribute("d") ?? "";
    expect([...edges.querySelectorAll("path[data-edge]")].map((p) => p.getAttribute("data-edge"))).toEqual(["s1-s2", "s2-s3", "s2-s4", "s3-s4", "s2-s5", "s4-s5"]);
    // s2 -> s4 leaves s2's top edge near its right side and lands on s4's top edge near its left side; s2 -> s5 the same, one lane higher.
    const s2Right = 1 * COL_PITCH + NODE_W;
    const ends = (edge: string) => [samplePath(d(edge))[0], samplePath(d(edge)).at(-1)];
    expect(ends("s2-s4")).toEqual([
      [s2Right - 16, 0],
      [3 * COL_PITCH + 16, 0],
    ]);
    expect(ends("s2-s5")).toEqual([
      [s2Right - 16, 0],
      [4 * COL_PITCH + 16, 0],
    ]);
    const peak = (edge: string) => Math.min(...samplePath(d(edge), 200).map(([, y]) => y));
    expect(peak("s2-s4")).toBeLessThan(-12);
    expect(peak("s2-s5")).toBeLessThan(peak("s2-s4"));
    // The pad above the row holds the highest arc.
    expect(pad).toBeGreaterThanOrEqual(-peak("s2-s5"));
    // No connector passes behind a step that is neither its source nor its target (before: both arcs crossed s3).
    expect(crossings()).toEqual({ "s1-s2": [], "s2-s3": [], "s2-s4": [], "s3-s4": [], "s2-s5": [], "s4-s5": [] });
  });

  it("routes an edge that skips columns outside the first row through the gaps between steps", () => {
    // Depth 0: s1. Depth 1: s2, s3. Depth 2: s4 (after s2), s6 (after s3). Depth 3: s5 (after s4 and s1), s7 (after s3 and s4).
    show(plan([["s1", []], ["s2", ["s1"]], ["s3", ["s1"]], ["s4", ["s2"]], ["s5", ["s4", "s1"]], ["s6", ["s3"]], ["s7", ["s3", "s4"]]]), "succeeded");
    const at = (step: string) => {
      const li = document.querySelector<HTMLElement>(`.plan-map__item[data-step="${step}"]`);
      return [li?.style.getPropertyValue("--col"), li?.style.getPropertyValue("--row")];
    };
    expect(["s1", "s2", "s3", "s4", "s6", "s5", "s7"].map(at)).toEqual([
      ["0", "0"],
      ["1", "0"],
      ["1", "1"],
      ["2", "0"],
      ["2", "1"],
      ["3", "0"],
      ["3", "1"],
    ]);
    const hits = crossings();
    expect(Object.keys(hits).sort()).toEqual(["s1-s2", "s1-s3", "s1-s5", "s2-s4", "s3-s6", "s3-s7", "s4-s5", "s4-s7"]);
    // s1 -> s5 arcs over the first row; s3 -> s7 (row 1 to row 1) and the others never pass behind another step.
    for (const edge of Object.keys(hits)) expect([edge, hits[edge]]).toEqual([edge, []]);
  });

  it("ends every connector in an arrowhead at the step that waits", () => {
    show(offboardingLinear());
    const edges = screen.getByTestId("plan-edges");
    const marker = edges.querySelector("marker");
    expect(marker?.id).toBeTruthy();
    for (const path of edges.querySelectorAll("path[data-edge]")) expect(path.getAttribute("marker-end")).toBe(`url(#${marker?.id})`);
  });

  it("marks the step waiting for approval with the word 'blocking', and says who acts and what waits behind it", () => {
    show(offboardingGated());
    const blockers = document.querySelectorAll(".plan-node--blocker");
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.getAttribute("aria-label")).toBe("s2 hris.set_employment_status, write, needs approval, waiting for approval, blocking the run, runs after s1");
    // The word is visible text inside the blocking node only, so the mark does not rest on the ring's colour.
    expect(screen.getAllByTestId("plan-blocking").map((flag) => [flag.textContent, flag.closest("[data-step]")?.getAttribute("data-step")])).toEqual([["blocking", "s2"]]);
    expect(blockers[0]?.classList.contains("plan-node--warning")).toBe(true);
    expect(sentence()).toBe("Blocked at s2 hris.set_employment_status: waiting for an approver. s3, s4 and s5 run after it.");
  });

  it("draws no unexplained marks: a node shows its id, read or write, the approval lock, its tool and its state in words", () => {
    show(offboardingGated({ tsk_x2: "succeeded", tsk_v2: "budget_blocked" }), "needs_attention");
    const s2 = screen.getAllByTestId("plan-node")[1] as HTMLElement;
    expect(s2.querySelector(".plan-node__head")?.textContent).toBe("s2writeblocking");
    expect(s2.querySelector(".plan-node__state")?.textContent).toBe("out of budget");
    // The write and verify pips are gone; the task list below has each task's status in words.
    expect(document.querySelectorAll(".plan-pip, .plan-node__pips")).toHaveLength(0);
  });

  it.each([
    ["held", { tsk_x2: "held" as const }, { tsk_x2: { holdReason: "role_disabled" as const } }, "Blocked at s2 hris.set_employment_status: held: executor role disabled. An admin can enable the executor role on the Dashboard."],
    ["out of budget", { tsk_x2: "budget_blocked" as const }, {}, "Blocked at s2 hris.set_employment_status: out of budget. An admin can raise the budget."],
    [
      "failed",
      { tsk_x2: "failed" as const },
      { tsk_x2: { lastError: "permanent_error" } },
      "Blocked at s2 hris.set_employment_status: failed: the tool refused the call, so retrying it unchanged will fail again. An operator or an admin can retry it.",
    ],
    [
      "verification failed",
      { tsk_x2: "succeeded" as const, tsk_v2: "failed" as const },
      { tsk_v2: { lastError: "postcondition_failed" } },
      "Blocked at s2 hris.set_employment_status: verification failed: the verifier read the record back and the write had not taken effect. An operator or an admin can retry s2 execute to run the write again.",
    ],
    ["dead-lettered", { tsk_x2: "dead_lettered" as const }, {}, "Blocked at s2 hris.set_employment_status: dead-lettered after its queue deliveries ran out. An operator or an admin can retry it."],
    ["rejected by expiry", { tsk_x2: "rejected" as const }, {}, "Blocked at s2 hris.set_employment_status: the approval expired. An operator or an admin can retry it to request a new approval."],
  ])("names who acts when the blocking step is %s", (_name, status, extra, expected) => {
    show(offboardingGated(status, extra), "needs_attention");
    expect(sentence()).toBe(expected);
    expect(document.querySelector(".plan-node--blocker")?.getAttribute("aria-label")).toMatch(/^s2 /);
  });

  it("adds how many more steps are blocked", () => {
    show(offboardingGated({ tsk_x2: "succeeded", tsk_v2: "succeeded", tsk_x3: "failed", tsk_x4: "budget_blocked", tsk_x5: "dead_lettered" }), "needs_attention");
    expect(sentence()).toMatch(/^Blocked at s3 access\.revoke_all_roles: failed: .* 2 more steps are blocked\.$/);
  });

  it("shows the planning line and no nodes while the run is queued or planning", () => {
    for (const status of ["queued", "planning"] as const) {
      const view = show([task({ id: "p", kind: "plan", status: status === "queued" ? "ready" : "leased" })], status);
      expect(screen.getByTestId("plan-line").textContent).toBe("Planning: the steps appear when the plan is accepted.");
      expect(screen.queryAllByTestId("plan-node")).toHaveLength(0);
      expect(screen.queryByTestId("plan-summary")).toBeNull();
      view.unmount();
    }
  });

  it("says why a plan was rejected or failed, with the readable sentence, and shows no nodes", () => {
    const rejected = show([task({ id: "p", kind: "plan", status: "failed", lastError: "plan_invalid" })], "needs_attention");
    expect(screen.getByTestId("plan-line").textContent).toBe("The plan was rejected: the plan did not pass validation, so no step was created.");
    expect(screen.queryAllByTestId("plan-node")).toHaveLength(0);
    rejected.unmount();
    show([task({ id: "p", kind: "plan", status: "failed", attempts: 3, lastError: "agent_exception" })], "needs_attention");
    expect(screen.getByTestId("plan-line").textContent).toBe("The planner failed on every attempt: the agent raised an error instead of finishing the task.");
  });

  it("names the generation of a retried plan, and the plan task when it is held", () => {
    const retried = show(addressChange().map((t) => (t.kind === "plan" ? { ...t, generation: 1 } : t)), "running");
    expect(screen.getByTestId("plan-line").textContent).toBe("Plan accepted, generation 1");
    retried.unmount();
    show([task({ id: "p", kind: "plan", status: "held", holdReason: "role_disabled" })], "queued");
    expect(sentence()).toBe("Blocked at the plan task: held: planner role disabled. An admin can enable the planner role on the Dashboard.");
  });

  it("says a paused run starts nothing, a finished run is done, and a moving run has no sentence", () => {
    const paused = show(offboardingGated({ tsk_x2: "failed" }), "paused");
    expect(sentence()).toBe("Paused: no step starts until the run is resumed.");
    expect(document.querySelector(".plan-node--blocker")).toBeNull();
    expect(screen.queryByTestId("plan-blocking")).toBeNull();
    paused.unmount();
    const done = show(addressChange({ a_x3: "succeeded", a_v3: "succeeded" }), "succeeded");
    expect(sentence()).toBe("All steps done.");
    done.unmount();
    show(addressChange({ a_x3: "leased" }), "running");
    expect(sentence()).toBeNull();
    expect(names()[2]).toBe("s3 notify.send, write, in progress, runs after s2");
  });

  it("tells a rejected run which steps did not run", () => {
    show(offboardingGated({ tsk_x2: "rejected", tsk_v2: "cancelled", tsk_x3: "cancelled", tsk_v3: "cancelled", tsk_x4: "cancelled", tsk_v4: "cancelled", tsk_x5: "cancelled", tsk_v5: "cancelled" }), "rejected");
    expect(sentence()).toBe("Rejected at s2 hris.set_employment_status: an approver rejected this step, so the run ended. s3, s4 and s5 did not run.");
  });

  it("moves focus to the step's execute row when a node is activated", () => {
    const tasks = offboardingGated();
    render(
      withSession(
        "viewer",
        <>
          <PlanMap tasks={tasks} status="awaiting_approval" />
          <TaskTimeline tasks={tasks} />
        </>,
      ),
    );
    const s4 = screen.getByRole("button", { name: /^s4 itsm\.create_ticket/ });
    fireEvent.click(s4);
    expect(document.activeElement?.id).toBe("task-tsk_x4");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
    // Nodes are buttons, so Enter and Space activate them like a click.
    expect(s4.tagName).toBe("BUTTON");
    expect(within(screen.getByRole("figure", { name: "Plan map" })).getAllByRole("button")).toHaveLength(5);
  });
});
