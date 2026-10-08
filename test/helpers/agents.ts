import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { ExecutorAgent, ToolCaller } from "../../src/worker/agents/executor-agent.ts";
import type { PlannerAgent } from "../../src/worker/agents/planner-agent.ts";
import type { HandleOutcome, RoleAgentRpc } from "../../src/worker/agents/role-agent.ts";
import type { LlmProvider } from "../../src/worker/llm/provider.ts";
import type { TaskMessage } from "../../src/worker/queue/messages.ts";
import { generateDataset, type SyntheticRun } from "../../src/shared/synth/generator.ts";
import { runInput, takeDispatches, type CoordinatorStub } from "./runs.ts";
import type { InitRunInput } from "../../src/worker/agents/coordinator/schema.ts";

const dataset = generateDataset();

export function datasetRun(ref: string): SyntheticRun {
  const run = dataset.runs.find((r) => r.ref === ref);
  if (!run) throw new Error(`no dataset run ${ref}`);
  return run;
}

export function firstRunOfType(type: SyntheticRun["requestType"], where: (run: SyntheticRun) => boolean = () => true): SyntheticRun {
  const run = dataset.runs.find((r) => r.requestType === type && where(r));
  if (!run) throw new Error(`no dataset run of type ${type}`);
  return run;
}

/** An InitRunInput carrying a dataset request, so the stub planner has its fixture. */
export function inputFromDataset(run: SyntheticRun, overrides: Partial<InitRunInput> = {}): InitRunInput {
  return runInput({
    requestType: run.requestType,
    subjectEmployeeId: run.subjectEmployeeId,
    requestText: run.requestText,
    title: run.title,
    ...overrides,
  });
}

export async function plannerAgent(name = "planner-0"): Promise<RoleAgentRpc> {
  return (await getAgentByName(env.PlannerAgent, name)) as unknown as RoleAgentRpc;
}

/** Runs one plan dispatch on a planner instance, optionally with a scripted provider. */
export async function runPlanner(message: TaskMessage, override: LlmProvider | null = null, name = "planner-0"): Promise<HandleOutcome> {
  const agent = await plannerAgent(name);
  await runInDurableObject(agent as unknown as DurableObjectStub<PlannerAgent>, (instance: PlannerAgent) => {
    instance.providerOverride = override;
  });
  return agent.handleTask(message);
}

export async function planningLog(name = "planner-0"): Promise<{ task_id: string; valid_first_pass: number; repaired: number; error: string | null; provider: string }[]> {
  const agent = await plannerAgent(name);
  return runInDurableObject(agent as unknown as DurableObjectStub<PlannerAgent>, (instance: PlannerAgent) =>
    instance.sql<{ task_id: string; valid_first_pass: number; repaired: number; error: string | null; provider: string }>`
      SELECT task_id, valid_first_pass, repaired, error, provider FROM ab_planning_log ORDER BY rowid`,
  );
}


export async function executorAgent(name = "executor-0"): Promise<RoleAgentRpc> {
  return (await getAgentByName(env.ExecutorAgent, name)) as unknown as RoleAgentRpc;
}

/** Runs one execute dispatch on an executor instance, optionally with a replacement MCP call. */
export async function runExecutor(message: TaskMessage, name = "executor-0", override: ToolCaller | null = null): Promise<HandleOutcome> {
  const agent = await executorAgent(name);
  await runInDurableObject(agent as unknown as DurableObjectStub<ExecutorAgent>, (instance: ExecutorAgent) => {
    instance.callOverride = override;
  });
  return agent.handleTask(message);
}

export async function journal(name = "executor-0"): Promise<{ idempotency_key: string; state: string; task_id: string }[]> {
  const agent = await executorAgent(name);
  return runInDurableObject(agent as unknown as DurableObjectStub<ExecutorAgent>, (instance: ExecutorAgent) =>
    instance.sql<{ idempotency_key: string; state: string; task_id: string }>`SELECT idempotency_key, state, task_id FROM ab_call_journal`,
  );
}

export async function verifierAgent(name = "verifier-0"): Promise<RoleAgentRpc> {
  return (await getAgentByName(env.VerifierAgent, name)) as unknown as RoleAgentRpc;
}

export async function agentFor(message: TaskMessage, shard = 0): Promise<RoleAgentRpc> {
  if (message.role === "planner") return plannerAgent(`planner-${shard}`);
  if (message.role === "executor") return executorAgent(`executor-${shard}`);
  return verifierAgent(`verifier-${shard}`);
}

/**
 * Delivers every dispatch of a manual run to the real role agents (shard 0)
 * until none remain or `stop` returns true for a message (which is returned, undelivered).
 */
export async function driveAgents(stub: CoordinatorStub, stop?: (message: TaskMessage) => boolean): Promise<TaskMessage[]> {
  const held: TaskMessage[] = [];
  for (let round = 0; round < 60; round++) {
    const dispatches = await takeDispatches(stub);
    if (dispatches.length === 0) return held;
    for (const { message } of dispatches) {
      if (stop?.(message)) {
        held.push(message);
        continue;
      }
      await (await agentFor(message)).handleTask(message);
    }
  }
  throw new Error("driveAgents did not settle");
}

/** Dataset runs of one type with pairwise distinct subjects (tests in one file share PEOPLE_DB). */
export function distinctRuns(type: SyntheticRun["requestType"], count: number): SyntheticRun[] {
  const seen = new Set<string>();
  const out: SyntheticRun[] = [];
  for (const run of dataset.runs) {
    if (run.requestType !== type || seen.has(run.subjectEmployeeId)) continue;
    seen.add(run.subjectEmployeeId);
    out.push(run);
    if (out.length === count) return out;
  }
  throw new Error(`only ${out.length} distinct ${type} runs`);
}
