import type { MiddlewareHandler } from "hono";
import { extractAccessToken, verifyAccessJwt } from "../../auth/access.ts";
import { permissionsFor } from "../../auth/permissions.ts";
import { principalFromClaims } from "../../auth/principal.ts";
import type { Config } from "../../config.ts";
import { getRoleBinding } from "../../db/console.ts";
import type { AppEnv, Identity } from "../types.ts";
import { apiError } from "./errors.ts";

export type AuthOutcome = { ok: true; identity: Identity } | { ok: false; message: string };

/** Verifies the Access JWT (or the dev JWT), maps it to a principal and loads its role binding. */
export async function authenticate(request: Request, db: D1Database, config: Config): Promise<AuthOutcome> {
  const token = extractAccessToken(request, config);
  if (!token) return { ok: false, message: "missing Access token" };
  let principal;
  try {
    principal = principalFromClaims(await verifyAccessJwt(token, config));
  } catch {
    return { ok: false, message: "invalid Access token" };
  }
  if (!principal) return { ok: false, message: "token carries no email or service name" };
  const binding = await getRoleBinding(db, principal.id);
  const role = binding?.role ?? null;
  return { ok: true, identity: { principal, role, permissions: permissionsFor(role) } };
}

export const identityMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const outcome = await authenticate(c.req.raw, c.env.DB, c.get("config"));
  if (!outcome.ok) return apiError(c, 401, "unauthenticated", outcome.message);
  c.set("identity", outcome.identity);
  await next();
};
