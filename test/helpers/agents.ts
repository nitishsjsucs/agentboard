import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { PlannerAgent } from "../../src/worker/agents/planner-agent.ts";
import type { HandleOutcome, RoleAgentRpc } from "../../src/worker/agents/role-agent.ts";
import type { LlmProvider } from "../../src/worker/llm/provider.ts";
import type { TaskMessage } from "../../src/worker/queue/messages.ts";
import { generateDataset, type SyntheticRun } from "../../src/shared/synth/generator.ts";
import { runInput } from "./runs.ts";
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
