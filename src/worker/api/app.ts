import { Hono } from "hono";
import type { Config } from "../config.ts";
import { csrfGuard } from "./middleware/csrf.ts";
import { apiError } from "./middleware/errors.ts";
import { identityMiddleware } from "./middleware/identity.ts";
import { agentRoutes } from "./routes/agents.ts";
import { approvalRoutes } from "./routes/approvals.ts";
import { devRoutes } from "./routes/dev.ts";
import { dlqRoutes } from "./routes/dlq.ts";
import { metricsRoutes } from "./routes/metrics.ts";
import { runRoutes } from "./routes/runs.ts";
import { healthRoutes } from "./routes/health.ts";
import { meRoutes } from "./routes/me.ts";
import type { AppEnv } from "./types.ts";

/** Builds the Hono API for one validated config. */
export function buildApp(config: Config): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("config", config);
    c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
    await next();
  });

  app.use("/api/*", csrfGuard);
  app.route("/", healthRoutes);

  // Public routes (no identity). Dev routes exist only in dev auth mode; in
  // access mode every /api/dev/* path is a plain 404, before identity runs.
  if (config.authMode === "dev") app.route("/", devRoutes());
  else app.all("/api/dev/*", (c) => apiError(c, 404, "not_found", "no such route"));

  // Everything below requires a verified identity.
  app.use("/api/*", identityMiddleware);
  app.route("/", meRoutes);
  app.route("/", runRoutes);
  app.route("/", approvalRoutes);
  app.route("/", agentRoutes);
  app.route("/", dlqRoutes);
  app.route("/", metricsRoutes);

  app.notFound((c) => apiError(c, 404, "not_found", "no such route"));
  app.onError((error, c) => {
    console.error("agentboard api error", error);
    return apiError(c, 500, "internal", "internal error");
  });
  return app;
}
