// Pure helpers for cf:verify: parsing `wrangler tail --format json` output,
// summarizing invocations (outcome, CPU and wall time per kind), and the
// Workers AI neuron bounds. Unit-tested in measure.test.ts.

import { percentile } from "../lib/metrics.ts";

/** Splits concatenated (possibly pretty-printed) JSON values; text outside them is skipped. */
export function splitJsonValues(text: string): unknown[] {
  const values: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          values.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // not JSON after all (a log line with braces); skip it
        }
        start = -1;
      }
    }
  }
  return values;
}

export interface TailEvent {
  outcome?: string;
  executionModel?: string;
  entrypoint?: string;
  cpuTime?: number;
  wallTime?: number;
  event?: Record<string, unknown> | null;
  scriptName?: string | null;
}

/** "worker fetch", "worker queue", "durable object PlannerAgent rpc", and so on. */
export function invocationKind(e: TailEvent): string {
  const ev = e.event ?? {};
  const kind =
    "request" in ev ? "fetch" : "queue" in ev ? "queue" : "rpcMethod" in ev ? "rpc" : "cron" in ev ? "cron" : "scheduledTime" in ev ? "alarm" : "getWebSocketEvent" in ev ? "websocket" : "other";
  const where = e.executionModel === "durableObject" ? `durable object ${e.entrypoint ?? "unknown"}` : "worker";
  return `${where} ${kind}`;
}

export interface KindSummary {
  invocations: number;
  outcomes: Record<string, number>;
  /** Null when the tail events carry no cpuTime. */
  cpu_ms_p50: number | null;
  cpu_ms_p95: number | null;
  cpu_ms_max: number | null;
  wall_ms_p50: number | null;
  wall_ms_max: number | null;
}

export function summarizeTail(events: TailEvent[]): Record<string, KindSummary> {
  const groups = new Map<string, TailEvent[]>();
  for (const e of events) {
    if (typeof e !== "object" || e === null || !("outcome" in e)) continue;
    const key = invocationKind(e);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: Record<string, KindSummary> = {};
  for (const [key, list] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const cpu = list.map((e) => e.cpuTime).filter((v): v is number => typeof v === "number");
    const wall = list.map((e) => e.wallTime).filter((v): v is number => typeof v === "number");
    const outcomes: Record<string, number> = {};
    for (const e of list) outcomes[e.outcome ?? "unknown"] = (outcomes[e.outcome ?? "unknown"] ?? 0) + 1;
    out[key] = {
      invocations: list.length,
      outcomes,
      cpu_ms_p50: cpu.length ? percentile(cpu, 50) : null,
      cpu_ms_p95: cpu.length ? percentile(cpu, 95) : null,
      cpu_ms_max: cpu.length ? Math.max(...cpu) : null,
      wall_ms_p50: wall.length ? percentile(wall, 50) : null,
      wall_ms_max: wall.length ? Math.max(...wall) : null,
    };
  }
  return out;
}

/** Invocations that hit a limit (wrangler tail reports exceededCpu and exceededMemory). */
export function limitOutcomes(summary: Record<string, KindSummary>): number {
  return Object.values(summary).reduce((n, s) => n + (s.outcomes["exceededCpu"] ?? 0) + (s.outcomes["exceededMemory"] ?? 0), 0);
}

/**
 * Workers AI neurons for @cf/qwen/qwen3-30b-a3b-fp8: 4,625 per million input tokens and 30,475 per
 * million output tokens (developers.cloudflare.com/workers-ai/platform/pricing/). Runs record input
 * and output tokens together, so this gives the bounds: all input, or all output.
 */
export function neuronBounds(llmTokens: number): { low: number; high: number } {
  return { low: Math.round((llmTokens * 4625) / 1e6), high: Math.round((llmTokens * 30475) / 1e6) };
}

/**
 * A tail event fit to keep on disk: request headers (they carry the Access JWT and could carry service
 * token credentials) and the request's `cf` properties are dropped; the URL, method and outcome stay.
 */
export function scrubTailEvent(e: TailEvent): TailEvent {
  if (!e.event || typeof e.event["request"] !== "object" || e.event["request"] === null) return e;
  const { headers: _headers, cf: _cf, ...request } = e.event["request"] as Record<string, unknown>;
  return { ...e, event: { ...e.event, request } };
}
