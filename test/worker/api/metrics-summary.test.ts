// GET /api/metrics/summary: the dashboard's "Needs a person" counts. The D1 mirror rows below are
// written directly, as the coordinator's outbox would, so every count and age is exact (this file's
// storage is isolated); the last test drives real coordinators and checks the mirror end to end.

import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { MetricsSummary } from "../../../src/shared/api-types.ts";
import { distinctRuns, driveAgents, inputFromDataset } from "../../helpers/agents.ts";
import { apiGet, json } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import { claimMessage, completePlan, planFor, readState, report, startManualRun, takeDispatches } from "../../helpers/runs.ts";

const summary = async (principal: string) => json<MetricsSummary>(await apiGet(principal, "/api/metrics/summary"));

async function insertRun(id: string, status: string, reason: string | null, updatedAt: string, requester: string = P.operator): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO runs (id, requester, client_request_id, request_hash, request_type, title, request_text, subject_employee_id, priority,
       status, status_reason, budget_json, usage_json, synthetic_ref, requested_at, created_at, updated_at, finished_at, version)
     VALUES (?, ?, ?, 'h', 'address_change', ?, 'text', 'E-1001', 'normal', ?, ?, '{}', '{}', NULL, ?, ?, ?, NULL, 1)`,
  )
    .bind(id, requester, `cr-${id}`, `Run ${id}`, status, reason, updatedAt, updatedAt, updatedAt)
    .run();
}

async function insertTask(id: string, runId: string, kind: "execute" | "verify", status: string, holdReason: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tasks (id, run_id, kind, step_id, tool, args_json, depends_on_json, status, hold_reason, attempts, generation, requires_approval,
       lease_owner, lease_epoch, lease_expires_at, last_error, created_at, updated_at, version)
     VALUES (?, ?, ?, 's1', 'hris.get_employee', NULL, '[]', ?, ?, 0, 0, 0, NULL, 0, NULL, NULL, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 1)`,
  )
    .bind(id, runId, kind, status, holdReason)
    .run();
}

