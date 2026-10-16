// Why a run is waiting or needs attention, and what this principal can do
// next. It only describes: the Recovery card and the coordinator decide.

import type { ApprovalListItem, MeResponse, RunSnapshot, TaskView } from "../../shared/api-types.ts";
import type { Permission } from "../../shared/domain.ts";
import { useSession } from "../api/hooks.ts";
import { ROLE_FOR_KIND, taskLabel } from "./explain.ts";
import { formatTime } from "./RunTable.tsx";

/** Mirrors the coordinator's planner floor (PLANNER_TOKEN_FLOOR in the worker's budgets.ts). */
const PLANNER_TOKEN_FLOOR = 1500;

export interface NextStepInput {
  snapshot: Pick<RunSnapshot, "status" | "statusReason" | "tasks" | "usage" | "budget">;
  approvals: readonly Pick<ApprovalListItem, "status" | "expiresAt">[];
  requester: string;
  me: MeResponse | null;
  llmProvider: string | null;
}

export interface NextStepNotice {
  tone: "info" | "warning";
  lines: string[];
  /** Offer a way to the run's Approvals tab. */
  approvals?: boolean;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Which budget a blocked task ran into, from the snapshot's usage and limits. */
function exhaustedMeter(snapshot: NextStepInput["snapshot"]): string {
  const { usage, budget, tasks } = snapshot;
  const blocked = tasks.filter((t) => t.status === "budget_blocked");
  const attempts = blocked.find((t) => t.attempts >= budget.maxAttemptsPerTask);
  if (attempts) return `${taskLabel(attempts)} used ${attempts.attempts} of ${budget.maxAttemptsPerTask} attempts per task`;
  const calls = usage.toolCalls + usage.toolCallsReserved;
  if (calls >= budget.maxToolCalls) return `tool calls are at ${calls} of ${budget.maxToolCalls}`;
  if (blocked.some((t) => t.kind === "plan") && budget.maxLlmTokens - usage.llmTokens < PLANNER_TOKEN_FLOOR) {
    return `LLM tokens are at ${usage.llmTokens} of ${budget.maxLlmTokens}, and planning needs ${PLANNER_TOKEN_FLOOR} left`;
  }
  return "a limit was reached";
}

export function describeNextStep(input: NextStepInput): NextStepNotice | null {
  const { snapshot, approvals, requester, me, llmProvider } = input;
  const { status, statusReason, tasks } = snapshot;
  const can = (permission: Permission) => me?.permissions.includes(permission) ?? false;
  const retry = (what: string, suffix = "") => (can("tasks:retry") ? `Retry ${what} in Recovery${suffix}.` : `An operator or an admin can retry ${what}${suffix}.`);
  const raise = can("budgets:edit") ? "Use Raise budget in Recovery." : "Ask an admin to raise the budget.";

  if (status === "paused") return { tone: "warning", lines: ["Paused. Tasks wait until someone with run control resumes it."] };

  if (status === "awaiting_approval") {
    const next = approvals.filter((a) => a.status === "pending").sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0];
    const lines = [`Waiting for an approver or an admin other than ${requester}${next ? `; the approval expires ${formatTime(next.expiresAt)}` : ""}.`];
    if (me && requester.toLowerCase() === me.principal.id) lines.push("You cannot decide it because you requested this run.");
    return { tone: "info", lines, approvals: true };
  }

