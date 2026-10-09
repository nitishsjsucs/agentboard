// Workers AI through AI Gateway (SPEC section 11.2). Production and preview
// only; never executed locally (it needs an account). Unit-tested with a fake Ai.

import { estimateTokens, stripThinking, timeoutSignal, type LlmProvider, type LlmRequest, type LlmResult } from "./provider.ts";

/** The slice of the Ai binding this provider uses. */
export interface AiRunner {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: { gateway?: { id: string; metadata?: Record<string, string | number | boolean | null> }; signal?: AbortSignal },
  ): Promise<unknown>;
}

/**
 * Settles with `work`, or rejects as soon as `signal` aborts. The signal is
 * also handed to the binding, but the bound must hold even if a call ignores
 * it: PLANNER_LEASE_TTL_MS assumes every model call ends within LLM_TIMEOUT_MS.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  const reason = () => new Error(signal.reason instanceof Error && signal.reason.name !== "TimeoutError" ? signal.reason.message : `workers-ai provider: no response within ${timeoutMs} ms`);
  if (signal.aborted) return Promise.reject(reason());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(reason());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Normalizes the Workers AI output union (choices[0].message.content, response, or a string) to text. */
export function workersAiText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const record = output as { choices?: { message?: { content?: unknown } }[]; response?: unknown };
    const content = record.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (typeof record.response === "string") return record.response;
    if (record.response && typeof record.response === "object") return JSON.stringify(record.response);
  }
  throw new Error("workers-ai provider: unrecognized output shape");
}

export class WorkersAiProvider implements LlmProvider {
  readonly name = "workers-ai" as const;
  readonly model: string;
  private readonly ai: AiRunner;
  private readonly gatewayId: string;

  constructor(ai: AiRunner, model: string, gatewayId: string) {
    this.ai = ai;
    this.model = model;
    this.gatewayId = gatewayId;
  }

  /** Bounded by `req.timeoutMs` (LLM_TIMEOUT_MS) and the caller's signal. */
  async generate(req: LlmRequest, signal?: AbortSignal): Promise<LlmResult> {
    const started = Date.now();
    const abort = timeoutSignal(req.timeoutMs, signal);
    const output = await untilAborted(
      this.ai.run(
        this.model,
        {
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: { type: "json_schema", json_schema: req.jsonSchema.schema },
          temperature: req.temperature,
          max_tokens: req.maxOutputTokens,
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
        },
        {
          ...(this.gatewayId ? { gateway: { id: this.gatewayId, metadata: { runId: req.metadata.runId } } } : {}),
          signal: abort,
        },
      ),
      abort,
      req.timeoutMs,
    );
    const text = stripThinking(workersAiText(output));
    const usage = (output as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null)?.usage;
    return {
      text,
      usage: {
        inputTokens: usage?.prompt_tokens ?? estimateTokens(req.system + req.user),
        outputTokens: usage?.completion_tokens ?? estimateTokens(text),
      },
      latencyMs: Date.now() - started,
      provider: this.name,
      model: this.model,
    };
  }
}
