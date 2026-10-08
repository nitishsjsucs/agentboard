// The integration's own idempotency ledger (SPEC section 7.5, layer 6).
//
// Claim: insert the key as in_progress for this owner, or read the existing
// row: completed rows replay their stored result (a different args hash is a
// conflict), a live in_progress row of another owner is busy, and a lapsed
// one (locked_until in the past) is taken over with a conditional update.
// Effect: one atomic batch. Every effect statement and the side_effects insert
// are guarded on this owner still holding the key AND on no side effect
// existing yet for the step's correlation (<runId>:<stepId>), so a step's
// effect is applied at most once across all generations. The completion then
// stores the first side effect's result, which is how a generation-bump retry
// of an already-applied write replays the original result (logical dedupe).

import type { WritePlan } from "./tools/types.ts";

export interface LedgerCall {
  db: D1Database;
  key: string;
  tool: string;
  argsHash: string;
  /** `<runId>:<stepId>` from the token claims, never from caller-supplied _meta. */
  correlationId: string;
  runId: string;
  stepId: string;
  generation: number;
  /** `<agent instance>:<lease>` from the token claims. */
  owner: string;
  lockMs: number;
  now: number;
}

export type LedgerClaim =
  | { state: "mine" }
  | { state: "replay"; result: Record<string, unknown> }
  | { state: "conflict" }
  | { state: "busy" };

interface LedgerRow {
  key: string;
  args_hash: string;
  state: "in_progress" | "completed";
  owner: string;
  locked_until: number;
  result_json: string | null;
}

export async function claimKey(call: LedgerCall): Promise<LedgerClaim> {
  const { db } = call;
  await db
    .prepare(
      `INSERT INTO idempotency (key, tool, args_hash, correlation_id, state, owner, locked_until, created_at)
       VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?) ON CONFLICT(key) DO NOTHING`,
    )
    .bind(call.key, call.tool, call.argsHash, call.correlationId, call.owner, call.now + call.lockMs, new Date(call.now).toISOString())
    .run();
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.prepare("SELECT key, args_hash, state, owner, locked_until, result_json FROM idempotency WHERE key = ?").bind(call.key).first<LedgerRow>();
    if (!row) return { state: "busy" };
    if (row.args_hash !== call.argsHash) return { state: "conflict" };
    if (row.state === "completed") return { state: "replay", result: JSON.parse(row.result_json ?? "{}") as Record<string, unknown> };
    if (row.owner === call.owner) return { state: "mine" };
    if (row.locked_until > call.now) return { state: "busy" };
    // The holder's lock lapsed: take the key over. One changed row means it is ours; zero means re-read.
    const takeover = await db
      .prepare("UPDATE idempotency SET owner = ?, locked_until = ? WHERE key = ? AND state = 'in_progress' AND locked_until < ?")
      .bind(call.owner, call.now + call.lockMs, call.key, call.now)
      .run();
    if (takeover.meta.changes === 1) return { state: "mine" };
  }
  return { state: "busy" };
}

const GUARD =
  " AND EXISTS (SELECT 1 FROM idempotency WHERE key = ? AND owner = ? AND state = 'in_progress')" +
  " AND NOT EXISTS (SELECT 1 FROM side_effects WHERE correlation_id = ?)";

export type EffectOutcome =
  | { outcome: "applied"; result: Record<string, unknown> }
  | { outcome: "logical_replay"; result: Record<string, unknown> }
  | { outcome: "lost" };

/** Applies the plan's effects, records one side_effects row and completes the key, atomically. */
export async function applyEffects(call: LedgerCall, plan: WritePlan): Promise<EffectOutcome> {
  const { db } = call;
  const guardParams = [call.key, call.owner, call.correlationId];
  const nowIso = new Date(call.now).toISOString();
  const statements = [
    ...plan.effects.map((e) => db.prepare(e.sql + GUARD).bind(...e.params, ...guardParams)),
    db
      .prepare(
        `INSERT INTO side_effects (idempotency_key, correlation_id, run_id, step_id, generation, tool, result_json, applied_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE 1 = 1${GUARD}`,
      )
      .bind(call.key, call.correlationId, call.runId, call.stepId, call.generation, call.tool, JSON.stringify(plan.result), nowIso, ...guardParams),
    db
      .prepare(
        `UPDATE idempotency SET state = 'completed',
           result_json = (SELECT result_json FROM side_effects WHERE correlation_id = ? ORDER BY id LIMIT 1), completed_at = ?
         WHERE key = ? AND owner = ? AND state = 'in_progress'`,
      )
      .bind(call.correlationId, nowIso, call.key, call.owner),
  ];
  const results = await db.batch(statements);
  const sideEffect = results[results.length - 2];
  const completion = results[results.length - 1];
  // Completion changed nothing: ownership was lost and the guards kept every effect out.
  if (!completion || completion.meta.changes === 0) return { outcome: "lost" };
  if (sideEffect && sideEffect.meta.changes === 1) return { outcome: "applied", result: plan.result };
  // The step's effect already existed under an earlier generation: replay that result.
  const stored = await db.prepare("SELECT result_json FROM idempotency WHERE key = ?").bind(call.key).first<{ result_json: string | null }>();
  return { outcome: "logical_replay", result: JSON.parse(stored?.result_json ?? "{}") as Record<string, unknown> };
}

/** silent_noop (dev only): complete the key with an ok result, but apply nothing and record no side effect. */
export async function completeWithoutEffect(call: LedgerCall, result: Record<string, unknown>): Promise<EffectOutcome> {
  const outcome = await call.db
    .prepare("UPDATE idempotency SET state = 'completed', result_json = ?, completed_at = ? WHERE key = ? AND owner = ? AND state = 'in_progress'")
    .bind(JSON.stringify(result), new Date(call.now).toISOString(), call.key, call.owner)
    .run();
  return outcome.meta.changes === 0 ? { outcome: "lost" } : { outcome: "applied", result };
}
