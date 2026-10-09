// Live run snapshots over WebSocket (SPEC sections 3.1, 10.2 and 15): only
// RunCoordinator, only its own path, only WebSocket upgrades, read-only
// connections, an Origin allowlist against cross-site WebSocket hijacking
// with an ambient cookie, runs:read, and the run must already exist in D1 (no
// Durable Object is created for an unknown id).
//
// Only the exact path `/agents/run-coordinator/<runId>` is accepted. The
// Agents SDK forwards a `/sub/{class}/{name}` tail under any agent route to a
// sub-agent facet of that class, created on demand; routeAgentRequest checks
// only the first two segments, so a longer path would reach any agent class.

import { routeAgentRequest } from "agents";
import { authenticate } from "./api/middleware/identity.ts";
import type { Config } from "./config.ts";
import { RUN_ID_PATTERN } from "./util/ids.ts";

function refuse(status: 401 | 403 | 404, code: string): Response {
  return Response.json({ error: { code, message: code, requestId: crypto.randomUUID() } }, { status });
}

export async function handleAgentRoute(request: Request, env: Env, config: Config): Promise<Response> {
  const routed = await routeAgentRequest(request, env, {
    onBeforeRequest: () => refuse(404, "not_found"),
    onBeforeConnect: async (upgrade, route) => {
      if (route.className !== "RunCoordinator") return refuse(403, "forbidden");
      if (new URL(upgrade.url).pathname !== `/agents/run-coordinator/${route.name}`) return refuse(404, "not_found");
      const origin = upgrade.headers.get("Origin");
      if (origin !== null && !config.allowedOrigins.includes(origin)) return refuse(403, "forbidden_origin");
      const auth = await authenticate(upgrade, env.DB, config);
      if (!auth.ok) return refuse(401, "unauthenticated");
      if (!auth.identity.permissions.includes("runs:read")) return refuse(403, "forbidden");
      if (!RUN_ID_PATTERN.test(route.name)) return refuse(404, "not_found");
      const exists = await env.DB.prepare("SELECT 1 AS present FROM runs WHERE id = ?").bind(route.name).first();
      if (!exists) return refuse(404, "not_found");
      return undefined;
    },
  });
  return routed ?? refuse(404, "not_found");
}
