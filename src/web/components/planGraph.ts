// The run's plan as a graph of steps, folded from the task list the run
// detail page already has (TaskView.dependsOn holds task ids inside the run).
// One node per plan step: its execute task and, for a write, its verify task.
// Pure: no request, no DOM.

import type { TaskView } from "../../shared/api-types.ts";
import { ROLE_FOR_KIND } from "./explain.ts";

export type StepState =
  | "failed"
  | "verification_failed"
  | "dead_lettered"
  | "out_of_budget"
  | "held"
  | "rejected"
  | "awaiting_approval"
  | "in_progress"
  | "verifying"
  | "ready"
  | "cancelled"
  | "skipped"
  | "done"
  | "not_started";

/** The colour family a state is drawn in; the state word always goes with it. */
export type StepTone = "success" | "info" | "warning" | "danger" | "faint";

export interface StepNode {
  stepId: string;
  tool: string;
  /** True when the step has a verify task, which the coordinator creates only for writes. */
  write: boolean;
  /** The execute task waits for an approval before it runs. */
  gated: boolean;
  execute: TaskView;
  verify: TaskView | null;
  state: StepState;
  /** For example "waiting for approval" or "held: executor role disabled". */
  stateWord: string;
  /** Longest path from a step with no step dependencies (0-based). */
  depth: number;
  /** Position inside its depth column (0-based). */
  row: number;
  /** Steps this one waits for, in step order. */
  after: string[];
}

export interface PlanGraph {
  plan: TaskView | null;
  /** In topological order: by depth, then step number. */
  nodes: StepNode[];
  edges: { from: string; to: string }[];
  /** The first node in topological order that stops the run from moving on. */
  blocker: StepNode | null;
  /** How many other nodes are blocking too. */
  extraBlockers: number;
}

export const BLOCKING_STATES: ReadonlySet<StepState> = new Set(["failed", "verification_failed", "dead_lettered", "out_of_budget", "held", "rejected", "awaiting_approval"]);

export const STATE_TONE: Record<StepState, StepTone> = {
  done: "success",
  in_progress: "info",
  verifying: "info",
  ready: "info",
  awaiting_approval: "warning",
  held: "warning",
  out_of_budget: "warning",
  failed: "danger",
  verification_failed: "danger",
  dead_lettered: "danger",
  rejected: "danger",
  not_started: "faint",
  cancelled: "faint",
  skipped: "faint",
};

/** Short words for the summary sentence ("2 done, 1 waiting for approval"), in the order they are listed there. */
export const SUMMARY_WORDS: [StepState, string][] = [
  ["done", "done"],
  ["in_progress", "in progress"],
  ["verifying", "verifying"],
  ["ready", "ready to run"],
  ["awaiting_approval", "waiting for approval"],
  ["held", "held"],
  ["out_of_budget", "out of budget"],
  ["failed", "failed"],
  ["verification_failed", "verification failed"],
  ["dead_lettered", "dead-lettered"],
  ["rejected", "rejected"],
  ["skipped", "skipped"],
  ["cancelled", "cancelled"],
  ["not_started", "not started"],
];

