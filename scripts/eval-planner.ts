// npm run eval:planner (SPEC section 14.2): planning quality of a local model
// (llama-server, OpenAI-compatible) on the 100 dataset requests, scored
// against the gold plans with the planner's own validator and policy.
//
//   LLM_BASE_URL=http://127.0.0.1:8080 npm run eval:planner
//   npm run eval:planner -- --provider stub   (sanity file; must score 100%)

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { generateDataset } from "../src/shared/synth/generator.ts";
import { goldFixtures } from "../src/worker/llm/fixtures.ts";
import { OpenAiCompatibleProvider } from "../src/worker/llm/openai-compatible.ts";
import type { LlmProvider } from "../src/worker/llm/provider.ts";
import { StubProvider } from "../src/worker/llm/stub.ts";
import { planRequest, registryCatalog, validatePlan } from "../src/worker/planning/planner.ts";
import { approvalFor } from "../src/worker/planning/policy.ts";
import { isToolName } from "../src/worker/planning/tool-registry.ts";
import { resultMeta, ROOT } from "./lib/meta.ts";
import { argAccuracy, multisetF1, percentile, sequenceExact, type StepLike } from "./lib/metrics.ts";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "openai-compatible" },
    label: { type: "string" },
    limit: { type: "string" },
  },
});
const SLOT_TOKENS = 8192;
const baseUrl = process.env["LLM_BASE_URL"] ?? "http://127.0.0.1:8080";
const modelLabel = process.env["LLM_MODEL"] ?? "qwen3-1.7b-q4_0";
const gguf = process.env["AGENTBOARD_GGUF"] ?? join(process.env["HOME"] ?? "", "Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf");
const serverFlags = process.env["LLM_SERVER_FLAGS"] ?? "-np 1 -c 8192 --reasoning off --jinja";
const dataset = generateDataset();
const runs = dataset.runs.slice(0, values.limit ? Number(values.limit) : dataset.runs.length);
const catalog = registryCatalog();

let provider: LlmProvider;
if (values.provider === "stub") provider = new StubProvider(await goldFixtures(catalog));
else provider = new OpenAiCompatibleProvider({ baseUrl, model: modelLabel, disableThinking: true });
const label = values.label ?? (values.provider === "stub" ? "stub" : modelLabel);

