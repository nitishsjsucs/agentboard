// OpenAI-compatible chat completions (SPEC section 11.2): local llama.cpp
// (llama-server) for evals, optional in dev, and usable against the Workers AI
// REST endpoint after a login.

import { stripThinking, timeoutSignal, type LlmProvider, type LlmRequest, type LlmResult } from "./provider.ts";

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetch?: typeof fetch;
  /** Adds chat_template_kwargs.enable_thinking=false (Qwen3); llama-server also runs with --reasoning off. */
  disableThinking?: boolean;
}

interface ChatCompletion {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = "openai-compatible" as const;
  readonly model: string;
  private readonly options: OpenAiCompatibleOptions;

  constructor(options: OpenAiCompatibleOptions) {
    this.options = options;
    this.model = options.model;
  }

  async generate(req: LlmRequest, signal?: AbortSignal): Promise<LlmResult> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      response_format: { type: "json_schema", json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema } },
      temperature: req.temperature,
      max_tokens: req.maxOutputTokens,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      ...(this.options.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.options.apiKey) headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(`${this.options.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: timeoutSignal(req.timeoutMs, signal),
    });
    if (!response.ok) throw new Error(`openai-compatible provider: HTTP ${response.status}`);
    const completion = (await response.json()) as ChatCompletion;
    const text = stripThinking(completion.choices?.[0]?.message?.content ?? "");
    return {
      text,
      usage: { inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 },
      latencyMs: Date.now() - started,
      provider: this.name,
      model: this.model,
      ...(typeof completion.model === "string" && completion.model ? { servedModel: completion.model } : {}),
    };
  }
}
