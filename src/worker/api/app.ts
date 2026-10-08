import { Hono } from "hono";

export function buildApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "no such route", requestId: crypto.randomUUID() } }, 404),
  );
  return app;
}
