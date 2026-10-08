// People Ops MCP server factory (SPEC sections 8.1 and 8.2): the 12 simulated
// People tools, each guarded by the call-bound token checks. Writes go through
// the integration ledger; dev-only fault directives are honored only when
// FAULT_INJECTION=on.

import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { argsHash } from "../agents/coordinator/credentials.ts";
import type { IntegrationClaims } from "../auth/integration-tokens.ts";
import type { Config } from "../config.ts";
import { TOOL_INPUTS, TOOL_NAMES, TOOL_SPECS, type ToolName } from "../planning/tool-registry.ts";
import { checkCall, META } from "./call-guard.ts";
import { faultDirective } from "./faults.ts";
import { applyEffects, claimKey, completeWithoutEffect, type LedgerCall } from "./ledger.ts";
import { failure, success, type McpToolResult } from "./results.ts";
import { grantRole, listRoles, revokeAllRoles, revokeRole } from "./tools/access.ts";
import { getEmployeeTool, setEmploymentStatus, updateAddress, updateManager } from "./tools/hris.ts";
import { createTicket, getTicket } from "./tools/itsm.ts";
import { getDelivery, sendNotification } from "./tools/notify.ts";
import { isWritePlan, type ReadImpl, type WriteImpl } from "./tools/types.ts";

const READS: Partial<Record<ToolName, ReadImpl>> = {
  "hris.get_employee": getEmployeeTool,
  "itsm.get_ticket": getTicket,
  "access.list_roles": listRoles,
  "notify.get_delivery": getDelivery,
};

const WRITES: Partial<Record<ToolName, WriteImpl>> = {
  "hris.update_address": updateAddress,
  "hris.update_manager": updateManager,
  "hris.set_employment_status": setEmploymentStatus,
  "itsm.create_ticket": createTicket,
  "access.grant_role": grantRole,
  "access.revoke_role": revokeRole,
  "access.revoke_all_roles": revokeAllRoles,
  "notify.send": sendNotification,
};

export function claimsFrom(ctx: ServerContext): IntegrationClaims | null {
  const extra = ctx.http?.authInfo?.extra as { claims?: IntegrationClaims } | undefined;
  return extra?.claims ?? null;
}

export async function runTool(
  tool: ToolName,
  args: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
  claims: IntegrationClaims | null,
  env: Env,
  config: Config,
): Promise<McpToolResult> {
  if (!claims) return failure("forbidden", "unauthenticated", "no verified integration token");
  const guard = checkCall(tool, args, meta, claims);
  if (!guard.ok) return failure("forbidden", guard.code, guard.message);

  const db = env.PEOPLE_DB;
  const read = READS[tool];
  if (read) return read(db, args);
  const write = WRITES[tool];
  if (!write) return failure("permanent", "unknown_tool", tool);

  // Fault directives that fail the call return before the ledger claim.
  const fault = faultDirective(meta, config.faultInjection);
  if (fault === "transient_error") return failure("retryable", "injected_transient", "simulated transient failure");
  if (fault === "permanent_error") return failure("permanent", "injected_permanent", "simulated permanent failure");

  const now = Date.now();
  const call: LedgerCall = {
    db,
    key: String(meta?.[META.idempotencyKey]),
    tool,
    argsHash: argsHash(args),
    correlationId: `${claims.run_id}:${claims.step_id ?? ""}`,
    runId: claims.run_id,
    stepId: claims.step_id ?? "",
    generation: generationFromMeta(meta),
    owner: `${claims.sub}:${claims.task_id}:${claims.epoch}`,
    lockMs: config.ledgerLockMs,
    now,
  };
  const claim = await claimKey(call);
  if (claim.state === "replay") return success(claim.result, true);
  if (claim.state === "conflict") return failure("permanent", "idempotency_conflict", "the key was used with different arguments");
  if (claim.state === "busy") return failure("in_progress", "in_progress", "another holder is applying this call");

  const plan = await write(db, args, new Date(now).toISOString());
  if (!isWritePlan(plan)) return plan;
  const applied = fault === "silent_noop" ? await completeWithoutEffect(call, plan.result) : await applyEffects(call, plan);
  if (applied.outcome === "lost") return failure("in_progress", "ownership_lost", "the ledger lock was taken over; nothing was applied");
  return success(applied.result, false);
}

function generationFromMeta(meta: Record<string, unknown> | undefined): number {
  const value = meta?.["agentboard/generation"];
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

export function buildPeopleOpsServer(env: Env, config: Config): McpServer {
  const server = new McpServer({ name: "agentboard-people-ops", version: "1.0.0" });
  for (const name of TOOL_NAMES) {
    server.registerTool(
      name,
      { description: TOOL_SPECS[name].description, inputSchema: TOOL_INPUTS[name] },
      async (args: unknown, ctx: ServerContext) =>
        runTool(name, args as Record<string, unknown>, ctx.mcpReq._meta as Record<string, unknown> | undefined, claimsFrom(ctx), env, config),
    );
  }
  return server;
}