export function stepNumber(stepId: string): number {
  const n = Number(stepId.replace(/^s/, ""));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function compareSteps(a: string, b: string): number {
  return stepNumber(a) - stepNumber(b) || a.localeCompare(b);
}

/** One step's state from its execute and verify tasks; the first matching rule wins. */
export function stepState(execute: TaskView, verify: TaskView | null): { state: StepState; word: string } {
  const tasks = verify ? [execute, verify] : [execute];
  const any = (status: TaskView["status"]) => tasks.find((t) => t.status === status);
  if (execute.status === "failed") return { state: "failed", word: "failed" };
  if (verify?.status === "failed") return { state: "verification_failed", word: "verification failed" };
  if (any("dead_lettered")) return { state: "dead_lettered", word: "dead-lettered" };
  if (any("budget_blocked")) return { state: "out_of_budget", word: "out of budget" };
  const held = any("held");
  if (held) {
    return held.holdReason === "checkpoint"
      ? { state: "held", word: "held at checkpoint" }
      : { state: "held", word: `held: ${ROLE_FOR_KIND[held.kind]} role disabled` };
  }
  if (any("rejected")) return { state: "rejected", word: "rejected" };
  if (any("awaiting_approval")) return { state: "awaiting_approval", word: "waiting for approval" };
  const writeDone = execute.status === "succeeded";
  if (any("leased")) return writeDone ? { state: "verifying", word: "verifying" } : { state: "in_progress", word: "in progress" };
  // A ready verify task after a finished write is a verification about to run, not the write.
  if (any("ready")) return writeDone ? { state: "verifying", word: "verifying" } : { state: "ready", word: "ready to run" };
  if (any("cancelled")) return { state: "cancelled", word: "cancelled" };
  if (any("skipped")) return { state: "skipped", word: "skipped" };
  if (tasks.every((t) => t.status === "succeeded")) return { state: "done", word: "done" };
  if (writeDone && verify) return { state: "verifying", word: "verifying" };
  return { state: "not_started", word: "not started" };
}

export function buildPlanGraph(tasks: readonly TaskView[]): PlanGraph {
  const plan = tasks.find((t) => t.kind === "plan") ?? null;
  const executes = new Map<string, TaskView>();
  const verifies = new Map<string, TaskView>();
  const stepOfTask = new Map<string, string>();
  for (const task of tasks) {
    if (task.kind === "plan" || task.stepId === null) continue;
    (task.kind === "execute" ? executes : verifies).set(task.stepId, task);
    stepOfTask.set(task.id, task.stepId);
  }

  const after = new Map<string, Set<string>>();
  for (const [stepId, execute] of executes) {
    const deps = new Set<string>();
    for (const task of [execute, verifies.get(stepId)]) {
      for (const id of task?.dependsOn ?? []) {
        const dep = stepOfTask.get(id);
        if (dep !== undefined && dep !== stepId && executes.has(dep)) deps.add(dep);
      }
    }
    after.set(stepId, deps);
  }

  // Longest path from a root; a cycle (which validation refuses) is cut instead of looping.
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (stepId: string): number => {
    const known = depth.get(stepId);
    if (known !== undefined) return known;
    if (visiting.has(stepId)) return 0;
    visiting.add(stepId);
    let d = 0;
    for (const dep of after.get(stepId) ?? []) d = Math.max(d, depthOf(dep) + 1);
    visiting.delete(stepId);
    depth.set(stepId, d);
    return d;
  };

  const order = [...executes.keys()].sort((a, b) => depthOf(a) - depthOf(b) || compareSteps(a, b));
  const rows = new Map<number, number>();
  const nodes: StepNode[] = order.map((stepId) => {
    const execute = executes.get(stepId) as TaskView;
    const verify = verifies.get(stepId) ?? null;
    const d = depthOf(stepId);
    const row = rows.get(d) ?? 0;
    rows.set(d, row + 1);
    const { state, word } = stepState(execute, verify);
    return {
      stepId,
      tool: execute.tool ?? "?",
      write: verify !== null,
      gated: execute.requiresApproval,
      execute,
      verify,
      state,
      stateWord: word,
      depth: d,
      row,
      after: [...(after.get(stepId) ?? [])].sort(compareSteps),
    };
  });
  const edges = nodes.flatMap((node) => node.after.map((from) => ({ from, to: node.stepId })));
  const blocking = nodes.filter((node) => BLOCKING_STATES.has(node.state));
  return { plan, nodes, edges, blocker: blocking[0] ?? null, extraBlockers: Math.max(0, blocking.length - 1) };
}

/** Every step that waits for `stepId`, directly or through other steps, in topological order. */
export function dependentsOf(graph: PlanGraph, stepId: string): StepNode[] {
  const found = new Set<string>();
  let frontier = [stepId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const node of graph.nodes) {
      if (found.has(node.stepId) || node.stepId === stepId) continue;
      if (node.after.some((dep) => frontier.includes(dep))) {
        found.add(node.stepId);
        next.push(node.stepId);
      }
    }
    frontier = next;
  }
  return graph.nodes.filter((node) => found.has(node.stepId));
}

/** "s3", "s3 and s4", "s3, s4 and s5". */
export function listSteps(stepIds: readonly string[]): string {
  if (stepIds.length <= 1) return stepIds[0] ?? "";
  return `${stepIds.slice(0, -1).join(", ")} and ${stepIds.at(-1)}`;
}

/** "5 steps: 2 done, 1 waiting for approval, 2 not started." */
export function planSummary(nodes: readonly StepNode[]): string {
  const counts = SUMMARY_WORDS.map(([state, word]) => [nodes.filter((n) => n.state === state).length, word] as const).filter(([n]) => n > 0);
  const total = `${nodes.length} ${nodes.length === 1 ? "step" : "steps"}`;
  return counts.length === 0 ? `${total}.` : `${total}: ${counts.map(([n, word]) => `${n} ${word}`).join(", ")}.`;
}
