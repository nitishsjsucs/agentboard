import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../../shared/api-types.ts";
import { App } from "../App.tsx";
import type { Health } from "../api/hooks.ts";
import { apiError, reply, stubApi } from "../components/__tests__/api.ts";
import { DEV_HEALTH, me } from "../components/__tests__/session.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACCESS_HEALTH: Health = { ...DEV_HEALTH, environment: "production", authMode: "access", llmProvider: "workers-ai", faultInjection: false };
const EMPLOYEES = [{ id: "E-1007", fullName: "Halia Elsworth", department: "Finance", employmentStatus: "active" }];
const USERS = [{ principal: "ops.lead@agentboard.test", role: "operator", displayName: "Ops Lead" }];

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("App session states", { tags: ["ui"] }, () => {
  it("on an unauthenticated first visit in dev mode, asks only for health and me before opening the dev login", async () => {
    const api = stubApi(({ path }) => {
      if (path === "/api/health") return reply(DEV_HEALTH);
      if (path === "/api/me") return apiError(401, "unauthenticated", "missing Access token");
      if (path === "/api/dev/users") return reply({ users: USERS });
      return reply({ items: [], nextCursor: null });
    });
    window.history.replaceState(null, "", "/");
    render(<App />);
    await screen.findByRole("heading", { name: "Dev login" });
    expect(window.location.pathname).toBe("/dev/login");
    const beforeLogin = api.paths().filter((p) => p !== "/api/dev/users");
    expect(new Set(beforeLogin)).toEqual(new Set(["/api/health", "/api/me"]));
    expect(api.paths().some((p) => p.startsWith("/api/metrics") || p.startsWith("/api/runs") || p.startsWith("/api/agents"))).toBe(false);
  });

  it("shows a principal without a role one page with their email, and makes no other request", async () => {
    const noRole: MeResponse = { principal: { kind: "user", id: "new.hire@example.test", email: "new.hire@example.test" }, role: null, permissions: [], authMode: "access", environment: "production" };
    const api = stubApi(({ path }) => {
      if (path === "/api/health") return reply(ACCESS_HEALTH);
      if (path === "/api/me") return reply(noRole);
      return reply({ items: [], nextCursor: null });
    });
    window.history.replaceState(null, "", "/runs");
    render(<App />);
    const page = await screen.findByTestId("no-role");
    expect(page.textContent).toContain("You are signed in as new.hire@example.test, but you have no AgentBoard role. Ask an admin to add a role binding for this email.");
    expect(screen.getAllByRole("link", { name: "Sign out" })[0]?.getAttribute("href")).toBe("/cdn-cgi/access/logout");
    expect(screen.queryByRole("link", { name: "Runs" })).toBeNull();
    await settle();
    expect(new Set(api.paths())).toEqual(new Set(["/api/health", "/api/me"]));
  });

  it("keeps the typed request when a launch gets a 401, shows a sign-in banner with next, and returns to the form after signing in", async () => {
    let signedIn = true;
    const api = stubApi(({ method, path }) => {
      if (path === "/api/health") return reply(DEV_HEALTH);
      if (path === "/api/me") return signedIn ? reply(me("operator", "ops.lead@agentboard.test")) : apiError(401, "unauthenticated", "invalid Access token");
      if (path === "/api/people/directory") return reply({ employees: EMPLOYEES });
      if (path === "/api/dev/samples") return reply({ samples: [] });
      if (path === "/api/agents") return reply({ roles: [] });
      if (path === "/api/dev/users") return reply({ users: USERS });
      if (path === "/api/dev/login" && method === "POST") {
        signedIn = true;
        return reply({ ok: true });
      }
      if (path === "/api/runs" && method === "POST") {
        signedIn = false;
        return apiError(401, "unauthenticated", "invalid Access token");
      }
      return undefined;
    });
    window.history.replaceState(null, "", "/launch");
    render(<App />);
    await screen.findByRole("option", { name: /Halia Elsworth/ });
    fireEvent.change(screen.getByLabelText("Subject employee"), { target: { value: "E-1007" } });
    const text = "Please update the home address for E-1007 to 12 Elm Street, Austin.";
    fireEvent.change(screen.getByLabelText("Request text"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Launch run" }));

    const banner = (await screen.findByText("Your dev session ended.")).closest("[role=alert]") as HTMLElement;
    const again = screen.getByRole("link", { name: "Sign in again" });
    expect(again.getAttribute("href")).toBe("/dev/login?next=%2Flaunch");
    expect(banner).toBeTruthy();
    expect(window.location.pathname).toBe("/launch");
    expect((screen.getByLabelText("Request text") as HTMLTextAreaElement).value).toBe(text);

    fireEvent.click(again);
    fireEvent.click(await screen.findByRole("button", { name: /Ops Lead/ }));
    await screen.findByRole("heading", { name: "Launch a run" });
    expect(window.location.pathname).toBe("/launch");
    expect(screen.queryByText("Your dev session ended.")).toBeNull();
    expect(api.paths()).toContain("/api/dev/login");
  });

  it("behind Access, answers a login page instead of JSON with a Reload banner and stays on the page", async () => {
    let expired = false;
    stubApi(({ path }) => {
      if (path === "/api/health") return reply(ACCESS_HEALTH);
      if (path === "/api/me") return reply({ ...me("viewer", "viewer@example.test"), authMode: "access", environment: "production" });
      if (expired) return new Response("<!doctype html><title>Sign in</title>", { status: 200, headers: { "Content-Type": "text/html" } });
      if (path === "/api/metrics/summary") return reply({ byStatus: {}, byType: {}, pendingApprovals: 0, needsAttention: 0, dlqOpen: 0 });
      if (path.startsWith("/api/runs")) return reply({ items: [], nextCursor: null });
      if (path === "/api/agents") return reply({ roles: [] });
      return undefined;
    });
    window.history.replaceState(null, "", "/runs?status=paused");
    render(<App />);
    await screen.findByText("No runs match.");
    expired = true;
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(await screen.findByText("Your Cloudflare Access session may have ended. Reload to sign in again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(window.location.pathname).toBe("/");
    expect(screen.queryByRole("link", { name: "switch user" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy());
  });
});
