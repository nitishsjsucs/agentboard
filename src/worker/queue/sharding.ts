import type { AgentRole } from "../../shared/domain.ts";
import { fnv1a32 } from "./backoff.ts";

/**
 * Role agent instance for one delivery: `<role>-<n>`, n = fnv1a32(runId:taskId:attempt) % shards.
 * A redelivery of the same dispatch carries the same attempt and reaches the same shard. A
 * lease-expiry redispatch increments the attempt, so duplicate prevention never depends on one
 * instance's memory: the integration ledger is the authority, the executor journal a fast path.
 *
 * Where the next attempt lands is deterministic, not random. FNV-1a's lowest bit is fixed by the
 * parity of the number of odd character codes in the input, and consecutive single-digit attempts
 * differ in that parity, so with an even shard count attempt n + 1 (n < 9) always lands on another
 * shard than attempt n. With the default AGENT_SHARDS=2, attempt 2 always reaches the other shard
 * (a crash after a call is recovered by a ledger replay there) and attempt 3 returns to attempt 1's
 * shard (where the journal can answer). executor.test.ts exercises the journal by delivering to a
 * shard explicitly.
 */
export function shardName(role: AgentRole, runId: string, taskId: string, attempt: number, shards: number): string {
  return `${role}-${fnv1a32(`${runId}:${taskId}:${attempt}`) % shards}`;
}
