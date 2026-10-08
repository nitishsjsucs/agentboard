// Hash chain for audit events (SPEC section 6.1). Synchronous on purpose: the
// coordinator computes it inside ctx.storage.transactionSync, where no await is
// possible, so it uses node:crypto createHash and never crypto.subtle.

import { createHash } from "node:crypto";
import { canonicalJson } from "../../shared/canonical-json.ts";

export const GENESIS_HASH = "0".repeat(64);

export type ActorType = "user" | "service" | "agent" | "system";

export interface ChainEvent {
  stream: string;
  seq: number;
  /** ISO-8601 UTC with milliseconds, stored identically in DO SQLite and D1. */
  ts: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  runId: string | null;
  taskId: string | null;
  /** The redacted detail object exactly as stored. */
  detail: unknown;
}

export interface ChainedEvent extends ChainEvent {
  prevHash: string;
  hash: string;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function eventHash(prevHash: string, event: ChainEvent): string {
  return sha256Hex(
    prevHash +
      canonicalJson({
        stream: event.stream,
        seq: event.seq,
        ts: event.ts,
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        runId: event.runId,
        taskId: event.taskId,
        detail: event.detail,
      }),
  );
}

/** Re-verifies a stream's events (ordered by seq). Reports the first seq whose link or hash is wrong. */
export function verifyChain(events: readonly ChainedEvent[]): { valid: boolean; brokenAtSeq: number | null } {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const event of events) {
    if (event.seq !== expectedSeq || event.prevHash !== prev || eventHash(prev, event) !== event.hash) {
      return { valid: false, brokenAtSeq: event.seq };
    }
    prev = event.hash;
    expectedSeq += 1;
  }
  return { valid: true, brokenAtSeq: null };
}

export interface AuditRow {
  stream: string;
  seq: number;
  ts: string;
  actor_type: string;
  actor_id: string;
  action: string;
  run_id: string | null;
  task_id: string | null;
  detail_json: string;
  prev_hash: string;
  hash: string;
}

export function chainedFromRow(row: AuditRow): ChainedEvent {
  return {
    stream: row.stream,
    seq: row.seq,
    ts: row.ts,
    actorType: row.actor_type as ActorType,
    actorId: row.actor_id,
    action: row.action,
    runId: row.run_id,
    taskId: row.task_id,
    detail: JSON.parse(row.detail_json) as unknown,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

/** Reads a run's audit stream from D1 and re-verifies it. */
export async function verifyRunAudit(db: D1Database, runId: string): Promise<{ events: ChainedEvent[]; valid: boolean; brokenAtSeq: number | null }> {
  const { results } = await db.prepare("SELECT * FROM audit_events WHERE stream = ? ORDER BY seq").bind(`run:${runId}`).all<AuditRow>();
  const events = results.map(chainedFromRow);
  return { events, ...verifyChain(events) };
}
