import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../types.ts";

export type ErrorCode = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid_request" | "misconfigured" | "internal";

/** ApiError body (SPEC section 9.1). */
export function apiError(c: Context<AppEnv>, status: ContentfulStatusCode, code: ErrorCode, message: string, reason?: string): Response {
  const error: Record<string, string> = { code, message, requestId: c.get("requestId") ?? crypto.randomUUID() };
  if (reason) error["reason"] = reason;
  return c.json({ error }, status);
}
