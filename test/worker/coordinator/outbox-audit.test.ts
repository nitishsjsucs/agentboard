import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { verifyChain, verifyRunAudit, type ChainedEvent } from "../../../src/worker/audit/hash-chain.ts";
import type { D1Statement } from "../../../src/worker/agents/coordinator/outbox.ts";
import type { RunCoordinator } from "../../../src/worker/agents/run-coordinator.ts";
import { claimMessage, completePlan, drain, granted, planFor, raw, readState, startManualRun, takeDispatches, type CoordinatorStub } from "../../helpers/runs.ts";

async function doEvents(stub: CoordinatorStub) {
  return runInDurableObject(raw(stub), (instance: RunCoordinator) =>
    instance.sql<{ seq: number; hash: string; prev_hash: string; action: string }>`SELECT seq, hash, prev_hash, action FROM ab_events ORDER BY seq`,
  );
}

async function pendingOutbox(stub: CoordinatorStub, kind: "d1" | "queue") {
  return runInDurableObject(raw(stub), (instance: RunCoordinator) =>
    instance.sql<{ id: number; attempts: number }>`SELECT id, attempts FROM ab_outbox WHERE kind = ${kind} AND sent_at IS NULL ORDER BY id`,
  );
}

async function d1Audit(runId: string) {
  const { results } = await env.DB.prepare("SELECT seq, action, hash FROM audit_events WHERE stream = ? ORDER BY seq").bind(`run:${runId}`).all<{ seq: number; action: string; hash: string }>();
  return results;
}

