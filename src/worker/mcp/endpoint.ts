// The People Ops MCP endpoint (SPEC section 8.1). Agents reach it in-process
// (mcp/client.ts); the Worker's own /mcp route exists only with
// MCP_EXTERNAL=on in development.

import { createMcpHandler } from "agents/mcp/server";
import { verifyIntegrationToken, type IntegrationClaims, type IntegrationKind } from "../auth/integration-tokens.ts";
import type { Config } from "../config.ts";
import { buildPeopleOpsServer } from "./server.ts";

export const PEOPLE_OPS_HOST = "people-ops.internal";

const BASE_METHODS = ["initialize", "notifications/initialized", "ping", "tools/list", "server/discover"];

export function methodsFor(kind: IntegrationKind): ReadonlySet<string> {
  return new Set(kind === "planner" ? BASE_METHODS : [...BASE_METHODS, "tools/call"]);
}

function deny(status: 401 | 403 | 400, code: string): Response {
  return Response.json({ error: { code, message: code } }, { status });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

async function jsonRpcMethod(request: Request): Promise<string | null> {
  if (request.method !== "POST") return null;
  try {
    const body = (await request.json()) as unknown;
    if (Array.isArray(body) || !body || typeof body !== "object") return null;
    const method = (body as { method?: unknown }).method;
    return typeof method === "string" ? method : null;
  } catch {
    return null;
  }
}

export async function peopleOpsEndpoint(request: Request, env: Env, config: Config): Promise<Response> {
  const token = bearer(request);
  if (!token) return deny(401, "missing_token");
  let claims: IntegrationClaims;
  try {
    claims = await verifyIntegrationToken(token, config.integrationSigningKey);
  } catch {
    return deny(401, "invalid_token");
  }
  // A token never outlives its lease, not even by the second jose rounds exp up to.
  if (Date.now() >= claims.lease_exp_ms) return deny(401, "lease_expired");
  // Stateless server: no standalone SSE stream (GET) and no sessions (DELETE).
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const method = await jsonRpcMethod(request.clone());
  if (method === null) return deny(400, "single_json_rpc_message_required");
  if (!methodsFor(claims.kind).has(method)) return deny(403, "method_not_allowed");
  const handler = createMcpHandler(() => buildPeopleOpsServer(env, config), {
    route: "/mcp",
    allowedHostnames: [PEOPLE_OPS_HOST, "localhost", "127.0.0.1"],
    corsOptions: false,
  });
  return handler.fetch(request, {
    authInfo: { token, clientId: claims.sub, scopes: claims.scope.split(" "), expiresAt: claims.exp, extra: { claims } },
  });
}
