import type { MiddlewareHandler } from "hono";
import type { Permission } from "../../../shared/domain.ts";
import type { AppEnv } from "../types.ts";
import { apiError } from "./errors.ts";

/** Default deny: the principal's role must grant `permission` (SPEC section 10.1). */
export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const identity = c.get("identity");
    if (!identity.permissions.includes(permission)) {
      return apiError(c, 403, "forbidden", `requires ${permission}`, identity.role === null ? "no_role_binding" : "missing_permission");
    }
    await next();
  };
}
