// Plan map: where the run is, which step blocks it and what waits behind that
// step. Drawn from the tasks the run page already holds (no request); the
// layout is CSS only, from each node's depth (column) and row.

import { useId, type CSSProperties } from "react";
import type { RunSnapshot, TaskView } from "../../shared/api-types.ts";
import type { RunStatus } from "../../shared/domain.ts";
import { ROLE_FOR_KIND, taskErrorSentence } from "./explain.ts";
import { buildPlanGraph, dependentsOf, listSteps, planSummary, STATE_TONE, type PlanGraph, type StepNode, type StepTone } from "./planGraph.ts";

/** Node box and pitch in px; the connector geometry and the CSS use the same numbers. A 144 px box at a 158 px column pitch fits five columns (a linear offboarding plan) in the 1280 px layout without scrolling. */
export const NODE_W = 144;
export const NODE_H = 64;
export const COL_PITCH = 158;
export const ROW_PITCH = 76;

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** "the tool refused the call, so retrying it unchanged will fail again" (no capital, no final period). */
function errorClause(code: string | null): string {
  const sentence = taskErrorSentence(code);
  if (sentence) return lowerFirst(sentence.replace(/\.$/, ""));
  return code ? `(${code})` : "with an error";
}

/** The plan task's line: planning, accepted (with its generation) or why it failed. */
export function planLine(plan: TaskView | null, status: RunStatus): { text: string; accepted: boolean } {
  if (plan?.status === "succeeded") return { text: `Plan accepted${plan.generation > 0 ? `, generation ${plan.generation}` : ""}`, accepted: true };
  if (plan?.status === "failed") {
    if (plan.lastError === "agent_exception") return { text: `The planner failed on every attempt: ${errorClause(plan.lastError)}.`, accepted: false };
    if (plan.lastError === "plan_invalid") return { text: `The plan was rejected: ${errorClause(plan.lastError)}.`, accepted: false };
    return { text: `The plan task failed: ${errorClause(plan.lastError)}.`, accepted: false };
  }
  if (status === "cancelled") return { text: "The run was cancelled before a plan was accepted.", accepted: false };
  return { text: "Planning: the steps appear when the plan is accepted.", accepted: false };
}

function nodeLabel(node: StepNode): string {
  return `${node.stepId} ${node.tool}`;
}

/** Who can unblock a step, in the same words as the run's next-step notice. */
function blockedClause(node: StepNode, dependents: StepNode[]): string {
  switch (node.state) {
    case "awaiting_approval": {
      const waiting = dependents.filter((d) => d.state !== "done").map((d) => d.stepId);
      return `waiting for an approver.${waiting.length > 0 ? ` ${listSteps(waiting)} ${waiting.length === 1 ? "runs" : "run"} after it.` : ""}`;
    }
    case "failed":
      return `failed: ${errorClause(node.execute.lastError)}. An operator or an admin can retry it.`;
    case "verification_failed":
      return node.verify?.lastError === "postcondition_failed"
        ? `verification failed: ${errorClause("postcondition_failed")}. An operator or an admin can retry ${node.stepId} execute to run the write again.`
        : `verification failed: ${errorClause(node.verify?.lastError ?? null)}. An operator or an admin can retry it.`;
    case "dead_lettered":
      return "dead-lettered after its queue deliveries ran out. An operator or an admin can retry it.";
    case "out_of_budget":
      return "out of budget. An admin can raise the budget.";
    case "held": {
      const held = [node.execute, node.verify].find((t) => t?.status === "held");
      if (held?.holdReason === "checkpoint") return "held at a simulation checkpoint until the run is paused and resumed.";
      const role = held ? ROLE_FOR_KIND[held.kind] : "executor";
      return `held: ${role} role disabled. An admin can enable the ${role} role on the Dashboard.`;
    }
    case "rejected":
      return "the approval expired. An operator or an admin can retry it to request a new approval.";
    default:
      return `${node.stateWord}.`;
  }
}

/** The plan task itself can be the blocker while no step exists yet. */
function planBlockedSentence(plan: TaskView | null): string | null {
  if (!plan) return null;
  switch (plan.status) {
    case "held":
      return plan.holdReason === "checkpoint" ? null : "Blocked at the plan task: held: planner role disabled. An admin can enable the planner role on the Dashboard.";
    case "budget_blocked":
      return "Blocked at the plan task: out of budget. An admin can raise the budget.";
    case "dead_lettered":
      return "Blocked at the plan task: dead-lettered after its queue deliveries ran out. An operator or an admin can retry it.";
    default:
      return null;
  }
}

