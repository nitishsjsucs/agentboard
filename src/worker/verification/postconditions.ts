// Registry postconditions (SPEC section 8.2): what the verifier checks, with
// read tools only, after each write. Pure.

import type { ToolName, VerifyCheck } from "../planning/tool-registry.ts";

export interface VerificationResult {
  passed: boolean;
  evidence: Record<string, unknown>;
}

/** The read call(s) a verify spec needs: arguments come from the write's args and the execute result's ids. */
export function verificationReads(tools: readonly ToolName[], writeArgs: Record<string, unknown>, executeResult: unknown): { tool: ToolName; args: Record<string, unknown> }[] {
  const result = (executeResult ?? {}) as Record<string, unknown>;
  return tools.map((tool) => {
    switch (tool) {
      case "itsm.get_ticket":
        return { tool, args: { ticketId: String(result["ticketId"] ?? "") } };
      case "notify.get_delivery":
        return { tool, args: { deliveryId: String(result["deliveryId"] ?? "") } };
      default:
        return { tool, args: { employeeId: String(writeArgs["employeeId"] ?? "") } };
    }
  });
}

const norm = (value: unknown): string => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function sameAddress(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return ["line1", "city", "region", "postalCode", "country"].every((field) => norm(x[field]) === norm(y[field]));
}

/** Evaluates one postcondition against the read results (in the order of the spec's tools). */
export function evaluate(check: VerifyCheck, writeArgs: Record<string, unknown>, reads: Record<string, unknown>[]): VerificationResult {
  const first = reads[0] ?? {};
  const employee = (first["employee"] ?? null) as Record<string, unknown> | null;
  const roles = (first["roles"] ?? null) as string[] | null;
  const roleName = `${String(writeArgs["system"])}:${String(writeArgs["role"])}`;
  switch (check) {
    case "address_matches":
      return { passed: sameAddress(employee?.["address"], writeArgs["address"]), evidence: { check, expected: { address: writeArgs["address"] }, actual: { address: employee?.["address"] ?? null } } };
    case "manager_matches":
      return { passed: employee?.["managerId"] === writeArgs["managerId"], evidence: { check, expected: writeArgs["managerId"], actual: employee?.["managerId"] ?? null } };
    case "status_matches":
      return { passed: employee?.["employmentStatus"] === writeArgs["status"], evidence: { check, expected: writeArgs["status"], actual: employee?.["employmentStatus"] ?? null } };
    case "ticket_exists": {
      const ticket = (first["ticket"] ?? null) as Record<string, unknown> | null;
      return { passed: ticket !== null && ticket["category"] === writeArgs["category"], evidence: { check, found: ticket !== null, category: ticket?.["category"] ?? null } };
    }
    case "role_present":
      return { passed: roles !== null && roles.includes(roleName), evidence: { check, role: roleName, roles } };
    case "role_absent":
      return { passed: roles !== null && !roles.includes(roleName), evidence: { check, role: roleName, roles } };
    case "no_roles":
      return { passed: roles !== null && roles.length === 0, evidence: { check, roles } };
    case "delivery_sent": {
      const delivery = (first["delivery"] ?? null) as Record<string, unknown> | null;
      return { passed: delivery !== null && delivery["status"] === "sent", evidence: { check, found: delivery !== null, status: delivery?.["status"] ?? null } };
    }
  }
}
