import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.ts";
import { apiError } from "./errors.ts";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * CSRF guard for every /api mutation (SPEC section 9): JSON content type plus
 * the custom `X-AgentBoard-Client: web` header force a CORS preflight, which
 * fails because /api never sends CORS headers. A browser `Origin` outside
 * ALLOWED_ORIGINS (and not the request's own origin) is refused outright.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  if (c.req.method === "OPTIONS") return apiError(c, 403, "forbidden", "cross-origin requests are not allowed", "csrf");
  const origin = c.req.header("Origin");
  if (origin !== undefined) {
    const own = new URL(c.req.url).origin;
    if (origin !== own && !c.get("config").allowedOrigins.includes(origin)) {
      return apiError(c, 403, "forbidden", "foreign Origin", "csrf_origin");
    }
  }
  if (c.req.header("X-AgentBoard-Client") !== "web") {
    return apiError(c, 403, "forbidden", "mutations require the X-AgentBoard-Client: web header", "csrf_header");
  }
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return apiError(c, 403, "forbidden", "mutations require Content-Type: application/json", "csrf_content_type");
  }
  await next();
};
