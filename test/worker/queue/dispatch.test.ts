import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { HandleOutcome } from "../../../src/worker/agents/role-agent.ts";
import { handleQueueBatch, type ConsumerDeps } from "../../../src/worker/queue/consumer.ts";
import type { TaskMessage } from "../../../src/worker/queue/messages.ts";
import { batchMessage, syntheticMessage, testConfig } from "../../helpers/queue.ts";

describe("queue dispatch", { tags: ["orchestration"] }, () => {
  it("the consumer has at most CONSUMER_CONCURRENCY handleTask calls in flight for one batch", async () => {
    const config = testConfig();
    expect(config.consumerConcurrency).toBe(4);
    let inFlight = 0;
    let maxInFlight = 0;
    const handled: string[] = [];
    const deps: ConsumerDeps = {
      coordinator: async () => {
        throw new Error("not used");
      },
      roleAgent: async () => ({
        async handleTask(message: TaskMessage): Promise<HandleOutcome> {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 30));
          inFlight -= 1;
          handled.push(message.taskId);
          return { kind: "ack" };
        },
      }),
      isRoleDisabled: async () => false,
    };
    const messages = Array.from({ length: 10 }, () => batchMessage(syntheticMessage()));
    const batch = createMessageBatch("agentboard-tasks", messages);
    const ctx = createExecutionContext();
    await handleQueueBatch(batch, env, config, deps);
    const result = await getQueueResult(batch, ctx);
    expect(maxInFlight).toBe(config.consumerConcurrency);
    expect(handled).toHaveLength(10);
    expect([...result.explicitAcks].sort()).toEqual(messages.map((m) => m.id).sort());
  });
});
