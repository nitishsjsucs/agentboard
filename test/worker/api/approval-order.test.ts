// GET /api/approvals order: pending soonest expiry first, every other list newest first, each with its
// own cursor. The approval mirror rows are written directly (this file's storage is isolated).

import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { ApprovalListItem, Page } from "../../../src/shared/api-types.ts";
import { apiGet, json } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";

async function insertApproval(id: string, status: string, requestedAt: string, expiresAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO approvals (id, run_id, task_id, generation, tool, summary, risk, requester, status, requested_at, expires_at, version)
     VALUES (?, 'run_order', ?, 0, 'hris.update_manager', ?, 'medium', ?, ?, ?, ?, 1)`,
  )
    .bind(id, `tsk_${id}`, `Change ${id}`, P.operator, status, requestedAt, expiresAt)
    .run();
}

const list = async (principal: string, query: string) => {
  const response = await apiGet(principal, `/api/approvals${query}`);
  return { status: response.status, body: (await response.json()) as Page<ApprovalListItem> & { error?: { code: string; reason?: string } } };
};

/** Every page of a list, one item per page. */
async function walk(principal: string, status: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = "";
  for (let i = 0; cursor !== null && i < 20; i++) {
    const page = await list(principal, `?status=${status}&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
    expect(page.status).toBe(200);
    ids.push(...page.body.items.map((a) => a.id));
    cursor = page.body.nextCursor;
  }
  return ids;
}

beforeAll(async () => {
  // Requested newest first: c, b, a. Expiring soonest first: b, d (same expiry as b, larger id), a, c.
  await insertApproval("apr_o_a", "pending", "2026-10-01T00:00:00.000Z", "2099-03-01T00:00:00.000Z");
  await insertApproval("apr_o_b", "pending", "2026-10-02T00:00:00.000Z", "2099-01-01T00:00:00.000Z");
  await insertApproval("apr_o_c", "pending", "2026-10-03T00:00:00.000Z", "2099-05-01T00:00:00.000Z");
  await insertApproval("apr_o_d", "pending", "2026-09-30T00:00:00.000Z", "2099-01-01T00:00:00.000Z");
  await insertApproval("apr_o_x", "approved", "2026-10-04T00:00:00.000Z", "2099-02-01T00:00:00.000Z");
  await insertApproval("apr_o_y", "approved", "2026-10-05T00:00:00.000Z", "2099-01-15T00:00:00.000Z");
});

describe("approval list order", { tags: ["history"] }, () => {
  it("lists pending approvals soonest expiry first (id breaks ties), page by page with no duplicates or gaps, the same for a viewer and an approver", async () => {
    const expected = ["apr_o_b", "apr_o_d", "apr_o_a", "apr_o_c"];
    expect((await list(P.approver, "?status=pending")).body.items.map((a) => a.id)).toEqual(expected);
    expect(await walk(P.approver, "pending")).toEqual(expected);
    expect(await walk(P.viewer, "pending")).toEqual(expected);
    const viewer = (await list(P.viewer, "?status=pending")).body.items;
    const approver = (await list(P.approver, "?status=pending")).body.items;
    expect(viewer.map((a) => a.canDecide)).toEqual([false, false, false, false]);
    expect(approver.map((a) => a.canDecide)).toEqual([true, true, true, true]);
    expect(viewer.map(({ canDecide: _v, ...rest }) => rest)).toEqual(approver.map(({ canDecide: _a, ...rest }) => rest));
  });

  it("keeps every other list newest first", async () => {
    expect(await walk(P.viewer, "approved")).toEqual(["apr_o_y", "apr_o_x"]);
    expect((await list(P.viewer, "")).body.items.map((a) => a.id)).toEqual(["apr_o_y", "apr_o_x", "apr_o_c", "apr_o_b", "apr_o_a", "apr_o_d"]);
  });

  it("answers 400 to a cursor from the other order, or one that is not a cursor at all", async () => {
    const pendingCursor = (await list(P.viewer, "?status=pending&limit=1")).body.nextCursor;
    const approvedCursor = (await list(P.viewer, "?status=approved&limit=1")).body.nextCursor;
    expect(pendingCursor && approvedCursor).toBeTruthy();
    for (const query of [`?status=approved&cursor=${pendingCursor}`, `?cursor=${pendingCursor}`, `?status=pending&cursor=${approvedCursor}`, "?status=pending&cursor=not-a-cursor"]) {
      const response = await list(P.viewer, query);
      expect(response.status, query).toBe(400);
      expect(response.body.error).toMatchObject({ code: "invalid_request", reason: "invalid_cursor" });
    }
  });
});
