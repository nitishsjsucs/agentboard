// Dev-only routes (SPEC section 10.3): registered only when AUTH_MODE=dev, and
// each answers 404 unless the request hostname is loopback.

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { importJWK, SignJWT } from "jose";
import { z } from "zod";
import { ACCESS_COOKIE, isLoopbackRequest } from "../../auth/access.ts";
import { claimsForPrincipal } from "../../auth/principal.ts";
import { appendGlobalAudit, getRoleBinding, listRoleBindings } from "../../db/console.ts";
import { apiError } from "../middleware/errors.ts";
import type { AppEnv } from "../types.ts";

const DEV_SESSION_SECONDS = 12 * 60 * 60;

export function devRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("/api/dev/*", async (c, next) => {
    if (!isLoopbackRequest(c.req.raw)) return apiError(c, 404, "not_found", "no such route");
    await next();
  });

  app.get("/api/dev/users", async (c) => {
    const bindings = await listRoleBindings(c.env.DB);
    return c.json({ users: bindings.map((b) => ({ principal: b.principal, role: b.role, displayName: b.display_name })) });
  });

  app.post("/api/dev/login", zValidator("json", z.object({ principal: z.string().min(3).max(200) })), async (c) => {
    const config = c.get("config");
    const principal = c.req.valid("json").principal.toLowerCase();
    const binding = await getRoleBinding(c.env.DB, principal);
    if (!binding) return apiError(c, 404, "not_found", "no seeded principal with that id");
    const jwk = config.devAccessPrivateJwk;
    if (!jwk) return apiError(c, 500, "misconfigured", "DEV_ACCESS_PRIVATE_JWK is not set; run npm run dev:keys");
    const key = await importJWK(jwk as Parameters<typeof importJWK>[0], "RS256");
    const kid = typeof jwk["kid"] === "string" ? jwk["kid"] : "dev";
    const token = await new SignJWT(claimsForPrincipal(principal))
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(config.accessTeamDomain)
      .setAudience(config.accessAud)
      .setIssuedAt()
      .setExpirationTime(`${DEV_SESSION_SECONDS}s`)
      .sign(key);
    await appendGlobalAudit(c.env.DB, {
      actorType: principal.startsWith("svc:") ? "service" : "user",
      actorId: principal,
      action: "auth.dev_login",
      detail: { principal, role: binding.role },
    });
    c.header("Set-Cookie", `${ACCESS_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DEV_SESSION_SECONDS}`);
    return c.json({ principal, role: binding.role });
  });
  return app;
}
