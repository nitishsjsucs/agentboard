import type { TaskView } from "../../shared/api-types.ts";
import { formatTime } from "./RunTable.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

const KIND_ORDER = { plan: 0, execute: 1, verify: 2 } as const;

function stepNumber(stepId: string | null): number {
  return stepId ? Number(stepId.slice(1)) : 0;
}

/** Plan first, then each step in numeric order with its execute task before its verify task. */
export function orderTasks(tasks: readonly TaskView[]): TaskView[] {
  return [...tasks].sort((a, b) => {
    if (a.kind === "plan" || b.kind === "plan") return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return stepNumber(a.stepId) - stepNumber(b.stepId) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });
}

export function TaskTimeline({ tasks }: { tasks: readonly TaskView[] }) {
  return (
    <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: "var(--space-2)" }}>
      {orderTasks(tasks).map((task) => (
        <li key={task.id} className="card card__body" data-testid="task-row" data-task-id={task.id}>
          <div className="row">
            <strong>{task.kind === "plan" ? "Plan" : `${task.stepId} ${task.kind}`}</strong>
            {task.tool ? <span className="mono small">{task.tool}</span> : null}
            <StatusBadge status={task.status} />
            {task.requiresApproval ? <span className="badge badge--warning">approval</span> : null}
            <span className="spacer" />
            <span className="badge" data-testid="attempts">
              attempt {task.attempts}
            </span>
            {task.generation > 0 ? (
              <span className="badge badge--accent" data-testid="generation">
                gen {task.generation}
              </span>
            ) : null}
          </div>
          <div className="row small muted" style={{ marginTop: 4 }}>
            {task.lease ? (
              <span data-testid="lease">
                leased by {task.lease.owner}, epoch {task.lease.epoch}, until {formatTime(task.lease.expiresAt)}
              </span>
            ) : null}
            {task.holdReason ? <span className="badge badge--warning">held: {task.holdReason.replace("_", " ")}</span> : null}
            {task.lastError ? <span className="error-text">{task.lastError}</span> : null}
            <span className="spacer" />
            <span className="faint">updated {formatTime(task.updatedAt)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
