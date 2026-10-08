import { Hono } from "hono";
import packageJson from "../../../../package.json" with { type: "json" };
import type { AppEnv } from "../types.ts";

export const healthRoutes = new Hono<AppEnv>().get("/api/health", (c) => {
  const config = c.get("config");
  return c.json({
    ok: true,
    version: packageJson.version,
    environment: config.environment,
    authMode: config.authMode,
    llmProvider: config.llmProvider,
    faultInjection: config.faultInjection,
  });
});
