import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { Role } from "../../../shared/domain.ts";
import type { Health } from "../../api/hooks.ts";
import { SessionContext } from "../../api/hooks.ts";
import { NavBar } from "../NavBar.tsx";
import { DEV_HEALTH, me } from "./session.tsx";

afterEach(cleanup);

function nav(health: Health, role: Role = "operator") {
  const principal = { ...me(role), authMode: health.authMode };
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={{ me: principal, health, loaded: true, reload: async () => undefined }}>
        <NavBar />
      </SessionContext.Provider>
    </MemoryRouter>,
  );
}

describe("NavBar", { tags: ["ui"] }, () => {
  it("offers Sign out (Access's logout path) and no switch user in access mode", () => {
    nav({ ...DEV_HEALTH, environment: "production", authMode: "access", faultInjection: false });
    expect(screen.getByRole("link", { name: "Sign out" }).getAttribute("href")).toBe("/cdn-cgi/access/logout");
    expect(screen.queryByRole("link", { name: "switch user" })).toBeNull();
  });

  it("offers switch user and no Sign out in dev mode", () => {
    nav(DEV_HEALTH);
    expect(screen.getByRole("link", { name: "switch user" }).getAttribute("href")).toBe("/dev/login");
    expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();
  });

  it("shows Launch only to roles that can launch", () => {
    const view = nav(DEV_HEALTH, "approver");
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["AgentBoard", "Dashboard", "Runs", "Approvals", "switch user"]);
    view.unmount();
    nav(DEV_HEALTH, "operator");
    expect(screen.getByRole("link", { name: "Launch" })).toBeTruthy();
  });
});
