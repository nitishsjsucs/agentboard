import { cloudflareTest, readD1Migrations, type D1Migration } from "@cloudflare/vitest-plugin";
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

/** Bindings shared by every workerd project (test values only). */
function workerBindings() {
  return {
    ENVIRONMENT: "test",
    TEST_CONSOLE_MIGRATIONS: consoleMigrations,
    TEST_PEOPLE_MIGRATIONS: peopleMigrations,
  };
}

function workerPool() {
  return cloudflareTest({
    main: "./test/helpers/test-worker.ts",
    wrangler: { configPath: "./wrangler.jsonc" },
    remoteBindings: false,
    miniflare: {
      bindings: workerBindings(),
      durableObjects: {
        ToolchainProbe: { className: "ToolchainProbe", useSQLite: true },
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
    ],
  },
});
