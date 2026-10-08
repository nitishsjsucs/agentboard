import { buildApp } from "./api/app.ts";

export { RunCoordinator } from "./agents/run-coordinator.ts";
export { PlannerAgent } from "./agents/planner-agent.ts";
export { ExecutorAgent } from "./agents/executor-agent.ts";
export { VerifierAgent } from "./agents/verifier-agent.ts";

const app = buildApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return app.fetch(request, env, ctx);
    return new Response("not found", { status: 404 });
  },
  async queue(batch: MessageBatch<unknown>): Promise<void> {
    // Fail closed until the consumer exists (SPEC section 19, commit 13).
    batch.retryAll();
  },
} satisfies ExportedHandler<Env>;
