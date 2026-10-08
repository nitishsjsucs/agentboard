// VerifierAgent (SPEC section 7.1): checks the registry postcondition of one
// write with read tools only, using the read-bound token from its claim
// (bound to the verify tools, the run's subject and the execute result's ids).
// Deterministic: no model calls.

import type { Client } from "@modelcontextprotocol/client";
import { withPeopleOps } from "../mcp/client.ts";
import type { McpToolResult } from "../mcp/results.ts";
import { isToolName, TOOL_SPECS } from "../planning/tool-registry.ts";
import { newCallId } from "../util/ids.ts";
import { evaluate, verificationReads } from "../verification/postconditions.ts";
import type { CompletionReport, RunCoordinatorRpc } from "./coordinator/schema.ts";
import { classifyToolResult } from "./executor-agent.ts";
import { RoleAgent, type GrantedClaim } from "./role-agent.ts";

export class VerifierAgent extends RoleAgent {
  readonly role = "verifier" as const;
  private tablesReady = false;

  override onStart(): void {
    this.ensureTables();
  }

  private ensureTables(): void {
    if (this.tablesReady) return;
    this.sql`CREATE TABLE IF NOT EXISTS ab_verification_log (task_id TEXT NOT NULL, run_id TEXT NOT NULL, "check" TEXT NOT NULL, passed INTEGER NOT NULL,
      evidence_json TEXT NOT NULL, at TEXT NOT NULL)`;
    this.tablesReady = true;
  }

  protected async work(claim: GrantedClaim, coordinator: RunCoordinatorRpc): Promise<CompletionReport | null> {
    this.ensureTables();
    const config = this.config();
    const context = claim.context;
    const step = context.step;
    if (!step || !isToolName(step.tool)) throw new Error("verify task has no known write step");
    const spec = TOOL_SPECS[step.tool].verify;
    if (!spec) throw new Error(`${step.tool} has no postcondition`);
    const token = claim.credential?.token;
    if (!token) throw new Error("verifier claim carried no credential");
    const base = { taskId: context.taskId, leaseId: claim.lease.leaseId, epoch: claim.lease.epoch, usage: {} };

    const reads: Record<string, unknown>[] = [];
    for (const read of verificationReads(spec.tools, step.args, context.executeResult)) {
      const started = Date.now();
      let result: McpToolResult | null = null;
      let thrown: unknown = null;
      let timedOut = false;
      try {
        result = await withPeopleOps(this.env, config, token, (client: Client) =>
          client.callTool({ name: read.tool, arguments: read.args }, { signal: AbortSignal.timeout(config.toolTimeoutMs), timeout: config.toolTimeoutMs }),
        ) as unknown as McpToolResult;
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) timedOut = true;
        else thrown = error;
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
        tool: read.tool,
        args: read.args,
        idempotencyKey: null,
        attempt: context.attempt,
        generation: context.generation,
        outcome: outcome.kind === "ok" ? "ok" : outcome.outcome,
        logical: false,
        result: outcome.kind === "ok" ? outcome.data : null,
        error: outcome.kind === "error" ? `${outcome.code}: ${outcome.message}` : null,
        startedAt: started,
        finishedAt: finished,
        durationMs: finished - started,
      });
      if (outcome.kind === "error") return { ...base, outcome: "failed", retryable: outcome.retryable, code: outcome.code, message: outcome.message };
      reads.push(outcome.data);
    }

    const verdict = evaluate(spec.check, step.args, reads);
    this.sql`INSERT INTO ab_verification_log (task_id, run_id, "check", passed, evidence_json, at)
      VALUES (${context.taskId}, ${context.runId}, ${spec.check}, ${verdict.passed ? 1 : 0}, ${JSON.stringify(verdict.evidence)}, ${new Date().toISOString()})`;
    if (verdict.passed) return { ...base, outcome: "succeeded", evidence: verdict.evidence };
    return { ...base, outcome: "failed", retryable: false, code: "postcondition_failed", evidence: verdict.evidence };
  }
}
