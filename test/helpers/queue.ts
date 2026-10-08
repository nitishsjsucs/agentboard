import { env } from "cloudflare:workers";
import { loadConfig, type Config } from "../../src/worker/config.ts";
import type { TaskMessage } from "../../src/worker/queue/messages.ts";
import { newRunId, newTaskId } from "../../src/worker/util/ids.ts";

export function testConfig(): Config {
  const loaded = loadConfig(env);
  if (!loaded.ok) throw new Error(loaded.errors.join("; "));
  return loaded.config;
}

export function syntheticMessage(overrides: Partial<TaskMessage> = {}): TaskMessage {
  return {
    v: 1,
    runId: newRunId(),
    taskId: newTaskId(),
    role: "executor",
    dispatchId: crypto.randomUUID(),
    attempt: 1,
    enqueuedAt: Date.now(),
    ...overrides,
  };
}

let counter = 0;
export function batchMessage<T>(body: T, attempts = 1): { id: string; timestamp: number; attempts: number; body: T } {
  counter += 1;
  return { id: `msg-${Date.now()}-${counter}`, timestamp: Date.now(), attempts, body };
}
