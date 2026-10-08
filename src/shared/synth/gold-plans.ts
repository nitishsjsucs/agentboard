import type { Address, Plan, RequestType } from "../domain.ts";
import { NOTIFY_TEMPLATE_FOR } from "./catalog.ts";

/** Type-specific fields of one synthetic request; the gold plan is built from them. */
export interface RunFields {
  channel: "email" | "slack";
  address: Address | null;
  managerId: string | null;
  managerName: string | null;
  system: string | null;
  role: string | null;
  effectiveDate: string | null;
}

/** Gold plans per request type (SPEC section 12.3). Steps form a chain; the first write is always s2. */
export function goldPlan(requestType: RequestType, employeeId: string, fields: RunFields): Plan {
  const notify = (id: string, dependsOn: string[]) => ({
    id,
    tool: "notify.send",
    args: { employeeId, channel: fields.channel, template: NOTIFY_TEMPLATE_FOR[requestType] },
    dependsOn,
  });
  const getEmployee = { id: "s1", tool: "hris.get_employee", args: { employeeId }, dependsOn: [] };
  switch (requestType) {
    case "address_change":
      return {
        steps: [
          getEmployee,
          { id: "s2", tool: "hris.update_address", args: { employeeId, address: required(fields.address) }, dependsOn: ["s1"] },
          notify("s3", ["s2"]),
        ],
      };
    case "manager_change":
      return {
        steps: [
          getEmployee,
          { id: "s2", tool: "hris.update_manager", args: { employeeId, managerId: required(fields.managerId) }, dependsOn: ["s1"] },
          notify("s3", ["s2"]),
        ],
      };
    case "onboarding_access":
      return {
        steps: [
          getEmployee,
          {
            id: "s2",
            tool: "itsm.create_ticket",
            args: { employeeId, category: "laptop_provision", summary: `Laptop provisioning for ${employeeId}` },
            dependsOn: ["s1"],
          },
          {
            id: "s3",
            tool: "access.grant_role",
            args: { employeeId, system: required(fields.system), role: required(fields.role) },
            dependsOn: ["s2"],
          },
          notify("s4", ["s3"]),
        ],
      };
    case "privileged_access":
      return {
        steps: [
          getEmployee,
          {
            id: "s2",
            tool: "access.grant_role",
            args: { employeeId, system: required(fields.system), role: required(fields.role) },
            dependsOn: ["s1"],
          },
          notify("s3", ["s2"]),
        ],
      };
    case "offboarding":
      return {
        steps: [
          getEmployee,
          {
            id: "s2",
            tool: "hris.set_employment_status",
            args: { employeeId, status: "terminated", effectiveDate: required(fields.effectiveDate) },
            dependsOn: ["s1"],
          },
          { id: "s3", tool: "access.revoke_all_roles", args: { employeeId }, dependsOn: ["s2"] },
          {
            id: "s4",
            tool: "itsm.create_ticket",
            args: { employeeId, category: "laptop_return", summary: `Laptop return for ${employeeId}` },
            dependsOn: ["s3"],
          },
          notify("s5", ["s4"]),
        ],
      };
    case "access_revocation":
      return {
        steps: [
          { id: "s1", tool: "access.list_roles", args: { employeeId }, dependsOn: [] },
          {
            id: "s2",
            tool: "access.revoke_role",
            args: { employeeId, system: required(fields.system), role: required(fields.role) },
            dependsOn: ["s1"],
          },
          notify("s3", ["s2"]),
        ],
      };
  }
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("gold plan field missing");
  return value;
}

/** Tools that change state. Everything else in the catalog is a read. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "hris.update_address",
  "hris.update_manager",
  "hris.set_employment_status",
  "itsm.create_ticket",
  "access.grant_role",
  "access.revoke_role",
  "access.revoke_all_roles",
  "notify.send",
]);
