// The one simulation driver (SPEC section 12.2), shared by the vitest
// simulation and `npm run eval:sim`. It launches every dataset request
// through the API with its simulation directives, applies exactly the action
// the dataset prescribes for its modifier, decides approvals as the dataset
// says, and waits for every run to settle. At most `concurrency` runs are in
// flight, and runs on the same subject are serialized.

import type { ApprovalListItem, RunDetailResponse, TaskView } from "../api-types.ts";
import type { SyntheticDataset, SyntheticRun } from "../synth/generator.ts";
import type { SimTransport } from "./transport.ts";

export const ADMIN = "admin@agentboard.test";

export type SimAction =
  | "approve"
  | "reject"
  | "skip_task"
  | "cancel"
  | "retry_task"
  | "raise_budget"
  | "pause"
  | "resume";

export interface SimRunResult {
  ref: string;
  runId: string;
  requestType: string;
  modifier: string | null;
  expectedStatus: string;
  finalStatus: string;
  actions: SimAction[];
  launchedAt: number;
  settledAt: number;
  error: string | null;
}

export interface SimOptions {
  concurrency: number;
  pollMs: number;
  /** Limit for the whole simulation. */
  timeoutMs: number;
  /** Prefix for clientRequestId, so a rerun against the same state launches new runs. */
  clientRequestPrefix?: string;
  onProgress?: (result: SimRunResult, done: number, total: number) => void;
}

export interface SimReport {
  results: SimRunResult[];
  startedAt: number;
  finishedAt: number;
  timedOut: boolean;
}

const TERMINAL = new Set(["succeeded", "rejected", "cancelled"]);

class Failure extends Error {}

async function call<T>(transport: SimTransport, principal: string, method: "GET" | "POST" | "PATCH", path: string, body?: unknown, okStatuses = [200, 201]): Promise<T> {
  const response = await transport.request(principal, method, path, body);
  if (!okStatuses.includes(response.status)) throw new Failure(`${method} ${path} as ${principal}: HTTP ${response.status} ${JSON.stringify(response.body).slice(0, 300)}`);
  return response.body as T;
}

function launchBody(run: SyntheticRun, prefix: string): Record<string, unknown> {
  return {
    clientRequestId: `${prefix}${run.ref}`,
    requestType: run.requestType,
    requestText: run.requestText,
    subjectEmployeeId: run.subjectEmployeeId,
    priority: run.priority,
    syntheticRef: run.ref,
    requestedAt: run.requestedAt,
    ...(run.sim ? { sim: run.sim } : {}),
    ...(run.budget ? { budget: run.budget } : {}),
  };
}

function execTask(detail: RunDetailResponse, predicate: (t: TaskView) => boolean): TaskView | undefined {
  return detail.tasks.find((t) => t.kind === "execute" && predicate(t));
}

