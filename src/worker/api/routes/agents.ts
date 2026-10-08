// Agent-role controls (SPEC section 7.7): disable holds a role's messages at
// the consumer; enable releases held tasks through a fan-out to every
// coordinator whose D1 mirror shows such holds. A coordinator wake rechecks
// holds whose mirror had not flushed yet.

import { Hono } from "hono";
import { ControlRequestSchema, type AgentRolesResponse } from "../../../shared/api-types.ts";
import { AGENT_ROLES, type AgentRole } from "../../../shared/domain.ts";
import { KIND_FOR_ROLE } from "../../agents/coordinator/schema.ts";
import { appendGlobalAudit } from "../../db/console.ts";
import { withConcurrency } from "../../queue/consumer.ts";
import { clearRoleControlsCache } from "../../queue/role-controls.ts";
import { coordinatorFor } from "../coordinator.ts";
import { apiError } from "../middleware/errors.ts";
import { requirePermission } from "../middleware/rbac.ts";
import { validate } from "../middleware/validate.ts";
import type { AppEnv } from "../types.ts";

export async function agentRoles(db: D1Database): Promise<AgentRolesResponse> {
  const { results } = await db.prepare("SELECT role, disabled, reason, updated_by, updated_at FROM agent_controls").all<{
    role: AgentRole;
    disabled: number;
    reason: string | null;
    updated_by: string;
    updated_at: string;
  }>();
  const held = await db
    .prepare("SELECT kind, COUNT(*) AS n FROM tasks WHERE status = 'held' AND hold_reason = 'role_disabled' GROUP BY kind")
    .all<{ kind: string; n: number }>();
  const heldByKind = new Map(held.results.map((r) => [r.kind, r.n]));
  return {
    roles: AGENT_ROLES.map((role) => {
      const row = results.find((r) => r.role === role);
      return {
        role,
        disabled: row?.disabled === 1,
        reason: row?.reason ?? null,
        updatedBy: row?.updated_by ?? "seed",
        updatedAt: row?.updated_at ?? new Date(0).toISOString(),
        heldTasks: heldByKind.get(KIND_FOR_ROLE[role]) ?? 0,
      };
    }),
  };
}

/** Releases role_disabled holds in every coordinator the D1 mirror points at (bounded concurrency). */
export async function releaseRoleHolds(env: Env, role: AgentRole, actor: { kind: "user" | "service" | "system"; id: string }, reason: string): Promise<number> {
  const { results } = await env.DB.prepare("SELECT DISTINCT run_id FROM tasks WHERE status = 'held' AND hold_reason = 'role_disabled' AND kind = ?")
    .bind(KIND_FOR_ROLE[role])
    .all<{ run_id: string }>();
  await withConcurrency(results, 4, async ({ run_id }) => {
    const coordinator = await coordinatorFor(env, run_id);
    await coordinator.control({ type: "release_role", role, actor, reason });
  });
  return results.length;
}

function isRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

export const agentRoutes = new Hono<AppEnv>()
  .get("/api/agents", requirePermission("agents:read"), async (c) => c.json(await agentRoles(c.env.DB)))
  .post("/api/agents/:role/:action{disable|enable}", requirePermission("agents:toggle"), validate("json", ControlRequestSchema), async (c) => {
    const role = c.req.param("role");
    if (!isRole(role)) return apiError(c, 404, "not_found", "no such agent role");
    const disabled = c.req.param("action") === "disable";
    const identity = c.get("identity");
    const { reason } = c.req.valid("json");
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO agent_controls (role, disabled, reason, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(role) DO UPDATE SET disabled = excluded.disabled, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
      .bind(role, disabled ? 1 : 0, reason, identity.principal.id, now)
      .run();
    clearRoleControlsCache();
    await appendGlobalAudit(c.env.DB, {
      actorType: identity.principal.kind,
      actorId: identity.principal.id,
      action: "agent_role.toggled",
      detail: { role, disabled, reason },
    });
    if (!disabled) await releaseRoleHolds(c.env, role, { kind: identity.principal.kind, id: identity.principal.id }, reason);
    return c.json(await agentRoles(c.env.DB));
  });
