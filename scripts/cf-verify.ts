// npm run cf:verify -- --env production|preview [--no-tail] [--analytics-delay <s>] [--allow-stale]
//
// A small simulation against the DEPLOYED Worker, through Cloudflare Access
// with the two verification service tokens that cf:setup created, and a
// measurement of what the Workers Free plan cannot be checked for locally.
//
//   - Access: an unauthenticated request must end at the Access login; each
//     service token must reach /api/me with its role.
//   - Four synthetic requests chosen to be repeatable (two address changes,
//     an approved manager change and a rejected privileged grant; a rejected
//     run writes nothing before its approval), each planned by Workers AI
//     (production refuses every other planner), executed through the real
//     queue, coordinator, agents and People Ops MCP tools. No fault directives
//     (production refuses them). Four runs cost at most 732 of the 10,000
//     neurons a day that this account's apps share (VERIFY_REFS).
//   - Every run's audit hash chain, re-verified by the API.
//   - Duplicate side effects of these runs, read from the People database's
//     integration ledger with a read-only `wrangler d1 execute` SELECT: per
//     idempotency key, and per run and step.
//   - CPU and limits: `wrangler tail --format json` during the run records
//     every invocation's outcome (exceededCpu, exceededMemory) and, when the
//     events carry them, CPU and wall time per kind (Worker fetch, Worker
//     queue, each Durable Object class). The Free plan's 10 ms CPU limit
//     applies to HTTP requests; this is where it is measured, not asserted.
//     With CF_API_TOKEN (Account Analytics Read) it also reads the GraphQL
//     Analytics API after --analytics-delay seconds (default 120): the Worker's
//     CPU time quantiles in the run's window, Durable Object CPU time, and
//     today's Worker requests and D1 rows read and written, against the Free
//     plan's daily allowances.
//
// It writes eval/results/production.json (rendered into the README by
// results:render) only for production, from a clean tree whose measured
// content is what is deployed (cf:setup records it in the version message);
// otherwise, or with --allow-stale, it writes eval/results/raw/verify-<env>.json.
// Runs that end anywhere unexpected are cancelled so nothing is left working.
// No secret is printed.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { ApprovalListItem, RunDetailResponse } from "../src/shared/api-types.ts";
import { generateDataset } from "../src/shared/synth/generator.ts";
import { apiFromEnv } from "./cloudflare/api.ts";
import { API_TOKEN_VAR, VERIFY_REFS, VERIFY_TOKENS, environment, parseDeployEnv, serviceTokenFile } from "./cloudflare/env.ts";
import { limitOutcomes, neuronBounds, splitJsonValues, summarizeTail, type TailEvent } from "./cloudflare/measure.ts";
import { describeProbe, localServiceTokens } from "./cloudflare/readiness.ts";
import { currentVersion, listD1, query, wranglerEnv } from "./cloudflare/wrangler.ts";
import { isDirty, resultMeta, ROOT } from "./lib/meta.ts";
import { percentile } from "./lib/metrics.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    "no-tail": { type: "boolean", default: false },
    "analytics-delay": { type: "string", default: "120" },
    "allow-stale": { type: "boolean", default: false },
    "timeout-min": { type: "string", default: "10" },
  },
});
const e = environment(parseDeployEnv(values.env));
const log = (message: string) => console.log(`cf:verify ${e.env}: ${message}`);
function fail(message: string): never {
  console.error(`cf:verify ${e.env}: ${message}`);
  process.exit(1);
}

// Credentials: the service tokens cf:setup stored (or AGENTBOARD_VERIFY_<ROLE>_ID / _SECRET).
const stored = localServiceTokens();
const credentials = Object.fromEntries(
  VERIFY_TOKENS.map((t) => {
    const prefix = `AGENTBOARD_VERIFY_${t.role.toUpperCase()}`;
    const id = process.env[`${prefix}_ID`] ?? stored[t.name]?.clientId;
    const secret = process.env[`${prefix}_SECRET`] ?? stored[t.name]?.clientSecret;
    if (!id || !secret) fail(`no credentials for ${t.name}: run npm run cf:setup -- --env ${e.env} with ${API_TOKEN_VAR} (it writes ${serviceTokenFile()})`);
    return [t.role, { id, secret }];
  }),
) as Record<"operator" | "approver", { id: string; secret: string }>;

