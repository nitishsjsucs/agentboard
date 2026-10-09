// Dev-only routes (SPEC section 10.3): registered only when AUTH_MODE=dev, and
// each answers 404 unless the request hostname is loopback.

import { validate } from "../middleware/validate.ts";
import { Hono } from "hono";
import { importJWK, SignJWT } from "jose";
import { z } from "zod";
import { ACCESS_COOKIE, isLoopbackRequest } from "../../auth/access.ts";
import { claimsForPrincipal } from "../../auth/principal.ts";
import { appendGlobalAudit, getRoleBinding, listRoleBindings } from "../../db/console.ts";
import { apiError } from "../middleware/errors.ts";
import { identityMiddleware } from "../middleware/identity.ts";
import { requirePermission } from "../middleware/rbac.ts";
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

  app.post("/api/dev/login", validate("json", z.object({ principal: z.string().min(3).max(200) })), async (c) => {
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
  // Sample requests from the synthetic dataset, so the launch form works with the stub planner.
  app.get("/api/dev/samples", identityMiddleware, requirePermission("runs:launch"), async (c) => {
    const { default: dataset } = (await import("../../../../fixtures/synthetic/dataset.v1.json", { with: { type: "json" } })) as {
      default: { runs: { ref: string; requestType: string; subjectEmployeeId: string; requestText: string }[] };
    };
    const samples = dataset.runs.slice(0, 24).map((r) => ({ ref: r.ref, requestType: r.requestType, subjectEmployeeId: r.subjectEmployeeId, requestText: r.requestText }));
    return c.json({ samples });
  });

  // Side-effect counters for the evaluation (admin only; dev mode and loopback only, like every dev route).
  app.get("/api/dev/people/side-effects", identityMiddleware, requirePermission("dlq:replay"), async (c) => {
    const db = c.env.PEOPLE_DB;
    const [total, keys, logical] = await db.batch([
      db.prepare("SELECT COUNT(*) AS n FROM side_effects"),
      db.prepare("SELECT COUNT(*) AS n FROM (SELECT idempotency_key FROM side_effects GROUP BY idempotency_key HAVING COUNT(*) > 1)"),
      db.prepare("SELECT COUNT(*) AS n FROM (SELECT run_id, step_id FROM side_effects GROUP BY run_id, step_id HAVING COUNT(*) > 1)"),
    ]);
    const n = (r: D1Result | undefined) => ((r?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0;
    return c.json({ total: n(total), duplicateKeys: n(keys), logicalDuplicates: n(logical) });
  });
  return app;
}
