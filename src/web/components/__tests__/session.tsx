import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import type { MeResponse } from "../../../shared/api-types.ts";
import type { Permission, Role } from "../../../shared/domain.ts";
import { SessionContext } from "../../api/hooks.ts";

const MATRIX: Record<Role, Permission[]> = {
  viewer: ["runs:read", "search:read", "audit:read", "agents:read"],
  operator: ["runs:read", "search:read", "audit:read", "agents:read", "runs:launch", "runs:control", "tasks:retry", "tasks:release_lease", "dlq:read", "pii:read"],
  approver: ["runs:read", "search:read", "audit:read", "agents:read", "approvals:decide", "pii:read"],
  admin: [
    "runs:read", "search:read", "audit:read", "agents:read", "runs:launch", "runs:control", "tasks:retry", "tasks:release_lease", "dlq:read",
    "approvals:decide", "pii:read", "tasks:skip", "budgets:edit", "dlq:replay", "agents:toggle",
  ],
};

export function me(role: Role, id = `${role}@agentboard.test`): MeResponse {
  return { principal: { kind: "user", id, email: id }, role, permissions: MATRIX[role], authMode: "dev", environment: "test" };
}

export function withSession(role: Role, children: ReactNode, id?: string) {
  return (
    <MemoryRouter>
      <SessionContext.Provider value={{ me: me(role, id), health: null, reload: () => undefined }}>{children}</SessionContext.Provider>
    </MemoryRouter>
  );
}
