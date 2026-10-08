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

export function RecoveryControls({ runId, snapshot, onDone }: { runId: string; snapshot: RunSnapshot; onDone: () => void }) {
  const canControl = useCan("runs:control");
  const canRetryTasks = useCan("tasks:retry");
  const canRelease = useCan("tasks:release_lease");
  const canSkipTasks = useCan("tasks:skip");
  const canBudget = useCan("budgets:edit");
  const [action, setAction] = useState<Action | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [budget, setBudget] = useState<Partial<Budget>>({});

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
  if (!runButtons.some((b) => b.show) && taskButtons.length === 0 && !showBudget) {
    return <div className="small muted" data-testid="no-controls">No recovery actions available{terminal ? " (the run is finished)" : ""}.</div>;
  }

  const run = async (reason: string) => {
    if (!action) return;
    let response: { accepted: boolean; reason?: string };
    if (action.kind === "run") response = await api.post(`/api/runs/${runId}/${action.command}`, { reason });
    else if (action.kind === "task") response = await api.post(`/api/runs/${runId}/tasks/${action.task.id}/${action.command}`, { reason });
    else response = await api.patch(`/api/runs/${runId}/budget`, { ...budget, reason });
    setOutcome(response.accepted ? "Accepted." : `Refused: ${response.reason ?? "invalid state"}.`);
    setAction(null);
    onDone();
  };

  const cascadeNote = (a: Extract<Action, { kind: "task" }>) => {
    if (a.task.kind !== "execute") return a.command === "skip" && a.task.kind === "verify" ? "The write stays unverified; the audit log records that." : null;
    const verify = verifyOf(tasks, a.task);
    if (!verify) return null;
    if (a.command === "retry") return `Also resets its verify task (${verify.stepId} verify) to pending at generation ${verify.generation + 1}.`;
    if (a.command === "skip") return `Also skips its verify task (${verify.stepId} verify).`;
    return null;
  };

  return (
    <div className="stack" style={{ gap: "var(--space-3)" }}>
      <div className="row">
        {runButtons
          .filter((b) => b.show)
          .map((b) => (
            <button key={b.command} type="button" className={`btn${b.command === "cancel" ? " btn--danger" : ""}`} onClick={() => setAction({ kind: "run", command: b.command })}>
              {b.command[0]?.toUpperCase()}
              {b.command.slice(1)} run
            </button>
          ))}
        {showBudget ? (
          <button type="button" className="btn" onClick={() => setAction({ kind: "budget" })}>
            Raise budget
          </button>
        ) : null}
      </div>
      {taskButtons.length > 0 ? (
        <div className="stack" style={{ gap: "var(--space-2)" }}>
          {taskButtons.map((b) => (
            <div key={`${b.command}-${b.task.id}`} className="row small">
              <button type="button" className={`btn btn--small${b.command === "skip" ? " btn--danger" : ""}`} onClick={() => setAction({ kind: "task", command: b.command, task: b.task })}>
                {b.command === "release-lease" ? "Release lease" : b.command === "retry" ? "Retry" : "Skip"}
              </button>
              <span>{label(b.task)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {outcome ? <div className="small muted">{outcome}</div> : null}
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
          danger={action.kind === "run" ? action.command === "cancel" : action.kind === "task" && action.command === "skip"}
          onCancel={() => setAction(null)}
          onConfirm={run}
        >
          {action.kind === "task" && cascadeNote(action) ? <p className="notice">{cascadeNote(action)}</p> : null}
          {action.kind === "budget" ? (
            <div className="grid grid--two" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {(["maxToolCalls", "maxLlmTokens", "maxAttemptsPerTask", "maxActiveMs"] as const).map((field) => (
                <div className="field" key={field}>
                  <label htmlFor={`budget-${field}`}>
                    {field} (now {snapshot.budget[field]})
                  </label>
                  <input
                    id={`budget-${field}`}
                    className="input"
                    type="number"
                    min={snapshot.budget[field]}
                    value={budget[field] ?? ""}
                    onChange={(e) => setBudget((b) => ({ ...b, [field]: e.target.value === "" ? undefined : Number(e.target.value) }))}
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