describe("transactional outbox and hash-chained audit", { tags: ["orchestration"] }, () => {
  it("every transition writes an audit event with a contiguous seq in the run stream, mirrored to D1", async () => {
    const { stub, runId } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    await drain(stub);
    const local = await doEvents(stub);
    const mirrored = await d1Audit(runId);
    expect(local.length).toBeGreaterThan(15);
    expect(local.map((e) => e.seq)).toEqual(Array.from({ length: local.length }, (_, i) => i + 1));
    expect(mirrored.map((e) => [e.seq, e.action, e.hash])).toEqual(local.map((e) => [e.seq, e.action, e.hash]));
    for (const action of ["run.created", "task.dispatched", "task.leased", "plan.accepted", "task.succeeded", "verify.passed", "run.status_changed"]) {
      expect(local.some((e) => e.action === action), action).toBe(true);
    }
    // The D1 mirrors carry the coordinator's latest versions.
    const run = await env.DB.prepare("SELECT status, version FROM runs WHERE id = ?").bind(runId).first<{ status: string; version: number }>();
    expect(run).toEqual({ status: "succeeded", version: (await readState(stub)).run.version });
    expect(await pendingOutbox(stub, "d1")).toEqual([]);
  });

  it("the hash chain of a finished run verifies with the canonical form (DO and D1 agree) and a tampered copy reports the first altered seq", async () => {
    const { stub, runId } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    await drain(stub);
    const audit = await verifyRunAudit(env.DB, runId);
    expect(audit.valid).toBe(true);
    expect(audit.brokenAtSeq).toBeNull();
    const local = await doEvents(stub);
    expect(audit.events.map((e) => e.hash)).toEqual(local.map((e) => e.hash));
    expect(audit.events[0]?.prevHash).toBe("0".repeat(64));

    const tampered: ChainedEvent[] = audit.events.map((e) => (e.seq === 5 ? { ...e, detail: { forged: true } } : e));
    expect(verifyChain(tampered)).toEqual({ valid: false, brokenAtSeq: 5 });
    const dropped = audit.events.filter((e) => e.seq !== 3);
    expect(verifyChain(dropped)).toEqual({ valid: false, brokenAtSeq: 4 });
    // D1 itself refuses edits: the table is append-only.
    await expect(env.DB.prepare("UPDATE audit_events SET detail_json = '{}' WHERE stream = ? AND seq = 1").bind(`run:${runId}`).run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM audit_events WHERE stream = ?").bind(`run:${runId}`).run()).rejects.toThrow(/append-only/);
  });

  it("a failing D1 write leaves the outbox row pending, the wake delivers it later in order, and re-flushing does not duplicate audit rows", async () => {
    const { stub, runId } = await startManualRun();
    const delivered = await d1Audit(runId);
    expect(delivered.map((e) => e.action)).toEqual(["run.created", "task.dispatched"]);
    await env.DB.prepare("CREATE TRIGGER inject_audit_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'injected D1 failure'); END").run();
    try {
      await completePlan(stub, planFor("address_change"));
      const pending = await pendingOutbox(stub, "d1");
      expect(pending.length).toBeGreaterThanOrEqual(2);
      expect(pending[0]?.attempts).toBe(1);
      // Nothing after the failure reached D1; the batch was atomic.
      expect(await d1Audit(runId)).toEqual(delivered);
    } finally {
      await env.DB.prepare("DROP TRIGGER inject_audit_failure").run();
    }
    // No RPC: the armed wake fires after the backoff and delivers every pending row in order.
    const started = Date.now();
    while (Date.now() - started < 6000 && (await pendingOutbox(stub, "d1")).length > 0) await new Promise((r) => setTimeout(r, 100));
    expect(await pendingOutbox(stub, "d1")).toEqual([]);
    const local = await doEvents(stub);
    expect((await d1Audit(runId)).map((e) => e.seq)).toEqual(local.map((e) => e.seq));

    // Re-flush every row: version guards and ON CONFLICT keep D1 unchanged.
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE stream = ?").bind(`run:${runId}`).first<{ n: number }>();
    await runInDurableObject(raw(stub), (instance: RunCoordinator) => {
      instance.sql`UPDATE ab_outbox SET sent_at = NULL, attempts = 0, next_attempt_at = 0 WHERE kind = 'd1'`;
    });
    await stub.getSnapshot();
    expect(await pendingOutbox(stub, "d1")).toEqual([]);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE stream = ?").bind(`run:${runId}`).first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
    expect((await verifyRunAudit(env.DB, runId)).valid).toBe(true);
  }, 15_000);

  it("the D1 tasks mirror never regresses: a lower-version write is ignored", async () => {
    const { stub, runId } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const firstBatch = await runInDurableObject(raw(stub), (instance: RunCoordinator) =>
      instance.sql<{ payload_json: string }>`SELECT payload_json FROM ab_outbox WHERE kind = 'd1' ORDER BY id`.map((r) => JSON.parse(r.payload_json) as { statements: D1Statement[] }),
    );
    await drain(stub);
    const latest = await env.DB.prepare("SELECT id, status, version FROM tasks WHERE run_id = ? ORDER BY id").bind(runId).all<{ id: string; status: string; version: number }>();
    const latestRun = await env.DB.prepare("SELECT status, version FROM runs WHERE id = ?").bind(runId).first();
    expect(latest.results.every((t) => t.status === "succeeded")).toBe(true);
    // Replay every early mirror batch out of order: nothing regresses.
    for (const batch of firstBatch) {
      await env.DB.batch(batch.statements.map((s) => env.DB.prepare(s.sql).bind(...s.params)));
    }
    const replayed = await env.DB.prepare("SELECT id, status, version FROM tasks WHERE run_id = ? ORDER BY id").bind(runId).all<{ id: string; status: string; version: number }>();
    expect(replayed.results).toEqual(latest.results);
    expect(await env.DB.prepare("SELECT status, version FROM runs WHERE id = ?").bind(runId).first()).toEqual(latestRun);
  });

  it("forty concurrent transitions on one coordinator produce a contiguous, valid chain", async () => {
    const { stub, runId } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1");
    const lease = granted(await claimMessage(stub, s1.message));
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        stub.appendTrace({
          id: `call_concurrent_${i}`,
          taskId: lease.context.taskId,
          leaseId: lease.lease.leaseId,
          epoch: lease.lease.epoch,
          stepId: "s1",
          agent: "executor-0",
          tool: "hris.get_employee",
          args: { employeeId: "E-1014" },
          idempotencyKey: null,
          attempt: 1,
          generation: 0,
          outcome: "ok",
          logical: false,
          result: { ok: true },
          error: null,
          startedAt: now,
          finishedAt: now,
          durationMs: i,
        }),
      ),
    );
    expect(results.every((r) => r.accepted)).toBe(true);
    const local = await doEvents(stub);
    expect(local.map((e) => e.seq)).toEqual(Array.from({ length: local.length }, (_, i) => i + 1));
    expect(local.filter((e) => e.action === "tool.called")).toHaveLength(40);
    const audit = await verifyRunAudit(env.DB, runId);
    expect(audit.valid).toBe(true);
    expect(audit.events).toHaveLength(local.length);
    expect((await readState(stub)).run.usage.toolCalls).toBe(40);
    const calls = await env.DB.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE run_id = ?").bind(runId).first<{ n: number }>();
    expect(calls?.n).toBe(40);
  });
});
