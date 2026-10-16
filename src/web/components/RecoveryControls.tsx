// Operator and admin recovery controls (SPEC section 3.5). Buttons appear only
// for roles that hold the permission and states where the command applies;
// every command asks for an audited reason, and the retry and skip dialogs name
// the verify task they cascade to. The coordinator re-checks everything.

import { useState } from "react";
import type { Budget } from "../../shared/domain.ts";
import type { RunSnapshot, TaskView } from "../../shared/api-types.ts";
import { api } from "../api/client.ts";
import { useCan } from "../api/hooks.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

type Action =
  | { kind: "run"; command: "pause" | "resume" | "cancel" }
  | { kind: "task"; command: "retry" | "release-lease" | "skip"; task: TaskView }
  | { kind: "budget" };

const TERMINAL = new Set(["succeeded", "rejected", "cancelled"]);

function verifyOf(tasks: readonly TaskView[], execute: TaskView): TaskView | undefined {
  return tasks.find((t) => t.kind === "verify" && t.stepId === execute.stepId);
}

function executeOf(tasks: readonly TaskView[], verify: TaskView): TaskView | undefined {
  return tasks.find((t) => t.kind === "execute" && t.stepId === verify.stepId);
}

export function canRetry(tasks: readonly TaskView[], task: TaskView): boolean {
  if (task.status === "rejected") return task.requiresApproval;
  if (task.kind === "execute") return task.status === "failed" || task.status === "dead_lettered" || (task.status === "succeeded" && verifyOf(tasks, task)?.status === "failed");
  if (task.kind === "verify") return task.status === "failed" && executeOf(tasks, task)?.status === "succeeded";
  return task.status === "failed" || task.status === "dead_lettered";
}

export function canSkip(task: TaskView): boolean {
  if (task.kind === "plan" || task.requiresApproval) return false;
  if (task.kind === "execute") return task.status === "failed" || task.status === "dead_lettered";
  return task.status === "failed";
}

function label(task: TaskView): string {
  return task.kind === "plan" ? "the plan task" : `${task.stepId} ${task.kind} (${task.tool})`;
}

const SUCCESS: Record<"pause" | "resume" | "cancel", string> = { pause: "Paused the run.", resume: "Resumed the run.", cancel: "Cancelled the run." };

/** Plain sentences for the coordinator's refusal codes; anything else shows its code. */
export function refusalSentence(code: string | undefined): string {
  switch (code) {
    case "invalid_state":
      return "The run is no longer in a state that allows this; the page now shows its current state.";
    case "not_retryable":
      return "This task cannot be retried in its current state; the page now shows its current state.";
    case "not_found":
      return "That task is no longer part of this run; the page now shows its current state.";
    case "not_a_raise":
      return "The budget was not raised: raise at least one value above its current limit, and lower none.";
    case "not_skippable":
      return "Plan tasks and approval-gated steps cannot be skipped.";
    default:
      return `Refused: ${code ?? "invalid state"}.`;
  }
}

function successSentence(action: Action): string {
  if (action.kind === "run") return SUCCESS[action.command];
  if (action.kind === "budget") return "Raised the budget.";
  if (action.command === "retry") return `Retry of ${label(action.task)} requested.`;
  if (action.command === "release-lease") return `Released the lease of ${label(action.task)}.`;
  return `Skipped ${label(action.task)}.`;
}

const MINUTE = 60_000;
type BudgetField = "maxToolCalls" | "maxLlmTokens" | "maxAttemptsPerTask" | "maxActiveMs";
const BUDGET_FIELDS: readonly BudgetField[] = ["maxToolCalls", "maxLlmTokens", "maxAttemptsPerTask", "maxActiveMs"];
/** Mirrors the coordinator's planner floor (PLANNER_TOKEN_FLOOR in the worker's budgets.ts). */
const PLANNER_TOKEN_FLOOR = 1500;

/** The limit as shown in the form: active time in minutes, the rest as stored. */
function shown(field: BudgetField, budget: Budget): number {
  return field === "maxActiveMs" ? Math.round((budget.maxActiveMs / MINUTE) * 100) / 100 : budget[field];
}