/** The one sentence under the map: what blocks the run and who acts, or why nothing moves. */
export function planMapSentence(graph: PlanGraph, status: RunStatus): string | null {
  if (status === "paused") return "Paused: no step starts until the run is resumed.";
  if (status === "succeeded") return "All steps done.";
  if (status === "cancelled") return "The run was cancelled; steps that had not finished were cancelled.";
  if (graph.plan?.status !== "succeeded") return planBlockedSentence(graph.plan);
  const blocker = graph.blocker;
  if (status === "rejected") {
    const rejected = graph.nodes.find((n) => n.state === "rejected");
    if (!rejected) return "An approver rejected a step, so the run ended.";
    const notRun = graph.nodes.filter((n) => n.state === "cancelled").map((n) => n.stepId);
    return `Rejected at ${nodeLabel(rejected)}: an approver rejected this step, so the run ended.${notRun.length > 0 ? ` ${listSteps(notRun)} did not run.` : ""}`;
  }
  if (!blocker) return null;
  const more = graph.extraBlockers > 0 ? ` ${graph.extraBlockers} more ${graph.extraBlockers === 1 ? "step is" : "steps are"} blocked.` : "";
  return `Blocked at ${nodeLabel(blocker)}: ${blockedClause(blocker, dependentsOf(graph, blocker.stepId))}${more}`;
}

/** "s3 access.revoke_all_roles, write, needs approval, not started, runs after s2". */
export function nodeName(node: StepNode): string {
  const parts = [nodeLabel(node), node.write ? "write" : "read"];
  if (node.gated) parts.push("needs approval");
  parts.push(node.stateWord);
  if (node.after.length > 0) parts.push(`runs after ${listSteps(node.after)}`);
  return parts.join(", ");
}

