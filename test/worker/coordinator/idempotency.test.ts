import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { argsHash, idempotencyKey } from "../../../src/worker/agents/coordinator/credentials.ts";
import { applyEffects, claimKey, type LedgerCall } from "../../../src/worker/mcp/ledger.ts";
import { createTicket } from "../../../src/worker/mcp/tools/itsm.ts";
import { isWritePlan } from "../../../src/worker/mcp/tools/types.ts";
import { setCoordinatorClock } from "../../helpers/clock.ts";
import { binding, call, executorToken, writeMeta } from "../../helpers/mcp.ts";
import { claimMessage, completePlan, granted, planFor, readState, report, startManualRun, takeDispatches } from "../../helpers/runs.ts";

async function effectsFor(correlationId: string): Promise<number> {
  const row = await env.PEOPLE_DB.prepare("SELECT COUNT(*) AS n FROM side_effects WHERE correlation_id = ?").bind(correlationId).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("duplicate-action prevention: integration ledger", { tags: ["orchestration"] }, () => {
  it("concurrent calls with the same key: one applies, the other gets in_progress (or the replay); never two effects", async () => {
    const args = { employeeId: "E-1022", category: "laptop_provision", summary: "Laptop provisioning for E-1022" };
    const b = binding("itsm.create_ticket", args);
    // Two holders of the same call (for example a zombie and its successor), racing.
    const [first, second] = await Promise.all([
      call(await executorToken("itsm.create_ticket", args, b, { sub: "executor-0", epoch: 1 }), "itsm.create_ticket", args, writeMeta(b)),
      call(await executorToken("itsm.create_ticket", args, b, { sub: "executor-1", epoch: 2 }), "itsm.create_ticket", args, writeMeta(b)),
    ]);
    const outcomes = [first, second].map((r) => r.structuredContent as { ok: boolean; replayed?: boolean; code?: string });
    expect(outcomes.filter((o) => o.ok && o.replayed === false)).toHaveLength(1);
    expect(outcomes.filter((o) => !(o.ok && o.replayed === false)).every((o) => o.code === "in_progress" || (o.ok && o.replayed === true))).toBe(true);
    expect(await effectsFor(`${b.runId}:${b.stepId}`)).toBe(1);

    // Deterministic interleaving: while one holder has the key in progress, the other is refused in_progress.
    const args2 = { ...args, employeeId: "E-1023", summary: "Laptop provisioning for E-1023" };
    const b2 = binding("itsm.create_ticket", args2);
    const holder: LedgerCall = {
      db: env.PEOPLE_DB,
      key: b2.key,
      tool: "itsm.create_ticket",
      argsHash: argsHash(args2),
      correlationId: `${b2.runId}:${b2.stepId}`,
      runId: b2.runId,
      stepId: b2.stepId,
      generation: 0,
      owner: "executor-0:held:1",
      lockMs: 2000,
      now: Date.now(),
    };
    expect(await claimKey(holder)).toEqual({ state: "mine" });
    const refused = await call(await executorToken("itsm.create_ticket", args2, b2, { sub: "executor-1", epoch: 2 }), "itsm.create_ticket", args2, writeMeta(b2));
    expect(refused.structuredContent).toMatchObject({ ok: false, errorClass: "in_progress", code: "in_progress" });
    expect(await effectsFor(holder.correlationId)).toBe(0);
  });

  it("ledger takeover: an in_progress row past locked_until is taken over, and the original holder's late effect batch changes no rows", async () => {
    const args = { employeeId: "E-1024", category: "laptop_return", summary: "Laptop return for E-1024" };
    const b = binding("itsm.create_ticket", args);
    const original: LedgerCall = {
      db: env.PEOPLE_DB,
      key: b.key,
      tool: "itsm.create_ticket",
      argsHash: argsHash(args),
      correlationId: `${b.runId}:${b.stepId}`,
      runId: b.runId,
      stepId: b.stepId,
      generation: 0,
      owner: "executor-0:zombie:1",
      lockMs: 2000,
      now: Date.now(),
    };
    expect(await claimKey(original)).toEqual({ state: "mine" });
    const originalPlan = await createTicket(env.PEOPLE_DB, args, new Date().toISOString());
    if (!isWritePlan(originalPlan)) throw new Error("no plan");
    // The original holder stalls past its lock.
    await env.PEOPLE_DB.prepare("UPDATE idempotency SET locked_until = ? WHERE key = ?").bind(Date.now() - 1, b.key).run();

    const successor = await call(await executorToken("itsm.create_ticket", args, b, { sub: "executor-1", epoch: 2 }), "itsm.create_ticket", args, writeMeta(b));
    expect(successor.structuredContent).toMatchObject({ ok: true, replayed: false });
    const owner = await env.PEOPLE_DB.prepare("SELECT owner, state FROM idempotency WHERE key = ?").bind(b.key).first<{ owner: string; state: string }>();
    expect(owner?.state).toBe("completed");
    expect(owner?.owner).not.toBe(original.owner);

    const late = await applyEffects(original, originalPlan);
    expect(late).toEqual({ outcome: "lost" });
    expect(await effectsFor(original.correlationId)).toBe(1);
    const tickets = await env.PEOPLE_DB.prepare("SELECT id FROM tickets WHERE employee_id = ?").bind("E-1024").all<{ id: string }>();
    expect(tickets.results.map((t) => t.id)).toEqual([(successor.structuredContent as unknown as { data: { ticketId: string } }).data.ticketId]);
  });

  it("the idempotency key is stable across attempts and changes with generation; a generation-bump retry of an applied write replays the first result", async () => {
    // Through the coordinator: the same key on attempt 1 and on the lease-expiry redispatch (attempt 2); a new one after an operator retry.
    const { stub, runId } = await startManualRun();
    await completePlan(stub, planFor("address_change"));
    const [s1] = await takeDispatches(stub);
    if (!s1) throw new Error("no s1");
    await report(stub, await claimMessage(stub, s1.message), { outcome: "succeeded", output: { ok: true }, usage: {} });
    const [s2] = await takeDispatches(stub);
    if (!s2) throw new Error("no s2");
    const attempt1 = granted(await claimMessage(stub, s2.message));
    await setCoordinatorClock(stub, 3500);
    await stub.getSnapshot();
    const [redispatch] = await takeDispatches(stub);
    if (!redispatch) throw new Error("no redispatch");
    const attempt2 = granted(await claimMessage(stub, redispatch.message, 1));
    expect(attempt2.context.attempt).toBe(2);
    expect(attempt2.lease.epoch).toBe(2);
    expect(attempt2.context.idempotencyKey).toBe(attempt1.context.idempotencyKey);
    await report(stub, attempt2, { outcome: "failed", retryable: false, code: "permanent", usage: {} });
    await stub.control({ type: "retry_task", taskId: s2.message.taskId, actor: { kind: "user", id: "ops.lead@agentboard.test" }, reason: "retry" });
    expect((await readState(stub)).tasks.get(s2.message.taskId)?.generation).toBe(1);
    const [retried] = await takeDispatches(stub);
    if (!retried) throw new Error("no retry dispatch");
    const generation1 = granted(await claimMessage(stub, retried.message));
    const args = generation1.context.step?.args ?? {};
    expect(generation1.context.idempotencyKey).toBe(idempotencyKey(runId, "s2", 1, "hris.update_address", args));
    expect(generation1.context.idempotencyKey).not.toBe(attempt1.context.idempotencyKey);

    // At the integration: generation 0 applies; the generation-1 key replays it (logical dedupe), with no second effect.
    const writeArgs = { employeeId: "E-1025", category: "access_issue", summary: "Reset badge access" };
    const gen0 = binding("itsm.create_ticket", writeArgs, { generation: 0 });
    const gen1 = binding("itsm.create_ticket", writeArgs, { runId: gen0.runId, stepId: gen0.stepId, generation: 1 });
    expect(gen1.key).not.toBe(gen0.key);
    const applied = await call(await executorToken("itsm.create_ticket", writeArgs, gen0), "itsm.create_ticket", writeArgs, writeMeta(gen0));
    const replayed = await call(await executorToken("itsm.create_ticket", writeArgs, gen1), "itsm.create_ticket", writeArgs, writeMeta(gen1));
    expect(applied.structuredContent).toMatchObject({ ok: true, replayed: false });
    expect(replayed.structuredContent).toMatchObject({ ok: true, replayed: true, logical: true });
    expect((replayed.structuredContent as unknown as { data: unknown }).data).toEqual((applied.structuredContent as unknown as { data: unknown }).data);
    expect(await effectsFor(`${gen0.runId}:${gen0.stepId}`)).toBe(1);
    const tickets = await env.PEOPLE_DB.prepare("SELECT COUNT(*) AS n FROM tickets WHERE employee_id = ?").bind("E-1025").first<{ n: number }>();
    expect(tickets?.n).toBe(1);
  });
});
