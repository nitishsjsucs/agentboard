import { cloudflareTest } from "@cloudflare/vitest-plugin";
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

/** Bindings shared by every workerd project (test values only). */
function workerBindings(): Record<string, string> {
  return {
    ENVIRONMENT: "test",
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
          include: ["test/worker/**/*.test.ts"],
          exclude: ["test/worker/auth/access-jwt.test.ts"],
        },
      },
      {
        extends: true,
        plugins: [workerPool()],
        test: {
          name: "worker-ws",
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
