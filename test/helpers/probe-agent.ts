import { Agent } from "agents";
import { createHash } from "node:crypto";

/**
 * Test-only Agent used by the toolchain gate (commit 1). It repeats the
 * prototype checks on the exact pins: a synchronous SHA-256 chain written
 * inside `transactionSync`, a one-shot `schedule()` wake and WebSocket
 * state frames. It is exported only from the test entry module.
 */
export interface ProbeState {
  label: string;
  writes: number;
}

const ZERO_HASH = "0".repeat(64);

export class ToolchainProbe extends Agent<Env, ProbeState> {
  override initialState: ProbeState = { label: "probe", writes: 0 };

  override onStart(): void {
    this.sql`CREATE TABLE IF NOT EXISTS probe_chain (seq INTEGER PRIMARY KEY, payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL)`;
    this.sql`CREATE TABLE IF NOT EXISTS probe_wakes (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, fired_at INTEGER NOT NULL)`;
  }

  /** Awaits I/O first, then appends one link inside a synchronous transaction. */
  async append(payload: string): Promise<number> {
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return this.ctx.storage.transactionSync(() => {
      const last = this.sql<{ seq: number; hash: string }>`SELECT seq, hash FROM probe_chain ORDER BY seq DESC LIMIT 1`[0];
      const seq = (last?.seq ?? 0) + 1;
      const prev = last?.hash ?? ZERO_HASH;
      const hash = createHash("sha256").update(prev + payload).digest("hex");
      this.sql`INSERT INTO probe_chain (seq, payload, prev_hash, hash) VALUES (${seq}, ${payload}, ${prev}, ${hash})`;
      return seq;
    });
  }

  chain(): { seq: number; payload: string; prev_hash: string; hash: string }[] {
    return this.sql<{ seq: number; payload: string; prev_hash: string; hash: string }>`SELECT seq, payload, prev_hash, hash FROM probe_chain ORDER BY seq`;
  }

  /** Arms a one-shot wake at the ceiling second, as the coordinator does. */
  async armWake(deadlineMs: number): Promise<{ at: number; schedules: number }> {
    const at = Math.ceil(deadlineMs / 1000) * 1000;
    await this.schedule(new Date(at), "onWake", { at }, { idempotent: true });
    const schedules = (await this.listSchedules()).length;
    return { at, schedules };
  }

  onWake(payload: { at: number }): void {
    this.sql`INSERT INTO probe_wakes (at, fired_at) VALUES (${payload.at}, ${Date.now()})`;
  }

  wakes(): { at: number; fired_at: number }[] {
    return this.sql<{ at: number; fired_at: number }>`SELECT at, fired_at FROM probe_wakes ORDER BY id`;
  }

  bump(): ProbeState {
    const next = { label: this.state.label, writes: this.state.writes + 1 };
    this.setState(next);
    return next;
  }

  override shouldConnectionBeReadonly(): boolean {
    return true;
  }

  override async onRequest(): Promise<Response> {
    return new Response("not found", { status: 404 });
  }
}

export function verifyProbeChain(rows: { seq: number; payload: string; prev_hash: string; hash: string }[]): boolean {
  let prev = ZERO_HASH;
  for (const [index, row] of rows.entries()) {
    if (row.seq !== index + 1 || row.prev_hash !== prev) return false;
    const expected = createHash("sha256").update(prev + row.payload).digest("hex");
    if (expected !== row.hash) return false;
    prev = row.hash;
  }
  return true;
}
