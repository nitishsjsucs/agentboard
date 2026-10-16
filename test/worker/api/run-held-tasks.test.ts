// heldTasks on run summaries (GET /api/runs and GET /api/runs/:id): the run lists' "held" chip.

import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Page, RunDetailResponse, RunSummary } from "../../../src/shared/api-types.ts";
import { handleQueueBatch } from "../../../src/worker/queue/consumer.ts";
import type { TaskMessage } from "../../../src/worker/queue/messages.ts";
import { datasetRun, inputFromDataset, runPlanner } from "../../helpers/agents.ts";
import { apiGet, apiPost, json } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import { batchMessage, testConfig } from "../../helpers/queue.ts";
import { readState, startManualRun, takeDispatches } from "../../helpers/runs.ts";

async function deliver(message: TaskMessage): Promise<void> {
  const batch = createMessageBatch("agentboard-tasks", [batchMessage(message)]);
  await handleQueueBatch(batch, env, testConfig());
  await getQueueResult(batch, createExecutionContext());
}

const listed = async (principal: string, runId: string) => (await json<Page<RunSummary>>(await apiGet(principal, "/api/runs?limit=100"))).items.find((r) => r.id === runId);
const detail = async (principal: string, runId: string) => (await json<RunDetailResponse>(await apiGet(principal, `/api/runs/${runId}`))).run;

describe("run summaries: tasks held by a disabled role", { tags: ["history"] }, () => {
  it("a running run whose task is held reports heldTasks to a viewer and an operator, in the list and the detail; a finished run reports 0", async () => {
    const started = await startManualRun(inputFromDataset(datasetRun("syn-0006")));
    const [plan] = await takeDispatches(started.stub);
    if (!plan) throw new Error("no plan dispatch");
    await runPlanner(plan.message);
    const [s1] = await takeDispatches(started.stub);
    if (!s1) throw new Error("no s1 dispatch");
    expect((await apiPost(P.admin, "/api/agents/executor/disable", { reason: "maintenance window" })).status).toBe(200);
    await deliver(s1.message);
    const state = await readState(started.stub);
    expect([state.run.status, state.tasks.get(s1.message.taskId)?.status]).toEqual(["running", "held"]);

    for (const principal of [P.viewer, P.operator]) {
      expect((await listed(principal, started.runId))?.heldTasks).toBe(1);
      expect((await detail(principal, started.runId)).heldTasks).toBe(1);
    }

    // Cancelling clears the hold, and a finished run never reports held tasks.
    expect((await apiPost(P.operator, `/api/runs/${started.runId}/cancel`, { reason: "not needed any more" })).status).toBe(200);
    expect((await detail(P.viewer, started.runId)).heldTasks).toBe(0);
    expect((await apiPost(P.admin, "/api/agents/executor/enable", { reason: "maintenance done" })).status).toBe(200);
  });

  it("the status guard reports 0 for a run that is not queued, planning or running even if its mirror still shows a held task", async () => {
    const id = "run_01J0HHHHGGGG00000000000000";
    await env.DB.prepare(
      `INSERT INTO runs (id, requester, client_request_id, request_hash, request_type, title, request_text, subject_employee_id, priority,
         status, status_reason, budget_json, usage_json, synthetic_ref, requested_at, created_at, updated_at, finished_at, version)
       VALUES (?, ?, 'cr-held-guard', 'h', 'address_change', 'Held guard', 'text', 'E-1001', 'normal', 'needs_attention', 'deadline_exceeded',
         '{"maxSteps":8,"maxToolCalls":24,"maxLlmTokens":6000,"maxAttemptsPerTask":3,"maxActiveMs":900000}',
         '{"toolCalls":0,"toolCallsReserved":0,"llmTokens":0,"activeMs":0,"attempts":0,"replays":0,"skippedSteps":0}', NULL, ?, ?, ?, NULL, 1)`,
    )
      .bind(id, P.operator, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z")
      .run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, run_id, kind, step_id, tool, args_json, depends_on_json, status, hold_reason, attempts, generation, requires_approval,
         lease_owner, lease_epoch, lease_expires_at, last_error, created_at, updated_at, version)
       VALUES ('tsk_held_guard', ?, 'execute', 's1', 'hris.get_employee', NULL, '[]', 'held', 'role_disabled', 0, 0, 0, NULL, 0, NULL, NULL, ?, ?, 1)`,
    )
      .bind(id, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z")
      .run();
    expect((await listed(P.viewer, id))?.heldTasks).toBe(0);
    expect((await detail(P.viewer, id)).heldTasks).toBe(0);
  });
});
