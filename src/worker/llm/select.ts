// Picks the provider by LLM_PROVIDER (SPEC section 11.2).

import type { Config } from "../config.ts";
import { OpenAiCompatibleProvider } from "./openai-compatible.ts";
import type { LlmProvider } from "./provider.ts";
import { StubProvider } from "./stub.ts";
import { WorkersAiProvider, type AiRunner } from "./workers-ai.ts";

export interface ProviderDeps {
  ai?: AiRunner | undefined;
  /** Prompt-hash fixtures for the stub provider. */
  stubFixtures: () => ReadonlyMap<string, string>;
  fetch?: typeof fetch;
}

export function selectProvider(config: Config, deps: ProviderDeps): LlmProvider {
  switch (config.llmProvider) {
    case "stub":
      return new StubProvider(deps.stubFixtures());
    case "openai-compatible":
      return new OpenAiCompatibleProvider({
        baseUrl: config.llmBaseUrl,
        model: config.llmModel,
        disableThinking: true,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
    case "workers-ai":
      if (!deps.ai) throw new Error("LLM_PROVIDER=workers-ai requires the AI binding");
      return new WorkersAiProvider(deps.ai, config.workersAiModel, config.aiGatewayId);
  }
}
