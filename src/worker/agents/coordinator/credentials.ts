// Idempotency keys and call-bound integration credentials (SPEC sections 7.1 and 10.4).
// The coordinator knows everything a token binds: the leased task's tool and
// arguments, the idempotency key it derives, the verify spec and the execute
// result's ids. Role agents never sign tokens.

import { createHash } from "node:crypto";
import { canonicalJson } from "../../../shared/canonical-json.ts";
import { signIntegrationToken, type IntegrationClaimInput } from "../../auth/integration-tokens.ts";
import { isToolName, isWriteTool, TOOL_SPECS } from "../../planning/tool-registry.ts";
import type { Credential, RunState, TaskRecord } from "./schema.ts";

/** ik_ + base64url(sha256(runId|stepId|generation|tool|canonicalJson(args))). Stable across attempts and epochs. */
export function idempotencyKey(runId: string, stepId: string, generation: number, tool: string, args: unknown): string {
  const digest = createHash("sha256").update(`${runId}|${stepId}|${generation}|${tool}|${canonicalJson(args)}`).digest("base64url");
  return `ik_${digest}`;
}

export function argsHash(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args)).digest("hex");
}

/** Claims for the leased task's token: one tool and its exact arguments, or the verify reads, or the catalog. */
export function credentialClaims(state: RunState, task: TaskRecord): IntegrationClaimInput {
  const run = state.run;
  const base = {
    sub: task.leaseOwner ?? "unknown",
    run_id: run.id,
    task_id: task.id,
    epoch: task.leaseEpoch,
    lease_exp_ms: task.leaseExpiresAt ?? 0,
  };
  if (task.kind === "plan") return { ...base, kind: "planner", scope: "catalog:read" };
  const tool = task.tool ?? "";
  const args = task.args ?? {};
  const stepId = task.stepId ?? "";
  if (task.kind === "execute") {
    const spec = isToolName(tool) ? TOOL_SPECS[tool] : null;
    return {
      ...base,
      kind: "executor",
      step_id: stepId,
      tool,
      scope: spec?.scope ?? "none",
      args_sha256: argsHash(args),
      ...(isWriteTool(tool) ? { idem_key: idempotencyKey(run.id, stepId, task.generation, tool, args) } : {}),
    };
  }
  // verify: the registry's read tools for this write, the subject, and ids from the execute result.
  const verify = isToolName(tool) ? TOOL_SPECS[tool].verify : null;
  const reads = verify?.tools ?? [];
  const execute = [...state.tasks.values()].find((t) => t.kind === "execute" && t.stepId === task.stepId);
  const result = (execute?.result ?? null) as Record<string, unknown> | null;
  const refs: string[] = [];
  if (verify?.refField && result && typeof result[verify.refField] === "string") refs.push(result[verify.refField] as string);
  return {
    ...base,
    kind: "verifier",
    step_id: stepId,
    tools: reads,
    scope: [...new Set(reads.map((r) => TOOL_SPECS[r].scope))].join(" "),
    subject: run.request.subjectEmployeeId,
    refs,
  };
}

export async function mintCredential(state: RunState, task: TaskRecord, key: Uint8Array, nowMs: number): Promise<Credential> {
  const claims = credentialClaims(state, task);
  return { token: await signIntegrationToken(claims, key, nowMs), leaseExpMs: claims.lease_exp_ms };
}
