import type { Hono } from "hono";
import { buildApp } from "./api/app.ts";
import type { AppEnv } from "./api/types.ts";
import { loadConfig, misconfiguredResponse, type Config } from "./config.ts";
import { externalMcpRoute } from "./mcp/endpoint.ts";
import { handleQueueBatch } from "./queue/consumer.ts";
import { handleAgentRoute } from "./realtime.ts";

export { RunCoordinator } from "./agents/run-coordinator.ts";
export { PlannerAgent } from "./agents/planner-agent.ts";
export { ExecutorAgent } from "./agents/executor-agent.ts";
export { VerifierAgent } from "./agents/verifier-agent.ts";

const apps = new WeakMap<Config, Hono<AppEnv>>();

function appFor(config: Config): Hono<AppEnv> {
  let app = apps.get(config);
  if (!app) {
    app = buildApp(config);
    apps.set(config, app);
  }
  return app;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const loaded = loadConfig(env);
    if (!loaded.ok) {
      console.error("agentboard: configuration rejected", loaded.errors);
      return misconfiguredResponse();
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return appFor(loaded.config).fetch(request, env, ctx);
    if (url.pathname.startsWith("/agents/")) return handleAgentRoute(request, env, loaded.config);
    // 404 unless MCP_EXTERNAL=on (development only) and the host is loopback.
    if (url.pathname === "/mcp") return externalMcpRoute(request, env, loaded.config);
    return new Response("not found", { status: 404 });
  },
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const loaded = loadConfig(env);
    if (!loaded.ok) {
      console.error("agentboard: configuration rejected; retrying the batch", loaded.errors);
      batch.retryAll();
      return;
    }
    await handleQueueBatch(batch, env, loaded.config);
  },
} satisfies ExportedHandler<Env>;
