import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../../shared/domain.ts";
import { describeNextStep, NextStep, type NextStepInput } from "../NextStep.tsx";
import { snapshot, task } from "./fixtures.ts";
import { DEV_HEALTH, me, renderAt } from "./session.tsx";

afterEach(cleanup);

const REQUESTER = "ops.lead@agentboard.test";

function lines(overrides: Partial<NextStepInput> & { role?: Role; id?: string } = {}): string[] {
  const { role = "operator", id, ...rest } = overrides;
  const notice = describeNextStep({ snapshot: snapshot(), approvals: [], requester: REQUESTER, me: me(role, id), llmProvider: "stub", ...rest });
  return notice?.lines ?? [];
}

const failedPlan = (code: string) =>
  snapshot({ statusReason: `task_failed:${code}`, tasks: [task({ id: "p", kind: "plan", status: "failed", attempts: 3, lastError: code })] });

describe("NextStep", { tags: ["ui"] }, () => {
  it("tells the stub user that a planner agent_exception will fail again, and others to retry", () => {
    expect(lines({ snapshot: failedPlan("agent_exception") })).toEqual([
      "The planner failed on every attempt.",
      "With the local stub planner this usually means the request is not one of the samples, so a retry will fail the same way.",
      "Cancel this run and launch a sample.",
    ]);
    expect(lines({ snapshot: failedPlan("agent_exception"), role: "viewer" }).at(-1)).toBe("An operator or an admin can cancel this run.");
    expect(lines({ snapshot: failedPlan("agent_exception"), llmProvider: "workers-ai" })).toEqual([
      "The planner failed on every attempt.",
      "Retry the plan task in Recovery, or cancel the run.",
    ]);
  });

  it("explains the other task failures with the failed step", () => {
    expect(lines({ snapshot: failedPlan("plan_invalid") })[0]).toBe("The plan did not pass validation, so no step ran. The Events table lists the issues.");
    // The fixture's s2 verification failed its postcondition.
    expect(lines()).toEqual([
      "The verifier found that the write of step s2 (hris.update_address) did not take effect.",
      "Retry s2 execute (hris.update_address) in Recovery to run the write again; retrying s2 verify only reads the record again.",
    ]);
    expect(lines({ role: "viewer" })[1]).toBe("An operator or an admin can retry s2 execute (hris.update_address) to run the write again.");
    const timedOut = snapshot({ statusReason: "task_failed:timeout", tasks: [task({ id: "x", kind: "execute", stepId: "s3", tool: "notify.send", status: "failed", lastError: "timeout" })] });
    expect(lines({ snapshot: timedOut })[0]).toBe("Step s3 (notify.send) timed out on every attempt.");
    const exhausted = snapshot({ statusReason: "task_failed:attempts_exhausted", tasks: [task({ id: "x", kind: "execute", stepId: "s1", tool: "hris.get_employee", status: "failed" })] });
    expect(lines({ snapshot: exhausted })[0]).toBe("Step s1 (hris.get_employee) used every attempt it was allowed.");
    const other = snapshot({ statusReason: "task_failed:transport_error", tasks: [task({ id: "x", kind: "execute", stepId: "s4", tool: "itsm.create_ticket", status: "failed" })] });
    expect(lines({ snapshot: other })).toEqual(["Step s4 failed (transport_error).", "Retry it in Recovery."]);
    expect(lines({ snapshot: other, role: "approver" })[1]).toBe("An operator or an admin can retry it.");
  });

  it("names the exhausted meter, and tells an admin to raise the budget and an operator to ask an admin", () => {
    const blocked = snapshot({
      statusReason: "budget_exhausted",
      usage: { toolCalls: 24, toolCallsReserved: 0, llmTokens: 900, activeMs: 4000, attempts: 5, replays: 0, skippedSteps: 0 },
      tasks: [task({ id: "x", kind: "execute", stepId: "s3", tool: "notify.send", status: "budget_blocked", attempts: 1 })],
    });
    expect(lines({ snapshot: blocked, role: "admin" })).toEqual(["The run is out of budget: tool calls are at 24 of 24.", "Use Raise budget in Recovery."]);
    expect(lines({ snapshot: blocked, role: "operator" })).toEqual(["The run is out of budget: tool calls are at 24 of 24.", "Ask an admin to raise the budget."]);
  });

  it("explains dead letters, expired approvals and the active-time deadline", () => {
    expect(lines({ snapshot: snapshot({ statusReason: "dead_lettered" }) })).toEqual(["A task was dead-lettered after its queue deliveries ran out.", "Retry it in Recovery."]);
    expect(lines({ snapshot: snapshot({ statusReason: "approval_expired" }) })).toEqual([
      "An approval expired before anyone decided it.",
      "Retry the gated step to request a new approval.",
    ]);
    expect(lines({ snapshot: snapshot({ statusReason: "deadline_exceeded" }), role: "admin" })).toEqual(["The run used up its active-time budget.", "Use Raise budget in Recovery."]);
  });

  it("explains a pause", () => {
    expect(lines({ snapshot: snapshot({ status: "paused", statusReason: "paused" }) })).toEqual(["Paused. Tasks wait until someone with run control resumes it."]);
  });

  it("says who can decide a waiting approval and when it expires, and tells the requester why they cannot", () => {
    const waiting = snapshot({ status: "awaiting_approval", statusReason: null });
    const approvals = [{ status: "pending" as const, expiresAt: "2026-10-18T12:00:00.000Z" }];
    const requester = lines({ snapshot: waiting, approvals, role: "admin", id: REQUESTER });
    expect(requester[0]).toMatch(/^Waiting for an approver or an admin other than ops\.lead@agentboard\.test; the approval expires .+\.$/);
    expect(requester[1]).toBe("You cannot decide it because you requested this run.");
    const approver = lines({ snapshot: waiting, approvals, role: "approver", id: "approver.lee@agentboard.test" });
    expect(approver).toHaveLength(1);
  });

  it("says when every open task is held because its role is disabled", () => {
    const held = snapshot({
      status: "running",
      statusReason: null,
      tasks: [
        task({ id: "p", kind: "plan", status: "succeeded" }),
        task({ id: "x1", kind: "execute", stepId: "s1", tool: "hris.get_employee", status: "held", holdReason: "role_disabled" }),
        task({ id: "x2", kind: "execute", stepId: "s2", tool: "notify.send", status: "pending" }),
      ],
    });
    expect(lines({ snapshot: held })).toEqual(["Tasks are held because the executor role is disabled. An admin can enable it on the Dashboard."]);
    const moving = snapshot({ ...held, tasks: [...held.tasks, task({ id: "v1", kind: "verify", stepId: "s0", status: "leased" })] });
    expect(lines({ snapshot: moving })).toEqual([]);
  });

  it("says nothing for a run that is moving or finished", () => {
    expect(describeNextStep({ snapshot: snapshot({ status: "running", statusReason: null }), approvals: [], requester: REQUESTER, me: me("operator"), llmProvider: "stub" })).toBeNull();
    expect(describeNextStep({ snapshot: snapshot({ status: "succeeded", statusReason: null }), approvals: [], requester: REQUESTER, me: me("operator"), llmProvider: "stub" })).toBeNull();
  });

  it("renders the notice with a way to the Approvals tab", () => {
    const open = vi.fn();
    render(
      renderAt(
        "approver",
        <NextStep snapshot={snapshot({ status: "awaiting_approval", statusReason: null })} approvals={[]} requester={REQUESTER} onOpenApprovals={open} />,
        { health: DEV_HEALTH },
      ),
    );
    expect(screen.getByTestId("next-step").textContent).toContain("Waiting for an approver or an admin other than ops.lead@agentboard.test.");
    fireEvent.click(screen.getByRole("button", { name: "Open the Approvals tab" }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
