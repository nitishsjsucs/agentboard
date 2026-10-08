import { Hono } from "hono";
import type { AppEnv } from "../types.ts";

export const meRoutes = new Hono<AppEnv>().get("/api/me", (c) => {
  const identity = c.get("identity");
  const config = c.get("config");
  return c.json({
    principal: identity.principal,
    role: identity.role,
    permissions: identity.permissions,
    authMode: config.authMode,
    environment: config.environment,
  });
});
