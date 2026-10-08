import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { distinctRuns, driveAgents, inputFromDataset } from "../../helpers/agents.ts";
import { apiPost } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import { readState, startManualRun } from "../../helpers/runs.ts";

const [OWN, TWICE, OTHERS] = distinctRuns("privileged_access", 3) as [
  ReturnType<typeof distinctRuns>[number],
  ReturnType<typeof distinctRuns>[number],
  ReturnType<typeof distinctRuns>[number],
];

async function pendingApproval(run: typeof OWN, requester: string) {
  const started = await startManualRun(inputFromDataset(run, { requester }));
  await driveAgents(started.stub);
  const approval = [...(await readState(started.stub)).approvals.values()][0];
  if (!approval) throw new Error("no approval");
  return { ...started, approval };
}

describe("separation of duties on approvals", { tags: ["authz"] }, () => {
  it("a requester cannot approve or reject an approval on their own run (403 self_approval, decided by the coordinator)", async () => {
    // The admin holds approvals:decide, so RBAC lets the call through; the coordinator refuses it.
    const { stub, approval } = await pendingApproval(OWN, P.admin);
    for (const decision of ["approve", "reject"] as const) {
      const response = await apiPost(P.admin, `/api/approvals/${approval.id}/decision`, { decision, note: "my own request" });
      expect(response.status, decision).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden", reason: "self_approval" } });
    }
    expect((await readState(stub)).approvals.get(approval.id)?.status).toBe("pending");
    // A principal without approvals:decide is stopped by RBAC before the coordinator.
    const operator = await apiPost(P.operator2, `/api/approvals/${approval.id}/decision`, { decision: "approve", note: "not my role" });
    expect(operator.status).toBe(403);
    expect(await operator.json()).toMatchObject({ error: { reason: "missing_permission" } });
  });

  it("a decided approval cannot be decided again (409)", async () => {
    const { approval } = await pendingApproval(TWICE, P.operator);
    expect((await apiPost(P.approver, `/api/approvals/${approval.id}/decision`, { decision: "approve", note: "first" })).status).toBe(200);
    const again = await apiPost(P.approver2, `/api/approvals/${approval.id}/decision`, { decision: "reject", note: "second" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "conflict", reason: "already_decided" } });
    expect((await apiPost(P.approver, `/api/approvals/apr_01J00000000000000000000000/decision`, { decision: "approve", note: "ghost" })).status).toBe(404);
  });

  it("an admin can decide approvals on other people's runs, and the decision is audited with actor and note", async () => {
    const { runId, approval } = await pendingApproval(OTHERS, P.operator);
    const response = await apiPost(P.admin, `/api/approvals/${approval.id}/decision`, { decision: "approve", note: "approved by admin on call" });
    expect(response.status).toBe(200);
    const audit = await env.DB.prepare("SELECT actor_type, actor_id, detail_json FROM audit_events WHERE stream = ? AND action = 'approval.decided'")
      .bind(`run:${runId}`)
      .all<{ actor_type: string; actor_id: string; detail_json: string }>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]).toMatchObject({ actor_type: "user", actor_id: P.admin });
    expect(JSON.parse(audit.results[0]?.detail_json ?? "{}")).toMatchObject({ approvalId: approval.id, decision: "approve", note: "approved by admin on call" });
  });
});
