import { Hono } from "hono";
import type { MetricsSummary } from "../../../shared/api-types.ts";
import { listDirectory } from "../../db/people.ts";
import { requirePermission } from "../middleware/rbac.ts";
import type { AppEnv } from "../types.ts";

export const metricsRoutes = new Hono<AppEnv>()
  .get("/api/metrics/summary", requirePermission("runs:read"), async (c) => {
    const db = c.env.DB;
    const [byStatus, byType, pending, dlq] = await db.batch([
      db.prepare("SELECT status AS k, COUNT(*) AS n FROM runs GROUP BY status"),
      db.prepare("SELECT request_type AS k, COUNT(*) AS n FROM runs GROUP BY request_type"),
      db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'"),
      db.prepare("SELECT COUNT(*) AS n FROM dlq_messages WHERE outcome = 'dead_lettered' AND replayed_at IS NULL"),
    ]);
    const toMap = (rows: unknown[] | undefined) => Object.fromEntries(((rows ?? []) as { k: string; n: number }[]).map((r) => [r.k, r.n]));
    const statusCounts = toMap(byStatus?.results);
    const summary: MetricsSummary = {
      byStatus: statusCounts,
      byType: toMap(byType?.results),
      pendingApprovals: ((pending?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0,
      needsAttention: statusCounts["needs_attention"] ?? 0,
      dlqOpen: ((dlq?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0,
    };
    return c.json(summary);
  })
  // The launch form's subject picker: a read-only directory (id, name, department) of the simulated HRIS.
  .get("/api/people/directory", requirePermission("runs:launch"), async (c) => c.json({ employees: await listDirectory(c.env.PEOPLE_DB) }));
