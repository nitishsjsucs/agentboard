import { cloudflareTest, readD1Migrations, type D1Migration } from "@cloudflare/vitest-plugin";
import { exportJWK, generateKeyPair } from "jose";
import { randomBytes } from "node:crypto";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const TAGS = [
  { name: "orchestration", description: "coordinator, dispatch, leases, budgets, retries, idempotency, audit" },
  { name: "authz", description: "identity, permissions, separation of duties, integration tokens" },
  { name: "history", description: "search and history" },
  { name: "data", description: "synthetic data generator" },
  { name: "integration", description: "People Ops MCP tools" },
  { name: "llm", description: "LLM providers" },
  { name: "sim", description: "100-run simulation" },
  { name: "ui", description: "React components" },
  { name: "eval", description: "evaluation math" },
  { name: "tooling", description: "toolchain and launcher gates" },
];

const consoleMigrations: D1Migration[] = await readD1Migrations("./migrations/console");
const peopleMigrations: D1Migration[] = await readD1Migrations("./migrations/people");
// Generated seeds, applied as one-entry migration lists tracked in `seed_migrations`.
const consoleSeed: D1Migration[] = await readD1Migrations({ projectPath: ".", migrationsDir: "seed", migrationsPattern: "seed/console.sql" });
const peopleSeed: D1Migration[] = await readD1Migrations({ projectPath: ".", migrationsDir: "seed", migrationsPattern: "seed/people.sql" });

// Test-only keys, generated per vitest run (never written to disk).
const testKeys = await generateKeyPair("RS256", { extractable: true });
const testPublicJwk = { ...(await exportJWK(testKeys.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
const testPrivateJwk = { ...(await exportJWK(testKeys.privateKey)), kid: "test-key", alg: "RS256" };
const testIntegrationKey = randomBytes(32).toString("base64");

/** Bindings shared by every workerd project (test values only). */
function workerBindings() {
  return {
    ENVIRONMENT: "test",
    AUTH_MODE: "dev",
    LEASE_TTL_MS: "3000",
    PLANNER_LEASE_TTL_MS: "6000",
    TOOL_TIMEOUT_MS: "1000",
    LLM_TIMEOUT_MS: "2000",
    LEDGER_LOCK_MS: "2000",
    RETRY_BASE_DELAY_S: "0",
    APPROVAL_TTL_MS: "60000",
    AGENT_CONTROLS_CACHE_MS: "0",
    HOLD_RECHECK_MS: "1000",
    INTEGRATION_SIGNING_KEY: testIntegrationKey,
    ACCESS_DEV_JWKS: JSON.stringify({ keys: [testPublicJwk] }),
    TEST_ACCESS_PRIVATE_JWK: JSON.stringify(testPrivateJwk),
    DEV_ACCESS_PRIVATE_JWK: JSON.stringify(testPrivateJwk),
    TEST_CONSOLE_MIGRATIONS: consoleMigrations,
    TEST_PEOPLE_MIGRATIONS: peopleMigrations,
    TEST_CONSOLE_SEED: consoleSeed,
    TEST_PEOPLE_SEED: peopleSeed,
  };
}

/** The worker-access project: Access mode against an intercepted remote JWKS, no dev keys. */
function accessBindings() {
  const { ACCESS_DEV_JWKS: _jwks, DEV_ACCESS_PRIVATE_JWK: _private, TEST_ACCESS_PRIVATE_JWK: _test, ...rest } = workerBindings();
  return {
    ...rest,
    AUTH_MODE: "access",
    // Empty means absent; this also masks a developer's local .dev.vars, which the plugin loads.
    ACCESS_DEV_JWKS: "",
    DEV_ACCESS_PRIVATE_JWK: "",
    ACCESS_TEAM_DOMAIN: "https://agentboard-test.cloudflareaccess.com",
    ACCESS_AUD: "agentboard-test-aud",
  };
}

function workerPool(bindings: Record<string, unknown> = workerBindings()) {
  return cloudflareTest({
    main: "./test/helpers/test-worker.ts",
    wrangler: { configPath: "./wrangler.jsonc" },
    remoteBindings: false,
    miniflare: {
      bindings: bindings as ReturnType<typeof workerBindings>,
      durableObjects: {
        ToolchainProbe: { className: "ToolchainProbe", useSQLite: true },
      },
      // Fast local queues for tests (SPEC section 5.4).
      queueConsumers: {
        "agentboard-tasks": { maxBatchSize: 10, maxBatchTimeout: 0.05, maxRetries: 2, deadLetterQueue: "agentboard-tasks-dlq" },
        "agentboard-tasks-dlq": { maxBatchSize: 10, maxBatchTimeout: 0.05, maxRetries: 2 },
      },
    },
  });
}

export default defineConfig({
  test: {
    tags: TAGS,
    strictTags: true,
    projects: [
      {
        extends: true,
        plugins: [workerPool()],
        test: {
          name: "worker",
          setupFiles: ["./test/helpers/setup.ts"],
          include: ["test/worker/**/*.test.ts"],
          exclude: ["test/worker/auth/access-jwt.test.ts"],
        },
      },
      {
        extends: true,
        plugins: [workerPool()],
        test: {
          name: "worker-ws",
          setupFiles: ["./test/helpers/setup.ts"],
          include: ["test/worker-ws/**/*.test.ts"],
          isolate: false,
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        plugins: [workerPool(accessBindings())],
        test: {
          name: "worker-access",
          setupFiles: ["./test/helpers/setup.ts"],
          include: ["test/worker/auth/access-jwt.test.ts"],
          sequence: { groupOrder: 2 },
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "web",
          environment: "happy-dom",
          include: ["src/web/**/*.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["scripts/**/*.test.ts"],
        },
      },
    ],
  },
});
