// loadConfig(env): parse every var with zod and fail closed (SPEC section 5.2).
// When any rule fails, fetch answers 500 `misconfigured` on every path and the
// queue retries every message, so nothing executes under a bad config.

import { z } from "zod";

export const ENVIRONMENTS = ["development", "test", "eval", "preview", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export interface Config {
  environment: Environment;
  authMode: "access" | "dev";
  accessTeamDomain: string;
  accessAud: string;
  llmProvider: "workers-ai" | "openai-compatible" | "stub";
  llmBaseUrl: string;
  llmModel: string;
  workersAiModel: string;
  aiGatewayId: string;
  faultInjection: boolean;
  mcpExternal: boolean;
  dlqQueueName: string;
  agentShards: number;
  consumerConcurrency: number;
  leaseTtlMs: number;
  plannerLeaseTtlMs: number;
  toolTimeoutMs: number;
  llmTimeoutMs: number;
  ledgerLockMs: number;
  retryBaseDelayS: number;
  retryMaxDelayS: number;
  approvalTtlMs: number;
  agentControlsCacheMs: number;
  holdRecheckMs: number;
  allowedOrigins: string[];
  /** Raw bytes of INTEGRATION_SIGNING_KEY (HS256). */
  integrationSigningKey: Uint8Array;
  /** Public JWKS for dev-mode JWTs (dev auth only). */
  accessDevJwks: { keys: Record<string, unknown>[] } | null;
  /** Private JWK used only by /api/dev/login (dev auth only). */
  devAccessPrivateJwk: Record<string, unknown> | null;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: string[] };

const int = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, "must be a non-negative integer")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

const onOff = z.enum(["on", "off"]).transform((v) => v === "on");

