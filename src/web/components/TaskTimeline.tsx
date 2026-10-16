import type { TaskView } from "../../shared/api-types.ts";
import { taskErrorSentence } from "./explain.ts";
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

/**
 * One dense row per task, in a single card. Rows carry id `task-<taskId>` and tabIndex -1, so the
 * plan map can move focus to a step's row.
 */
export function TaskTimeline({ tasks }: { tasks: readonly TaskView[] }) {
  return (
    <ol className="card task-list" aria-label="Tasks">
      {orderTasks(tasks).map((task) => {
        const sentence = taskErrorSentence(task.lastError);
        return (
          <li key={task.id} id={`task-${task.id}`} tabIndex={-1} className="task-row" data-testid="task-row" data-task-id={task.id}>
            <strong className="task-row__name">{task.kind === "plan" ? "Plan" : `${task.stepId} ${task.kind}`}</strong>
            {task.tool ? <span className="mono small task-row__tool">{task.tool}</span> : null}
            <StatusBadge status={task.status} />
            {task.requiresApproval ? <span className="badge badge--warning">approval</span> : null}
            {task.holdReason ? <span className="badge badge--warning">held: {task.holdReason.replace("_", " ")}</span> : null}
            {task.lease ? (
              <span className="small muted" data-testid="lease">
                leased by {task.lease.owner}, epoch {task.lease.epoch}, until {formatTime(task.lease.expiresAt)}
              </span>
            ) : null}
            {task.lastError ? (
              <span className="error-text" data-testid="last-error">
                {sentence ? <span>{sentence} </span> : null}
                <span className="mono">{task.lastError}</span>
              </span>
            ) : null}
            <span className="spacer" />
            <span className="badge" data-testid="attempts">
              attempt {task.attempts}
            </span>
            {task.generation > 0 ? (
              <span className="badge badge--accent" data-testid="generation">
                gen {task.generation}
              </span>
            ) : null}
            <span className="small faint task-row__time">updated {formatTime(task.updatedAt)}</span>
          </li>
        );
      })}
    </ol>
  );
}
