import { describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "../../../src/worker/llm/openai-compatible.ts";
import type { LlmRequest } from "../../../src/worker/llm/provider.ts";
import { selectProvider } from "../../../src/worker/llm/select.ts";
import { promptHash, ScriptedProvider, StubMiss, StubProvider } from "../../../src/worker/llm/stub.ts";
import { WorkersAiProvider, type AiRunner } from "../../../src/worker/llm/workers-ai.ts";
import { testConfig } from "../../helpers/queue.ts";

const REQUEST: LlmRequest = {
  purpose: "plan",
  system: "You plan People-operations requests.",
  user: "Request type: address_change",
  jsonSchema: { name: "plan", schema: { type: "object", properties: { steps: { type: "array" } }, required: ["steps"] } },
  temperature: 0,
  maxOutputTokens: 800,
  timeoutMs: 2000,
  seed: 7,
  metadata: { runId: "run_x", taskId: "tsk_x" },
};

function completion(content: string, usage = { prompt_tokens: 321, completion_tokens: 54 }): Response {
  return Response.json({ choices: [{ message: { role: "assistant", content } }], usage });
}

describe("LLM providers", { tags: ["llm"] }, () => {
  it("the OpenAI-compatible provider sends the chat-completions shape with a JSON schema and reads the reported usage", async () => {
    const seen: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
    const provider = new OpenAiCompatibleProvider({
      baseUrl: "http://127.0.0.1:8140/",
      model: "qwen3-1.7b-q4_0",
      apiKey: "local-key",
      disableThinking: true,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers: new Headers(init?.headers) });
        return completion('{"steps":[]}');
      }) as typeof fetch,
    });
    const result = await provider.generate(REQUEST);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://127.0.0.1:8140/v1/chat/completions");
    expect(seen[0]?.headers.get("Authorization")).toBe("Bearer local-key");
    expect(seen[0]?.body).toEqual({
      model: "qwen3-1.7b-q4_0",
      messages: [
        { role: "system", content: REQUEST.system },
        { role: "user", content: REQUEST.user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "plan", schema: REQUEST.jsonSchema.schema } },
      temperature: 0,
      max_tokens: 800,
      seed: 7,
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(result).toMatchObject({ text: '{"steps":[]}', usage: { inputTokens: 321, outputTokens: 54 }, provider: "openai-compatible", model: "qwen3-1.7b-q4_0" });
  });

  it("strips <think> blocks from model output", async () => {
    const outputs = ['<think>\nThe user wants an address change.\n</think>\n\n{"steps":[1]}', 'leaked reasoning</think>{"steps":[2]}', '{"steps":[3]}'];
    const provider = new OpenAiCompatibleProvider({ baseUrl: "http://llm", model: "m", fetch: (async () => completion(outputs.shift() ?? "")) as typeof fetch });
    expect((await provider.generate(REQUEST)).text).toBe('{"steps":[1]}');
    expect((await provider.generate(REQUEST)).text).toBe('{"steps":[2]}');
    expect((await provider.generate(REQUEST)).text).toBe('{"steps":[3]}');
  });

  it("normalizes the Workers AI output union and passes the AI Gateway options (fake Ai)", async () => {
    const calls: { model: string; inputs: Record<string, unknown>; options: unknown }[] = [];
    const outputs: unknown[] = [
      { choices: [{ message: { content: '{"steps":["a"]}' } }], usage: { prompt_tokens: 100, completion_tokens: 10 } },
      { response: '{"steps":["b"]}' },
      { response: { steps: ["c"] } },
      '{"steps":["d"]}',
    ];
    const ai: AiRunner = {
      async run(model, inputs, options) {
        calls.push({ model, inputs, options });
        return outputs.shift();
      },
    };
    const provider = new WorkersAiProvider(ai, "@cf/qwen/qwen3-30b-a3b-fp8", "agentboard");
    const texts = [];
    for (let i = 0; i < 4; i++) texts.push((await provider.generate(REQUEST)).text);
    expect(texts).toEqual(['{"steps":["a"]}', '{"steps":["b"]}', '{"steps":["c"]}', '{"steps":["d"]}']);
    expect(calls[0]?.model).toBe("@cf/qwen/qwen3-30b-a3b-fp8");
    expect(calls[0]?.inputs).toMatchObject({ response_format: { type: "json_schema", json_schema: REQUEST.jsonSchema.schema }, temperature: 0, max_tokens: 800, seed: 7 });
    expect(calls[0]?.options).toEqual({ gateway: { id: "agentboard", collectLog: false, metadata: { runId: "run_x" } }, signal: expect.any(AbortSignal) });
    const withoutGateway = new WorkersAiProvider({ run: async (_m, _i, options) => (calls.push({ model: "x", inputs: {}, options }), "{}") }, "m", "");
    await withoutGateway.generate(REQUEST);
    expect(calls.at(-1)?.options).toEqual({ signal: expect.any(AbortSignal) });
    await expect(new WorkersAiProvider({ run: async () => ({ nothing: true }) }, "m", "").generate(REQUEST)).rejects.toThrow(/unrecognized output/);
  });

  it("bounds a Workers AI call by the request timeout even when the binding never answers, and aborts the signal it passed", async () => {
    let passed: AbortSignal | undefined;
    const hanging: AiRunner = {
      run: (_model, _inputs, options) => {
        passed = options?.signal;
        return new Promise(() => undefined);
      },
    };
    const started = Date.now();
    await expect(new WorkersAiProvider(hanging, "m", "agentboard").generate({ ...REQUEST, timeoutMs: 150 })).rejects.toThrow(/no response within 150 ms/);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(1500);
    expect(passed?.aborted).toBe(true);
    // The caller's signal bounds it too.
    const caller = new AbortController();
    const pending = new WorkersAiProvider(hanging, "m", "").generate({ ...REQUEST, timeoutMs: 60_000 }, caller.signal);
    caller.abort(new Error("lease lost"));
    await expect(pending).rejects.toThrow(/lease lost/);
  });

  it("the stub is deterministic and throws StubMiss for an unknown prompt; the scripted provider returns its queue in order", async () => {
    const fixtures = new Map([[promptHash(REQUEST.system, REQUEST.user), '{"steps":["gold"]}']]);
    const stub = new StubProvider(fixtures);
    const a = await stub.generate(REQUEST);
    const b = await stub.generate(REQUEST);
    expect(a).toEqual(b);
    expect(a.text).toBe('{"steps":["gold"]}');
    expect(a.usage).toEqual({ inputTokens: Math.ceil((REQUEST.system.length + 1 + REQUEST.user.length) / 4), outputTokens: Math.ceil(a.text.length / 4) });
    await expect(stub.generate({ ...REQUEST, user: "something else" })).rejects.toBeInstanceOf(StubMiss);
    const scripted = new ScriptedProvider(["first", "second"]);
    expect((await scripted.generate(REQUEST)).text).toBe("first");
    expect((await scripted.generate({ ...REQUEST, purpose: "plan_repair" })).text).toBe("second");
    expect(scripted.requests.map((r) => r.purpose)).toEqual(["plan", "plan_repair"]);
    await expect(scripted.generate(REQUEST)).rejects.toThrow(/ran out/);
  });

  it("selects the provider from LLM_PROVIDER", () => {
    const config = testConfig();
    const deps = { stubFixtures: () => new Map<string, string>(), ai: { run: async () => "{}" } };
    expect(selectProvider({ ...config, llmProvider: "stub" }, deps).name).toBe("stub");
    const local = selectProvider({ ...config, llmProvider: "openai-compatible", llmBaseUrl: "http://127.0.0.1:8140", llmModel: "qwen3-1.7b-q4_0" }, deps);
    expect([local.name, local.model]).toEqual(["openai-compatible", "qwen3-1.7b-q4_0"]);
    const cloud = selectProvider({ ...config, llmProvider: "workers-ai" }, deps);
    expect([cloud.name, cloud.model]).toEqual(["workers-ai", config.workersAiModel]);
    expect(() => selectProvider({ ...config, llmProvider: "workers-ai" }, { stubFixtures: deps.stubFixtures })).toThrow(/AI binding/);
  });
});
