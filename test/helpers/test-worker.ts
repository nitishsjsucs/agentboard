import { routeAgentRequest } from "agents";
import worker from "../../src/worker/index.ts";

/**
 * Test entry module. It is the production worker plus the test-only
 * `ToolchainProbe` agent, reachable under `/__probe/*`. Production code never
 * imports this file.
 */
export * from "../../src/worker/index.ts";
export { ToolchainProbe } from "./probe-agent.ts";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__probe/")) {
      const routed = await routeAgentRequest(request, env, { prefix: "__probe" });
      return routed ?? new Response("no probe route", { status: 404 });
    }
    return worker.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