  if (status === "needs_attention" && statusReason) {
    if (statusReason.startsWith("task_failed:")) {
      const code = statusReason.slice("task_failed:".length);
      const failed: TaskView | undefined = tasks.find((t) => t.status === "failed");
      const label = failed ? taskLabel(failed) : "a task";
      if (code === "agent_exception" && (!failed || failed.kind === "plan")) {
        const lines = ["The planner failed on every attempt."];
        if (llmProvider === "stub") {
          lines.push("With the local stub planner this usually means the request is not one of the samples, so a retry will fail the same way.");
          lines.push(can("runs:control") ? "Cancel this run and launch a sample." : "An operator or an admin can cancel this run.");
        } else {
          lines.push(retry("the plan task", ", or cancel the run"));
        }
        return { tone: "warning", lines };
      }
      if (code === "plan_invalid") return { tone: "warning", lines: ["The plan did not pass validation, so no step ran. The Events table lists the issues.", retry("the plan task", ", or cancel the run")] };
      if (code === "postcondition_failed") {
        // Recovery lists two rows for the step; name the one that runs the write again, as Recovery labels it.
        const step = failed?.stepId ?? "?";
        const row = `${step} execute${failed?.tool ? ` (${failed.tool})` : ""}`;
        return {
          tone: "warning",
          lines: [
            `The verifier found that the write of ${failed ? taskLabel({ ...failed, kind: "execute" }) : "a step"} did not take effect.`,
            can("tasks:retry") ? `Retry ${row} in Recovery to run the write again; retrying ${step} verify only reads the record again.` : `An operator or an admin can retry ${row} to run the write again.`,
          ],
        };
      }
      if (code === "attempts_exhausted") return { tone: "warning", lines: [`${capitalize(label)} used every attempt it was allowed.`, retry("it")] };
      if (code === "timeout") return { tone: "warning", lines: [`${capitalize(label)} timed out on every attempt.`, retry("it")] };
      const which = failed?.kind === "plan" ? "The plan task" : `Step ${failed?.stepId ?? "?"}`;
      return { tone: "warning", lines: [`${which} failed (${code}).`, retry("it")] };
    }
    if (statusReason === "budget_exhausted") return { tone: "warning", lines: [`The run is out of budget: ${exhaustedMeter(snapshot)}.`, raise] };
    if (statusReason === "dead_lettered") return { tone: "warning", lines: ["A task was dead-lettered after its queue deliveries ran out.", retry("it")] };
    if (statusReason === "approval_expired") {
      return {
        tone: "warning",
        lines: [
          "An approval expired before anyone decided it.",
          can("tasks:retry") ? "Retry the gated step to request a new approval." : "An operator or an admin can retry the gated step to request a new approval.",
        ],
      };
    }
    if (statusReason === "deadline_exceeded") return { tone: "warning", lines: ["The run used up its active-time budget.", raise] };
    return null;
  }

  if (status === "queued" || status === "planning" || status === "running") {
    const held = tasks.filter((t) => t.status === "held" && t.holdReason === "role_disabled");
    const moving = tasks.some((t) => t.status === "ready" || t.status === "leased");
    if (held.length > 0 && !moving) {
      const roles = [...new Set(held.map((t) => ROLE_FOR_KIND[t.kind]))];
      const names = roles.length === 1 ? `the ${roles[0]} role is` : `the ${roles.slice(0, -1).join(", ")} and ${roles.at(-1)} roles are`;
      return { tone: "warning", lines: [`Tasks are held because ${names} disabled. An admin can enable ${roles.length === 1 ? "it" : "them"} on the Dashboard.`] };
    }
  }
  return null;
}

export function NextStep({
  snapshot,
  approvals,
  requester,
  onOpenApprovals,
}: Omit<NextStepInput, "me" | "llmProvider"> & { onOpenApprovals?: () => void }) {
  const { me, health } = useSession();
  const notice = describeNextStep({ snapshot, approvals, requester, me, llmProvider: health?.llmProvider ?? null });
  if (!notice) return null;
  return (
    <div className={`notice${notice.tone === "warning" ? " notice--warning" : ""}`} data-testid="next-step">
      {notice.lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
      {notice.approvals && onOpenApprovals ? (
        <button type="button" className="btn btn--small" style={{ marginTop: "var(--space-2)" }} onClick={onOpenApprovals}>
          Open the Approvals tab
        </button>
      ) : null}
    </div>
  );
}
