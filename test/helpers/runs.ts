// Helpers that drive a RunCoordinator directly, acting as the role agents.
// Coordinators started with `startManualRun` keep their queue outbox rows
// local (test-only switch, honored only when ENVIRONMENT=test), so the test
// reads dispatches with `takeDispatches` instead of the real queue consumer.

import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { DEFAULT_BUDGET, type Budget, type Plan, type RequestType, type SimDirectives } from "../../src/shared/domain.ts";
import { goldPlan, type RunFields } from "../../src/shared/synth/gold-plans.ts";
import type { RunCoordinator } from "../../src/worker/agents/run-coordinator.ts";
import type { ClaimResult, CompletionReport, InitRunInput, RunCoordinatorRpc, RunState } from "../../src/worker/agents/coordinator/schema.ts";
import type { TaskMessage } from "../../src/worker/queue/messages.ts";
import { newRunId } from "../../src/worker/util/ids.ts";

/** A coordinator stub typed by its RPC interface (see RunCoordinatorRpc). */
export type CoordinatorStub = RunCoordinatorRpc;

/** The same stub, typed for runInDurableObject. */
export function raw(stub: CoordinatorStub): DurableObjectStub<RunCoordinator> {
  return stub as unknown as DurableObjectStub<RunCoordinator>;
}

export const SUBJECT = "E-1014";
export const NEW_ADDRESS = { line1: "5356 Harbor View Drive", city: "San Jose", region: "CA", postalCode: "95173", country: "US" };

export function fieldsFor(requestType: RequestType): RunFields {
  const base: RunFields = { channel: "email", address: null, managerId: null, managerName: null, system: null, role: null, effectiveDate: null };
  switch (requestType) {
    case "address_change":
      return { ...base, address: NEW_ADDRESS };
    case "manager_change":
      return { ...base, managerId: "E-1003", managerName: "Manager" };
    case "onboarding_access":
      return { ...base, system: "github", role: "member" };
    case "privileged_access":
      return { ...base, system: "aws", role: "prod-admin" };
    case "offboarding":
      return { ...base, effectiveDate: "2026-10-20" };
    case "access_revocation":
      return { ...base, system: "slack", role: "member" };
  }
}

export function planFor(requestType: RequestType, subject: string = SUBJECT): Plan {
  return goldPlan(requestType, subject, fieldsFor(requestType));
}

