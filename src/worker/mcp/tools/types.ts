import type { McpToolResult } from "../results.ts";

/** One effect statement. Its SQL ends inside a WHERE clause; the ledger appends its ownership and correlation guards. */
export interface EffectStatement {
  sql: string;
  params: (string | number | null)[];
}

/** What a write would do: guarded effect statements and the result to record. */
export interface WritePlan {
  effects: EffectStatement[];
  result: Record<string, unknown>;
}

export type ReadImpl = (db: D1Database, args: Record<string, unknown>) => Promise<McpToolResult>;
export type WriteImpl = (db: D1Database, args: Record<string, unknown>, nowIso: string) => Promise<WritePlan | McpToolResult>;

export function shortId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function isWritePlan(value: WritePlan | McpToolResult): value is WritePlan {
  return Array.isArray((value as WritePlan).effects) && !("structuredContent" in value);
}