// Which code is deployed: cf:setup writes "agentboard <sha> measured <16 hex>" into the version message.
const meta = resultMeta("workers-ai", e.workersAiModel);
const version = currentVersion(e.env);
if (!version) fail(`${e.workerName} is not deployed`);
const contentPrefix = meta.measuredTree.slice("sha256:".length, "sha256:".length + 16);
const fresh = version.message.includes(`measured ${contentPrefix}`) && !meta.dirty;
if (!fresh && !values["allow-stale"]) {
  fail(`the deployed version (${version.message || "no message"}) is not this checkout's committed code (measured ${contentPrefix}${meta.dirty ? ", dirty tree" : ""}); deploy it with cf:setup first, or pass --allow-stale to measure anyway (written to eval/results/raw only)`);
}

type Who = "operator" | "approver" | "anonymous";
interface Reply {
  status: number;
  body: unknown;
  location: string | null;
}
const httpStatuses: number[] = [];
async function call(who: Who, method: "GET" | "POST", path: string, body?: unknown): Promise<Reply> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (who !== "anonymous") {
    headers["CF-Access-Client-Id"] = credentials[who].id;
    headers["CF-Access-Client-Secret"] = credentials[who].secret;
  }
  // The API's CSRF guard: JSON, the console's client header, and (when sent) an allowed Origin.
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-AgentBoard-Client"] = "web";
    headers["Origin"] = e.url;
  }
  const response = await fetch(`${e.url}${path}`, { method, headers, redirect: "manual", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  httpStatuses.push(response.status);
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON (an Access page)
  }
  return { status: response.status, body: parsed, location: response.headers.get("location") };
}
async function json<T>(who: Who, method: "GET" | "POST", path: string, body?: unknown, ok = [200, 201]): Promise<T> {
  const reply = await call(who, method, path, body);
  if (!ok.includes(reply.status)) throw new Error(`${method} ${path} as ${who}: HTTP ${reply.status} ${JSON.stringify(reply.body).slice(0, 300)}`);
  return reply.body as T;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. Access and identity.
const anonymous = await call("anonymous", "GET", "/api/health");
const probe = describeProbe({ status: anonymous.status, location: anonymous.location, body: String(anonymous.body).slice(0, 300) });
log(`unauthenticated GET /api/health: ${probe.text}`);
if (!probe.accessProtected) fail("the Worker is not behind Access; run cf:setup with the API token first");
const health = await json<{ environment: string; authMode: string; llmProvider: string; faultInjection: boolean }>("operator", "GET", "/api/health");
if (health.environment !== e.env || health.authMode !== "access" || health.llmProvider !== "workers-ai" || health.faultInjection) fail(`unexpected /api/health: ${JSON.stringify(health)}`);
const identities: Record<string, string | null> = {};
for (const who of ["operator", "approver"] as const) {
  const me = await json<{ role: string | null }>(who, "GET", "/api/me");
  identities[who] = me.role;
  if (me.role !== who) fail(`the ${who} service token is bound to role ${me.role}; run cf:setup again`);
}
log("Access: both service tokens reach the Worker with their roles");

// 2. Tail every invocation while the simulation runs.
const tailText: string[] = [];
let tail: ReturnType<typeof spawn> | null = null;
if (!values["no-tail"]) {
  tail = spawn("npx", ["wrangler", "tail", e.workerName, "--format", "json", "--config", "wrangler.jsonc", "--env", e.env], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: wranglerEnv(),
  });
  tail.stdout?.on("data", (chunk: Buffer) => tailText.push(chunk.toString()));
  tail.stderr?.on("data", () => undefined);
  await sleep(10_000);
  log("wrangler tail started");
}
function stopTail(): void {
  if (tail?.pid && tail.exitCode === null) {
    try {
      process.kill(-tail.pid, "SIGTERM");
    } catch {
      tail.kill("SIGTERM");
    }
  }
}
process.on("exit", stopTail);

// 3. The simulation.
interface RunResult {
  ref: string;
  requestType: string;
  runId: string;
  expectedStatus: string;
  finalStatus: string;
  statusReason: string | null;
  decisions: string[];
  cancelledByVerify: boolean;
  durationMs: number;
  llmTokens: number;
  toolCalls: number;
  auditChainValid: boolean | null;
  error: string | null;
}
const runs = generateDataset().runs.filter((r) => VERIFY_REFS.includes(r.ref));
const prefix = `verify-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-`;
const deadline = Date.now() + Number(values["timeout-min"]) * 60_000;
const startedAt = new Date();

