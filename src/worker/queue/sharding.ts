import type { AgentRole } from "../../shared/domain.ts";
import { fnv1a32 } from "./backoff.ts";

/**
 * Role agent instance for one delivery: `<role>-<n>`, n = fnv1a32(runId:taskId:attempt) % shards.
 * A redelivery of the same dispatch carries the same attempt and reaches the same shard; a
 * lease-expiry redispatch increments the attempt and may land elsewhere, so duplicate
 * prevention never depends on one instance's memory.
 */
export function shardName(role: AgentRole, runId: string, taskId: string, attempt: number, shards: number): string {
  return `${role}-${fnv1a32(`${runId}:${taskId}:${attempt}`) % shards}`;
}
