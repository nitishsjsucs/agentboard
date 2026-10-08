// The 100-run simulation in workerd: every dataset request goes through the
// real API, identity, coordinator, local queue, agents and MCP tools, driven
// by the same driver as `npm run eval:sim`.

import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { runSimulation, type SimReport } from "../../src/shared/sim/driver.ts";
import type { SimTransport } from "../../src/shared/sim/transport.ts";
import { APPROVAL_DECISION_COUNTS, EXPECTED_STATUS_COUNTS, generateDataset } from "../../src/shared/synth/generator.ts";
import { verifyRunAudit } from "../../src/worker/audit/hash-chain.ts";
import { signTestJwt } from "../helpers/auth.ts";

const dataset = generateDataset();
let report: SimReport;

function workerdTransport(): SimTransport {
  const tokens = new Map<string, Promise<string>>();
  const token = (principal: string) => {
    let value = tokens.get(principal);
    if (!value) {
      value = signTestJwt(principal, { expiresIn: "2h" });
      tokens.set(principal, value);
    }
    return value;
  };
  return {
    async request(principal, method, path, body) {
      const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await token(principal) };
      if (body !== undefined) Object.assign(headers, { "Content-Type": "application/json", "X-AgentBoard-Client": "web" });
      const response = await exports.default.fetch(`http://127.0.0.1:8784${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

function count<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

describe("100-run simulation (workerd)", { tags: ["sim"] }, () => {
  beforeAll(async () => {
    report = await runSimulation(workerdTransport(), dataset, { concurrency: 8, pollMs: 200, timeoutMs: 840_000 });
  }, 900_000);

  it("D1 holds exactly 100 simulated runs, one per dataset request", async () => {
    expect(report.timedOut).toBe(false);
    expect(report.results.filter((r) => r.error)).toEqual([]);
    const rows = await env.DB.prepare("SELECT synthetic_ref FROM runs WHERE synthetic_ref IS NOT NULL ORDER BY synthetic_ref").all<{ synthetic_ref: string }>();
    expect(rows.results.map((r) => r.synthetic_ref)).toEqual(dataset.runs.map((r) => r.ref));
  });

  it("the terminal distribution equals the expected one, run by run", async () => {
    const mismatches = report.results.filter((r) => r.finalStatus !== r.expectedStatus).map((r) => `${r.ref} ${r.modifier ?? "clean"}: ${r.finalStatus} (expected ${r.expectedStatus})`);
    expect(mismatches).toEqual([]);
    const rows = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM runs WHERE synthetic_ref IS NOT NULL GROUP BY status").all<{ status: string; n: number }>();
    expect(Object.fromEntries(rows.results.map((r) => [r.status, r.n]))).toEqual(EXPECTED_STATUS_COUNTS);
  });

  it("every run has audit events and a valid hash chain", async () => {
    const broken: string[] = [];
    for (const result of report.results) {
      const audit = await verifyRunAudit(env.DB, result.runId);
      if (audit.events.length === 0 || !audit.valid) broken.push(`${result.ref}: ${audit.events.length} events, broken at ${audit.brokenAtSeq}`);
    }
    expect(broken).toEqual([]);
  });

  it("no duplicate side effects: per idempotency key and per (run, step)", async () => {
    const duplicates = await env.PEOPLE_DB.prepare("SELECT COUNT(*) AS n FROM (SELECT idempotency_key FROM side_effects GROUP BY idempotency_key HAVING COUNT(*) > 1)").first<{ n: number }>();
    const logical = await env.PEOPLE_DB.prepare("SELECT COUNT(*) AS n FROM (SELECT run_id, step_id FROM side_effects GROUP BY run_id, step_id HAVING COUNT(*) > 1)").first<{ n: number }>();
    expect(duplicates?.n).toBe(0);
    expect(logical?.n).toBe(0);
    const total = await env.PEOPLE_DB.prepare("SELECT COUNT(*) AS n FROM side_effects").first<{ n: number }>();
    expect(total?.n).toBeGreaterThan(200);
  });

  it("approval counts match the dataset", async () => {
    const rows = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM approvals GROUP BY status").all<{ status: string; n: number }>();
    const byStatus = Object.fromEntries(rows.results.map((r) => [r.status, r.n]));
    expect(byStatus).toEqual({ approved: APPROVAL_DECISION_COUNTS.approve, rejected: APPROVAL_DECISION_COUNTS.reject, pending: APPROVAL_DECISION_COUNTS.pending });
  });

  it("recovery actions match the modifiers", () => {
    const actions = count(report.results.flatMap((r) => r.actions), (a) => a);
    expect(actions).toEqual({ approve: 36, reject: 6, skip_task: 2, cancel: 4, retry_task: 4, raise_budget: 3, pause: 3, resume: 3 });
    for (const result of report.results) {
      const expected: Record<string, string[]> = {
        silent_noop: ["retry_task"],
        budget_exhausted: ["raise_budget"],
        pause_resume: ["pause", "resume"],
        cancel: ["cancel"],
      };
      const want = result.modifier ? expected[result.modifier] : undefined;
      if (want) expect(result.actions.filter((a) => a !== "approve"), result.ref).toEqual(want);
    }
  });
});
