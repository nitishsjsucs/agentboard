import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { SearchHit } from "../../../src/shared/api-types.ts";
import { sanitizeQuery } from "../../../src/worker/search/query.ts";
import { distinctRuns, driveAgents, inputFromDataset } from "../../helpers/agents.ts";
import { apiGet, json } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import { startManualRun } from "../../helpers/runs.ts";

interface SearchPage {
  items: SearchHit[];
  nextCursor: string | null;
}

let docCounter = 0;
async function doc(fields: { runId?: string; docType?: SearchHit["docType"]; status?: string; requestType?: string; body: string; createdAt?: string }): Promise<string> {
  docCounter += 1;
  const runId = fields.runId ?? `run_SEARCH${String(docCounter).padStart(18, "0")}`;
  await env.DB.prepare("INSERT INTO search_docs (doc_id, run_id, doc_type, status, request_type, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(`test:${docCounter}`, runId, fields.docType ?? "run", fields.status ?? "succeeded", fields.requestType ?? "address_change", fields.body, fields.createdAt ?? "2026-10-01T00:00:00.000Z")
    .run();
  return runId;
}

async function search(query: string): Promise<SearchPage> {
  const response = await apiGet(P.viewer, `/api/search?${query}`);
  expect(response.status, query).toBe(200);
  return json<SearchPage>(response);
}

describe("history search (D1 FTS5)", { tags: ["history"] }, () => {
  it("ranks with bm25: the document matching more query terms more often comes first", async () => {
    const weak = await doc({ body: "Quillon Brightwater onboarding access" });
    const strong = await doc({ body: "Quillon Brightwater manager change\nmanager change approved for Quillon Brightwater" });
    await doc({ body: "Unrelated address change for someone else" });
    const page = await search("q=quillon%20brightwater%20manager");
    expect(page.items.map((h) => h.runId)).toEqual([strong]);
    const both = await search("q=quillon%20brightwater");
    expect(both.items.map((h) => h.runId)).toEqual([strong, weak]);
    expect(both.items[0]?.score).toBeGreaterThan(both.items[1]?.score ?? Infinity);
  });

  it("filters by document type, status, request type and creation time", async () => {
    const run = await doc({ body: "Ravenscroft filtertest", docType: "run", status: "succeeded", requestType: "offboarding", createdAt: "2026-09-12T10:00:00.000Z" });
    const task = await doc({ body: "Ravenscroft filtertest", docType: "task", status: "failed", requestType: "offboarding", createdAt: "2026-09-20T10:00:00.000Z" });
    const other = await doc({ body: "Ravenscroft filtertest", docType: "run", status: "cancelled", requestType: "address_change", createdAt: "2026-10-02T10:00:00.000Z" });
    const ids = async (extra: string) => (await search(`q=ravenscroft%20filtertest${extra}`)).items.map((h) => h.runId).sort();
    expect(await ids("")).toEqual([run, task, other].sort());
    expect(await ids("&docType=task")).toEqual([task]);
    expect(await ids("&status=cancelled")).toEqual([other]);
    expect(await ids("&type=offboarding")).toEqual([run, task].sort());
    expect(await ids("&from=2026-09-15T00:00:00.000Z&to=2026-09-30T00:00:00.000Z")).toEqual([task]);
  });

  it("returns snippets with U+0002/U+0003 highlight markers and never HTML", async () => {
    await doc({ body: "Pemberton escalation <img src=x onerror=alert(1)> payroll-admin request" });
    const page = await search("q=pemberton%20escalation");
    const snippet = page.items[0]?.snippet ?? "";
    expect(snippet).toContain("\u0002Pemberton\u0003");
    expect(snippet).toContain("\u0002escalation\u0003");
    expect(snippet).not.toContain("<mark>");
    expect(snippet).not.toContain("<b>");
    // Stored text stays text: the snippet carries the raw characters for the UI to render as text.
    expect(snippet).toContain("<img src=x");
  });

  it("pages results with an opaque cursor and no overlap", async () => {
    for (let i = 0; i < 5; i++) await doc({ body: `Thistlewood paging marker ${"extra ".repeat(i)}` });
    const first = await search("q=thistlewood%20paging&limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await search(`q=thistlewood%20paging&limit=2&cursor=${first.nextCursor}`);
    const third = await search(`q=thistlewood%20paging&limit=2&cursor=${second.nextCursor}`);
    const all = [...first.items, ...second.items, ...third.items].map((h) => h.runId);
    expect(all).toHaveLength(5);
    expect(new Set(all).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it("indexes task and tool-call documents written by the coordinator's outbox, without PII", async () => {
    const [run] = distinctRuns("onboarding_access", 1);
    if (!run) throw new Error("no dataset run");
    const { stub, runId } = await startManualRun(inputFromDataset(run, { requester: P.operator }));
    await driveAgents(stub);
    const byName = await search(`q=${encodeURIComponent(run.subjectName)}%20onboarding%20access`);
    expect(byName.items[0]?.runId).toBe(runId);
    expect(byName.items[0]?.docType).toBe("run");
    const ticket = await search("q=itsm%20create%20ticket&docType=tool_call");
    expect(ticket.items.some((h) => h.runId === runId)).toBe(true);
    const tasks = await search("q=grant%20role&docType=task&status=succeeded");
    expect(tasks.items.some((h) => h.runId === runId)).toBe(true);
    const bodies = await env.DB.prepare("SELECT body FROM search_docs WHERE run_id = ?").bind(runId).all<{ body: string }>();
    const text = bodies.results.map((b) => b.body).join("\n");
    expect(text).not.toContain(run.requestText);
    expect(text).not.toMatch(/@example\.test/);
  });

  it("sanitizes FTS syntax: operators, quotes, column filters and prefixes are treated as literal words", async () => {
    await doc({ body: "Yardley sanitize target" });
    expect(sanitizeQuery('Yardley" OR "x')).toBe('"yardley" "or" "x"');
    expect(sanitizeQuery("NEAR(a b)")).toBe('"near" "a" "b"');
    expect(sanitizeQuery("body:yardley*")).toBe('"body" "yardley"');
    expect(sanitizeQuery("  -- ; ' \" ")).toBeNull();
    for (const raw of ['"unbalanced', "NEAR(yardley sanitize)", "body:yardley", "yardley*", "-yardley", "*", "yardley AND", "^yardley"]) {
      const response = await apiGet(P.viewer, `/api/search?q=${encodeURIComponent(raw)}`);
      expect(response.status, raw).toBe(200);
    }
    expect((await search(`q=${encodeURIComponent("yardley*")}`)).items).toHaveLength(1);
    expect((await search(`q=${encodeURIComponent('"yardley" OR "zzz"')}`)).items).toHaveLength(0);
  });
});
