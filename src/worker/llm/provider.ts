// LLM provider interface (SPEC section 11.1). Only the planner calls a model.

export interface LlmRequest {
  purpose: "plan" | "plan_repair";
  system: string;
  user: string;
  jsonSchema: { name: string; schema: Record<string, unknown> };
  /** 0 for evals. */
  temperature: number;
  /** min(800, remaining budget - estimated input). */
  maxOutputTokens: number;
  /** LLM_TIMEOUT_MS. */
  timeoutMs: number;
  seed?: number;
  metadata: { runId: string; taskId: string };
}

export interface LlmResult {
  /** Raw model text after <think> stripping. */
  text: string;
  /** Provider-reported when available. */
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  provider: "workers-ai" | "openai-compatible" | "stub";
  model: string;
}

export interface LlmProvider {
  readonly name: LlmResult["provider"];
  readonly model: string;
  generate(req: LlmRequest, signal?: AbortSignal): Promise<LlmResult>;
}

/** Removes any <think>...</think> block a reasoning model may emit, as a guard. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

/** A rough token estimate (about 4 characters per token) for providers that report no usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Combines the caller's signal with the request timeout. */
export function timeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
