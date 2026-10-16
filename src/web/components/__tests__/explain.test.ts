import { describe, expect, it } from "vitest";
import { whoActsForReason } from "../explain.ts";

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
