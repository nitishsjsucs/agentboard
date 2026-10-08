// Workers AI through AI Gateway (SPEC section 11.2). Production and preview
// only; never executed locally (it needs an account). Unit-tested with a fake Ai.

import { estimateTokens, stripThinking, type LlmProvider, type LlmRequest, type LlmResult } from "./provider.ts";

/** The slice of the Ai binding this provider uses. */
export interface AiRunner {
  run(model: string, inputs: Record<string, unknown>, options?: { gateway?: { id: string; metadata?: Record<string, string | number | boolean | null> } }): Promise<unknown>;
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

  async generate(req: LlmRequest): Promise<LlmResult> {
    const started = Date.now();
    const output = await this.ai.run(
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
      this.gatewayId ? { gateway: { id: this.gatewayId, metadata: { runId: req.metadata.runId } } } : undefined,
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
