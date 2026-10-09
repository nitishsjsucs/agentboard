// Approval policy, per-request-type allowlists and subject pinning
// (SPEC sections 8.2 and 11.3). Approval flags come from here, never from the model.

import { BASELINE_ROLES, PRIVILEGED_ROLES, type PlanStep, type RequestType } from "../../shared/domain.ts";
import type { ToolName } from "./tool-registry.ts";

export { BASELINE_ROLES, PRIVILEGED_ROLES };

export const ALLOWED_TOOLS: Record<RequestType, readonly ToolName[]> = {
  address_change: ["hris.get_employee", "hris.update_address", "notify.send"],
  manager_change: ["hris.get_employee", "hris.update_manager", "notify.send"],
  onboarding_access: ["hris.get_employee", "access.list_roles", "itsm.create_ticket", "access.grant_role", "notify.send"],
  privileged_access: ["hris.get_employee", "access.list_roles", "access.grant_role", "notify.send"],
  offboarding: ["hris.get_employee", "access.list_roles", "hris.set_employment_status", "access.revoke_all_roles", "itsm.create_ticket", "notify.send"],
  access_revocation: ["hris.get_employee", "access.list_roles", "access.revoke_role", "notify.send"],
};

export interface ApprovalRequirement {
  required: boolean;
  risk: "medium" | "high" | null;
}

const PRIVILEGED = new Set<string>(PRIVILEGED_ROLES);
const BASELINE = new Set<string>(BASELINE_ROLES);

export function isPrivilegedRole(system: unknown, role: unknown): boolean {
  return PRIVILEGED.has(`${String(system)}:${String(role)}`);
}

export function isBaselineRole(system: unknown, role: unknown): boolean {
  return BASELINE.has(`${String(system)}:${String(role)}`);
}

/** Approval requirement for one step, decided by policy alone. */
export function approvalFor(step: Pick<PlanStep, "tool" | "args">): ApprovalRequirement {
  switch (step.tool) {
    case "hris.update_manager":
      return { required: true, risk: "medium" };
    case "hris.set_employment_status":
      return { required: true, risk: "high" };
    case "access.grant_role":
      return isPrivilegedRole(step.args["system"], step.args["role"]) ? { required: true, risk: "high" } : { required: false, risk: null };
    default:
      return { required: false, risk: null };
  }
}

export type PolicyViolation = "tool_not_allowed" | "off_subject" | "missing_gate";

export interface PolicyIssue {
  code: PolicyViolation | "manager_is_subject" | "role_not_allowed";
  stepId: string;
  message: string;
}

/** Allowlist, subject pinning and role-class checks for one step. */
export function checkStepPolicy(step: PlanStep, requestType: RequestType, subjectEmployeeId: string): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  if (!(ALLOWED_TOOLS[requestType] as readonly string[]).includes(step.tool)) {
    issues.push({ code: "tool_not_allowed", stepId: step.id, message: `${step.tool} is not allowed for ${requestType}` });
  }
  if ("employeeId" in step.args && step.args["employeeId"] !== subjectEmployeeId) {
    issues.push({ code: "off_subject", stepId: step.id, message: `employeeId must be the subject ${subjectEmployeeId}` });
  }
  if (step.tool === "hris.update_manager" && step.args["managerId"] === subjectEmployeeId) {
    issues.push({ code: "manager_is_subject", stepId: step.id, message: "managerId must differ from the subject" });
  }
  if (step.tool === "access.grant_role") {
    if (requestType === "onboarding_access" && !isBaselineRole(step.args["system"], step.args["role"])) {
      issues.push({ code: "role_not_allowed", stepId: step.id, message: `onboarding may grant only baseline roles (${BASELINE_ROLES.join(", ")})` });
    }
    if (requestType === "privileged_access" && !isPrivilegedRole(step.args["system"], step.args["role"])) {
      issues.push({ code: "role_not_allowed", stepId: step.id, message: `privileged_access may grant only ${PRIVILEGED_ROLES.join(", ")}` });
    }
  }
  return issues;
}

export interface PlanPolicyIssue {
  code: "missing_gate";
  stepId?: string;
  message: string;
}

/**
 * Plan-level rule: `access.revoke_all_roles` runs only behind an approval. The
 * plan must also terminate the subject with `hris.set_employment_status`
 * (always gated), so the gating edges put the revoke after that approval.
 * Without this rule a plan that drops the status change revokes every role
 * with no approval at all.
 */
export function checkPlanPolicy(steps: readonly PlanStep[]): PlanPolicyIssue[] {
  const issues: PlanPolicyIssue[] = [];
  const terminates = steps.some((s) => s.tool === "hris.set_employment_status" && s.args["status"] === "terminated");
  for (const step of steps) {
    if (step.tool === "access.revoke_all_roles" && !terminates) {
      issues.push({
        code: "missing_gate",
        stepId: step.id,
        message: "access.revoke_all_roles is allowed only together with hris.set_employment_status to terminated, whose approval it waits for",
      });
    }
  }
  return issues;
}
