// Deterministic providers for tests and the simulation (SPEC section 11.2).
// StubProvider looks up sha256(system + "\n" + user) in fixtures generated
// from the dataset's gold plans; an unknown prompt throws StubMiss.

import { createHash } from "node:crypto";
import { estimateTokens, type LlmProvider, type LlmRequest, type LlmResult } from "./provider.ts";

export class StubMiss extends Error {
  readonly promptHash: string;
  constructor(promptHash: string) {
    super(`stub LLM has no fixture for prompt ${promptHash.slice(0, 12)}`);
    this.name = "StubMiss";
    this.promptHash = promptHash;
  }
}

export function promptHash(system: string, user: string): string {
  return createHash("sha256").update(`${system}\n${user}`).digest("hex");
}

export class StubProvider implements LlmProvider {
  readonly name = "stub" as const;
  readonly model = "stub-gold-plans";
  private readonly fixtures: ReadonlyMap<string, string>;

  constructor(fixtures: ReadonlyMap<string, string>) {
    this.fixtures = fixtures;
  }

  async generate(req: LlmRequest): Promise<LlmResult> {
    const hash = promptHash(req.system, req.user);
    const text = this.fixtures.get(hash);
    if (text === undefined) throw new StubMiss(hash);
    return {
      text,
      usage: { inputTokens: estimateTokens(req.system + "\n" + req.user), outputTokens: estimateTokens(text) },
      latencyMs: 0,
      provider: this.name,
      model: this.model,
    };
  }
}

/** Returns canned outputs in order (repair-path and injection tests). */
export class ScriptedProvider implements LlmProvider {
  readonly name = "stub" as const;
  readonly model = "scripted";
  readonly requests: LlmRequest[] = [];
  private readonly outputs: string[];

  constructor(outputs: string[]) {
    this.outputs = [...outputs];
  }

  async generate(req: LlmRequest): Promise<LlmResult> {
    this.requests.push(req);
    const text = this.outputs.shift();
    if (text === undefined) throw new Error("ScriptedProvider ran out of outputs");
    return {
      text,
      usage: { inputTokens: estimateTokens(req.system + "\n" + req.user), outputTokens: estimateTokens(text) },
      latencyMs: 0,
      provider: this.name,
      model: this.model,
    };
  }
}
