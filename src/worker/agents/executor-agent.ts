// ExecutorAgent (SPEC section 7.1): runs one plan step through the People Ops
// MCP server with the call-bound token from its claim. Deterministic: no
// model calls.
//
// 1. The idempotency key comes from the coordinator (task context and token).
// 2. ab_call_journal: a key this shard already completed is reported from the
//    journal without calling again (fast path; the integration ledger is the
//    authority across shards).
// 3. tools/call with _meta (key, run, task, step, generation, fault directive)
//    and a TOOL_TIMEOUT_MS deadline.
// 4. One trace per call, when the call finishes.
// 5. crash_after_call (dev simulation): after a successful call and its trace,
//    report nothing. Recovery is lease expiry, redispatch and a ledger replay.
// 6. completeTask with the result, or a failure classified per SPEC 8.4.

import type { Client } from "@modelcontextprotocol/client";
import { withPeopleOps } from "../mcp/client.ts";
import { FAULT_META_KEY } from "../mcp/faults.ts";
import type { McpToolResult, ToolFailure, ToolSuccess } from "../mcp/results.ts";
import { newCallId } from "../util/ids.ts";
import type { CompletionReport, RunCoordinatorRpc, ToolCallOutcome } from "./coordinator/schema.ts";
import { RoleAgent, type GrantedClaim } from "./role-agent.ts";

export type CallOutcome =
  | { kind: "ok"; data: Record<string, unknown>; replayed: boolean; logical: boolean }
  | { kind: "error"; outcome: ToolCallOutcome; retryable: boolean; code: string; message: string };

/** Maps an MCP tool result (or a thrown error / timeout) to a trace outcome and a retry decision (SPEC 8.4). */
export function classifyToolResult(result: McpToolResult | null, thrown: unknown, timedOut: boolean): CallOutcome {
  if (timedOut) return { kind: "error", outcome: "timeout", retryable: true, code: "timeout", message: "tool call exceeded TOOL_TIMEOUT_MS" };
  if (thrown !== undefined && thrown !== null) {
    return { kind: "error", outcome: "retryable_error", retryable: true, code: "transport_error", message: thrown instanceof Error ? thrown.message : String(thrown) };
  }
  const content = (result?.structuredContent ?? null) as ToolSuccess | ToolFailure | null;
  if (!content || typeof content !== "object") return { kind: "error", outcome: "retryable_error", retryable: true, code: "malformed_result", message: "no structured content" };
  if (content.ok) return { kind: "ok", data: content.data, replayed: content.replayed, logical: content.logical === true };
  switch (content.errorClass) {
    case "retryable":
      return { kind: "error", outcome: "retryable_error", retryable: true, code: content.code, message: content.message };
    case "in_progress":
      return { kind: "error", outcome: "in_progress", retryable: true, code: content.code, message: content.message };
    case "forbidden":
      return { kind: "error", outcome: "forbidden", retryable: false, code: content.code, message: content.message };
    default:
      return { kind: "error", outcome: "permanent_error", retryable: false, code: content.code, message: content.message };
  }
}

export type ToolCaller = (token: string, request: { name: string; arguments: Record<string, unknown>; _meta: Record<string, unknown> }, signal: AbortSignal) => Promise<McpToolResult>;

export class ExecutorAgent extends RoleAgent {
  readonly role = "executor" as const;
  /** Test-only replacement for the MCP call (set through runInDurableObject); never set in production code. */
  callOverride: ToolCaller | null = null;
  private tablesReady = false;

  override onStart(): void {
    this.ensureTables();
  }

  private ensureTables(): void {
    if (this.tablesReady) return;
    this.sql`CREATE TABLE IF NOT EXISTS ab_call_journal (idempotency_key TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, epoch INTEGER NOT NULL,
      tool TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('started','succeeded','failed')), result_json TEXT, started_at TEXT NOT NULL, finished_at TEXT)`;
    this.tablesReady = true;
  }

