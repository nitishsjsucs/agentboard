// RunCoordinator: one Durable Object per run, the single writer of that run's
// task state, leases, approvals, budgets and audit stream (SPEC section 7.1).
//
// Every RPC has the same shape: one ctx.storage.transactionSync that loads the
// run, sweeps, applies the operation, re-derives the run status, dispatches
// ready tasks and persists rows, events and outbox entries. Nothing inside the
// transaction awaits. Only after the commit does it broadcast the snapshot.

import { Agent } from "agents";
import type { Connection } from "agents";
import { eventHash, GENESIS_HASH } from "../audit/hash-chain.ts";
import { redactForViewer } from "../audit/redaction.ts";
import { loadConfig, type Config } from "../config.ts";
import type { TaskMessage } from "../queue/messages.ts";
import { Clock } from "../util/clock.ts";
import { idempotencyKey } from "./coordinator/credentials.ts";
import {
  approvalFromRow,
  DDL,
  ROLE_FOR_KIND,
  runFromRow,
  SCHEMA_VERSION,
  taskFromRow,
  type ClaimRequest,
  type ClaimResult,
  type CompletionReport,
  type ControlCommand,
  type ControlResult,
  type InitRunInput,
  type RunCoordinatorRpc,
  type RunSnapshot,
  type RunState,
  type TaskContext,
  type TaskRecord,
  type ToolCallTrace,
} from "./coordinator/schema.ts";
import { buildSnapshot, emptySnapshot } from "./coordinator/snapshot.ts";
import {
  appendTrace,
  applyDerivedStatus,
  claim,
  complete,
  control,
  dispatchReady,
  initRun,
  newRunState,
  promote,
  RunTx,
  SYSTEM,
  type TxConfig,
} from "./coordinator/transitions.ts";
import { isWriteTool } from "../planning/tool-registry.ts";

type Row = Record<string, string | number | boolean | null>;

