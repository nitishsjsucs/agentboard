// PlannerAgent (SPEC section 7.1): the only agent that calls a model. It reads
// the tool catalog over MCP with its catalog-only token (cached 5 minutes,
// traced when fetched), plans with one repair, logs every model call, and
// reports the plan with its token usage. Policy, allowlists and subject
// pinning are enforced by the validator, and again by the coordinator.

import { Client } from "@modelcontextprotocol/client";
import type { RequestType } from "../../shared/domain.ts";
import { goldFixtures } from "../llm/fixtures.ts";
import type { LlmProvider } from "../llm/provider.ts";
import { selectProvider } from "../llm/select.ts";
import type { AiRunner } from "../llm/workers-ai.ts";
import { withPeopleOps } from "../mcp/client.ts";
import { promptHash } from "../llm/stub.ts";
import { buildPlanPrompt, planRequest, PlanningError, type CatalogEntry, type PlanCall } from "../planning/planner.ts";
import { newCallId } from "../util/ids.ts";
import type { CompletionReport, RunCoordinatorRpc } from "./coordinator/schema.ts";
import { RoleAgent, type GrantedClaim } from "./role-agent.ts";

const CATALOG_TTL_MS = 5 * 60_000;

export class PlannerAgent extends RoleAgent {
  readonly role = "planner" as const;
  /** Test-only provider override (set through runInDurableObject); never set in production code. */
  providerOverride: LlmProvider | null = null;
  private tablesReady = false;

  override onStart(): void {
    this.ensureTables();
  }

  private ensureTables(): void {
    if (this.tablesReady) return;
    this.sql`CREATE TABLE IF NOT EXISTS ab_planning_log (task_id TEXT NOT NULL, run_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      prompt_hash TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, max_output_tokens INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL, valid_first_pass INTEGER NOT NULL, repaired INTEGER NOT NULL, error TEXT, at TEXT NOT NULL)`;
    this.sql`CREATE TABLE IF NOT EXISTS ab_catalog_cache (fetched_at INTEGER NOT NULL, tools_json TEXT NOT NULL)`;
    this.tablesReady = true;
  }

  protected async work(claim: GrantedClaim, coordinator: RunCoordinatorRpc): Promise<CompletionReport | null> {
    this.ensureTables();
    const config = this.config();
    const context = claim.context;
    const token = claim.credential?.token;
    if (!token) throw new Error("planner claim carried no credential");
    const catalog = await this.catalog(token, claim, coordinator);
    const llm = this.providerOverride ?? (await this.provider(catalog));

    const input = { requestType: context.request.requestType as RequestType, subjectEmployeeId: context.request.subjectEmployeeId, requestText: context.request.requestText };
    const prompt = buildPlanPrompt(input, catalog, context.budget.maxSteps);
    const hash = promptHash(prompt.system, prompt.user);
    const log = (calls: readonly PlanCall[], validFirstPass: boolean, error: string | null) => {
      for (const call of calls) {
        this.sql`INSERT INTO ab_planning_log (task_id, run_id, provider, model, prompt_hash, input_tokens, output_tokens, max_output_tokens, latency_ms,
          valid_first_pass, repaired, error, at) VALUES (${context.taskId}, ${context.runId}, ${call.result?.provider ?? llm.name}, ${call.result?.model ?? llm.model},
          ${hash}, ${call.result?.usage.inputTokens ?? 0}, ${call.result?.usage.outputTokens ?? 0}, ${call.maxOutputTokens}, ${call.result?.latencyMs ?? 0},
          ${validFirstPass ? 1 : 0}, ${call.purpose === "plan_repair" ? 1 : 0}, ${error}, ${new Date().toISOString()})`;
      }
    };
    let outcome;
    try {
      outcome = await planRequest(llm, input, catalog, {
        maxSteps: context.budget.maxSteps,
        remainingLlmTokens: context.remaining.llmTokens,
        timeoutMs: config.llmTimeoutMs,
        temperature: 0,
        metadata: { runId: context.runId, taskId: context.taskId },
      });
    } catch (error) {
      // A model call failed: log the calls, then let the role skeleton report a retryable failure
      // that carries the tokens already spent (PlanningError.llmTokens).
      if (error instanceof PlanningError) log(error.calls, false, "llm_error");
      throw error;
    }
    log(outcome.calls, outcome.ok && outcome.validFirstPass, outcome.ok ? null : outcome.code);
    const base = { taskId: context.taskId, leaseId: claim.lease.leaseId, epoch: claim.lease.epoch, usage: { llmTokens: outcome.llmTokens } };
    if (outcome.ok) return { ...base, outcome: "succeeded", output: { plan: outcome.plan, validFirstPass: outcome.validFirstPass, repaired: outcome.repaired } };
    return {
      ...base,
      outcome: "failed",
      retryable: false,
      code: outcome.code,
      evidence: { issues: outcome.issues.map((i) => ({ code: i.code, stepId: i.stepId ?? null, message: i.message })), policyViolations: outcome.policyViolations },
    };
  }

  private async provider(catalog: CatalogEntry[]): Promise<LlmProvider> {
    const config = this.config();
    // The stub answers from fixtures built with the catalog this agent actually fetched.
    const fixtures = config.llmProvider === "stub" ? await goldFixtures(catalog) : new Map<string, string>();
    return selectProvider(config, { ai: (this.env as { AI?: AiRunner }).AI, stubFixtures: () => fixtures });
  }

  /** tools/list over MCP with the planner's catalog token, cached for 5 minutes; a fetch is traced. */
  private async catalog(token: string, claim: GrantedClaim, coordinator: RunCoordinatorRpc): Promise<CatalogEntry[]> {
    const cached = this.sql<{ fetched_at: number; tools_json: string }>`SELECT fetched_at, tools_json FROM ab_catalog_cache ORDER BY fetched_at DESC LIMIT 1`[0];
    if (cached && Date.now() - cached.fetched_at < CATALOG_TTL_MS) return JSON.parse(cached.tools_json) as CatalogEntry[];
    const started = Date.now();
    // Bounded like every other MCP call, so the planner's lease covers the catalog read (SPEC section 5.2).
    const timeoutMs = this.config().toolTimeoutMs;
    const tools = await withPeopleOps(this.env, this.config(), token, async (client: Client) => (await client.listTools(undefined, { signal: AbortSignal.timeout(timeoutMs), timeout: timeoutMs })).tools);
    const catalog: CatalogEntry[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
    const finished = Date.now();
    this.sql`DELETE FROM ab_catalog_cache`;
    this.sql`INSERT INTO ab_catalog_cache (fetched_at, tools_json) VALUES (${finished}, ${JSON.stringify(catalog)})`;
    await coordinator.appendTrace({
      id: newCallId(),
      taskId: claim.context.taskId,
      leaseId: claim.lease.leaseId,
      epoch: claim.lease.epoch,
      stepId: null,
      agent: this.name,
      tool: "tools/list",
      args: {},
      idempotencyKey: null,
      attempt: claim.context.attempt,
      generation: claim.context.generation,
      outcome: "ok",
      logical: false,
      result: { tools: catalog.length },
      error: null,
      startedAt: started,
      finishedAt: finished,
      durationMs: finished - started,
    });
    return catalog;
  }
}
