// Typed D1 queries for the console database (binding DB).

import type { Role } from "../../shared/domain.ts";
import { eventHash, GENESIS_HASH, type ActorType } from "../audit/hash-chain.ts";

export interface RoleBindingRow {
  principal: string;
  role: Role;
  display_name: string;
}

export async function getRoleBinding(db: D1Database, principal: string): Promise<RoleBindingRow | null> {
  return db
    .prepare("SELECT principal, role, display_name FROM role_bindings WHERE principal = ?")
    .bind(principal.toLowerCase())
    .first<RoleBindingRow>();
}

export async function listRoleBindings(db: D1Database): Promise<RoleBindingRow[]> {
  const { results } = await db.prepare("SELECT principal, role, display_name FROM role_bindings ORDER BY role, principal").all<RoleBindingRow>();
  return results;
}

export interface GlobalAuditInput {
  actorType: ActorType;
  actorId: string;
  action: string;
  runId?: string | null;
  taskId?: string | null;
  /** Must already be redacted: no addresses, no personal emails. */
  detail: Record<string, unknown>;
}

/**
 * Appends to the `global` audit stream: read the last (seq, hash), insert
 * seq + 1. A UNIQUE(stream, seq) conflict means another writer won the race,
 * so it re-reads and retries (up to 3 retries). SPEC section 6.1.
 */
export async function appendGlobalAudit(db: D1Database, input: GlobalAuditInput): Promise<{ seq: number; hash: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const last = await db
      .prepare("SELECT seq, hash FROM audit_events WHERE stream = 'global' ORDER BY seq DESC LIMIT 1")
      .first<{ seq: number; hash: string }>();
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const ts = new Date().toISOString();
    const event = {
      stream: "global",
      seq,
      ts,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      runId: input.runId ?? null,
      taskId: input.taskId ?? null,
      detail: input.detail,
    };
    const hash = eventHash(prevHash, event);
    const result = await db
      .prepare(
        `INSERT INTO audit_events (stream, seq, ts, actor_type, actor_id, action, run_id, task_id, detail_json, prev_hash, hash)
         VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(stream, seq) DO NOTHING`,
      )
      .bind(seq, ts, input.actorType, input.actorId, input.action, event.runId, event.taskId, JSON.stringify(input.detail), prevHash, hash)
      .run();
    if (result.meta.changes === 1) return { seq, hash };
  }
  throw new Error("global audit append lost the race 4 times");
}
