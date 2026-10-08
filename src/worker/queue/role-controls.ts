// Cached reader of agent_controls (SPEC section 7.7). A disable takes effect
// within AGENT_CONTROLS_CACHE_MS (0 in tests).

import type { AgentRole } from "../../shared/domain.ts";

interface CacheEntry {
  at: number;
  disabled: Set<AgentRole>;
}

let cache: CacheEntry | null = null;

export async function disabledRoles(db: D1Database, cacheMs: number, now: number = Date.now()): Promise<Set<AgentRole>> {
  if (cache && cacheMs > 0 && now - cache.at < cacheMs) return cache.disabled;
  const { results } = await db.prepare("SELECT role FROM agent_controls WHERE disabled = 1").all<{ role: AgentRole }>();
  cache = { at: now, disabled: new Set(results.map((r) => r.role)) };
  return cache.disabled;
}

export function clearRoleControlsCache(): void {
  cache = null;
}
