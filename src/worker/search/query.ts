// Ranked history search over the FTS5 index (SPEC sections 6.1 and 9).

import type { SearchHit } from "../../shared/api-types.ts";
import type { RequestType } from "../../shared/domain.ts";

/**
 * Turns user input into a safe FTS5 MATCH expression: only letter and digit
 * runs survive, each becomes a quoted literal, and they are ANDed. FTS syntax
 * (quotes, NEAR, column filters, prefixes, operators) can never reach SQLite.
 */
export function sanitizeQuery(raw: string): string | null {
  const tokens = raw.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
  const unique = [...new Set(tokens.map((t) => t.toLowerCase()))].slice(0, 16);
  if (unique.length === 0) return null;
  return unique.map((t) => `"${t}"`).join(" ");
}

export interface SearchFilters {
  docType?: SearchHit["docType"] | undefined;
  status?: string | undefined;
  type?: RequestType | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface SearchPage {
  items: SearchHit[];
  nextCursor: string | null;
}

export const SNIPPET_START = "\u0002";
export const SNIPPET_END = "\u0003";

export async function searchDocs(db: D1Database, query: string, filters: SearchFilters, limit: number, offset: number): Promise<SearchPage> {
  const match = sanitizeQuery(query);
  if (!match) return { items: [], nextCursor: null };
  const clauses = ["search_fts MATCH ?"];
  const params: (string | number)[] = [match];
  if (filters.docType) (clauses.push("d.doc_type = ?"), params.push(filters.docType));
  if (filters.status) (clauses.push("d.status = ?"), params.push(filters.status));
  if (filters.type) (clauses.push("d.request_type = ?"), params.push(filters.type));
  if (filters.from) (clauses.push("d.created_at >= ?"), params.push(filters.from));
  if (filters.to) (clauses.push("d.created_at < ?"), params.push(filters.to));
  const { results } = await db
    .prepare(
      `SELECT d.run_id, d.doc_type, d.status, d.request_type, d.created_at,
              snippet(search_fts, 0, char(2), char(3), '…', 12) AS snippet, bm25(search_fts) AS rank
       FROM search_fts JOIN search_docs d ON d.rowid = search_fts.rowid
       WHERE ${clauses.join(" AND ")}
       ORDER BY rank, d.created_at DESC, d.doc_id LIMIT ? OFFSET ?`,
    )
    .bind(...params, limit + 1, offset)
    .all<{ run_id: string; doc_type: SearchHit["docType"]; status: string | null; request_type: RequestType | null; created_at: string; snippet: string; rank: number }>();
  const items: SearchHit[] = results.slice(0, limit).map((row) => ({
    runId: row.run_id,
    docType: row.doc_type,
    status: row.status,
    requestType: row.request_type,
    snippet: row.snippet,
    score: -row.rank,
    createdAt: row.created_at,
  }));
  return { items, nextCursor: results.length > limit ? String(offset + limit) : null };
}
