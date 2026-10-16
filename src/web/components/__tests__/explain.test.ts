import { describe, expect, it } from "vitest";
import { whoActs, whoActsForReason } from "../explain.ts";
import { me } from "./session.tsx";

describe("whoActsForReason", { tags: ["ui"] }, () => {
  it.each([
    ["budget_exhausted", "admin", "out of budget"],
    ["deadline_exceeded", "admin", "out of active time"],
    ["approval_expired", "operator", "approval expired: retry the gated step"],
    ["dead_lettered", "operator", "a task was dead-lettered: retry it"],
    ["task_failed:postcondition_failed", "operator", "a write did not take effect: retry it"],
    ["task_failed:plan_invalid", "operator", "the plan failed validation"],
    ["task_failed:permanent_error", "operator", "the tool refused the call"],
    ["task_failed:agent_exception", "operator", "a task failed (agent_exception)"],
    ["task_failed:timeout", "operator", "a task failed (timeout)"],
    ["task_failed:injected_permanent", "operator", "a task failed (injected_permanent)"],
    ["something_new", "operator", "needs attention"],
    [null, "operator", "needs attention"],
  ])("%s: %s (%s)", (reason, actor, sentence) => {
    expect(whoActsForReason(reason)).toEqual({ actor, sentence });
  });
});

describe("whoActs", { tags: ["ui"] }, () => {
  const run = (status: Parameters<typeof whoActs>[0]["status"], statusReason: string | null = null, heldTasks = 0) => ({ status, statusReason, requester: "ops.lead@agentboard.test", heldTasks });
  const viewer = me("viewer", "viewer.ana@agentboard.test");

  it.each([
    [run("awaiting_approval"), "approver", "Approver", "waiting for an approval"],
    [run("paused", "paused"), "operator", "Operator", "paused: resume to continue"],
    [run("needs_attention", "budget_exhausted"), "admin", "Admin", "out of budget"],
    [run("needs_attention", "deadline_exceeded"), "admin", "Admin", "out of active time"],
    [run("needs_attention", "approval_expired"), "operator", "Operator", "approval expired: retry the gated step"],
    [run("needs_attention", "dead_lettered"), "operator", "Operator", "a task was dead-lettered: retry it"],
    [run("needs_attention", "task_failed:postcondition_failed"), "operator", "Operator", "a write did not take effect: retry it"],
    [run("needs_attention", "task_failed:plan_invalid"), "operator", "Operator", "the plan failed validation"],
    [run("needs_attention", "task_failed:permanent_error"), "operator", "Operator", "the tool refused the call"],
    [run("needs_attention", "task_failed:timeout"), "operator", "Operator", "a task failed (timeout)"],
    [run("queued"), "nobody", "Nobody", "in progress"],
    [run("planning"), "nobody", "Nobody", "in progress"],
    [run("running"), "nobody", "Nobody", "in progress"],
    [run("queued", null, 1), "admin", "Admin", "held: a role is disabled"],
    [run("running", null, 2), "admin", "Admin", "held: a role is disabled"],
    [run("succeeded"), "done", "Done", ""],
    [run("rejected", "approval_rejected"), "done", "Done", "approval rejected"],
    [run("cancelled", "cancelled"), "done", "Done", "cancelled"],
  ])("%o", (input, actor, chip, sentence) => {
    expect(whoActs(input, viewer)).toMatchObject({ actor, chip, sentence });
  });

  it("says 'Approver (not you)' to the run's own requester, and ignores held tasks on runs that are not moving", () => {
    expect(whoActs(run("awaiting_approval"), me("operator", "ops.lead@agentboard.test")).chip).toBe("Approver (not you)");
    expect(whoActs({ ...run("awaiting_approval"), requester: "Admin@AgentBoard.test" }, me("admin", "admin@agentboard.test")).chip).toBe("Approver (not you)");
    expect(whoActs(run("awaiting_approval"), null).chip).toBe("Approver");
    expect(whoActs(run("needs_attention", "task_failed:timeout", 1), viewer).chip).toBe("Operator");
    expect(whoActs(run("cancelled", "cancelled", 1), viewer).chip).toBe("Done");
  });

  it("gives the same actor as the dashboard's split for every needs-attention reason", () => {
    for (const reason of ["budget_exhausted", "deadline_exceeded", "approval_expired", "dead_lettered", "task_failed:postcondition_failed", "task_failed:agent_exception", null]) {
      expect(whoActs(run("needs_attention", reason), viewer).actor).toBe(whoActsForReason(reason).actor);
    }
  });
});