export function runInput(overrides: Partial<InitRunInput> = {}): InitRunInput {
  const runId = overrides.runId ?? newRunId();
  const requestType = overrides.requestType ?? "address_change";
  return {
    runId,
    requester: "ops.lead@agentboard.test",
    clientRequestId: `test-${runId}`,
    requestHash: "0".repeat(64),
    requestType,
    title: `Test ${requestType} for ${overrides.subjectEmployeeId ?? SUBJECT}`,
    requestText: `Test request ${requestType}`,
    subjectEmployeeId: SUBJECT,
    priority: "normal",
    budget: { ...DEFAULT_BUDGET },
    sim: null,
    syntheticRef: null,
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

export async function coordinator(runId: string): Promise<CoordinatorStub> {
  return (await getAgentByName(env.RunCoordinator, runId)) as unknown as CoordinatorStub;
}

/** Starts a run whose dispatches stay in the outbox for the test to take. */
export async function startManualRun(overrides: Partial<InitRunInput> & { budget?: Budget; sim?: SimDirectives | null } = {}): Promise<{
  runId: string;
  stub: CoordinatorStub;
  input: InitRunInput;
}> {
  const input = runInput(overrides);
  const stub = await coordinator(input.runId);
  await runInDurableObject(raw(stub), (_instance: RunCoordinator, state) => {
    state.storage.kv.put("test:manualDispatch", true);
  });
  await stub.initRun(input);
  return { runId: input.runId, stub, input };
}

export interface TakenDispatch {
  message: TaskMessage;
  delaySeconds: number;
}

/** Returns the queue messages the coordinator has produced since the last call, and marks them taken. */
export async function takeDispatches(stub: CoordinatorStub): Promise<TakenDispatch[]> {
  return runInDurableObject(raw(stub), (instance: RunCoordinator) => {
    const rows = instance.sql<{ id: number; payload_json: string }>`SELECT id, payload_json FROM ab_outbox WHERE kind = 'queue' AND sent_at IS NULL ORDER BY id`;
    for (const row of rows) instance.sql`UPDATE ab_outbox SET sent_at = ${Date.now()} WHERE id = ${row.id}`;
    return rows.map((row) => JSON.parse(row.payload_json) as TakenDispatch);
  });
}

export async function readState(stub: CoordinatorStub): Promise<RunState> {
  const state = await runInDurableObject(raw(stub), (instance: RunCoordinator) => instance.loadState());
  if (!state) throw new Error("run does not exist");
  return state;
}

export async function events(stub: CoordinatorStub): Promise<{ seq: number; action: string; task_id: string | null; detail: Record<string, unknown> }[]> {
  return runInDurableObject(raw(stub), (instance: RunCoordinator) =>
    instance.sql<{ seq: number; action: string; task_id: string | null; detail_json: string }>`SELECT seq, action, task_id, detail_json FROM ab_events ORDER BY seq`.map((e) => ({
      seq: e.seq,
      action: e.action,
      task_id: e.task_id,
      detail: JSON.parse(e.detail_json) as Record<string, unknown>,
    })),
  );
}

export function ownerFor(message: TaskMessage, shard = 0): string {
  return `${message.role}-${shard}`;
}

export async function claimMessage(stub: CoordinatorStub, message: TaskMessage, shard = 0): Promise<ClaimResult> {
  return stub.claimTask({ taskId: message.taskId, owner: ownerFor(message, shard), dispatchId: message.dispatchId });
}

type Granted = Extract<ClaimResult, { ok: true }>;

export function granted(result: ClaimResult): Granted {
  if (!result.ok) throw new Error(`claim refused: ${result.reason}`);
  return result;
}

export async function report(stub: CoordinatorStub, claimResult: ClaimResult, outcome: Omit<CompletionReport, "taskId" | "leaseId" | "epoch">) {
  const lease = granted(claimResult);
  return stub.completeTask({ taskId: lease.context.taskId, leaseId: lease.lease.leaseId, epoch: lease.lease.epoch, ...outcome });
}

/** Plays the planner for the run's plan dispatch with the given plan. */
export async function completePlan(stub: CoordinatorStub, plan: Plan): Promise<void> {
  const dispatches = await takeDispatches(stub);
  const planMessage = dispatches.find((d) => d.message.role === "planner");
  if (!planMessage) throw new Error("no plan dispatch");
  const claimResult = await claimMessage(stub, planMessage.message);
  const result = await report(stub, claimResult, { outcome: "succeeded", output: { plan }, usage: { llmTokens: 100 } });
  if (!result.accepted) throw new Error(`plan completion refused: ${result.reason}`);
}

/** Polls the coordinator until the run reaches one of `statuses` (through the real queue and agents). */
export async function waitForStatus(runId: string, statuses: string[], timeoutMs = 20_000): Promise<string> {
  const stub = await coordinator(runId);
  const started = Date.now();
  let status = "";
  while (Date.now() - started < timeoutMs) {
    status = (await stub.getSnapshot()).status;
    if (statuses.includes(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`run ${runId} stuck in ${status}`);
}

/**
 * Waits until every run a test launched through the real queue has stopped
 * moving. A launch whose request text has no stub fixture fails planning
 * (StubMiss) until its attempts run out and the run needs attention; a test
 * that returns before then leaves queued planner work running while the test
 * file's environment is torn down.
 */
export async function settleRuns(runIds: readonly string[]): Promise<void> {
  for (const runId of runIds) await waitForStatus(runId, ["needs_attention", "succeeded", "cancelled", "rejected", "awaiting_approval"]);
}

/** Output an execute task reports for a tool (the ids a verifier later reads). */
export function fakeOutput(tool: string | null): Record<string, unknown> {
  if (tool === "itsm.create_ticket") return { ticketId: "TKT-000000000001" };
  if (tool === "notify.send") return { deliveryId: "DLV-000000000001" };
  return { ok: true };
}

/** Claims and succeeds every dispatched task until none remain (or `stopAt` says stop). */
export async function drain(stub: CoordinatorStub, stopAt?: (message: TaskMessage) => boolean): Promise<TakenDispatch[]> {
  const skipped: TakenDispatch[] = [];
  for (let round = 0; round < 50; round++) {
    const dispatches = await takeDispatches(stub);
    if (dispatches.length === 0) return skipped;
    for (const dispatch of dispatches) {
      if (stopAt?.(dispatch.message)) {
        skipped.push(dispatch);
        continue;
      }
      const claimResult = await claimMessage(stub, dispatch.message);
      if (!claimResult.ok) continue;
      const tool = claimResult.context.step?.tool ?? null;
      await report(stub, claimResult, { outcome: "succeeded", output: fakeOutput(tool), evidence: { checked: true }, usage: {} });
    }
  }
  throw new Error("drain did not settle");
}
