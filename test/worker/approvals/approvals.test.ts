import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ApprovalListItem, Page } from "../../../src/shared/api-types.ts";
import { agentFor, distinctRuns, driveAgents, inputFromDataset } from "../../helpers/agents.ts";
import { apiGet, apiPost, json } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import { setCoordinatorClock } from "../../helpers/clock.ts";
import { events, readState, startManualRun, takeDispatches } from "../../helpers/runs.ts";

// Distinct manager-change requests (each test has its own subject).
const [GATED, APPROVED, REJECTED, EXPIRED] = distinctRuns("manager_change", 4) as [
  ReturnType<typeof distinctRuns>[number],
  ReturnType<typeof distinctRuns>[number],
  ReturnType<typeof distinctRuns>[number],
  ReturnType<typeof distinctRuns>[number],
];

/** A manager-change run driven by the real agents until it waits for its approval. */
async function awaitingApproval(run: typeof GATED) {
  const started = await startManualRun(inputFromDataset(run, { requester: P.operator }));
  await driveAgents(started.stub);
  const state = await readState(started.stub);
  const approval = [...state.approvals.values()][0];
  if (!approval) throw new Error("no approval was requested");
  return { ...started, approval };
}

describe("approvals", { tags: ["orchestration"] }, () => {
  it("a step requiring approval moves to awaiting_approval and creates one pending approval, mirrored to D1", async () => {
    const { stub, runId, approval } = await awaitingApproval(GATED);
    const state = await readState(stub);
    expect(state.run.status).toBe("awaiting_approval");
    expect(state.approvals.size).toBe(1);
    expect(state.tasks.get(approval.taskId)).toMatchObject({ status: "awaiting_approval", tool: "hris.update_manager", requiresApproval: true });
    expect(approval).toMatchObject({ status: "pending", risk: "medium", tool: "hris.update_manager" });
    const mirrored = await env.DB.prepare("SELECT id, status, risk, requester, summary FROM approvals WHERE run_id = ?").bind(runId).all();
    expect(mirrored.results).toEqual([{ id: approval.id, status: "pending", risk: "medium", requester: P.operator, summary: approval.summary }]);
    const listed = await json<Page<ApprovalListItem>>(await apiGet(P.approver, "/api/approvals?status=pending"));
    expect(listed.items.find((a) => a.id === approval.id)).toMatchObject({ runId, canDecide: true });
    const asRequester = await json<Page<ApprovalListItem>>(await apiGet(P.operator, "/api/approvals?status=pending"));
    expect(asRequester.items.find((a) => a.id === approval.id)?.canDecide).toBe(false);
  });

  it("approve dispatches the execute task exactly once", async () => {
    const { stub, approval } = await awaitingApproval(APPROVED);
    const response = await apiPost(P.approver, `/api/approvals/${approval.id}/decision`, { decision: "approve", note: "looks right" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: approval.id, status: "approved", decidedBy: P.approver, decisionNote: "looks right" });
    const dispatches = await takeDispatches(stub);
    expect(dispatches.map((d) => d.message.taskId)).toEqual([approval.taskId]);
    expect((await readState(stub)).tasks.get(approval.taskId)?.status).toBe("ready");
    expect((await events(stub)).filter((e) => e.action === "task.dispatched" && e.task_id === approval.taskId)).toHaveLength(1);
    // The run then completes through the real agents (starting with the dispatch taken above).
    for (const d of dispatches) await (await agentFor(d.message)).handleTask(d.message);
    await driveAgents(stub);
    expect((await readState(stub)).run.status).toBe("succeeded");
  });

  it("reject marks the run rejected, cancels the remaining tasks, and no write gated behind the approval ever executes", async () => {
    const { stub, runId, approval } = await awaitingApproval(REJECTED);
    const response = await apiPost(P.approver2, `/api/approvals/${approval.id}/decision`, { decision: "reject", note: "not justified" });
    expect(response.status).toBe(200);
    await driveAgents(stub);
    const state = await readState(stub);
    expect(state.run.status).toBe("rejected");
    expect(state.tasks.get(approval.taskId)?.status).toBe("rejected");
    const others = [...state.tasks.values()].filter((t) => t.kind !== "plan" && t.id !== approval.taskId && t.stepId !== "s1");
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((t) => t.status === "cancelled")).toBe(true);
    // Only the read before the gate ran; no write was ever applied or even leased.
    const effects = await env.PEOPLE_DB.prepare("SELECT COUNT(*) AS n FROM side_effects WHERE run_id = ?").bind(runId).first<{ n: number }>();
    expect(effects?.n).toBe(0);
    const leased = (await events(stub)).filter((e) => e.action === "task.leased").map((e) => state.tasks.get(e.task_id ?? "")?.tool ?? "plan");
    expect(leased).toEqual(["plan", "hris.get_employee"]);
    const employee = await env.PEOPLE_DB.prepare("SELECT manager_id FROM employees WHERE id = ?").bind(REJECTED.subjectEmployeeId).first<{ manager_id: string }>();
    expect(employee?.manager_id).not.toBe(REJECTED.fields.managerId);
  });

  it("a pending approval past expires_at becomes expired through the sweep, the run needs attention, and a decision racing the expiry gets 409; an operator retry asks again at generation + 1", async () => {
    const { stub, runId, approval } = await awaitingApproval(EXPIRED);
    // APPROVAL_TTL_MS is 60 s in tests. No RPC runs between the clock move and the decision:
    // the decision's own transaction sweeps first and finds the approval expired.
    await setCoordinatorClock(stub, 61_000);
    const response = await apiPost(P.approver, `/api/approvals/${approval.id}/decision`, { decision: "approve", note: "too late" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "conflict", reason: "expired" } });
    const state = await readState(stub);
    expect(state.approvals.get(approval.id)?.status).toBe("expired");
    expect(state.tasks.get(approval.taskId)?.status).toBe("rejected");
    expect(state.run.status).toBe("needs_attention");
    expect(state.run.statusReason).toBe("approval_expired");
    expect((await events(stub)).filter((e) => e.action === "approval.expired")).toHaveLength(1);
    const mirrored = await env.DB.prepare("SELECT status FROM approvals WHERE run_id = ?").bind(runId).first<{ status: string }>();
    expect(mirrored?.status).toBe("expired");

    // SPEC 3.5: retrying a task rejected by expiry puts it back to pending at generation + 1, and it asks for a new approval.
    const retry = await apiPost(P.operator, `/api/runs/${runId}/tasks/${approval.taskId}/retry`, { reason: "approver was away" });
    expect(retry.status).toBe(200);
    let after = await readState(stub);
    const task = after.tasks.get(approval.taskId);
    expect([task?.status, task?.generation]).toEqual(["awaiting_approval", 1]);
    expect(after.run.status).toBe("awaiting_approval");
    const approvals = [...after.approvals.values()].sort((a, b) => a.generation - b.generation);
    expect(approvals.map((a) => [a.status, a.generation, a.taskId])).toEqual([
      ["expired", 0, approval.taskId],
      ["pending", 1, approval.taskId],
    ]);
    const second = approvals[1];
    if (!second) throw new Error("no second approval");
    expect(task?.approvalId).toBe(second.id);
    const mirroredBoth = await env.DB.prepare("SELECT id, status FROM approvals WHERE run_id = ? ORDER BY requested_at, id").bind(runId).all<{ id: string; status: string }>();
    expect(mirroredBoth.results.map((r) => [r.id, r.status]).sort()).toEqual(
      [
        [approval.id, "expired"],
        [second.id, "pending"],
      ].sort(),
    );
    const retried = (await events(stub)).filter((e) => e.action === "task.retried");
    expect(retried.map((e) => [e.task_id, e.detail["from"], e.detail["to"], e.detail["generation"]])).toEqual([[approval.taskId, "rejected", "pending", 1]]);

    // The new approval is decided like any other, and the run completes.
    const decided = await apiPost(P.approver, `/api/approvals/${second.id}/decision`, { decision: "approve", note: "approved on retry" });
    expect(decided.status).toBe(200);
    await driveAgents(stub);
    after = await readState(stub);
    expect(after.tasks.get(approval.taskId)?.status).toBe("succeeded");
    expect(after.run.status).toBe("succeeded");
  });
});
