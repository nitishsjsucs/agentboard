import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../../src/worker/config.ts";
import worker from "../../../src/worker/index.ts";
import { buildApp } from "../../../src/worker/api/app.ts";
import { P } from "../../helpers/auth.ts";

/** A production env that passes every rule; each case below breaks exactly one. */
function productionEnv(overrides: Record<string, unknown> = {}): Env {
  const base: Record<string, unknown> = {
    ...env,
    ENVIRONMENT: "production",
    AUTH_MODE: "access",
    ACCESS_TEAM_DOMAIN: "https://agentboard-test.cloudflareaccess.com",
    ACCESS_AUD: "agentboard-test-aud",
    FAULT_INJECTION: "off",
    MCP_EXTERNAL: "off",
    LLM_PROVIDER: "workers-ai",
    AI: { run: async () => ({}) },
    ACCESS_DEV_JWKS: undefined,
    DEV_ACCESS_PRIVATE_JWK: undefined,
    ALLOWED_ORIGINS: "https://agentboard-production.example.workers.dev",
    LEASE_TTL_MS: "30000",
    PLANNER_LEASE_TTL_MS: "120000",
    TOOL_TIMEOUT_MS: "5000",
    LLM_TIMEOUT_MS: "45000",
    LEDGER_LOCK_MS: "15000",
  };
  return { ...base, ...overrides } as unknown as Env;
}

const BROKEN: [string, Record<string, unknown>][] = [
  ["production with dev auth", { AUTH_MODE: "dev", ACCESS_DEV_JWKS: env.ACCESS_DEV_JWKS }],
  ["fault injection on", { FAULT_INJECTION: "on" }],
  ["MCP_EXTERNAL on", { MCP_EXTERNAL: "on" }],
  ["a stub LLM", { LLM_PROVIDER: "stub" }],
  ["a short signing key", { INTEGRATION_SIGNING_KEY: btoa("too-short-key") }],
  ["a violated timing invariant (LEASE_TTL_MS < 2 * TOOL_TIMEOUT_MS + 1000)", { LEASE_TTL_MS: "9000" }],
];

describe("dev mode and fail-closed config", { tags: ["authz"] }, () => {
  it("loadConfig fails closed: 500 misconfigured on every route and a retried queue batch, for each production misconfiguration", async () => {
    // The test environment itself and a well-formed production environment both load.
    expect(parseConfig(env as unknown as Record<string, unknown>, false)).toMatchObject({ ok: true });
    expect(parseConfig(productionEnv() as unknown as Record<string, unknown>, true).ok).toBe(true);
    for (const [label, overrides] of BROKEN) {
      const broken = productionEnv(overrides);
      const result = parseConfig(broken as unknown as Record<string, unknown>, true);
      expect(result.ok, label).toBe(false);
      for (const path of ["/api/health", "/api/me", "/agents/run-coordinator/run_x", "/mcp", "/"]) {
        const response = await worker.fetch(new Request(`http://127.0.0.1${path}`), broken, createExecutionContext());
        expect(response.status, `${label} ${path}`).toBe(500);
        expect(await response.json(), `${label} ${path}`).toMatchObject({ error: { code: "misconfigured" } });
      }
      const batch = createMessageBatch("agentboard-tasks", [{ id: "m1", timestamp: Date.now(), attempts: 1, body: { v: 1 } }]);
      const ctx = createExecutionContext();
      await worker.queue(batch, broken);
      const queueResult = await getQueueResult(batch, ctx);
      expect(queueResult.retryBatch.retry, label).toBe(true);
      expect(queueResult.explicitAcks, label).toEqual([]);
    }
  });
});

describe("dev routes", { tags: ["authz"] }, () => {
  it("an access-mode app registers no /api/dev/* routes", async () => {
    const parsed = parseConfig(productionEnv() as unknown as Record<string, unknown>, true);
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const app = buildApp(parsed.config);
    for (const [method, path] of [["GET", "/api/dev/users"], ["POST", "/api/dev/login"], ["GET", "/api/dev/people/side-effects"]] as const) {
      const response = await app.fetch(
        new Request(`http://127.0.0.1${path}`, { method, headers: { "Content-Type": "application/json", "X-AgentBoard-Client": "web" }, ...(method === "POST" ? { body: JSON.stringify({ principal: P.admin }) } : {}) }),
        productionEnv(),
        createExecutionContext(),
      );
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("dev login refuses non-loopback hostnames; a loopback dev cookie session is accepted and carries the bound role", async () => {
    const body = JSON.stringify({ principal: P.approver });
    const headers = { "Content-Type": "application/json", "X-AgentBoard-Client": "web" };
    for (const host of ["agentboard.example.com", "10.0.0.8", "agentboard-production.example.workers.dev"]) {
      const refused = await exports.default.fetch(`http://${host}/api/dev/login`, { method: "POST", headers, body });
      expect(refused.status, host).toBe(404);
      expect(refused.headers.get("Set-Cookie"), host).toBeNull();
    }
    const login = await exports.default.fetch("http://127.0.0.1:8784/api/dev/login", { method: "POST", headers, body });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^CF_Authorization=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=43200$/);
    const session = cookie.split(";")[0] ?? "";
    const meResponse = await exports.default.fetch("http://127.0.0.1:8784/api/me", { headers: { Cookie: session } });
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toMatchObject({ principal: { id: P.approver }, role: "approver", authMode: "dev" });
    const audit = await env.DB.prepare("SELECT action, actor_id FROM audit_events WHERE stream = 'global' ORDER BY seq").all<{ action: string; actor_id: string }>();
    expect(audit.results).toContainEqual({ action: "auth.dev_login", actor_id: P.approver });
  });
});