function StateIcon({ tone }: { tone: StepTone }) {
  const common = { width: 12, height: 12, viewBox: "0 0 12 12", "aria-hidden": true, className: `plan-node__icon tone--${tone}` } as const;
  switch (tone) {
    case "success":
      return (
        <svg {...common}>
          <path d="M2.5 6.5l2.2 2.2L9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "danger":
      return (
        <svg {...common}>
          <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "warning":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 3.4V6l1.8 1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <path d="M3.5 2.5l5 3.5-5 3.5z" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
  }
}

/** Write and verify progress: filled when done, a ring when not yet, a cross when it failed. */
function Pip({ task }: { task: TaskView | null }) {
  const status = task?.status;
  const done = status === "succeeded" || status === "skipped";
  const failed = status === "failed" || status === "rejected" || status === "dead_lettered";
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className={`plan-pip${done ? " tone--success" : failed ? " tone--danger" : " tone--faint"}`}>
      {failed ? (
        <path d="M1.2 1.2l5.6 5.6M6.8 1.2L1.2 6.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      ) : done ? (
        <circle cx="4" cy="4" r="3.5" fill="currentColor" />
      ) : (
        <circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      )}
    </svg>
  );
}

function Lock() {
  return (
    <svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true" className="plan-node__lock">
      <rect x="1" y="4.5" width="8" height="6" rx="1.2" fill="currentColor" />
      <path d="M3 4.5V3.2a2 2 0 014 0v1.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** Focus the step's execute row in the task list (rows carry id task-<taskId> and tabIndex -1). */
function focusTaskRow(taskId: string): void {
  const row = document.getElementById(`task-${taskId}`);
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView?.({ block: "nearest" });
}

/**
 * Connector from the source's right middle to the target's left middle. Most are a gentle S-curve; an
 * edge in the first row that skips over steps (a gating edge, such as s2 to s4) arcs above the row, in
 * its own lane, so it does not hide behind the steps between.
 */
export function connector(from: StepNode, to: StepNode, lane: number | null): string {
  const x1 = from.depth * COL_PITCH + NODE_W;
  const y1 = from.row * ROW_PITCH + NODE_H / 2;
  const x2 = to.depth * COL_PITCH;
  const y2 = to.row * ROW_PITCH + NODE_H / 2;
  if (lane !== null) {
    const top = arcControlY(lane);
    return `M${x1} ${y1} C${x1 + 30} ${top}, ${x2 - 30} ${top}, ${x2} ${y2}`;
  }
  const bend = Math.max(12, (x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

const arcControlY = (lane: number) => -36 - 14 * lane;

/** Edges in the first row that pass over a step between them get an arc lane each. */
function arcLanes(graph: PlanGraph): Map<string, number> {
  const lanes = new Map<string, number>();
  const firstRow = graph.nodes.filter((n) => n.row === 0);
  for (const edge of graph.edges) {
    const from = firstRow.find((n) => n.stepId === edge.from);
    const to = firstRow.find((n) => n.stepId === edge.to);
    if (!from || !to) continue;
    if (firstRow.some((n) => n.depth > from.depth && n.depth < to.depth)) lanes.set(`${edge.from}-${edge.to}`, lanes.size);
  }
  return lanes;
}

export function PlanMap({ tasks, status }: { tasks: RunSnapshot["tasks"]; status: RunStatus }) {
  const titleId = useId();
  const summaryId = useId();
  const graph = buildPlanGraph(tasks);
  const line = planLine(graph.plan, status);
  const sentence = planMapSentence(graph, status);
  const showNodes = line.accepted && graph.nodes.length > 0;
  const byStep = new Map(graph.nodes.map((n) => [n.stepId, n]));
  const cols = Math.max(1, ...graph.nodes.map((n) => n.depth + 1));
  const rows = Math.max(1, ...graph.nodes.map((n) => n.row + 1));
  const width = (cols - 1) * COL_PITCH + NODE_W;
  const height = (rows - 1) * ROW_PITCH + NODE_H;
  const lanes = arcLanes(graph);
  // Room above the first row for the highest arc (a cubic's peak is (y1 + y2) / 8 + 3/4 of its control y).
  const arcPad = lanes.size === 0 ? 0 : Math.ceil(-(NODE_H / 8 + 0.75 * arcControlY(lanes.size - 1))) + 4;

  return (
    <div className="card plan-map" data-testid="plan-map">
      <figure className="plan-map__figure" aria-labelledby={titleId} aria-describedby={showNodes ? summaryId : undefined}>
        <figcaption className="plan-map__caption">
          <h3 id={titleId}>Plan map</h3>
          {showNodes ? (
            <span id={summaryId} className="small muted" data-testid="plan-summary">
              {planSummary(graph.nodes)}
            </span>
          ) : null}
        </figcaption>
        <p className="small muted plan-map__line" data-testid="plan-line">
          {line.text}
        </p>
        {showNodes ? (
          <div className="plan-map__scroll">
            <div className="plan-map__canvas" style={{ "--cols": cols, "--rows": rows, "--arc-pad": `${arcPad}px` } as CSSProperties}>
              <svg className="plan-map__edges" width={width} height={height} aria-hidden="true" data-testid="plan-edges">
                {graph.edges.map((edge) => {
                  const from = byStep.get(edge.from);
                  const to = byStep.get(edge.to);
                  const key = `${edge.from}-${edge.to}`;
                  return from && to ? <path key={key} d={connector(from, to, lanes.get(key) ?? null)} /> : null;
                })}
              </svg>
              <ol className="plan-map__nodes">
                {graph.nodes.map((node) => {
                  const tone = STATE_TONE[node.state];
                  const blocker = graph.blocker?.stepId === node.stepId && status !== "paused";
                  return (
                    <li key={node.stepId} className="plan-map__item" style={{ "--col": node.depth, "--row": node.row } as CSSProperties} data-step={node.stepId}>
                      <button
                        type="button"
                        className={`plan-node plan-node--${tone}${blocker ? " plan-node--blocker" : ""}`}
                        aria-label={nodeName(node)}
                        data-testid="plan-node"
                        onClick={() => focusTaskRow(node.execute.id)}
                      >
                        <span className="plan-node__head">
                          <span className="plan-node__id">{node.stepId}</span>
                          <span className="plan-node__kind">{node.write ? "write" : "read"}</span>
                          {node.gated ? <Lock /> : null}
                          {node.write ? (
                            <span className="plan-node__pips">
                              <Pip task={node.execute} />
                              <Pip task={node.verify} />
                            </span>
                          ) : null}
                        </span>
                        <span className="plan-node__tool mono" title={node.tool}>
                          {node.tool}
                        </span>
                        <span className="plan-node__state">
                          <StateIcon tone={tone} />
                          <span>{node.stateWord}</span>
                        </span>
                        {node.after.length > 0 ? <span className="plan-node__after">after {listSteps(node.after)}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        ) : null}
      </figure>
      {sentence ? (
        <p className="plan-map__note" data-testid="plan-blocker">
          {sentence}
        </p>
      ) : null}
    </div>
  );
}