  protected async work(claim: GrantedClaim, coordinator: RunCoordinatorRpc): Promise<CompletionReport | null> {
    this.ensureTables();
    const config = this.config();
    const context = claim.context;
    const step = context.step;
    if (!step) throw new Error("execute task has no step");
    const token = claim.credential?.token;
    if (!token) throw new Error("executor claim carried no credential");
    const key = context.idempotencyKey;
    const base = { taskId: context.taskId, leaseId: claim.lease.leaseId, epoch: claim.lease.epoch, usage: {} };

    // Fast path: this shard already completed the key.
    if (key) {
      const journal = this.sql<{ state: string; result_json: string | null }>`SELECT state, result_json FROM ab_call_journal WHERE idempotency_key = ${key}`[0];
      if (journal?.state === "succeeded") {
        return { ...base, outcome: "succeeded", output: JSON.parse(journal.result_json ?? "{}") as Record<string, unknown> };
      }
      this.sql`INSERT OR REPLACE INTO ab_call_journal (idempotency_key, run_id, task_id, epoch, tool, state, result_json, started_at, finished_at)
        VALUES (${key}, ${context.runId}, ${context.taskId}, ${context.epoch}, ${step.tool}, 'started', NULL, ${new Date().toISOString()}, NULL)`;
    }

    const directive = context.faults.find((f) => f === "transient_error" || f === "permanent_error" || f === "silent_noop");
    const meta: Record<string, unknown> = {
      "agentboard/runId": context.runId,
      "agentboard/taskId": context.taskId,
      "agentboard/stepId": step.stepId,
      "agentboard/generation": context.generation,
      ...(key ? { "agentboard/idempotencyKey": key } : {}),
      ...(directive ? { [FAULT_META_KEY]: directive } : {}),
    };
    const request = { name: step.tool, arguments: step.args, _meta: meta };

    const started = Date.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, config.toolTimeoutMs);
    });
    let result: McpToolResult | null = null;
    let thrown: unknown = null;
    let timedOut = false;
    try {
      const raced = await Promise.race([this.callTool(token, request, controller.signal), timeout]);
      if (raced === "timeout") timedOut = true;
      else result = raced;
    } catch (error) {
      if (controller.signal.aborted) timedOut = true;
      else thrown = error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const finished = Date.now();
    const outcome = classifyToolResult(result, thrown, timedOut);

    await coordinator.appendTrace({
      id: newCallId(),
      taskId: context.taskId,
      leaseId: claim.lease.leaseId,
      epoch: claim.lease.epoch,
      stepId: step.stepId,
      agent: this.name,
      tool: step.tool,
      args: step.args,
      idempotencyKey: key,
      attempt: context.attempt,
      generation: context.generation,
      outcome: outcome.kind === "ok" ? (outcome.replayed ? "replayed" : "ok") : outcome.outcome,
      logical: outcome.kind === "ok" && outcome.logical,
      result: outcome.kind === "ok" ? outcome.data : null,
      error: outcome.kind === "error" ? `${outcome.code}: ${outcome.message}` : null,
      startedAt: started,
      finishedAt: finished,
      durationMs: finished - started,
    });

    if (key) {
      this.sql`UPDATE ab_call_journal SET state = ${outcome.kind === "ok" ? "succeeded" : "failed"},
        result_json = ${outcome.kind === "ok" ? JSON.stringify(outcome.data) : null}, finished_at = ${new Date(finished).toISOString()}
        WHERE idempotency_key = ${key}`;
    }

    if (outcome.kind === "ok" && context.faults.includes("crash_after_call")) {
      // Simulated crash: the call happened and was traced, but no report is sent.
      return null;
    }
    if (outcome.kind === "ok") return { ...base, outcome: "succeeded", output: outcome.data };
    return { ...base, outcome: "failed", retryable: outcome.retryable, code: outcome.code, message: outcome.message };
  }

  private async callTool(token: string, request: Parameters<ToolCaller>[1], signal: AbortSignal): Promise<McpToolResult> {
    if (this.callOverride) return this.callOverride(token, request, signal);
    const config = this.config();
    return withPeopleOps(this.env, config, token, async (client: Client) => {
      const result = await client.callTool(request, { signal, timeout: config.toolTimeoutMs });
      return result as unknown as McpToolResult;
    });
  }
}
