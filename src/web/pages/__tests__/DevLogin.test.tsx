import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../../shared/domain.ts";
import { App } from "../../App.tsx";
import type { Health } from "../../api/hooks.ts";
import { me } from "../../components/__tests__/session.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const USERS: { principal: string; role: Role; displayName: string }[] = [
  { principal: "admin@agentboard.test", role: "admin", displayName: "Admin" },
  { principal: "approver.lee@agentboard.test", role: "approver", displayName: "Lee Approver" },
];

const HEALTH: Health = { ok: true, version: "test", environment: "development", authMode: "dev", llmProvider: "stub", faultInjection: true };

interface Seen {
  method: string;
  path: string;
  principal: string;
  status: number;
}

/** A dev-mode API whose cookie belongs to `principal` and whose /api/me answers late, as a slow network would. */
function fakeApi(initial: string) {
  let principal = initial;
  const seen: Seen[] = [];
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const user = USERS.find((u) => u.principal === principal);
    const role = user?.role ?? "viewer";
    const record = (response: Response) => {
      seen.push({ method, path, principal, status: response.status });
      return response;
    };
    if (path === "/api/health") return record(reply(HEALTH));
    if (path === "/api/me") {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return record(reply(me(role, principal)));
    }
    if (path === "/api/dev/users") return record(reply({ users: USERS }));
    if (path === "/api/dev/login" && method === "POST") {
      principal = (JSON.parse(String(init?.body)) as { principal: string }).principal;
      return record(reply({ ok: true }));
    }
    if (path === "/api/dlq") {
      if (!me(role, principal).permissions.includes("dlq:read")) return record(reply({ error: { code: "forbidden", message: "forbidden", requestId: "r" } }, 403));
      return record(reply({ items: [], nextCursor: null }));
    }
    if (path === "/api/metrics/summary") return record(reply({ byStatus: {}, byType: {}, pendingApprovals: 0, needsAttention: 0, dlqOpen: 0 }));
    if (path.startsWith("/api/runs")) return record(reply({ items: [], nextCursor: null }));
    if (path === "/api/agents") return record(reply({ roles: [] }));
    return record(reply({ error: { code: "not_found", message: "not found", requestId: "r" } }, 404));
  });
  return { fetch, seen };
}

describe("DevLogin", { tags: ["ui"] }, () => {
  it("switching principals waits for the new session, so the dashboard never fetches with the previous principal's permissions", async () => {
    const api = fakeApi("admin@agentboard.test");
    vi.stubGlobal("fetch", api.fetch);
    window.history.replaceState(null, "", "/dev/login");
    render(<App />);
    // The admin session is loaded before switching.
    await screen.findByText("admin@agentboard.test", { selector: ".principal" });
    fireEvent.click(await screen.findByRole("button", { name: /Lee Approver/ }));

    await screen.findByRole("heading", { name: "Dashboard" });
    await screen.findByText("approver.lee@agentboard.test", { selector: ".principal" });
    const login = api.seen.findIndex((s) => s.path === "/api/dev/login");
    await waitFor(() => expect(api.seen.slice(login).some((s) => s.path === "/api/agents")).toBe(true));
    const afterLogin = api.seen.slice(login + 1);
    // The approver lacks dlq:read: no DLQ request, and nothing was refused.
    expect(afterLogin.filter((s) => s.path === "/api/dlq")).toEqual([]);
    expect(afterLogin.filter((s) => s.status >= 400)).toEqual([]);
    expect(afterLogin.every((s) => s.principal === "approver.lee@agentboard.test")).toBe(true);
  });
});
