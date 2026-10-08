import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../../src/worker/config.ts";
import worker from "../../../src/worker/index.ts";

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