export interface PersistedEvent {
  seq: number;
  ts: string;
  actorType: string;
  actorId: string;
  action: string;
  taskId: string | null;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export class RunCoordinator extends Agent<Env, RunSnapshot> implements RunCoordinatorRpc {
  override initialState: RunSnapshot = emptySnapshot("");

  /** Wall clock plus a test-only offset (tests set it through runInDurableObject). */
  readonly clock = new Clock();
  private schemaReady = false;
  private broadcastVersion = -1;

  override onStart(): void {
    this.ensureSchema();
  }

  // Browser connections are read-only; every mutation goes through the audited HTTP API.
  override shouldConnectionBeReadonly(): boolean {
    return true;
  }

  override validateStateChange(_next: RunSnapshot, source: Connection | "server"): void {
    if (source !== "server") throw new Error("read-only");
  }

  override async onRequest(): Promise<Response> {
    return new Response("not found", { status: 404 });
  }

  override onMessage(): void {
    // Client messages are ignored.
  }

  // -------------------------------------------------------------------------
  // RPC methods

  async initRun(input: InitRunInput): Promise<RunSnapshot> {
    this.ensureSchema();
    const existing = this.loadState();
    if (existing) {
      return this.getSnapshot();
    }
    const now = this.clock.now();
    this.transact(now, (tx) => initRun(tx, { kind: input.requester.startsWith("svc:") ? "service" : "user", id: input.requester }), newRunState(input, now));
    return this.snapshot();
  }

  async claimTask(req: ClaimRequest): Promise<ClaimResult> {
    this.ensureSchema();
    const now = this.clock.now();
    const { result, state } = this.transact(now, (tx) => claim(tx, req, null, null));
    if (!result.ok) return { ok: false, reason: result.reason };
    const task = state.tasks.get(req.taskId) as TaskRecord;
    return {
      ok: true,
      lease: { leaseId: task.leaseId ?? "", epoch: task.leaseEpoch, expiresAt: task.leaseExpiresAt ?? now },
      credential: null,
      context: this.buildContext(state, task),
    };
  }

  async appendTrace(trace: ToolCallTrace): Promise<{ accepted: boolean; reason?: string }> {
    this.ensureSchema();
    const seen = this.sql<{ id: string }>`SELECT id FROM ab_traces WHERE id = ${trace.id}`;
    if (seen.length > 0) return { accepted: true, reason: "duplicate_trace" };
    const now = this.clock.now();
    const { result } = this.transact(now, (tx) => {
      const out = appendTrace(tx, trace);
      if (out.accepted) this.sql`INSERT INTO ab_traces (id, received_at) VALUES (${trace.id}, ${now})`;
      return out;
    });
    return result;
  }

  async completeTask(report: CompletionReport): Promise<{ accepted: boolean; reason?: string }> {
    this.ensureSchema();
    const now = this.clock.now();
    const { result } = this.transact(now, (tx) => {
      const seen = this.sql<{ lease_id: string }>`SELECT lease_id FROM ab_reports WHERE lease_id = ${report.leaseId}`;
      if (seen.length > 0) return { accepted: false, reason: "duplicate_report" };
      const out = complete(tx, report);
      if (tx.acceptedReport) this.sql`INSERT INTO ab_reports (lease_id, received_at) VALUES (${tx.acceptedReport}, ${now})`;
      return out;
    });
    return result;
  }

  async control(cmd: ControlCommand): Promise<ControlResult & { snapshot: RunSnapshot }> {
    this.ensureSchema();
    if (!this.loadState()) return { accepted: false, reason: "not_found", snapshot: emptySnapshot(this.name) };
    const now = this.clock.now();
    const { result } = this.transact(now, (tx) => control(tx, cmd, null));
    return { ...result, snapshot: this.snapshot() };
  }

  async getSnapshot(): Promise<RunSnapshot> {
    this.ensureSchema();
    if (!this.loadState()) return emptySnapshot(this.name);
    this.transact(this.clock.now(), () => null);
    return this.snapshot();
  }

  async getTaskContext(taskId: string, leaseId: string): Promise<TaskContext | null> {
    this.ensureSchema();
    const state = this.loadState();
    const task = state?.tasks.get(taskId);
    if (!state || !task || task.leaseId !== leaseId || task.status !== "leased") return null;
    return this.buildContext(state, task);
  }

  // -------------------------------------------------------------------------
  // Transaction plumbing

  protected config(): Config {
    const loaded = loadConfig(this.env);
    if (!loaded.ok) throw new Error(`configuration rejected: ${loaded.errors.join("; ")}`);
    return loaded.config;
  }

  protected txConfig(config: Config): TxConfig {
    return {
      leaseTtlMs: config.leaseTtlMs,
      plannerLeaseTtlMs: config.plannerLeaseTtlMs,
      approvalTtlMs: config.approvalTtlMs,
      retryBaseDelayS: config.retryBaseDelayS,
      retryMaxDelayS: config.retryMaxDelayS,
      faultInjection: config.faultInjection,
    };
  }

  /**
   * Runs one coordinator transaction: (sweep), derive, operation, promote,
   * derive, dispatch, persist. `fresh` is the state of a run being created.
   */
  protected transact<T>(now: number, operation: (tx: RunTx) => T, fresh?: RunState): { result: T; state: RunState; events: PersistedEvent[] } {
    const cfg = this.txConfig(this.config());
    const outcome = this.ctx.storage.transactionSync(() => {
      const state = fresh ?? this.loadState();
      if (!state) throw new Error(`run ${this.name} does not exist`);
      const tx = new RunTx(state, now, cfg);
      this.beforeOperation(tx);
      applyDerivedStatus(tx);
      const result = operation(tx);
      promote(tx);
      applyDerivedStatus(tx);
      dispatchReady(tx);
      const events = tx.changed || fresh ? this.persist(tx) : [];
      return { result, state, events };
    });
    this.afterCommit(outcome.state);
    return outcome;
  }

  /** Hook for the sweep (commit 10). */
  protected beforeOperation(_tx: RunTx): void {}

  protected afterCommit(state: RunState): void {
    if (state.run.version !== this.broadcastVersion) {
      this.broadcastVersion = state.run.version;
      this.setState(this.snapshotOf(state));
    }
  }

  protected ensureSchema(): void {
    if (this.schemaReady) return;
    for (const statement of DDL) this.ctx.storage.sql.exec(statement);
    const version = this.sql<{ version: number }>`SELECT version FROM ab_schema LIMIT 1`;
    if (version.length === 0) this.sql`INSERT INTO ab_schema (version) VALUES (${SCHEMA_VERSION})`;
    this.schemaReady = true;
  }

  /** Reads the whole run (public for tests and the API layer; never mutates). */
  loadState(): RunState | null {
    const runs = this.sql<Row>`SELECT * FROM ab_run LIMIT 1`;
    const runRow = runs[0];
    if (!runRow) return null;
    const tasks = new Map<string, TaskRecord>();
    for (const row of this.sql<Row>`SELECT * FROM ab_tasks`) {
      const task = taskFromRow(row);
      tasks.set(task.id, task);
    }
    const approvals = new Map(this.sql<Row>`SELECT * FROM ab_approvals`.map((row) => {
      const approval = approvalFromRow(row);
      return [approval.id, approval] as const;
    }));
    return { run: runFromRow(runRow), tasks, approvals };
  }

  private persist(tx: RunTx): PersistedEvent[] {
    const run = tx.run;
    run.version += 1;
    run.updatedAt = tx.now;
    for (const id of tx.dirtyTasks) {
      const t = tx.state.tasks.get(id);
      if (!t) continue;
      t.version += 1;
      this.sql`INSERT OR REPLACE INTO ab_tasks (id, kind, step_id, tool, args_json, depends_on_json, status, hold_reason, attempts, max_attempts,
        generation, requires_approval, approval_id, dispatch_id, lease_id, lease_owner, lease_epoch, lease_expires_at, reserved_calls,
        result_json, last_error, checkpoint_done, version, created_at, updated_at)
        VALUES (${t.id}, ${t.kind}, ${t.stepId}, ${t.tool}, ${t.args === null ? null : JSON.stringify(t.args)}, ${JSON.stringify(t.dependsOn)},
        ${t.status}, ${t.holdReason}, ${t.attempts}, ${t.maxAttempts}, ${t.generation}, ${t.requiresApproval ? 1 : 0}, ${t.approvalId},
        ${t.dispatchId}, ${t.leaseId}, ${t.leaseOwner}, ${t.leaseEpoch}, ${t.leaseExpiresAt}, ${t.reservedCalls},
        ${t.result === null || t.result === undefined ? null : JSON.stringify(t.result)}, ${t.lastError}, ${t.checkpointDone ? 1 : 0},
        ${t.version}, ${t.createdAt}, ${t.updatedAt})`;
    }
    for (const id of tx.dirtyApprovals) {
      const a = tx.state.approvals.get(id);
      if (!a) continue;
      a.version += 1;
      this.sql`INSERT OR REPLACE INTO ab_approvals (id, task_id, generation, tool, summary, risk, status, requested_at, expires_at, decided_by, decided_at, note, version)
        VALUES (${a.id}, ${a.taskId}, ${a.generation}, ${a.tool}, ${a.summary}, ${a.risk}, ${a.status}, ${a.requestedAt}, ${a.expiresAt},
        ${a.decidedBy}, ${a.decidedAt}, ${a.note}, ${a.version})`;
    }
    this.sql`INSERT OR REPLACE INTO ab_run (id, client_request_id, requester, request_json, status, paused, cancelled, status_reason, deadline_exceeded,
      budget_json, usage_json, active_since, wake_at, finished_at, version, created_at, updated_at)
      VALUES (${run.id}, ${run.request.clientRequestId}, ${run.request.requester}, ${JSON.stringify(run.request)}, ${run.status},
      ${run.paused ? 1 : 0}, ${run.cancelled ? 1 : 0}, ${run.statusReason}, ${run.deadlineExceeded ? 1 : 0}, ${JSON.stringify(run.budget)},
      ${JSON.stringify(run.usage)}, ${run.activeSince}, ${run.wakeAt}, ${run.finishedAt}, ${run.version}, ${run.createdAt}, ${run.updatedAt})`;

    const persisted: PersistedEvent[] = [];
    const last = this.sql<{ seq: number; hash: string }>`SELECT seq, hash FROM ab_events ORDER BY seq DESC LIMIT 1`[0];
    let seq = last?.seq ?? 0;
    let prevHash = last?.hash ?? GENESIS_HASH;
    const ts = new Date(tx.now).toISOString();
    for (const event of tx.events) {
      seq += 1;
      // Audit detail is redacted at write time for everyone (SPEC section 6.1).
      const detail = redactForViewer(event.detail) as Record<string, unknown>;
      const hash = eventHash(prevHash, {
        stream: `run:${run.id}`,
        seq,
        ts,
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        runId: run.id,
        taskId: event.taskId,
        detail,
      });
      this.sql`INSERT INTO ab_events (seq, ts, actor_type, actor_id, action, task_id, detail_json, prev_hash, hash)
        VALUES (${seq}, ${ts}, ${event.actorType}, ${event.actorId}, ${event.action}, ${event.taskId}, ${JSON.stringify(detail)}, ${prevHash}, ${hash})`;
      persisted.push({ seq, ts, actorType: event.actorType, actorId: event.actorId, action: event.action, taskId: event.taskId, detail, prevHash, hash });
      prevHash = hash;
    }

    for (const dispatch of tx.dispatches) {
      const message: TaskMessage = {
        v: 1,
        runId: run.id,
        taskId: dispatch.taskId,
        role: dispatch.role,
        dispatchId: dispatch.dispatchId,
        attempt: dispatch.attempt,
        enqueuedAt: tx.now,
      };
      const payload = JSON.stringify({ message, delaySeconds: dispatch.delaySeconds });
      const copies = dispatch.duplicate ? 2 : 1;
      for (let i = 0; i < copies; i++) {
        this.sql`INSERT INTO ab_outbox (kind, payload_json, attempts, next_attempt_at) VALUES ('queue', ${payload}, 0, ${tx.now})`;
      }
    }
    this.afterPersist(tx, persisted);
    return persisted;
  }

  /** Hook for the D1 mirror outbox rows (commit 12). */
  protected afterPersist(_tx: RunTx, _events: PersistedEvent[]): void {}

  // -------------------------------------------------------------------------
  // Views

  protected recentEvents(): RunSnapshot["recentEvents"] {
    return this.sql<{ seq: number; ts: string; action: string; actor_id: string; task_id: string | null }>`
      SELECT seq, ts, action, actor_id, task_id FROM ab_events ORDER BY seq DESC LIMIT 50`
      .reverse()
      .map((e) => ({ seq: e.seq, ts: e.ts, action: e.action, actorId: e.actor_id, taskId: e.task_id }));
  }

  protected snapshotOf(state: RunState): RunSnapshot {
    return buildSnapshot(state, this.recentEvents());
  }

  protected snapshot(): RunSnapshot {
    const state = this.loadState();
    return state ? this.snapshotOf(state) : emptySnapshot(this.name);
  }

  protected buildContext(state: RunState, task: TaskRecord): TaskContext {
    const run = state.run;
    const request = run.request;
    const config = this.config();
    const execute = task.kind === "verify" ? [...state.tasks.values()].find((t) => t.kind === "execute" && t.stepId === task.stepId) : undefined;
    const faults =
      config.faultInjection && task.kind === "execute"
        ? (request.sim?.faults ?? [])
            .filter((f) => f.stepId === task.stepId && f.generation === task.generation && f.attempt === task.attempts)
            .map((f) => f.kind)
        : [];
    const step = task.stepId !== null && task.tool !== null ? { stepId: task.stepId, tool: task.tool, args: task.args ?? {} } : null;
    return {
      runId: run.id,
      taskId: task.id,
      kind: task.kind,
      role: ROLE_FOR_KIND[task.kind],
      attempt: task.attempts,
      generation: task.generation,
      leaseId: task.leaseId ?? "",
      epoch: task.leaseEpoch,
      leaseExpiresAt: task.leaseExpiresAt ?? 0,
      request: { requestType: request.requestType, subjectEmployeeId: request.subjectEmployeeId, requestText: request.requestText, title: request.title },
      step,
      idempotencyKey:
        task.kind === "execute" && step && isWriteTool(step.tool) ? idempotencyKey(run.id, step.stepId, task.generation, step.tool, step.args) : null,
      executeResult: execute?.result ?? null,
      budget: run.budget,
      usage: run.usage,
      remaining: {
        toolCalls: Math.max(0, run.budget.maxToolCalls - run.usage.toolCalls - run.usage.toolCallsReserved),
        llmTokens: Math.max(0, run.budget.maxLlmTokens - run.usage.llmTokens),
      },
      faults,
    };
  }
}

export { SYSTEM };
