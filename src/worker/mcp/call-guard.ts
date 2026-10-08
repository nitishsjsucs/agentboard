// Per-handler binding checks (SPEC section 8.3). The endpoint has already
// verified the token's signature, audience, expiry and lease expiry; every
// handler then checks that this exact call is the one the token was minted
// for, and answers forbidden with no side effect on any mismatch.

import { argsHash } from "../agents/coordinator/credentials.ts";
import type { IntegrationClaims } from "../auth/integration-tokens.ts";
import { TOOL_SPECS, type ToolName } from "../planning/tool-registry.ts";

export const META = {
  idempotencyKey: "agentboard/idempotencyKey",
  runId: "agentboard/runId",
  taskId: "agentboard/taskId",
  stepId: "agentboard/stepId",
} as const;

export type GuardResult = { ok: true } | { ok: false; code: string; message: string };

export function checkCall(tool: ToolName, args: Record<string, unknown>, meta: Record<string, unknown> | undefined, claims: IntegrationClaims): GuardResult {
  const spec = TOOL_SPECS[tool];
  const scopes = new Set(claims.scope.split(" "));
  if (claims.kind === "executor") {
    if (claims.tool !== tool) return { ok: false, code: "tool_not_bound", message: `token is bound to ${String(claims.tool)}, not ${tool}` };
    if (argsHash(args) !== claims.args_sha256) return { ok: false, code: "args_mismatch", message: "arguments differ from the ones the token was minted for" };
    if (!scopes.has(spec.scope)) return { ok: false, code: "scope_missing", message: `token lacks ${spec.scope}` };
    if (spec.kind === "write") {
      const m = meta ?? {};
      if (!claims.idem_key || m[META.idempotencyKey] !== claims.idem_key) return { ok: false, code: "meta_mismatch", message: "idempotency key does not match the token" };
      if (m[META.runId] !== claims.run_id || m[META.taskId] !== claims.task_id || m[META.stepId] !== claims.step_id) {
        return { ok: false, code: "meta_mismatch", message: "run, task or step does not match the token" };
      }
    }
    return { ok: true };
  }
  if (claims.kind === "verifier") {
    if (spec.kind !== "read" || !(claims.tools ?? []).includes(tool)) return { ok: false, code: "tool_not_bound", message: `verifier token does not allow ${tool}` };
    if (!scopes.has(spec.scope)) return { ok: false, code: "scope_missing", message: `token lacks ${spec.scope}` };
    if ("employeeId" in args && args["employeeId"] !== claims.subject) return { ok: false, code: "off_subject", message: "verifier may read only the run's subject" };
    for (const field of ["ticketId", "deliveryId"] as const) {
      if (field in args && !(claims.refs ?? []).includes(String(args[field]))) return { ok: false, code: "ref_not_bound", message: `${field} is not a result of the verified step` };
    }
    return { ok: true };
  }
  return { ok: false, code: "method_not_allowed", message: "planner tokens cannot call tools" };
}