function llamaBuild(): string {
  if (values.provider === "stub") return "n/a";
  try {
    return execFileSync("llama-server", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").filter(Boolean).join(" ");
  } catch (error) {
    const output = (error as { stderr?: string; stdout?: string }).stderr ?? "";
    return output.trim().split("\n").filter(Boolean).join(" ") || "unknown";
  }
}

interface PerRequest {
  ref: string;
  requestType: string;
  validFirstPass: boolean;
  validAfterRepair: boolean;
  policyViolation: boolean;
  exact: boolean;
  f1: number;
  matchedFields: number;
  equalFields: number;
  steps: number;
  unknownTools: number;
  policyOverrides: number;
  latencyMs: number;
  promptTokens: number[];
  tokensOut: number;
  error: string | null;
}

const perRequest: PerRequest[] = [];
for (const [index, run] of runs.entries()) {
  const input = { requestType: run.requestType, subjectEmployeeId: run.subjectEmployeeId, requestText: run.requestText };
  const started = performance.now();
  let row: PerRequest;
  try {
    const outcome = await planRequest(provider, input, catalog, {
      maxSteps: 8,
      remainingLlmTokens: 6000,
      timeoutMs: Number(process.env["LLM_TIMEOUT_MS"] ?? 60_000),
      temperature: 0,
      seed: 7,
      metadata: { runId: run.ref, taskId: "eval" },
    });
    const promptTokens = outcome.calls.map((c) => c.result?.usage.inputTokens ?? 0);
    for (const call of outcome.calls) {
      const prompt = call.result?.usage.inputTokens ?? 0;
      if (prompt + call.maxOutputTokens > SLOT_TOKENS) throw new Error(`${run.ref}: prompt ${prompt} + max output ${call.maxOutputTokens} exceeds the ${SLOT_TOKENS}-token slot`);
    }
    // Score the last plan the model produced (the repair when there was one).
    const lastText = outcome.calls.at(-1)?.result?.text ?? "";
    let steps: StepLike[] = [];
    try {
      const parsed = JSON.parse(lastText) as { steps?: { tool?: unknown; args?: unknown }[] };
      steps = (parsed.steps ?? []).map((s) => ({ tool: String(s.tool ?? ""), args: (s.args && typeof s.args === "object" ? s.args : {}) as Record<string, unknown> }));
    } catch {
      steps = [];
    }
    const goldTools = run.goldPlan.steps.map((s) => s.tool);
    const tools = steps.map((s) => s.tool);
    const args = argAccuracy(steps, run.goldPlan.steps);
    const finalCheck = validatePlan(lastText, { requestType: run.requestType, subjectEmployeeId: run.subjectEmployeeId, maxSteps: 8 });
    row = {
      ref: run.ref,
      requestType: run.requestType,
      validFirstPass: outcome.ok && outcome.validFirstPass,
      validAfterRepair: outcome.ok,
      policyViolation: !outcome.ok && outcome.policyViolations.length > 0,
      exact: sequenceExact(tools, goldTools),
      f1: multisetF1(tools, goldTools),
      matchedFields: args.matchedFields,
      equalFields: args.equalFields,
      steps: steps.length,
      unknownTools: steps.filter((s) => !isToolName(s.tool)).length,
      // The output schema has no approval field, so every policy-gated step is set by policy, not the model.
      policyOverrides: finalCheck.ok ? finalCheck.plan.steps.filter((s) => approvalFor(s).required && (s as { requiresApproval?: unknown }).requiresApproval !== true).length : 0,
      latencyMs: performance.now() - started,
      promptTokens,
      tokensOut: outcome.calls.reduce((sum, c) => sum + (c.result?.usage.outputTokens ?? 0), 0),
      error: outcome.ok ? null : outcome.code,
    };
  } catch (error) {
    row = {
      ref: run.ref,
      requestType: run.requestType,
      validFirstPass: false,
      validAfterRepair: false,
      policyViolation: false,
      exact: false,
      f1: 0,
      matchedFields: 0,
      equalFields: 0,
      steps: 0,
      unknownTools: 0,
      policyOverrides: 0,
      latencyMs: performance.now() - started,
      promptTokens: [],
      tokensOut: 0,
      error: error instanceof Error ? error.message : String(error),
    };
    if (String(row.error).includes("exceeds the")) throw error;
  }
  perRequest.push(row);
  console.log(`${index + 1}/${runs.length} ${run.ref} ${run.requestType}: ${row.validAfterRepair ? (row.validFirstPass ? "valid" : "valid after repair") : `invalid (${row.error})`} ${Math.round(row.latencyMs)} ms, prompt ${row.promptTokens.join("+")}`);
}

const n = perRequest.length;
const sum = (f: (r: PerRequest) => number) => perRequest.reduce((acc, r) => acc + f(r), 0);
const allPrompts = perRequest.flatMap((r) => r.promptTokens);
const metrics = {
  n,
  valid_first_pass: sum((r) => (r.validFirstPass ? 1 : 0)),
  valid_after_repair: sum((r) => (r.validAfterRepair ? 1 : 0)),
  policy_violations: sum((r) => (r.policyViolation ? 1 : 0)),
  tool_sequence_exact: sum((r) => (r.exact ? 1 : 0)),
  tool_set_f1_macro: n ? sum((r) => r.f1) / n : 0,
  arg_accuracy: sum((r) => r.matchedFields) ? sum((r) => r.equalFields) / sum((r) => r.matchedFields) : 0,
  unknown_tool_rate: sum((r) => r.steps) ? sum((r) => r.unknownTools) / sum((r) => r.steps) : 0,
  policy_overrides: sum((r) => r.policyOverrides),
  latency_ms_p50: percentile(perRequest.map((r) => r.latencyMs), 50),
  latency_ms_p95: percentile(perRequest.map((r) => r.latencyMs), 95),
  prompt_tokens_p50: percentile(allPrompts, 50),
  prompt_tokens_max: allPrompts.length ? Math.max(...allPrompts) : null,
  tokens_out_total: sum((r) => r.tokensOut),
  errors: perRequest.filter((r) => r.error && !r.validAfterRepair).length,
};
const output = {
  meta: {
    ...resultMeta(provider.name, provider.model),
    label,
    llama_cpp_build: llamaBuild(),
    gguf: values.provider === "stub" ? "n/a" : basename(gguf),
    quant: values.provider === "stub" ? "n/a" : "Q4_0",
    server_flags: values.provider === "stub" ? "n/a" : serverFlags,
    base_url: values.provider === "stub" ? "n/a" : baseUrl,
    temperature: 0,
    seed: 7,
    sanity: values.provider === "stub",
  },
  metrics,
  perRequest,
};
mkdirSync(join(ROOT, "eval/results"), { recursive: true });
const file = join(ROOT, `eval/results/planner-${label}.json`);
writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(metrics, null, 2));
console.log(`wrote ${file}`);
if (values.provider === "stub" && (metrics.valid_first_pass !== n || metrics.tool_sequence_exact !== n || metrics.arg_accuracy !== 1)) {
  console.error("the stub sanity run must score 100%");
  process.exit(1);
}