const VarsSchema = z.object({
  ENVIRONMENT: z.enum(ENVIRONMENTS),
  AUTH_MODE: z.enum(["access", "dev"]),
  ACCESS_TEAM_DOMAIN: z.string().min(1),
  ACCESS_AUD: z.string(),
  LLM_PROVIDER: z.enum(["workers-ai", "openai-compatible", "stub"]),
  LLM_BASE_URL: z.string(),
  LLM_MODEL: z.string(),
  WORKERS_AI_MODEL: z.string(),
  AI_GATEWAY_ID: z.string(),
  FAULT_INJECTION: onOff,
  MCP_EXTERNAL: onOff,
  DLQ_QUEUE_NAME: z.string().min(1),
  AGENT_SHARDS: int(1, 16),
  CONSUMER_CONCURRENCY: int(1, 10),
  LEASE_TTL_MS: int(2000, 600_000),
  PLANNER_LEASE_TTL_MS: int(2000, 1_800_000),
  TOOL_TIMEOUT_MS: int(100, 60_000),
  LLM_TIMEOUT_MS: int(100, 300_000),
  LEDGER_LOCK_MS: int(100, 600_000),
  RETRY_BASE_DELAY_S: int(0, 60),
  RETRY_MAX_DELAY_S: int(1, 43_200),
  APPROVAL_TTL_MS: int(1000, 30 * 86_400_000),
  AGENT_CONTROLS_CACHE_MS: int(0, 60_000),
  HOLD_RECHECK_MS: int(500, 3_600_000),
  ALLOWED_ORIGINS: z.string(),
  INTEGRATION_SIGNING_KEY: z.string().optional(),
  ACCESS_DEV_JWKS: z.string().optional(),
  DEV_ACCESS_PRIVATE_JWK: z.string().optional(),
});

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value.trim());
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Pure parse of a vars record; `hasAiBinding` says whether `env.AI` exists. */
export function parseConfig(vars: Record<string, unknown>, hasAiBinding: boolean): ConfigResult {
  const parsed = VarsSchema.safeParse(vars);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
  const v = parsed.data;
  // An empty secret counts as absent (lets tests override a developer's local .dev.vars).
  if (v.ACCESS_DEV_JWKS === "") delete v.ACCESS_DEV_JWKS;
  if (v.DEV_ACCESS_PRIVATE_JWK === "") delete v.DEV_ACCESS_PRIVATE_JWK;
  const errors: string[] = [];
  const deployed = v.ENVIRONMENT === "production" || v.ENVIRONMENT === "preview";

  const signingKey = v.INTEGRATION_SIGNING_KEY ? decodeBase64(v.INTEGRATION_SIGNING_KEY) : null;
  if (!signingKey || signingKey.length < 32) errors.push("INTEGRATION_SIGNING_KEY must decode (base64) to at least 32 bytes");

  const allowedOrigins = v.ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  for (const origin of allowedOrigins) {
    if (!/^https?:\/\/[^/]+$/.test(origin)) errors.push(`ALLOWED_ORIGINS entry ${origin} is not an origin`);
  }

  if (deployed) {
    if (v.AUTH_MODE !== "access") errors.push(`${v.ENVIRONMENT} requires AUTH_MODE=access`);
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(v.ACCESS_TEAM_DOMAIN)) {
      errors.push("ACCESS_TEAM_DOMAIN must be https://<team>.cloudflareaccess.com");
    }
    if (v.ACCESS_AUD.trim() === "") errors.push("ACCESS_AUD must be set");
    if (v.FAULT_INJECTION) errors.push(`${v.ENVIRONMENT} requires FAULT_INJECTION=off`);
    if (v.MCP_EXTERNAL) errors.push(`${v.ENVIRONMENT} requires MCP_EXTERNAL=off`);
    if (v.LLM_PROVIDER === "stub") errors.push(`${v.ENVIRONMENT} may not use the stub LLM provider`);
    if (v.ACCESS_DEV_JWKS !== undefined) errors.push(`ACCESS_DEV_JWKS must be absent in ${v.ENVIRONMENT}`);
    if (v.DEV_ACCESS_PRIVATE_JWK !== undefined) errors.push(`DEV_ACCESS_PRIVATE_JWK must be absent in ${v.ENVIRONMENT}`);
    for (const origin of allowedOrigins) if (!origin.startsWith("https://")) errors.push(`ALLOWED_ORIGINS entry ${origin} must be https://`);
  }
  if (v.MCP_EXTERNAL && v.ENVIRONMENT !== "development") errors.push("MCP_EXTERNAL=on is allowed only in development");
  if (v.LLM_PROVIDER === "workers-ai" && !hasAiBinding) errors.push("LLM_PROVIDER=workers-ai requires the AI binding");

  let accessDevJwks: Config["accessDevJwks"] = null;
  let devAccessPrivateJwk: Config["devAccessPrivateJwk"] = null;
  if (v.AUTH_MODE === "dev") {
    if (!(["development", "test", "eval"] as Environment[]).includes(v.ENVIRONMENT)) {
      errors.push("AUTH_MODE=dev is allowed only in development, test and eval");
    }
    const jwks = v.ACCESS_DEV_JWKS ? parseJson(v.ACCESS_DEV_JWKS) : undefined;
    if (!jwks || typeof jwks !== "object" || !Array.isArray((jwks as { keys?: unknown }).keys)) {
      errors.push("AUTH_MODE=dev requires ACCESS_DEV_JWKS (a JWKS JSON document)");
    } else {
      accessDevJwks = jwks as Config["accessDevJwks"];
    }
    if (v.DEV_ACCESS_PRIVATE_JWK) {
      const jwk = parseJson(v.DEV_ACCESS_PRIVATE_JWK);
      if (jwk && typeof jwk === "object") devAccessPrivateJwk = jwk as Record<string, unknown>;
      else errors.push("DEV_ACCESS_PRIVATE_JWK is not JSON");
    }
  }

  // Timing invariants: no external call can outlive its lease (SPEC section 5.2).
  if (v.LEASE_TTL_MS < 2 * v.TOOL_TIMEOUT_MS + 1000) errors.push("LEASE_TTL_MS must be >= 2 * TOOL_TIMEOUT_MS + 1000");
  if (v.PLANNER_LEASE_TTL_MS < v.TOOL_TIMEOUT_MS + 2 * v.LLM_TIMEOUT_MS + 1000) {
    errors.push("PLANNER_LEASE_TTL_MS must be >= TOOL_TIMEOUT_MS + 2 * LLM_TIMEOUT_MS + 1000");
  }
  if (v.LEDGER_LOCK_MS <= v.TOOL_TIMEOUT_MS) errors.push("LEDGER_LOCK_MS must be > TOOL_TIMEOUT_MS");
  if (v.RETRY_MAX_DELAY_S < v.RETRY_BASE_DELAY_S) errors.push("RETRY_MAX_DELAY_S must be >= RETRY_BASE_DELAY_S");

  if (errors.length > 0 || !signingKey) return { ok: false, errors };
  return {
    ok: true,
    config: {
      environment: v.ENVIRONMENT,
      authMode: v.AUTH_MODE,
      accessTeamDomain: v.ACCESS_TEAM_DOMAIN,
      accessAud: v.ACCESS_AUD,
      llmProvider: v.LLM_PROVIDER,
      llmBaseUrl: v.LLM_BASE_URL,
      llmModel: v.LLM_MODEL,
      workersAiModel: v.WORKERS_AI_MODEL,
      aiGatewayId: v.AI_GATEWAY_ID,
      faultInjection: v.FAULT_INJECTION,
      mcpExternal: v.MCP_EXTERNAL,
      dlqQueueName: v.DLQ_QUEUE_NAME,
      agentShards: v.AGENT_SHARDS,
      consumerConcurrency: v.CONSUMER_CONCURRENCY,
      leaseTtlMs: v.LEASE_TTL_MS,
      plannerLeaseTtlMs: v.PLANNER_LEASE_TTL_MS,
      toolTimeoutMs: v.TOOL_TIMEOUT_MS,
      llmTimeoutMs: v.LLM_TIMEOUT_MS,
      ledgerLockMs: v.LEDGER_LOCK_MS,
      retryBaseDelayS: v.RETRY_BASE_DELAY_S,
      retryMaxDelayS: v.RETRY_MAX_DELAY_S,
      approvalTtlMs: v.APPROVAL_TTL_MS,
      agentControlsCacheMs: v.AGENT_CONTROLS_CACHE_MS,
      holdRecheckMs: v.HOLD_RECHECK_MS,
      allowedOrigins,
      integrationSigningKey: signingKey,
      accessDevJwks,
      devAccessPrivateJwk,
    },
  };
}

const cache = new WeakMap<object, ConfigResult>();

/** Parses and caches the config for one env object (one per isolate in production). */
export function loadConfig(env: Env): ConfigResult {
  const cached = cache.get(env);
  if (cached) return cached;
  const result = parseConfig(env as unknown as Record<string, unknown>, Boolean((env as { AI?: unknown }).AI));
  cache.set(env, result);
  return result;
}

export function misconfiguredResponse(): Response {
  return Response.json(
    { error: { code: "misconfigured", message: "the worker configuration failed validation", requestId: crypto.randomUUID() } },
    { status: 500 },
  );
}
