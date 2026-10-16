import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskView } from "../../../shared/api-types.ts";
import type { RunStatus } from "../../../shared/domain.ts";
import { PlanMap } from "../PlanMap.tsx";
import { TaskTimeline } from "../TaskTimeline.tsx";
import { task } from "./fixtures.ts";
import { addressChange, offboardingGated, offboardingLinear } from "./planFixtures.ts";
import { withSession } from "./session.tsx";

afterEach(cleanup);

const show = (tasks: TaskView[], status: RunStatus = "awaiting_approval") => render(withSession("viewer", <PlanMap tasks={tasks} status={status} />));
const names = () => screen.getAllByTestId("plan-node").map((n) => n.getAttribute("aria-label"));
const sentence = () => screen.queryByTestId("plan-blocker")?.textContent ?? null;

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
      "s2 hris.set_employment_status, write, needs approval, waiting for approval, runs after s1",
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
    expect(edges.querySelectorAll("path")).toHaveLength(4);
  });

  it("arcs a gating edge that skips over steps above the first row, and leaves room for it", () => {
    show(offboardingLinear());
    expect(names().slice(3)).toEqual(["s4 itsm.create_ticket, write, not started, runs after s2 and s3", "s5 notify.send, write, not started, runs after s2 and s4"]);
    const canvas = document.querySelector<HTMLElement>(".plan-map__canvas");
    expect(canvas?.style.getPropertyValue("--cols")).toBe("5");
    expect(Number.parseInt(canvas?.style.getPropertyValue("--arc-pad") ?? "0", 10)).toBeGreaterThan(20);
    const paths = [...screen.getByTestId("plan-edges").querySelectorAll("path")].map((p) => p.getAttribute("d") ?? "");
    expect(paths).toHaveLength(6);
    // s2 -> s4 and s2 -> s5 bend above the row (negative control points); s3 -> s4 stays level.
    expect(paths.filter((d) => /C\d+ -\d+/.test(d))).toHaveLength(2);
  });

  it("rings the step waiting for approval and says who acts and what waits behind it", () => {
    show(offboardingGated());
    const blockers = document.querySelectorAll(".plan-node--blocker");
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.getAttribute("aria-label")).toMatch(/^s2 /);
    expect(sentence()).toBe("Blocked at s2 hris.set_employment_status: waiting for an approver. s3, s4 and s5 run after it.");
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