/** Drives one run from launch to its expected resting state. Resolves when the subject can be released. */
async function driveRun(transport: SimTransport, run: SyntheticRun, options: SimOptions, deadline: number): Promise<SimRunResult> {
  const launchedAt = transport.now();
  const actions: SimAction[] = [];
  const result = (runId: string, finalStatus: string, error: string | null): SimRunResult => ({
    ref: run.ref,
    runId,
    requestType: run.requestType,
    modifier: run.modifier,
    expectedStatus: run.expectedStatus,
    finalStatus,
    actions,
    launchedAt,
    settledAt: transport.now(),
    error,
  });
  let runId = "";
  try {
    const launched = await call<{ runId: string }>(transport, run.launchedBy, "POST", "/api/runs", launchBody(run, options.clientRequestPrefix ?? "sim-"));
    runId = launched.runId;
    const decided = new Set<string>();
    let paused = false;
    let resumed = false;
    let recovered = false;
    while (transport.now() < deadline) {
      const detail = await call<RunDetailResponse>(transport, ADMIN, "GET", `/api/runs/${runId}`);
      const status = detail.run.status;
      if (TERMINAL.has(status)) return result(runId, status, null);

      // Approvals: decide as the dataset says; a "pending" decision parks the run.
      const pending = detail.approvals.filter((a: ApprovalListItem) => a.status === "pending" && !decided.has(a.id));
      for (const approval of pending) {
        if (!run.approval) throw new Failure(`unexpected approval ${approval.id} on ${run.ref}`);
        if (run.approval.decision === "pending") {
          if (status === "awaiting_approval") return result(runId, status, null);
          continue;
        }
        await call(transport, run.approval.approver, "POST", `/api/approvals/${approval.id}/decision`, { decision: run.approval.decision, note: run.approval.note });
        decided.add(approval.id);
        actions.push(run.approval.decision);
      }

      // Modifier actions (SPEC section 12.2).
      switch (run.modifier) {
        case "permanent_error": {
          const notify = execTask(detail, (t) => t.tool === "notify.send" && t.status === "failed");
          if (status === "needs_attention" && notify && !recovered) {
            if (run.recovery === "skip") {
              await call(transport, ADMIN, "POST", `/api/runs/${runId}/tasks/${notify.id}/skip`, { reason: "notification failed permanently; skipping it" });
              actions.push("skip_task");
            } else {
              await call(transport, run.launchedBy, "POST", `/api/runs/${runId}/cancel`, { reason: "notification failed permanently; cancelling" });
              actions.push("cancel");
            }
            recovered = true;
          }
          break;
        }
        case "silent_noop": {
          const stepId = run.sim?.faults?.[0]?.stepId;
          const verify = detail.tasks.find((t) => t.kind === "verify" && t.stepId === stepId);
          const execute = execTask(detail, (t) => t.stepId === stepId);
          if (status === "needs_attention" && verify?.status === "failed" && execute && !recovered) {
            await call(transport, run.launchedBy, "POST", `/api/runs/${runId}/tasks/${execute.id}/retry`, { reason: "verification failed; re-running the write" });
            actions.push("retry_task");
            recovered = true;
          }
          break;
        }
        case "budget_exhausted": {
          if (status === "needs_attention" && detail.tasks.some((t) => t.status === "budget_blocked") && !recovered) {
            await call(transport, ADMIN, "PATCH", `/api/runs/${runId}/budget`, { maxToolCalls: 24, reason: "tool-call budget too tight for this request" });
            actions.push("raise_budget");
            recovered = true;
          }
          break;
        }
        case "pause_resume": {
          const parked = execTask(detail, (t) => t.stepId === "s2" && t.status === "held" && t.holdReason === "checkpoint");
          if (!paused && parked) {
            await call(transport, run.launchedBy, "POST", `/api/runs/${runId}/pause`, { reason: "pausing at the checkpoint" });
            actions.push("pause");
            paused = true;
          } else if (paused && !resumed && status === "paused") {
            await call(transport, run.launchedBy, "POST", `/api/runs/${runId}/resume`, { reason: "resuming after the checkpoint" });
            actions.push("resume");
            resumed = true;
          }
          break;
        }
        case "cancel": {
          const parked = execTask(detail, (t) => t.stepId === "s2" && t.status === "held" && t.holdReason === "checkpoint");
          if (parked && !recovered) {
            await call(transport, run.launchedBy, "POST", `/api/runs/${runId}/cancel`, { reason: "cancelling at the checkpoint" });
            actions.push("cancel");
            recovered = true;
          }
          break;
        }
        default:
          break;
      }
      await transport.sleep(options.pollMs);
    }
    return result(runId, "timeout", "run did not settle before the deadline");
  } catch (error) {
    return result(runId, "error", error instanceof Error ? error.message : String(error));
  }
}

/** Runs the whole dataset with bounded concurrency and per-subject serialization. */
export async function runSimulation(transport: SimTransport, dataset: Pick<SyntheticDataset, "runs">, options: SimOptions): Promise<SimReport> {
  const startedAt = transport.now();
  const deadline = startedAt + options.timeoutMs;
  const queue = [...dataset.runs];
  const busySubjects = new Set<string>();
  const results: SimRunResult[] = [];
  const inFlight = new Set<Promise<void>>();

  const startNext = (): boolean => {
    // Dataset order, skipping runs whose subject is busy (they wait their turn).
    const index = queue.findIndex((run) => !busySubjects.has(run.subjectEmployeeId));
    if (index < 0) return false;
    const [run] = queue.splice(index, 1);
    if (!run) return false;
    busySubjects.add(run.subjectEmployeeId);
    const task = driveRun(transport, run, options, deadline).then((res) => {
      results.push(res);
      busySubjects.delete(run.subjectEmployeeId);
      options.onProgress?.(res, results.length, dataset.runs.length);
    });
    const tracked = task.finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
    return true;
  };

  while (queue.length > 0 || inFlight.size > 0) {
    while (inFlight.size < options.concurrency && queue.length > 0 && startNext()) {
      // keep filling
    }
    if (inFlight.size === 0) break;
    await Promise.race(inFlight);
  }
  results.sort((a, b) => a.ref.localeCompare(b.ref));
  return { results, startedAt, finishedAt: transport.now(), timedOut: transport.now() >= deadline };
}
