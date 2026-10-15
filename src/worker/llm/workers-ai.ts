// Workers AI through AI Gateway (SPEC section 11.2). Production and preview
// only; never executed locally (it needs an account). Unit-tested with a fake Ai.

import { estimateTokens, stripThinking, timeoutSignal, type LlmProvider, type LlmRequest, type LlmResult } from "./provider.ts";

/** The slice of the Ai binding this provider uses. */
export interface AiRunner {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: { gateway?: { id: string; collectLog?: boolean; metadata?: Record<string, string | number | boolean | null> }; signal?: AbortSignal },
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

/**
 * Qwen3 models think before answering, and on Workers AI the thinking counts against max_tokens. In production
 * (2026-10-15) @cf/qwen/qwen3-30b-a3b-fp8 spent all 800 planner tokens on reasoning, finished with
 * finish_reason "length" and returned content null, so 2 of 4 verification runs failed. Qwen3's documented soft
 * switch "/no_think" at the end of the user turn turns thinking off (checked against the REST API the same day:
 * finish_reason "stop", valid JSON, about 310 tokens); chat_template_kwargs.enable_thinking=false did not.
 */
export function userTurnFor(model: string, user: string): string {
  return /qwen3/i.test(model) ? `${user}\n/no_think` : user;
}

/** Normalizes the Workers AI output union (choices[0].message.content, response, or a string) to text. */
export function workersAiText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const record = output as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; response?: unknown };
    const content = record.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim() !== "") return content;
    if (record.choices?.[0]?.finish_reason === "length") {
      throw new Error("workers-ai provider: the model used its whole output budget before answering (finish_reason length, no content)");
    }
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
            { role: "user", content: userTurnFor(this.model, req.user) },
          ],
          response_format: { type: "json_schema", json_schema: req.jsonSchema.schema },
          temperature: req.temperature,
          max_tokens: req.maxOutputTokens,
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
        },
        {
          // collectLog false: the prompt carries the request text, which the console treats as PII (pii:read),
          // and AI Gateway logs would keep it outside the console's redaction for anyone who can read the logs.
          ...(this.gatewayId ? { gateway: { id: this.gatewayId, collectLog: false, metadata: { runId: req.metadata.runId } } } : {}),
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
