import { env } from "cloudflare:workers";
import type { Client } from "@modelcontextprotocol/client";
import { argsHash, idempotencyKey } from "../../src/worker/agents/coordinator/credentials.ts";
import { signIntegrationToken, type IntegrationClaimInput } from "../../src/worker/auth/integration-tokens.ts";
import { withPeopleOps } from "../../src/worker/mcp/client.ts";
import { peopleOpsEndpoint } from "../../src/worker/mcp/endpoint.ts";
import type { McpToolResult } from "../../src/worker/mcp/results.ts";
import { TOOL_SPECS, type ToolName } from "../../src/worker/planning/tool-registry.ts";
import { newRunId, newTaskId } from "../../src/worker/util/ids.ts";
import { testConfig } from "./queue.ts";

export const SIGNING_KEY = Uint8Array.from(atob(env.INTEGRATION_SIGNING_KEY), (c) => c.charCodeAt(0));

export interface CallBinding {
  runId: string;
  taskId: string;
  stepId: string;
  generation: number;
  key: string;
}

export function binding(tool: string, args: Record<string, unknown>, overrides: Partial<CallBinding> = {}): CallBinding {
  const runId = overrides.runId ?? newRunId();
  const stepId = overrides.stepId ?? "s2";
  const generation = overrides.generation ?? 0;
  return {
    runId,
    taskId: overrides.taskId ?? newTaskId(),
    stepId,
    generation,
    key: overrides.key ?? idempotencyKey(runId, stepId, generation, tool, args),
  };
}

/** An executor token for exactly this tool call, as the coordinator would mint it. */
export async function executorToken(tool: ToolName, args: Record<string, unknown>, b: CallBinding, opts: { leaseMs?: number; sub?: string; epoch?: number } = {}): Promise<string> {
  const leaseExp = Date.now() + (opts.leaseMs ?? 30_000);
  const claims: IntegrationClaimInput = {
    sub: opts.sub ?? "executor-0",
    kind: "executor",
    run_id: b.runId,
    task_id: b.taskId,
    epoch: opts.epoch ?? 1,
    lease_exp_ms: leaseExp,
    step_id: b.stepId,
    tool,
    scope: TOOL_SPECS[tool].scope,
    args_sha256: argsHash(args),
    ...(TOOL_SPECS[tool].kind === "write" ? { idem_key: b.key } : {}),
  };
  return signIntegrationToken(claims, SIGNING_KEY);
}

export async function verifierToken(tools: ToolName[], subject: string, refs: string[], b: Pick<CallBinding, "runId" | "taskId" | "stepId">): Promise<string> {
  return signIntegrationToken(
    {
      sub: "verifier-0",
      kind: "verifier",
      run_id: b.runId,
      task_id: b.taskId,
      epoch: 1,
      lease_exp_ms: Date.now() + 30_000,
      step_id: b.stepId,
      tools,
      scope: [...new Set(tools.map((t) => TOOL_SPECS[t].scope))].join(" "),
      subject,
      refs,
    },
    SIGNING_KEY,
  );
}

export async function plannerToken(runId: string, taskId: string, leaseMs = 30_000): Promise<string> {
  return signIntegrationToken({ sub: "planner-0", kind: "planner", run_id: runId, task_id: taskId, epoch: 1, lease_exp_ms: Date.now() + leaseMs, scope: "catalog:read" }, SIGNING_KEY);
}

export function writeMeta(b: CallBinding, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "agentboard/idempotencyKey": b.key,
    "agentboard/runId": b.runId,
    "agentboard/taskId": b.taskId,
    "agentboard/stepId": b.stepId,
    "agentboard/generation": b.generation,
    ...extra,
  };
}

export async function withClient<T>(token: string, fn: (client: Client) => Promise<T>): Promise<T> {
  return withPeopleOps(env, testConfig(), token, fn);
}

export async function call(token: string, name: ToolName, args: Record<string, unknown>, meta?: Record<string, unknown>): Promise<McpToolResult> {
  return withClient(token, async (client) => (await client.callTool({ name, arguments: args, ...(meta ? { _meta: meta } : {}) })) as unknown as McpToolResult);
}

/** Posts one raw JSON-RPC message to the endpoint (for refusals that happen before MCP). */
export async function rawRpc(token: string | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Host: "people-ops.internal" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return peopleOpsEndpoint(new Request("https://people-ops.internal/mcp", { method: "POST", headers, body: JSON.stringify(body) }), env, testConfig());
}

export async function sideEffects(): Promise<{ total: number }> {
  const row = await env.PEOPLE_DB.prepare("SELECT COUNT(*) AS total FROM side_effects").first<{ total: number }>();
  return { total: row?.total ?? 0 };
}
