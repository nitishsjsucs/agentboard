// Plan to task graph (SPEC section 11.3, step 6). Pure.
//
// One execute task per step; one verify task per write step, depending on its
// execute task. Each execute task depends on the verify task (for a write) or
// the execute task (for a read) of every step it names in dependsOn.
// Gating edges: when any step requires approval, every other write step's
// execute task also depends on the verify task of every gated step, so only
// reads can run before an approval. A cycle is a validation error.

import type { Plan } from "../../shared/domain.ts";
import { approvalFor } from "./policy.ts";
import { isWriteTool } from "./tool-registry.ts";

export interface MaterializedTask {
  /** Stable key inside one plan: `x:<stepId>` (execute) or `v:<stepId>` (verify). */
  key: string;
  kind: "execute" | "verify";
  stepId: string;
  tool: string;
  args: Record<string, unknown>;
  dependsOn: string[];
  requiresApproval: boolean;
  risk: "medium" | "high" | null;
}

export type MaterializeResult = { ok: true; tasks: MaterializedTask[] } | { ok: false; error: string };

export const executeKey = (stepId: string): string => `x:${stepId}`;
export const verifyKey = (stepId: string): string => `v:${stepId}`;

export function materializePlan(plan: Plan): MaterializeResult {
  const writes = new Set(plan.steps.filter((s) => isWriteTool(s.tool)).map((s) => s.id));
  const gated = plan.steps.filter((s) => approvalFor(s).required).map((s) => s.id);
  const tasks: MaterializedTask[] = [];
  for (const step of plan.steps) {
    const approval = approvalFor(step);
    const deps = new Set<string>();
    for (const dep of step.dependsOn) deps.add(writes.has(dep) ? verifyKey(dep) : executeKey(dep));
    if (writes.has(step.id)) {
      for (const g of gated) if (g !== step.id) deps.add(verifyKey(g));
    }
    tasks.push({
      key: executeKey(step.id),
      kind: "execute",
      stepId: step.id,
      tool: step.tool,
      args: step.args,
      dependsOn: [...deps].sort(),
      requiresApproval: approval.required,
      risk: approval.risk,
    });
    if (writes.has(step.id)) {
      tasks.push({
        key: verifyKey(step.id),
        kind: "verify",
        stepId: step.id,
        tool: step.tool,
        args: step.args,
        dependsOn: [executeKey(step.id)],
        requiresApproval: false,
        risk: null,
      });
    }
  }
  const cycle = findCycle(tasks);
  if (cycle) return { ok: false, error: `dependency cycle: ${cycle.join(" -> ")}` };
  return { ok: true, tasks };
}

function findCycle(tasks: MaterializedTask[]): string[] | null {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (key: string): string[] | null => {
    const current = state.get(key);
    if (current === "done") return null;
    if (current === "visiting") return [...stack.slice(stack.indexOf(key)), key];
    state.set(key, "visiting");
    stack.push(key);
    for (const dep of byKey.get(key)?.dependsOn ?? []) {
      const found = visit(dep);
      if (found) return found;
    }
    stack.pop();
    state.set(key, "done");
    return null;
  };
  for (const task of tasks) {
    const found = visit(task.key);
    if (found) return found;
  }
  return null;
}
