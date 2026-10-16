import type { TaskView } from "../../../shared/api-types.ts";
import { task } from "./fixtures.ts";

type Status = TaskView["status"];

/**
 * The offboarding gating fixture: s1 hris.get_employee (read); s2 hris.set_employment_status, a gated
 * write; s3 access.revoke_all_roles, s4 itsm.create_ticket and s5 notify.send each depending on s2's
 * verify task. Ten tasks: the plan, five execute tasks and four verify tasks.
 */
export function offboardingGated(status: Partial<Record<string, Status>> = {}, extra: Partial<Record<string, Partial<TaskView>>> = {}): TaskView[] {
  const s = (id: string, fallback: Status): Status => status[id] ?? fallback;
  const t = (fields: Partial<TaskView> & Pick<TaskView, "id" | "kind">) => task({ ...fields, ...extra[fields.id] });
  return [
    t({ id: "tsk_plan", kind: "plan", status: s("tsk_plan", "succeeded"), attempts: 1 }),
    t({ id: "tsk_x1", kind: "execute", stepId: "s1", tool: "hris.get_employee", status: s("tsk_x1", "succeeded"), attempts: 1 }),
    t({ id: "tsk_x2", kind: "execute", stepId: "s2", tool: "hris.set_employment_status", dependsOn: ["tsk_x1"], requiresApproval: true, status: s("tsk_x2", "awaiting_approval") }),
    t({ id: "tsk_v2", kind: "verify", stepId: "s2", tool: "hris.set_employment_status", dependsOn: ["tsk_x2"], status: s("tsk_v2", "pending") }),
    t({ id: "tsk_x3", kind: "execute", stepId: "s3", tool: "access.revoke_all_roles", dependsOn: ["tsk_v2"], status: s("tsk_x3", "pending") }),
    t({ id: "tsk_v3", kind: "verify", stepId: "s3", tool: "access.revoke_all_roles", dependsOn: ["tsk_x3"], status: s("tsk_v3", "pending") }),
    t({ id: "tsk_x4", kind: "execute", stepId: "s4", tool: "itsm.create_ticket", dependsOn: ["tsk_v2"], status: s("tsk_x4", "pending") }),
    t({ id: "tsk_v4", kind: "verify", stepId: "s4", tool: "itsm.create_ticket", dependsOn: ["tsk_x4"], status: s("tsk_v4", "pending") }),
    t({ id: "tsk_x5", kind: "execute", stepId: "s5", tool: "notify.send", dependsOn: ["tsk_v2"], status: s("tsk_x5", "pending") }),
    t({ id: "tsk_v5", kind: "verify", stepId: "s5", tool: "notify.send", dependsOn: ["tsk_x5"], status: s("tsk_v5", "pending") }),
  ];
}

/** A manager change as the gold plan materializes it: s1 read, s2 hris.update_manager (gated), s3 notify.send after s2. */
export function managerChange(status: Partial<Record<string, Status>> = {}): TaskView[] {
  const s = (id: string, fallback: Status): Status => status[id] ?? fallback;
  return [
    task({ id: "m_plan", kind: "plan", status: "succeeded", attempts: 1 }),
    task({ id: "m_x1", kind: "execute", stepId: "s1", tool: "hris.get_employee", status: s("m_x1", "succeeded"), attempts: 1 }),
    task({ id: "m_x2", kind: "execute", stepId: "s2", tool: "hris.update_manager", dependsOn: ["m_x1"], requiresApproval: true, status: s("m_x2", "awaiting_approval") }),
    task({ id: "m_v2", kind: "verify", stepId: "s2", tool: "hris.update_manager", dependsOn: ["m_x2"], status: s("m_v2", "pending") }),
    task({ id: "m_x3", kind: "execute", stepId: "s3", tool: "notify.send", dependsOn: ["m_v2"], status: s("m_x3", "pending") }),
    task({ id: "m_v3", kind: "verify", stepId: "s3", tool: "notify.send", dependsOn: ["m_x3"], status: s("m_v3", "pending") }),
  ];
}

/** A linear address change: s1 read, s2 hris.update_address after s1, s3 notify.send after s2. */
export function addressChange(status: Partial<Record<string, Status>> = {}): TaskView[] {
  const s = (id: string, fallback: Status): Status => status[id] ?? fallback;
  return [
    task({ id: "a_plan", kind: "plan", status: "succeeded", attempts: 1 }),
    task({ id: "a_x1", kind: "execute", stepId: "s1", tool: "hris.get_employee", status: s("a_x1", "succeeded"), attempts: 1 }),
    task({ id: "a_x2", kind: "execute", stepId: "s2", tool: "hris.update_address", dependsOn: ["a_x1"], status: s("a_x2", "succeeded"), attempts: 1 }),
    task({ id: "a_v2", kind: "verify", stepId: "s2", tool: "hris.update_address", dependsOn: ["a_x2"], status: s("a_v2", "succeeded"), attempts: 1 }),
    task({ id: "a_x3", kind: "execute", stepId: "s3", tool: "notify.send", dependsOn: ["a_v2"], status: s("a_x3", "pending") }),
    task({ id: "a_v3", kind: "verify", stepId: "s3", tool: "notify.send", dependsOn: ["a_x3"], status: s("a_v3", "pending") }),
  ];
}

/** The offboarding gold plan as the stub planner produces it: a chain s1 to s5, plus gating edges from s2's verify task to s4 and s5. */
export function offboardingLinear(): TaskView[] {
  return offboardingGated({}, { tsk_x4: { dependsOn: ["tsk_v2", "tsk_v3"] }, tsk_x5: { dependsOn: ["tsk_v2", "tsk_v4"] } });
}
