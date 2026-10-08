// One source of truth for the 12 People Ops tools (SPEC section 8.2): argument
// schemas (also the MCP input schemas), scopes, kind and the verifier's
// postcondition. Pure: no Workers APIs, so Node scripts import it too.

import { z } from "zod";
import { NOTIFY_CHANNELS, NOTIFY_TEMPLATES, TICKET_CATEGORIES } from "../../shared/domain.ts";

export const EmployeeId = z.string().regex(/^E-\d{4}$/, "employee ids look like E-1001");
export const AddressSchema = z.strictObject({
  line1: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  region: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  country: z.string().min(2).max(56),
});
const SystemName = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/);
const RoleName = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);

export const TOOL_INPUTS = {
  "hris.get_employee": z.strictObject({ employeeId: EmployeeId }),
  "hris.update_address": z.strictObject({ employeeId: EmployeeId, address: AddressSchema }),
  "hris.update_manager": z.strictObject({ employeeId: EmployeeId, managerId: EmployeeId }),
  "hris.set_employment_status": z.strictObject({
    employeeId: EmployeeId,
    status: z.enum(["active", "terminated", "pending_start"]),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveDate is YYYY-MM-DD"),
  }),
  "itsm.create_ticket": z.strictObject({
    employeeId: EmployeeId,
    category: z.enum(TICKET_CATEGORIES),
    summary: z.string().min(3).max(200),
  }),
  "itsm.get_ticket": z.strictObject({ ticketId: z.string().regex(/^TKT-[0-9a-f]{12}$/) }),
  "access.list_roles": z.strictObject({ employeeId: EmployeeId }),
  "access.grant_role": z.strictObject({ employeeId: EmployeeId, system: SystemName, role: RoleName }),
  "access.revoke_role": z.strictObject({ employeeId: EmployeeId, system: SystemName, role: RoleName }),
  "access.revoke_all_roles": z.strictObject({ employeeId: EmployeeId }),
  "notify.send": z.strictObject({ employeeId: EmployeeId, channel: z.enum(NOTIFY_CHANNELS), template: z.enum(NOTIFY_TEMPLATES) }),
  "notify.get_delivery": z.strictObject({ deliveryId: z.string().regex(/^DLV-[0-9a-f]{12}$/) }),
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;
export const TOOL_NAMES = Object.keys(TOOL_INPUTS) as ToolName[];

/** Postcondition the verifier checks after a write, using read tools only. */
export type VerifyCheck =
  | "address_matches"
  | "manager_matches"
  | "status_matches"
  | "ticket_exists"
  | "role_present"
  | "role_absent"
  | "no_roles"
  | "delivery_sent";

export interface VerifySpec {
  check: VerifyCheck;
  /** Read tools the verifier calls, in order. */
  tools: ToolName[];
  /** Number of reads the claim reserves against `maxToolCalls`. */
  reads: number;
  /** Result field holding the id the read needs (`ticketId`, `deliveryId`), if any. */
  refField: "ticketId" | "deliveryId" | null;
}

export interface ToolSpec {
  name: ToolName;
  kind: "read" | "write";
  scope: string;
  description: string;
  /** False for verifier-only reads, which the planner may never use. */
  plannable: boolean;
  verify: VerifySpec | null;
}

const spec = (s: ToolSpec): ToolSpec => s;

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  "hris.get_employee": spec({
    name: "hris.get_employee",
    kind: "read",
    scope: "hris:read",
    description: "Read an employee record from the HRIS (name, department, title, manager, status, address).",
    plannable: true,
    verify: null,
  }),
  "hris.update_address": spec({
    name: "hris.update_address",
    kind: "write",
    scope: "hris:write",
    description: "Replace the employee's home address in the HRIS.",
    plannable: true,
    verify: { check: "address_matches", tools: ["hris.get_employee"], reads: 1, refField: null },
  }),
  "hris.update_manager": spec({
    name: "hris.update_manager",
    kind: "write",
    scope: "hris:write",
    description: "Set the employee's manager (reporting line) in the HRIS. Always requires approval.",
    plannable: true,
    verify: { check: "manager_matches", tools: ["hris.get_employee"], reads: 1, refField: null },
  }),
  "hris.set_employment_status": spec({
    name: "hris.set_employment_status",
    kind: "write",
    scope: "hris:write",
    description: "Set the employment status (active, terminated, pending_start) with an effective date. Always requires approval.",
    plannable: true,
    verify: { check: "status_matches", tools: ["hris.get_employee"], reads: 1, refField: null },
  }),
  "itsm.create_ticket": spec({
    name: "itsm.create_ticket",
    kind: "write",
    scope: "itsm:write",
    description: "Open an IT service ticket for the employee (laptop_provision, laptop_return, access_issue).",
    plannable: true,
    verify: { check: "ticket_exists", tools: ["itsm.get_ticket"], reads: 1, refField: "ticketId" },
  }),
  "itsm.get_ticket": spec({
    name: "itsm.get_ticket",
    kind: "read",
    scope: "itsm:read",
    description: "Read an IT service ticket by id.",
    plannable: false,
    verify: null,
  }),
  "access.list_roles": spec({
    name: "access.list_roles",
    kind: "read",
    scope: "access:read",
    description: "List the employee's active access roles as system:role pairs.",
    plannable: true,
    verify: null,
  }),
  "access.grant_role": spec({
    name: "access.grant_role",
    kind: "write",
    scope: "access:write",
    description: "Grant one access role (system and role) to the employee. Privileged roles require approval.",
    plannable: true,
    verify: { check: "role_present", tools: ["access.list_roles"], reads: 1, refField: null },
  }),
  "access.revoke_role": spec({
    name: "access.revoke_role",
    kind: "write",
    scope: "access:write",
    description: "Revoke one access role (system and role) from the employee.",
    plannable: true,
    verify: { check: "role_absent", tools: ["access.list_roles"], reads: 1, refField: null },
  }),
  "access.revoke_all_roles": spec({
    name: "access.revoke_all_roles",
    kind: "write",
    scope: "access:write",
    description: "Revoke every active access role of the employee (offboarding only).",
    plannable: true,
    verify: { check: "no_roles", tools: ["access.list_roles"], reads: 1, refField: null },
  }),
  "notify.send": spec({
    name: "notify.send",
    kind: "write",
    scope: "notify:write",
    description: "Send the employee a notification from a fixed template over email or Slack.",
    plannable: true,
    verify: { check: "delivery_sent", tools: ["notify.get_delivery"], reads: 1, refField: "deliveryId" },
  }),
  "notify.get_delivery": spec({
    name: "notify.get_delivery",
    kind: "read",
    scope: "notify:read",
    description: "Read a notification delivery by id.",
    plannable: false,
    verify: null,
  }),
};

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_INPUTS, name);
}

export function isWriteTool(name: string): boolean {
  return isToolName(name) && TOOL_SPECS[name].kind === "write";
}

/** JSON Schema of a tool's arguments (for the planner prompt and the LLM schema). */
export function toolJsonSchema(name: ToolName): Record<string, unknown> {
  return z.toJSONSchema(TOOL_INPUTS[name]) as Record<string, unknown>;
}
