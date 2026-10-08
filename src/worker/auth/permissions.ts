import type { Permission, Role } from "../../shared/domain.ts";

/** Role to permission matrix (SPEC section 10.1). Default deny. */
const MATRIX: Record<Role, readonly Permission[]> = {
  viewer: ["runs:read", "search:read", "audit:read", "agents:read"],
  operator: [
    "runs:read", "search:read", "audit:read", "agents:read",
    "runs:launch", "runs:control", "tasks:retry", "tasks:release_lease", "dlq:read",
    "pii:read",
  ],
  approver: ["runs:read", "search:read", "audit:read", "agents:read", "approvals:decide", "pii:read"],
  admin: [
    "runs:read", "search:read", "audit:read", "agents:read",
    "runs:launch", "runs:control", "tasks:retry", "tasks:release_lease", "dlq:read",
    "approvals:decide", "pii:read",
    "tasks:skip", "budgets:edit", "dlq:replay", "agents:toggle",
  ],
};

export function permissionsFor(role: Role | null): Permission[] {
  return role ? [...MATRIX[role]] : [];
}

export function hasPermission(role: Role | null, permission: Permission): boolean {
  return role !== null && MATRIX[role].includes(permission);
}