/** Which limits the run has reached, from its usage (the budget the coordinator blocked on is among them). */
function exhaustedFields(snapshot: RunSnapshot): Set<BudgetField> {
  const { usage, budget, tasks } = snapshot;
  const out = new Set<BudgetField>();
  const blocked = tasks.filter((t) => t.status === "budget_blocked");
  if (usage.toolCalls + usage.toolCallsReserved >= budget.maxToolCalls) out.add("maxToolCalls");
  if (usage.llmTokens >= budget.maxLlmTokens || (blocked.some((t) => t.kind === "plan") && budget.maxLlmTokens - usage.llmTokens < PLANNER_TOKEN_FLOOR)) out.add("maxLlmTokens");
  if (blocked.some((t) => t.attempts >= budget.maxAttemptsPerTask)) out.add("maxAttemptsPerTask");
  if (usage.activeMs >= budget.maxActiveMs || snapshot.statusReason === "deadline_exceeded") out.add("maxActiveMs");
  return out;
}

export function RecoveryControls({ runId, snapshot, onDone }: { runId: string; snapshot: RunSnapshot; onDone: () => void }) {
  const canControl = useCan("runs:control");
  const canRetryTasks = useCan("tasks:retry");
  const canRelease = useCan("tasks:release_lease");
  const canSkipTasks = useCan("tasks:skip");
  const canBudget = useCan("budgets:edit");
  const [action, setAction] = useState<Action | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; accepted: boolean } | null>(null);
  // The budget form's values as typed, in the units shown (active time in minutes).
  const [form, setForm] = useState<Record<BudgetField, string>>({ maxToolCalls: "", maxLlmTokens: "", maxAttemptsPerTask: "", maxActiveMs: "" });

  const { status, tasks } = snapshot;
  const terminal = TERMINAL.has(status);
  const runButtons: { command: "pause" | "resume" | "cancel"; show: boolean }[] = [
    { command: "pause", show: canControl && ["queued", "planning", "running", "needs_attention"].includes(status) },
    { command: "resume", show: canControl && status === "paused" },
    { command: "cancel", show: canControl && !terminal },
  ];
  const taskButtons = tasks.flatMap((task) => [
    ...(canRetryTasks && !terminal && canRetry(tasks, task) ? [{ command: "retry" as const, task }] : []),
    ...(canRelease && !terminal && task.status === "leased" ? [{ command: "release-lease" as const, task }] : []),
    ...(canSkipTasks && !terminal && canSkip(task) ? [{ command: "skip" as const, task }] : []),
  ]);
  const showBudget = canBudget && !terminal;

  // A raise must increase at least one field and lower none (the coordinator refuses anything else).
  const requested = (field: BudgetField): number => {
    const typed = form[field].trim();
    if (typed === "" || !Number.isFinite(Number(typed))) return snapshot.budget[field];
    return field === "maxActiveMs" ? Math.round(Number(typed) * MINUTE) : Number(typed);
  };
  const isRaise = BUDGET_FIELDS.some((f) => requested(f) > snapshot.budget[f]) && BUDGET_FIELDS.every((f) => requested(f) >= snapshot.budget[f]);
  const exhausted = exhaustedFields(snapshot);

  const open = (next: Action) => {
    // A new command starts from a clean slate: the previous outcome no longer describes the page.
    setOutcome(null);
    if (next.kind === "budget") {
      setForm({
        maxToolCalls: String(shown("maxToolCalls", snapshot.budget)),
        maxLlmTokens: String(shown("maxLlmTokens", snapshot.budget)),
        maxAttemptsPerTask: String(shown("maxAttemptsPerTask", snapshot.budget)),
        maxActiveMs: String(shown("maxActiveMs", snapshot.budget)),
      });
    }
    setAction(next);
  };

  const run = async (reason: string) => {
    if (!action) return;
    let response: { accepted: boolean; reason?: string };
    if (action.kind === "run") response = await api.post(`/api/runs/${runId}/${action.command}`, { reason });
    else if (action.kind === "task") response = await api.post(`/api/runs/${runId}/tasks/${action.task.id}/${action.command}`, { reason });
    else {
      // Only the raised fields are sent; active time goes back to milliseconds.
      const raised = Object.fromEntries(BUDGET_FIELDS.filter((f) => requested(f) > snapshot.budget[f]).map((f) => [f, requested(f)]));
      response = await api.patch(`/api/runs/${runId}/budget`, { ...raised, reason });
    }
    setOutcome(response.accepted ? { text: successSentence(action), accepted: true } : { text: refusalSentence(response.reason), accepted: false });
    setAction(null);
    onDone();
  };

  const cascadeNote = (a: Extract<Action, { kind: "task" }>) => {
    if (a.task.status === "rejected" && a.task.requiresApproval && a.command === "retry") return "Retrying asks for a new approval.";
    if (a.task.kind !== "execute") return a.command === "skip" && a.task.kind === "verify" ? "The write stays unverified; the audit log records that." : null;
    const verify = verifyOf(tasks, a.task);
    if (!verify) return null;
    if (a.command === "retry") return `Also resets its verify task (${verify.stepId} verify) to pending at generation ${verify.generation + 1}.`;
    if (a.command === "skip") return `Also skips its verify task (${verify.stepId} verify).`;
    return null;
  };

  const outcomeRegion = (
    <div role="status" data-testid="recovery-outcome" className={`small${outcome && !outcome.accepted ? " error-text" : " muted"}`}>
      {outcome?.text ?? ""}
    </div>
  );

  if (!runButtons.some((b) => b.show) && taskButtons.length === 0 && !showBudget) {
    return (
      <div className="stack" style={{ gap: "var(--space-2)" }}>
        <div className="small muted" data-testid="no-controls">
          No recovery actions available{terminal ? " (the run is finished)" : ""}.
        </div>
        {outcomeRegion}
      </div>
    );
  }

  const budgetLabel = (field: BudgetField): string => {
    const { usage, budget } = snapshot;
    switch (field) {
      case "maxToolCalls":
        return `Tool calls (used ${usage.toolCalls + usage.toolCallsReserved} of ${budget.maxToolCalls})`;
      case "maxLlmTokens":
        return `LLM tokens (used ${usage.llmTokens} of ${budget.maxLlmTokens})`;
      case "maxAttemptsPerTask":
        return `Attempts per task (now ${budget.maxAttemptsPerTask})`;
      case "maxActiveMs":
        return `Active time in minutes (used ${Math.round((usage.activeMs / MINUTE) * 10) / 10} of ${shown("maxActiveMs", budget)})`;
    }
  };

  return (
    <div className="stack" style={{ gap: "var(--space-3)" }}>
      <div className="row">
        {runButtons
          .filter((b) => b.show)
          .map((b) => (
            <button key={b.command} type="button" className={`btn${b.command === "cancel" ? " btn--danger" : ""}`} onClick={() => open({ kind: "run", command: b.command })}>
              {b.command[0]?.toUpperCase()}
              {b.command.slice(1)} run
            </button>
          ))}
        {showBudget ? (
          <button type="button" className="btn" onClick={() => open({ kind: "budget" })}>
            Raise budget
          </button>
        ) : null}
      </div>
      {taskButtons.length > 0 ? (
        <div className="stack" style={{ gap: "var(--space-2)" }}>
          {taskButtons.map((b) => (
            <div key={`${b.command}-${b.task.id}`} className="row small">
              <button type="button" className={`btn btn--small${b.command === "skip" ? " btn--danger" : ""}`} onClick={() => open({ kind: "task", command: b.command, task: b.task })}>
                {b.command === "release-lease" ? "Release lease" : b.command === "retry" ? "Retry" : "Skip"}
              </button>
              <span>{label(b.task)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {outcomeRegion}
      {action ? (
        <ConfirmDialog
          title={
            action.kind === "run"
              ? `${action.command[0]?.toUpperCase()}${action.command.slice(1)} this run`
              : action.kind === "budget"
                ? "Raise the run budget"
                : `${action.command === "release-lease" ? "Release the lease of" : action.command === "retry" ? "Retry" : "Skip"} ${label(action.task)}`
          }
          confirmLabel="Confirm"
          action={action.kind === "run" ? "pause, resume or cancel runs" : action.kind === "budget" ? "raise budgets" : action.command === "skip" ? "skip tasks" : action.command === "retry" ? "retry tasks" : "release leases"}
          danger={action.kind === "run" ? action.command === "cancel" : action.kind === "task" && action.command === "skip"}
          confirmDisabled={action.kind === "budget" && !isRaise}
          confirmHint={action.kind === "budget" && !isRaise ? "Raise at least one value above its current limit, and lower none." : undefined}
          onCancel={() => setAction(null)}
          onConfirm={run}
        >
          {action.kind === "task" && cascadeNote(action) ? <p className="notice">{cascadeNote(action)}</p> : null}
          {action.kind === "budget" ? (
            <div className="form-two">
              {BUDGET_FIELDS.map((field) => (
                <div className="field" key={field}>
                  <label htmlFor={`budget-${field}`}>
                    {budgetLabel(field)}
                    {exhausted.has(field) ? (
                      <>
                        {" "}
                        <span className="badge badge--danger">exhausted</span>
                      </>
                    ) : null}
                  </label>
                  <input
                    id={`budget-${field}`}
                    className="input"
                    type="number"
                    min={shown(field, snapshot.budget)}
                    step={field === "maxActiveMs" ? "any" : 1}
                    value={form[field]}
                    onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
