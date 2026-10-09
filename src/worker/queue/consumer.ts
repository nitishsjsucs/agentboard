// Queue consumer (SPEC section 7.2).
//
// DLQ batches (batch.queue === DLQ_QUEUE_NAME): record the message, then ask
// the coordinator to dead-letter the task. The coordinator does so only when
// the message's dispatchId is the task's current dispatch (and answers a repeat
// for a task it already dead-lettered with that dispatch as accepted);
// otherwise the row is marked ignored_stale on the message's first delivery.
// Always ack.
//
// Task batches: up to CONSUMER_CONCURRENCY messages at a time. Poison
// messages are audited and acked; messages for a disabled role are held at
// the coordinator and acked; everything else goes to the sharded role agent,
// whose outcome is ack or retry. A thrown error retries with backoff
// (infrastructure retry; it consumes no task attempt unless a claim was granted).

import { getAgentByName } from "agents";
import type { AgentRole } from "../../shared/domain.ts";
import type { RunCoordinatorRpc } from "../agents/coordinator/schema.ts";
import type { HandleOutcome, RoleAgentRpc } from "../agents/role-agent.ts";
import type { Config } from "../config.ts";
import { appendGlobalAudit } from "../db/console.ts";
import { backoff } from "./backoff.ts";
import { TaskMessage } from "./messages.ts";
import { disabledRoles } from "./role-controls.ts";
import { shardName } from "./sharding.ts";

export interface ConsumerDeps {
  coordinator(runId: string): Promise<RunCoordinatorRpc>;
  roleAgent(role: AgentRole, name: string): Promise<RoleAgentRpc>;
  isRoleDisabled(role: AgentRole): Promise<boolean>;
}

const CONSUMER_ACTOR = { kind: "system" as const, id: "queue-consumer" };

export function defaultConsumerDeps(env: Env, config: Config): ConsumerDeps {
  return {
    async coordinator(runId) {
      return (await getAgentByName(env.RunCoordinator, runId)) as unknown as RunCoordinatorRpc;
    },
    async roleAgent(role, name) {
      const namespace = role === "planner" ? env.PlannerAgent : role === "executor" ? env.ExecutorAgent : env.VerifierAgent;
      return (await getAgentByName(namespace as DurableObjectNamespace<never>, name)) as unknown as RoleAgentRpc;
    },
    async isRoleDisabled(role) {
      return (await disabledRoles(env.DB, config.agentControlsCacheMs)).has(role);
    },
  };
}

/** Runs `worker` over `items` with at most `limit` in flight. */
export async function withConcurrency<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

export async function handleQueueBatch(batch: MessageBatch<unknown>, env: Env, config: Config, deps: ConsumerDeps = defaultConsumerDeps(env, config)): Promise<void> {
  if (batch.queue === config.dlqQueueName) {
    await withConcurrency(batch.messages, config.consumerConcurrency, (message) => handleDeadLetter(message, env, deps));
    return;
  }
  await withConcurrency(batch.messages, config.consumerConcurrency, (message) => handleTaskMessage(message, env, config, deps));
}

async function recordPoison(message: Message<unknown>, env: Env, reason: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO dlq_messages (id, run_id, task_id, dispatch_id, body_json, attempts, outcome, received_at)
     VALUES (?, NULL, NULL, NULL, ?, ?, 'poison', ?)`,
  )
    .bind(message.id, safeJson(message.body), message.attempts, new Date().toISOString())
    .run();
  await appendGlobalAudit(env.DB, {
    actorType: "system",
    actorId: CONSUMER_ACTOR.id,
    action: "message.poison",
    detail: { messageId: message.id, attempts: message.attempts, reason },
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify(String(value));
  }
}

async function handleTaskMessage(message: Message<unknown>, env: Env, config: Config, deps: ConsumerDeps): Promise<void> {
  const parsed = TaskMessage.safeParse(message.body);
  if (!parsed.success) {
    try {
      await recordPoison(message, env, "invalid_body");
      message.ack();
    } catch {
      message.retry({ delaySeconds: backoff(message.attempts, message.id, config) });
    }
    return;
  }
  const body = parsed.data;
  try {
    if (await deps.isRoleDisabled(body.role)) {
      const coordinator = await deps.coordinator(body.runId);
      await coordinator.control({
        type: "hold_role",
        actor: CONSUMER_ACTOR,
        reason: `${body.role} role disabled`,
        taskId: body.taskId,
        dispatchId: body.dispatchId,
        role: body.role,
      });
      message.ack();
      return;
    }
    const agent = await deps.roleAgent(body.role, shardName(body.role, body.runId, body.taskId, body.attempt, config.agentShards));
    const outcome: HandleOutcome = await agent.handleTask(body);
    if (outcome.kind === "retry") message.retry({ delaySeconds: outcome.delaySeconds });
    else message.ack();
  } catch (error) {
    console.warn("consumer: delivery failed; retrying", { messageId: message.id, attempts: message.attempts, error: String(error) });
    message.retry({ delaySeconds: backoff(message.attempts, message.id, config) });
  }
}

async function handleDeadLetter(message: Message<unknown>, env: Env, deps: ConsumerDeps): Promise<void> {
  const parsed = TaskMessage.safeParse(message.body);
  if (!parsed.success) {
    await recordPoison(message, env, "invalid_body_in_dlq");
    message.ack();
    return;
  }
  const body = parsed.data;
  try {
    const insert = await env.DB.prepare(
      `INSERT OR IGNORE INTO dlq_messages (id, run_id, task_id, dispatch_id, body_json, attempts, outcome, received_at)
       VALUES (?, ?, ?, ?, ?, ?, 'dead_lettered', ?)`,
    )
      .bind(message.id, body.runId, body.taskId, body.dispatchId, JSON.stringify(body), message.attempts, new Date().toISOString())
      .run();
    const coordinator = await deps.coordinator(body.runId);
    const result = await coordinator.control({
      type: "dead_letter",
      actor: { kind: "system", id: "dlq-consumer" },
      reason: "delivery retries exhausted",
      taskId: body.taskId,
      dispatchId: body.dispatchId,
    });
    // Only this message's first delivery decides its outcome. A redelivery (or a retry after the
    // coordinator had already committed) finds the row in place and leaves it alone: the dead-letter
    // is idempotent at the coordinator, and a row that was replayed or recovered since must keep its record.
    if (!result.accepted && insert.meta.changes > 0) {
      await env.DB.prepare("UPDATE dlq_messages SET outcome = 'ignored_stale' WHERE id = ? AND outcome = 'dead_lettered' AND replayed_at IS NULL")
        .bind(message.id)
        .run();
    }
    message.ack();
  } catch (error) {
    console.warn("dlq consumer: failed; retrying", { messageId: message.id, error: String(error) });
    message.retry();
  }
}