async function insertApproval(id: string, status: string, requester: string, expiresAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO approvals (id, run_id, task_id, generation, tool, summary, risk, requester, status, requested_at, expires_at, version)
     VALUES (?, 'run_m_aw1', ?, 0, 'hris.update_manager', 'Change the manager', 'medium', ?, ?, '2026-10-01T00:00:00.000Z', ?, 1)`,
  )
    .bind(id, `tsk_${id}`, requester, status, expiresAt)
    .run();
}

beforeAll(async () => {
  await insertRun("run_m_na1", "needs_attention", "task_failed:permanent_error", "2026-10-10T00:00:00.000Z");
  await insertRun("run_m_na2", "needs_attention", "budget_exhausted", "2026-10-12T00:00:00.000Z");
  await insertRun("run_m_na3", "needs_attention", "task_failed:timeout", "2026-10-11T00:00:00.000Z");
  await insertRun("run_m_aw1", "awaiting_approval", null, "2026-10-13T00:00:00.000Z");
  await insertRun("run_m_p1", "paused", "paused", "2026-10-09T00:00:00.000Z");
  await insertRun("run_m_ok", "succeeded", null, "2026-10-08T00:00:00.000Z");
  await insertRun("run_m_cx", "cancelled", "cancelled", "2026-10-08T00:00:00.000Z");
  await insertRun("run_m_r1", "running", null, "2026-10-14T00:00:00.000Z");
  await insertRun("run_m_r2", "running", null, "2026-10-14T06:00:00.000Z");
  await insertRun("run_m_q1", "queued", null, "2026-10-14T12:00:00.000Z");
  // Held by a disabled role: r1 (executor), r2 (executor and verifier: one run, two roles).
  await insertTask("tsk_m_h1", "run_m_r1", "execute", "held", "role_disabled");
  await insertTask("tsk_m_h2", "run_m_r2", "execute", "held", "role_disabled");
  await insertTask("tsk_m_h3", "run_m_r2", "verify", "held", "role_disabled");
  // Not counted: a hold on a run that needs attention, a checkpoint hold, and a hold left on a cancelled run.
  await insertTask("tsk_m_h4", "run_m_na2", "execute", "held", "role_disabled");
  await insertTask("tsk_m_h5", "run_m_q1", "execute", "held", "checkpoint");
  await insertTask("tsk_m_h6", "run_m_cx", "execute", "held", "role_disabled");
  // Pending approvals: one the operator requested, one the admin requested, one past its expiry whose mirror still says pending.
  await insertApproval("apr_m_a", "pending", P.operator, "2099-01-01T00:00:00.000Z");
  await insertApproval("apr_m_b", "pending", P.admin, "2099-06-01T00:00:00.000Z");
  await insertApproval("apr_m_c", "pending", P.operator, "2020-01-01T00:00:00.000Z");
  await insertApproval("apr_m_d", "approved", P.operator, "2099-01-01T00:00:00.000Z");
});

describe("metrics summary authorization", { tags: ["authz"] }, () => {
  it("decidableByYou counts only approvals the principal could decide (not their own run, not past expiry) and is null without approvals:decide; dlqOpen is null without dlq:read; no role binding gets 403", async () => {
    const approver = await summary(P.approver);
    expect(approver.approvals).toEqual({ pending: 3, decidableByYou: 2, soonestExpiry: "2099-01-01T00:00:00.000Z" });
    const admin = await summary(P.admin);
    expect(admin.approvals.decidableByYou).toBe(1);
    for (const principal of [P.operator, P.viewer]) {
      const other = await summary(principal);
      expect(other.approvals).toEqual({ pending: 3, decidableByYou: null, soonestExpiry: "2099-01-01T00:00:00.000Z" });
    }
    // The dead-letter count goes only to the roles that can open the dead-letter panel.
    expect((await summary(P.viewer)).dlqOpen).toBeNull();
    expect((await summary(P.approver)).dlqOpen).toBeNull();
    expect((await summary(P.operator)).dlqOpen).toBe(0);
    expect((await summary(P.admin)).dlqOpen).toBe(0);
    const unbound = await apiGet(P.unbound, "/api/metrics/summary");
    expect(unbound.status).toBe(403);
    expect(await unbound.json()).toMatchObject({ error: { code: "forbidden", reason: "no_role_binding" } });
  });
});

describe("metrics summary counts", { tags: ["history"] }, () => {
  it("counts open runs per status with the oldest updated_at, groups needs-attention reasons, and counts held runs once, only while queued, planning or running", async () => {
    const s = await summary(P.viewer);
    const open = Object.fromEntries(s.open.map((o) => [o.status, [o.count, o.oldestUpdatedAt]]));
    expect(open).toEqual({
      needs_attention: [3, "2026-10-10T00:00:00.000Z"],
      awaiting_approval: [1, "2026-10-13T00:00:00.000Z"],
      paused: [1, "2026-10-09T00:00:00.000Z"],
      running: [2, "2026-10-14T00:00:00.000Z"],
      queued: [1, "2026-10-14T12:00:00.000Z"],
    });
    expect([...s.needsAttentionByReason].sort((a, b) => String(a.reason).localeCompare(String(b.reason)))).toEqual([
      { reason: "budget_exhausted", count: 1 },
      { reason: "task_failed:permanent_error", count: 1 },
      { reason: "task_failed:timeout", count: 1 },
    ]);
    expect(s.heldRuns.total).toBe(2);
    expect([...s.heldRuns.byRole].sort((a, b) => a.role.localeCompare(b.role))).toEqual([
      { role: "executor", runs: 2 },
      { role: "verifier", runs: 1 },
    ]);
    // The fields the dashboard used before stay as they were.
    expect(s.byStatus).toMatchObject({ needs_attention: 3, succeeded: 1, cancelled: 1, running: 2 });
    expect([s.pendingApprovals, s.needsAttention]).toEqual([3, 3]);
  });

  it("shows coordinator-driven runs as their D1 mirror has them: one awaiting approval, one that needs attention", async () => {
    const before = await summary(P.viewer);
    const countOf = (s: MetricsSummary, status: string) => s.open.find((o) => o.status === status)?.count ?? 0;
    const [manager] = distinctRuns("manager_change", 1);
    if (!manager) throw new Error("no manager change");
    const waiting = await startManualRun(inputFromDataset(manager, { requester: P.operator }));
    await driveAgents(waiting.stub);
    expect((await readState(waiting.stub)).run.status).toBe("awaiting_approval");

    const failing = await startManualRun();
    await completePlan(failing.stub, planFor("address_change"));
    const [s1] = await takeDispatches(failing.stub);
    if (!s1) throw new Error("no s1 dispatch");
    await report(failing.stub, await claimMessage(failing.stub, s1.message), { outcome: "failed", code: "permanent_error", retryable: false, usage: {} });
    expect((await readState(failing.stub)).run.statusReason).toBe("task_failed:permanent_error");

    const after = await summary(P.approver);
    expect(countOf(after, "awaiting_approval")).toBe(countOf(before, "awaiting_approval") + 1);
    expect(countOf(after, "needs_attention")).toBe(countOf(before, "needs_attention") + 1);
    expect(after.needsAttentionByReason.find((r) => r.reason === "task_failed:permanent_error")?.count).toBe(2);
    expect(after.approvals.pending).toBe(before.approvals.pending + 1);
    expect(after.approvals.decidableByYou).toBe(3);
  });
});
