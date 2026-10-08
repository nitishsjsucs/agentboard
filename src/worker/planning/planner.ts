// Planner pipeline (SPEC section 11.3). Pure TypeScript, no Workers APIs, so
// the Node planner eval imports it unchanged.

import { z } from "zod";
import type { Plan, PlanStep, RequestType } from "../../shared/domain.ts";
import { materializePlan, type MaterializedTask } from "./materialize.ts";
import { approvalFor, checkStepPolicy, type PolicyViolation } from "./policy.ts";
import { isToolName, isWriteTool, TOOL_INPUTS, TOOL_SPECS } from "./tool-registry.ts";

export interface PlanContext {
  requestType: RequestType;
  subjectEmployeeId: string;
  maxSteps: number;
}

export interface PlanIssue {
  code:
    | "invalid_json"
    | "invalid_shape"
    | "too_many_steps"
    | "duplicate_step_id"
    | "bad_dependency"
    | "unknown_tool"
    | "tool_not_allowed"
    | "invalid_args"
    | "off_subject"
    | "manager_is_subject"
    | "role_not_allowed"
    | "gated_dependency"
    | "cycle";
  stepId?: string;
  message: string;
}

export type PlanValidation =
  | { ok: true; plan: Plan; tasks: MaterializedTask[] }
  | { ok: false; issues: PlanIssue[]; policyViolations: PolicyViolation[] };

const RawStep = z.looseObject({
  id: z.string().regex(/^s[1-9]\d?$/, 'step ids are "s1", "s2", ...'),
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  dependsOn: z.array(z.string()).default([]),
});
const RawPlan = z.looseObject({ steps: z.array(RawStep).min(1) });

/** Validates a model's plan output (string or parsed value) against schema, allowlist, policy and graph rules. */
export function validatePlan(raw: unknown, ctx: PlanContext): PlanValidation {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return fail([{ code: "invalid_json", message: `output is not JSON: ${(error as Error).message}` }]);
    }
  }
  const parsed = RawPlan.safeParse(value);
  if (!parsed.success) {
    return fail([{ code: "invalid_shape", message: `plan must be { steps: [{ id, tool, args, dependsOn }] }: ${z.prettifyError(parsed.error)}` }]);
  }
  const steps: PlanStep[] = parsed.data.steps.map((s) => ({ id: s.id, tool: s.tool, args: s.args, dependsOn: s.dependsOn }));
  const issues: PlanIssue[] = [];
  if (steps.length > ctx.maxSteps) {
    issues.push({ code: "too_many_steps", message: `plan has ${steps.length} steps; the budget allows ${ctx.maxSteps}` });
  }
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) issues.push({ code: "duplicate_step_id", stepId: step.id, message: `step id ${step.id} is used twice` });
    for (const dep of step.dependsOn) {
      if (!seen.has(dep)) issues.push({ code: "bad_dependency", stepId: step.id, message: `${step.id} depends on ${dep}, which is not an earlier step` });
    }
    seen.add(step.id);

    if (!isToolName(step.tool) || !TOOL_SPECS[step.tool].plannable) {
      issues.push({ code: "unknown_tool", stepId: step.id, message: `${step.tool} is not a tool in the catalog` });
      continue;
    }
    for (const issue of checkStepPolicy(step, ctx.requestType, ctx.subjectEmployeeId)) issues.push(issue);
    const args = TOOL_INPUTS[step.tool].safeParse(step.args);
    if (!args.success) {
      issues.push({ code: "invalid_args", stepId: step.id, message: `${step.tool} arguments: ${z.prettifyError(args.error)}` });
    }
  }
  // An approval-gated step may depend only on read steps.
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const step of steps) {
    if (!isToolName(step.tool) || !approvalFor(step).required) continue;
    for (const dep of step.dependsOn) {
      const target = byId.get(dep);
      if (target && isWriteTool(target.tool)) {
        issues.push({ code: "gated_dependency", stepId: step.id, message: `${step.id} needs approval and may depend only on read steps, not ${dep}` });
      }
    }
  }
  if (issues.length > 0) return fail(issues);

  const plan: Plan = { steps };
  const graph = materializePlan(plan);
  if (!graph.ok) return fail([{ code: "cycle", message: graph.error }]);
  return { ok: true, plan, tasks: graph.tasks };
}

function fail(issues: PlanIssue[]): PlanValidation {
  const violations = new Set<PolicyViolation>();
  for (const issue of issues) {
    if (issue.code === "tool_not_allowed" || issue.code === "off_subject") violations.add(issue.code);
  }
  return { ok: false, issues, policyViolations: [...violations] };
}
