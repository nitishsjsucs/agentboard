import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../../shared/api-types.ts";
import { App } from "../App.tsx";
import type { Health } from "../api/hooks.ts";
import { MESSAGES } from "../api/describeError.ts";
import { apiError, opaqueRedirect, reply, stubApi } from "../components/__tests__/api.ts";
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

  /** A viewer behind Access on /runs; once `answer` returns a Response, every other /api request gets it. */
  function accessViewer(answer: () => Response | undefined) {
    return stubApi(({ path }) => {
      if (path === "/api/health") return reply(ACCESS_HEALTH);
      if (path === "/api/me") return reply({ ...me("viewer", "viewer@example.test"), authMode: "access", environment: "production" });
      const override = answer();
      if (override) return override;
      if (path === "/api/metrics/summary") return reply({ byStatus: {}, byType: {}, pendingApprovals: 0, needsAttention: 0, dlqOpen: 0 });
      if (path.startsWith("/api/runs")) return reply({ items: [], nextCursor: null });
      if (path === "/api/agents") return reply({ roles: [] });
      return undefined;
    });
  }

  it("behind Access, shows a Reload banner and stays on the page when an expired session is redirected to the login page", async () => {
    // Production answers an expired session with 302 to the team's cross-origin login page; the client
    // does not follow it, so the browser hands back an opaque redirect.
    let expired = false;
    accessViewer(() => (expired ? opaqueRedirect() : undefined));
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

  it("behind Access, treats a 5xx HTML error page as a server failure, not an ended session", async () => {
    let failing = false;
    accessViewer(() => (failing ? new Response("<!doctype html><title>Error 1102</title>", { status: 503, headers: { "Content-Type": "text/html" } }) : undefined));
    window.history.replaceState(null, "", "/runs?status=paused");
    render(<App />);
    await screen.findByText("No runs match.");
    failing = true;
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect((await screen.findAllByText(MESSAGES.server, { exact: false })).length).toBeGreaterThan(0);
    expect(screen.queryByText("Your Cloudflare Access session may have ended. Reload to sign in again.")).toBeNull();
    expect(document.querySelector(".session-banner")).toBeNull();
  });
});

describe("App navigation for keyboard and screen-reader users", { tags: ["ui"] }, () => {
  function signedInApi() {
    return stubApi(({ path }) => {
      if (path === "/api/health") return reply(DEV_HEALTH);
      if (path === "/api/me") return reply(me("operator", "ops.lead@agentboard.test"));
      if (path === "/api/metrics/summary") return reply({ byStatus: {}, byType: {}, pendingApprovals: 0, needsAttention: 0, dlqOpen: 0 });
      if (path.startsWith("/api/runs") || path.startsWith("/api/approvals") || path === "/api/dlq") return reply({ items: [], nextCursor: null });
      if (path === "/api/agents") return reply({ roles: [] });
      if (path === "/api/people/directory") return reply({ employees: EMPLOYEES });
      if (path === "/api/dev/samples") return reply({ samples: [] });
      return undefined;
    });
  }

  it("starts with a Skip to content link that focuses main", async () => {
    signedInApi();
    window.history.replaceState(null, "", "/");
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    const skip = screen.getByRole("link", { name: "Skip to content" });
    const focusable = document.body.querySelectorAll("a[href], button, input, select, textarea");
    expect(focusable[0]).toBe(skip);
    fireEvent.click(skip);
    const main = document.getElementById("main");
    expect(main?.tagName).toBe("MAIN");
    expect(main?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(main);
  });

  it("titles every page and moves focus to the new page's heading after a client-side navigation", async () => {
    signedInApi();
    window.history.replaceState(null, "", "/");
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    await waitFor(() => expect(document.title).toBe("Dashboard | AgentBoard"));
    for (const [link, heading, title] of [
      ["Runs", "Runs", "Runs | AgentBoard"],
      ["Approvals", "Approval queue", "Approval queue | AgentBoard"],
      ["Launch", "Launch a run", "Launch a run | AgentBoard"],
      ["Dashboard", "Dashboard", "Dashboard | AgentBoard"],
    ] as const) {
      fireEvent.click(screen.getByRole("link", { name: link }));
      const h1 = await screen.findByRole("heading", { level: 1, name: heading });
      await waitFor(() => expect(document.title).toBe(title));
      await waitFor(() => expect(document.activeElement).toBe(h1));
    }
    fireEvent.click(screen.getByRole("link", { name: "switch user" }));
    await waitFor(() => expect(document.title).toBe("Dev login | AgentBoard"));
  });
});
