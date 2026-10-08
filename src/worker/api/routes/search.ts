import { Hono } from "hono";
import { SearchQuerySchema } from "../../../shared/api-types.ts";
import { searchDocs } from "../../search/query.ts";
import { requirePermission } from "../middleware/rbac.ts";
import { validate } from "../middleware/validate.ts";
import type { AppEnv } from "../types.ts";

export const searchRoutes = new Hono<AppEnv>().get("/api/search", requirePermission("search:read"), validate("query", SearchQuerySchema), async (c) => {
  const q = c.req.valid("query");
  const cursor = c.req.query("cursor");
  const offset = cursor && /^\d{1,6}$/.test(cursor) ? Number(cursor) : 0;
  const page = await searchDocs(c.env.DB, q.q, { docType: q.docType, status: q.status, type: q.type, from: q.from, to: q.to }, q.limit ?? 20, offset);
  return c.json(page);
});