async function drive(run: (typeof runs)[number]): Promise<RunResult> {
  const started = Date.now();
  const result: RunResult = {
    ref: run.ref,
    requestType: run.requestType,
    runId: "",
    expectedStatus: run.expectedStatus,
    finalStatus: "error",
    statusReason: null,
    decisions: [],
    cancelledByVerify: false,
    durationMs: 0,
    llmTokens: 0,
    toolCalls: 0,
    auditChainValid: null,
    error: null,
  };
  try {
    const launched = await json<{ runId: string }>("operator", "POST", "/api/runs", {
      clientRequestId: `${prefix}${run.ref}`,
      requestType: run.requestType,
      requestText: run.requestText,
      subjectEmployeeId: run.subjectEmployeeId,
      priority: run.priority,
    });
    result.runId = launched.runId;
    const decided = new Set<string>();
    while (Date.now() < deadline) {
      const detail = await json<RunDetailResponse>("operator", "GET", `/api/runs/${result.runId}`);
      const status = detail.run.status;
      result.statusReason = detail.run.statusReason;
      result.llmTokens = detail.run.usage.llmTokens;
      if (["succeeded", "rejected", "cancelled"].includes(status)) {
        result.finalStatus = status;
        break;
      }
      for (const approval of detail.approvals.filter((a: ApprovalListItem) => a.status === "pending" && !decided.has(a.id))) {
        const decision = run.approval && run.approval.decision !== "pending" ? run.approval.decision : "reject";
        await json("approver", "POST", `/api/approvals/${approval.id}/decision`, { decision, note: `cf:verify ${decision}s as the dataset prescribes` });
        decided.add(approval.id);
        result.decisions.push(decision);
      }
      if (status === "needs_attention") {
        // A planning or execution failure: record it, and stop the run so nothing keeps working.
        result.finalStatus = status;
        await json("operator", "POST", `/api/runs/${result.runId}/cancel`, { reason: "cf:verify: the run needs attention; cancelling it to leave nothing running" }, [200, 409]);
        result.cancelledByVerify = true;
        break;
      }
      await sleep(3000);
    }
    if (result.finalStatus === "error") {
      result.finalStatus = "timeout";
      await json("operator", "POST", `/api/runs/${result.runId}/cancel`, { reason: "cf:verify: did not settle before the deadline" }, [200, 409]);
      result.cancelledByVerify = true;
    }
    const audit = await json<{ chain: { valid: boolean } }>("operator", "GET", `/api/runs/${result.runId}/audit`);
    result.auditChainValid = audit.chain.valid;
    const calls = await json<{ items: unknown[] }>("operator", "GET", `/api/runs/${result.runId}/tool-calls`);
    result.toolCalls = calls.items.length;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  result.durationMs = Date.now() - started;
  log(`${run.ref} ${run.requestType}: ${result.finalStatus} (expected ${run.expectedStatus})${result.error ? `, error ${result.error}` : ""}`);
  return result;
}

const results: RunResult[] = [];
const queue = [...runs];
await Promise.all(
  Array.from({ length: 2 }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next) results.push(await drive(next));
    }
  }),
);
results.sort((a, b) => a.ref.localeCompare(b.ref));
const finishedAt = new Date();

// 4. Stop the tail after late events (queue consumers, alarms) have arrived.
let tailSummary: ReturnType<typeof summarizeTail> | null = null;
if (tail) {
  await sleep(20_000);
  stopTail();
  await sleep(1000);
  const events = splitJsonValues(tailText.join("")) as TailEvent[];
  tailSummary = summarizeTail(events);
  mkdirSync(join(ROOT, "eval/results/raw"), { recursive: true });
  writeFileSync(join(ROOT, `eval/results/raw/verify-${e.env}-tail.json`), `${JSON.stringify(events, null, 2)}\n`);
  log(`wrangler tail: ${events.length} events`);
}

