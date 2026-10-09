// Shared skeleton of the three role agents (SPEC section 7.1). handleTask:
//  1. claimTask; every refusal maps to ack (the sweep recovers a dead holder).
//  2. the task context comes with the claim.
//  3. role work inside try/catch; an exception becomes a retryable failure
//     (agent_exception) on the current lease.
//  4. completeTask, one report per lease. If the coordinator RPC throws, the
//     exception reaches the consumer, which retries the message; the
//     redelivery is refused and acked, and the sweep recovers the task.

import { Agent, getAgentByName } from "agents";
import type { AgentRole } from "../../shared/domain.ts";
import { loadConfig, type Config } from "../config.ts";
import type { TaskMessage } from "../queue/messages.ts";
import type { ClaimResult, CompletionReport, RunCoordinatorRpc } from "./coordinator/schema.ts";

export type HandleOutcome = { kind: "ack" } | { kind: "retry"; delaySeconds: number };

export interface RoleState {
  role: AgentRole | null;
  processed: number;
  lastError: string | null;
  lastActivityAt: string | null;
}

export type GrantedClaim = Extract<ClaimResult, { ok: true }>;

export interface RoleAgentRpc {
  handleTask(message: TaskMessage): Promise<HandleOutcome>;
}

export abstract class RoleAgent extends Agent<Env, RoleState> implements RoleAgentRpc {
  override initialState: RoleState = { role: null, processed: 0, lastError: null, lastActivityAt: null };
  abstract readonly role: AgentRole;

  override shouldConnectionBeReadonly(): boolean {
    return true;
  }

  override async onRequest(): Promise<Response> {
    return new Response("not found", { status: 404 });
  }

  // No sub-agents: the SDK would otherwise create a facet of any class for a `/sub/{class}/{name}` path.
  override async onBeforeSubAgent(): Promise<Response> {
    return new Response("not found", { status: 404 });
  }

  protected config(): Config {
    const loaded = loadConfig(this.env);
    if (!loaded.ok) throw new Error(`configuration rejected: ${loaded.errors.join("; ")}`);
    return loaded.config;
  }

  protected async coordinator(runId: string): Promise<RunCoordinatorRpc> {
    return (await getAgentByName(this.env.RunCoordinator, runId)) as unknown as RunCoordinatorRpc;
  }

  async handleTask(message: TaskMessage): Promise<HandleOutcome> {
    const coordinator = await this.coordinator(message.runId);
    const claim = await coordinator.claimTask({ taskId: message.taskId, owner: this.name, dispatchId: message.dispatchId });
    if (!claim.ok) return { kind: "ack" };

    let report: CompletionReport | null;
    try {
      report = await this.work(claim, coordinator);
    } catch (error) {
      report = {
        taskId: claim.context.taskId,
        leaseId: claim.lease.leaseId,
        epoch: claim.lease.epoch,
        outcome: "failed",
        retryable: true,
        code: "agent_exception",
        message: error instanceof Error ? error.message : String(error),
        usage: {},
      };
    }
    // null means the work deliberately reports nothing (the crash_after_call simulation).
    if (report) await coordinator.completeTask(report);
    this.setState({
      role: this.role,
      processed: this.state.processed + 1,
      lastError: report && report.outcome === "failed" ? (report.code ?? "error") : null,
      lastActivityAt: new Date().toISOString(),
    });
    return { kind: "ack" };
  }

  /** Role-specific work for a granted claim; returns the completion report, or null to report nothing. */
  protected abstract work(claim: GrantedClaim, coordinator: RunCoordinatorRpc): Promise<CompletionReport | null>;
}
