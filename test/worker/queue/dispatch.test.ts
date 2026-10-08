import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { HandleOutcome } from "../../../src/worker/agents/role-agent.ts";
import { handleQueueBatch, type ConsumerDeps } from "../../../src/worker/queue/consumer.ts";
import type { TaskMessage } from "../../../src/worker/queue/messages.ts";
import { shardName } from "../../../src/worker/queue/sharding.ts";
import { distinctRuns, inputFromDataset } from "../../helpers/agents.ts";
import { batchMessage, syntheticMessage, testConfig } from "../../helpers/queue.ts";
import { coordinator, events, readState } from "../../helpers/runs.ts";
import { apiGet, apiPost, json } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import type { ApprovalListItem, Page } from "../../../src/shared/api-types.ts";

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

describe("queue dispatch", { tags: ["orchestration"] }, () => {
  it("through the real queue, a launched address_change run reaches succeeded, with messages routed to the binding and shard computed from role, run id, task id and attempt", async () => {
    const config = testConfig();
    const [run] = distinctRuns("address_change", 1);
    if (!run) throw new Error("no dataset run");
    const input = inputFromDataset(run);
    const stub = await coordinator(input.runId);
    await stub.initRun(input);
    expect(await waitForStatus(input.runId, ["succeeded", "needs_attention", "cancelled"])).toBe("succeeded");
    const state = await readState(stub);
    expect([...state.tasks.values()].every((t) => t.status === "succeeded")).toBe(true);
    // Every lease went to the shard the consumer computes for that delivery.
    const leased = (await events(stub)).filter((e) => e.action === "task.leased");
    expect(leased.length).toBe(state.tasks.size);
    const actors = await env.DB.prepare("SELECT actor_id, task_id, detail_json FROM audit_events WHERE stream = ? AND action = 'task.leased'").bind(`run:${input.runId}`).all<{ actor_id: string; task_id: string; detail_json: string }>();
    for (const row of actors.results) {
      const task = state.tasks.get(row.task_id);
      const role = task?.kind === "plan" ? "planner" : task?.kind === "execute" ? "executor" : "verifier";
      const attempt = (JSON.parse(row.detail_json) as { attempt: number }).attempt;
      expect(row.actor_id).toBe(shardName(role, input.runId, row.task_id, attempt, config.agentShards));
    }
    const effects = await env.PEOPLE_DB.prepare("SELECT tool FROM side_effects WHERE run_id = ? ORDER BY id").bind(input.runId).all<{ tool: string }>();
    expect(effects.results.map((e) => e.tool)).toEqual(["hris.update_address", "notify.send"]);
  }, 30_000);

  it("an offboarding run pauses for approval and completes after approval through the API", async () => {
    const [run] = distinctRuns("offboarding", 1);
    if (!run) throw new Error("no dataset run");
    const input = inputFromDataset(run, { requester: P.operator2 });
    const stub = await coordinator(input.runId);
    await stub.initRun(input);
    expect(await waitForStatus(input.runId, ["awaiting_approval", "needs_attention"])).toBe("awaiting_approval");
    // Only the read ran before the gate.
    const before = await env.PEOPLE_DB.prepare("SELECT COUNT(*) AS n FROM side_effects WHERE run_id = ?").bind(input.runId).first<{ n: number }>();
    expect(before?.n).toBe(0);
    const pending = await json<Page<ApprovalListItem>>(await apiGet(P.approver, "/api/approvals?status=pending"));
    const approval = pending.items.find((a) => a.runId === input.runId);
    expect(approval).toMatchObject({ tool: "hris.set_employment_status", risk: "high", canDecide: true });
    const decided = await apiPost(P.approver, `/api/approvals/${approval?.id}/decision`, { decision: "approve", note: "HR confirmed the last day" });
    expect(decided.status).toBe(200);
    expect(await waitForStatus(input.runId, ["succeeded", "needs_attention", "cancelled"])).toBe("succeeded");
    const effects = await env.PEOPLE_DB.prepare("SELECT tool FROM side_effects WHERE run_id = ? ORDER BY id").bind(input.runId).all<{ tool: string }>();
    expect(effects.results.map((e) => e.tool)).toEqual(["hris.set_employment_status", "access.revoke_all_roles", "itsm.create_ticket", "notify.send"]);
    const employee = await env.PEOPLE_DB.prepare("SELECT employment_status FROM employees WHERE id = ?").bind(run.subjectEmployeeId).first<{ employment_status: string }>();
    expect(employee?.employment_status).toBe("terminated");
    expect((await readState(stub)).approvals.size).toBe(1);
  }, 30_000);

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
