import type { MiddlewareHandler } from "hono";
import { extractAccessToken, verifyAccessJwt } from "../../auth/access.ts";
import { permissionsFor } from "../../auth/permissions.ts";
import { principalFromClaims } from "../../auth/principal.ts";
import { getRoleBinding } from "../../db/console.ts";
import type { AppEnv } from "../types.ts";
import { apiError } from "./errors.ts";

/** Verifies the Access JWT (or the dev JWT), maps it to a principal and loads its role binding. */
export const identityMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const config = c.get("config");
  const token = extractAccessToken(c.req.raw, config);
  if (!token) return apiError(c, 401, "unauthenticated", "missing Access token");
  let principal;
  try {
    principal = principalFromClaims(await verifyAccessJwt(token, config));
  } catch {
    return apiError(c, 401, "unauthenticated", "invalid Access token");
  }
  if (!principal) return apiError(c, 401, "unauthenticated", "token carries no email or service name");
  const binding = await getRoleBinding(c.env.DB, principal.id);
  const role = binding?.role ?? null;
  c.set("identity", { principal, role, permissions: permissionsFor(role) });
  await next();
};
