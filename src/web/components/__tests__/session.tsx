import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { MeResponse } from "../../../shared/api-types.ts";
import type { Permission, Role } from "../../../shared/domain.ts";
import { SessionContext, type Health } from "../../api/hooks.ts";

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

export const DEV_HEALTH: Health = { ok: true, version: "test", environment: "development", authMode: "dev", llmProvider: "stub", faultInjection: true };

export function withSession(role: Role, children: ReactNode, id?: string) {
  return (
    <MemoryRouter>
      <SessionContext.Provider value={{ me: me(role, id), health: null, loaded: true, reload: async () => undefined }}>{children}</SessionContext.Provider>
    </MemoryRouter>
  );
}

/** Shows the current path and query, so a test can read what a page wrote to the URL. */
export function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location" hidden>{`${location.pathname}${location.search}`}</div>;
}

/** A page at `url`, matched by `path`, inside a session for `role` (or `principal`). */
export function renderAt(role: Role, element: ReactNode, options: { url?: string; path?: string; id?: string; health?: Health | null } = {}) {
  const { url = "/", path = "*", id, health = DEV_HEALTH } = options;
  return (
    <MemoryRouter initialEntries={[url]}>
      <SessionContext.Provider value={{ me: me(role, id), health, loaded: true, reload: async () => undefined }}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<div>other page</div>} />
        </Routes>
        <LocationProbe />
      </SessionContext.Provider>
    </MemoryRouter>
  );
}
