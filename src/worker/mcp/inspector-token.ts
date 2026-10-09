// Claims for MCP Inspector tokens (SPEC section 10.4: `npm run dev:token --
// --integration`), used only against the dev-only external /mcp route. The
// token is executor-shaped, bound to one READ tool and its exact arguments,
// with a 60 s pseudo-lease. Write tools are refused here, so the external route
// can never apply an effect that did not go through a coordinator lease. Pure
// (no Workers APIs), so the Node script imports it too.

import { argsHash } from "../agents/coordinator/credentials.ts";
import type { IntegrationClaimInput } from "../auth/integration-tokens.ts";
import { isToolName, TOOL_INPUTS, TOOL_SPECS } from "../planning/tool-registry.ts";

export const INSPECTOR_LEASE_MS = 60_000;

export function inspectorReadClaims(tool: string, args: unknown, nowMs: number = Date.now()): IntegrationClaimInput {
  if (!isToolName(tool)) throw new Error(`unknown tool ${tool}`);
  const spec = TOOL_SPECS[tool];
  if (spec.kind !== "read") throw new Error(`${tool} is a write tool; inspector tokens bind read tools only`);
  const parsed = TOOL_INPUTS[tool].safeParse(args);
  if (!parsed.success) throw new Error(`arguments for ${tool} are invalid: ${parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}`);
  return {
    sub: "mcp-inspector",
    kind: "executor",
    run_id: "run_inspector",
    task_id: "tsk_inspector",
    epoch: 0,
    lease_exp_ms: nowMs + INSPECTOR_LEASE_MS,
    step_id: "inspector",
    tool,
    scope: spec.scope,
    args_sha256: argsHash(parsed.data),
  };
}