// 5. Duplicate side effects of these runs, from the integration ledger (read-only SELECTs).
const runIds = results.map((r) => r.runId).filter((id) => /^[A-Za-z0-9_-]+$/.test(id));
const peopleDb = e.d1.find((d) => d.binding === "PEOPLE_DB")?.name ?? "";
let sideEffects: { rows: number; duplicateKeys: number; logicalDuplicates: number } | { error: string } = { error: "no runs" };
if (runIds.length > 0) {
  const inList = runIds.map((id) => `'${id}'`).join(", ");
  try {
    const [row] = query<{ rows: number; duplicate_keys: number; logical_duplicates: number }>(
      e.env,
      peopleDb,
      `SELECT (SELECT COUNT(*) FROM side_effects WHERE run_id IN (${inList})) AS rows,
              (SELECT COUNT(*) FROM (SELECT idempotency_key FROM side_effects WHERE run_id IN (${inList}) GROUP BY idempotency_key HAVING COUNT(*) > 1)) AS duplicate_keys,
              (SELECT COUNT(*) FROM (SELECT run_id, step_id FROM side_effects WHERE run_id IN (${inList}) GROUP BY run_id, step_id HAVING COUNT(*) > 1)) AS logical_duplicates`,
    );
    sideEffects = { rows: Number(row?.rows ?? 0), duplicateKeys: Number(row?.duplicate_keys ?? 0), logicalDuplicates: Number(row?.logical_duplicates ?? 0) };
  } catch (error) {
    sideEffects = { error: error instanceof Error ? error.message : String(error) };
  }
}

// 6. GraphQL Analytics (optional: CF_API_TOKEN with Account Analytics Read).
const api = apiFromEnv(e.accountId, API_TOKEN_VAR);
const delay = Number(values["analytics-delay"]);
const analytics: Record<string, unknown> = {};
if (api && delay > 0) {
  log(`waiting ${delay} s for the analytics to catch up`);
  await sleep(delay * 1000);
  const windowStart = new Date(startedAt.getTime() - 60_000).toISOString();
  const windowEnd = new Date().toISOString();
  const today = windowEnd.slice(0, 10);
  const databaseIds = Object.fromEntries(listD1(e.env).filter((d) => e.d1.some((x) => x.name === d.name)).map((d) => [d.uuid, d.name]));
  const queries: Record<string, [string, Record<string, unknown>]> = {
    // CPU time quantiles of the Worker's own invocations (fetch and queue) in the run's window.
    workerWindow: [
      `query ($accountTag: string, $start: string, $end: string, $script: string) { viewer { accounts(filter: {accountTag: $accountTag}) {
        workersInvocationsAdaptive(limit: 100, filter: {scriptName: $script, datetime_geq: $start, datetime_leq: $end}) {
          sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { status } } } } }`,
      { accountTag: e.accountId, start: windowStart, end: windowEnd, script: e.workerName },
    ],
    // Today's Worker requests against the Free plan's 100,000 a day (this Worker only).
    workerToday: [
      `query ($accountTag: string, $date: string, $script: string) { viewer { accounts(filter: {accountTag: $accountTag}) {
        workersInvocationsAdaptive(limit: 100, filter: {scriptName: $script, date: $date}) { sum { requests errors } dimensions { status } } } } }`,
      { accountTag: e.accountId, date: today, script: e.workerName },
    ],
    durableObjectsCpu: [
      `query ($accountTag: string, $start: string, $end: string) { viewer { accounts(filter: {accountTag: $accountTag}) {
        durableObjectsPeriodicGroups(limit: 100, filter: {datetimeMinute_geq: $start, datetimeMinute_leq: $end}) { sum { cpuTime } dimensions { namespaceId } } } } }`,
      { accountTag: e.accountId, start: windowStart, end: windowEnd },
    ],
    // Today's D1 rows against the Free plan's 5 million read and 100,000 written a day (account-wide limits).
    d1Today: [
      `query ($accountTag: string, $date: string) { viewer { accounts(filter: {accountTag: $accountTag}) {
        d1AnalyticsAdaptiveGroups(limit: 100, filter: {date_geq: $date, date_leq: $date}) { sum { readQueries writeQueries rowsRead rowsWritten } dimensions { databaseId } } } } }`,
      { accountTag: e.accountId, date: today },
    ],
  };
  for (const [name, [text, variables]] of Object.entries(queries)) {
    try {
      analytics[name] = await api.graphql(text, variables);
    } catch (error) {
      analytics[name] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  analytics["d1DatabaseNames"] = databaseIds;
  analytics["note"] = "cpuTime values are the GraphQL API's raw numbers (the schema's unit, microseconds for workersInvocationsAdaptive); the Worker window covers this run, the daily figures cover the whole UTC day";
}

// 7. Metrics, verdicts and the result file.
const byStatus: Record<string, number> = {};
for (const r of results) byStatus[r.finalStatus] = (byStatus[r.finalStatus] ?? 0) + 1;
const durations = results.map((r) => r.durationMs);
const llmTokens = results.reduce((n, r) => n + r.llmTokens, 0);
const serverErrors = httpStatuses.filter((s) => s >= 500).length;
const limitHits = tailSummary ? limitOutcomes(tailSummary) : null;
const workerFetch = tailSummary?.["worker fetch"];
const metrics = {
  runs_total: results.length,
  outcome_match: results.filter((r) => r.finalStatus === r.expectedStatus).length,
  runs_by_status: byStatus,
  runs_cancelled_by_verify: results.filter((r) => r.cancelledByVerify).length,
  run_errors: results.filter((r) => r.error).length,
  audit_chains_valid: results.filter((r) => r.auditChainValid).length,
  side_effects: sideEffects,
  tool_calls_total: results.reduce((n, r) => n + r.toolCalls, 0),
  run_duration_ms_p50: percentile(durations, 50),
  run_duration_ms_p95: percentile(durations, 95),
  http_requests: httpStatuses.length,
  http_5xx: serverErrors,
  access_unauthenticated: probe.text,
  identities,
  llm_tokens_total: llmTokens,
  neurons_estimate: neuronBounds(llmTokens),
  invocations_by_kind: tailSummary,
  invocations_hitting_a_limit: limitHits,
  worker_fetch_cpu_ms_max: workerFetch?.cpu_ms_max ?? null,
  analytics: api && delay > 0 ? analytics : "not read (needs CF_API_TOKEN with Account Analytics Read)",
};
const output = {
  meta: { ...meta, environment: e.env, url: e.url, deployedVersion: version.id, deployedMessage: version.message, fresh, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() },
  metrics,
  runs: results,
};
const recordable = e.env === "production" && fresh && !values["allow-stale"];
const file = recordable ? join(ROOT, "eval/results/production.json") : join(ROOT, `eval/results/raw/verify-${e.env}.json`);
mkdirSync(join(ROOT, "eval/results/raw"), { recursive: true });
writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
log(`wrote ${file}`);

const infrastructureProblems = [
  ...(serverErrors > 0 ? [`${serverErrors} responses were 5xx`] : []),
  ...(limitHits ? [`${limitHits} invocations exceeded a CPU or memory limit`] : []),
  ...(metrics.audit_chains_valid !== results.length ? ["an audit chain did not verify"] : []),
  ...("error" in sideEffects ? [`side effects not read: ${sideEffects.error}`] : sideEffects.duplicateKeys + sideEffects.logicalDuplicates > 0 ? [`duplicate side effects: ${sideEffects.duplicateKeys} keys, ${sideEffects.logicalDuplicates} run steps`] : []),
  ...results.filter((r) => r.finalStatus === "timeout" || r.error).map((r) => `${r.ref}: ${r.error ?? "timed out"}`),
];
log(`outcome match ${metrics.outcome_match}/${results.length}; statuses ${JSON.stringify(byStatus)}; ${metrics.tool_calls_total} tool calls; neurons ${metrics.neurons_estimate.low} to ${metrics.neurons_estimate.high} of the 10,000 a day`);
log("error" in sideEffects ? `side effects: not read (${sideEffects.error})` : `side effects: ${sideEffects.rows} ledger rows; duplicates ${sideEffects.duplicateKeys} per idempotency key, ${sideEffects.logicalDuplicates} per run and step`);
log(
  tailSummary
    ? `CPU: ${limitHits} invocations hit a limit; Worker fetch CPU max ${workerFetch?.cpu_ms_max ?? "not reported"} ms against the Free plan's 10 ms`
    : "CPU: not measured (--no-tail)",
);
if (infrastructureProblems.length > 0) fail(`problems: ${infrastructureProblems.join("; ")}`);
log("no infrastructure problem found; planner outcomes are reported above as measured");
