// npm run eval:sim (SPEC section 14.1): the 100-run simulation against
// `wrangler dev` on the built worker (local workerd, local D1, local queues),
// through the same driver as the vitest simulation, over HTTP.
// Writes eval/results/simulation.json.

import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditEventView, DlqMessageView, Page, RunSummary, SearchHit, ToolCallView } from "../src/shared/api-types.ts";
import { runSimulation, ADMIN } from "../src/shared/sim/driver.ts";
import type { SimTransport } from "../src/shared/sim/transport.ts";
import { generateDataset } from "../src/shared/synth/generator.ts";
import { buildLocal, freshState, startBuiltWorker } from "./lib/built-worker.ts";
import { resultMeta, ROOT } from "./lib/meta.ts";
import { percentile } from "./lib/metrics.ts";

const EVAL_STATE = join(ROOT, ".wrangler/eval-state");
const ENV_FILE = join(ROOT, ".dev.vars.eval");
const OUTPUT = join(ROOT, "eval/results/simulation.json");
const LOG = join(ROOT, "eval/results/raw/eval-sim-wrangler.log");

const dataset = generateDataset();
mkdirSync(join(ROOT, "eval/results/raw"), { recursive: true });

// 1. Build (local config only) and record the bundle hash.
const bundleSha256 = buildLocal();

// 2. Fresh local state.
freshState(EVAL_STATE);

// 3. Eval secrets and timing (absolute env file path, checked through /api/health below).
const kid = "eval";
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: "RS256" };
writeFileSync(
  ENV_FILE,
  [
    `INTEGRATION_SIGNING_KEY=${randomBytes(48).toString("base64")}`,
    `ACCESS_DEV_JWKS=${JSON.stringify({ keys: [publicJwk] })}`,
    `DEV_ACCESS_PRIVATE_JWK=${JSON.stringify(privateJwk)}`,
    "ENVIRONMENT=eval",
    "FAULT_INJECTION=on",
    "LLM_PROVIDER=stub",
    "LEASE_TTL_MS=3000",
    "PLANNER_LEASE_TTL_MS=6000",
    "TOOL_TIMEOUT_MS=1000",
    "LLM_TIMEOUT_MS=2000",
    "RETRY_BASE_DELAY_S=1",
    "APPROVAL_TTL_MS=3600000",
    "HOLD_RECHECK_MS=1000",
    "",
  ].join("\n"),
  { mode: 0o600 },
);

const worker = await startBuiltWorker({ persistTo: EVAL_STATE, envFile: ENV_FILE, logFile: LOG });
let exitCode = 0;
try {
  const health = (await (await fetch(`${worker.baseUrl}/api/health`)).json()) as { environment: string; faultInjection: boolean };
  if (health.environment !== "eval" || health.faultInjection !== true) throw new Error(`eval env file was not loaded: ${JSON.stringify(health)}`);

  const signingKey = await importJWK(privateJwk, "RS256");
  const tokens = new Map<string, Promise<string>>();
  const token = (principal: string) => {
    let value = tokens.get(principal);
    if (!value) {
      const claims = principal.startsWith("svc:") ? { common_name: principal.slice(4), sub: "" } : { email: principal, sub: principal };
      value = new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid }).setIssuer("https://agentboard-dev.local").setAudience("agentboard-dev").setIssuedAt().setExpirationTime("4h").sign(signingKey);
      tokens.set(principal, value);
    }
    return value;
  };
  const transport: SimTransport = {
    async request(principal, method, path, body) {
      const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await token(principal) };
      if (body !== undefined) Object.assign(headers, { "Content-Type": "application/json", "X-AgentBoard-Client": "web" });
      const response = await fetch(`${worker.baseUrl}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
  const get = async <T>(path: string): Promise<T> => {
    const response = await transport.request(ADMIN, "GET", path);
    if (response.status !== 200) throw new Error(`GET ${path}: ${response.status}`);
    return response.body as T;
  };

  // 4. Drive all 100 runs (15-minute limit), then collect through the API.
  console.log("eval:sim: driving 100 runs against wrangler dev...");
  const report = await runSimulation(transport, dataset, {
    concurrency: 8,
    pollMs: 300,
    timeoutMs: 900_000,
    onProgress: (r, done, total) => {
      if (done % 10 === 0 || r.finalStatus !== r.expectedStatus) console.log(`  ${done}/${total} ${r.ref} ${r.finalStatus}${r.finalStatus !== r.expectedStatus ? ` (expected ${r.expectedStatus}) ${r.error ?? ""}` : ""}`);
    },
  });

  const runs: RunSummary[] = [];
  for (let cursor: string | null = ""; cursor !== null; ) {
    const page: Page<RunSummary> = await get(`/api/runs?limit=100${cursor ? `&cursor=${cursor}` : ""}`);
    runs.push(...page.items);
    cursor = page.nextCursor;
  }
  const simRuns = runs.filter((r) => r.syntheticRef !== null);
  const byRef = new Map(simRuns.map((r) => [r.syntheticRef ?? "", r]));
  const count = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ((acc[v] = (acc[v] ?? 0) + 1), acc), {});

  let tasksTotal = 0;
  const calls: ToolCallView[] = [];
  const eventsByRun = new Map<string, AuditEventView[]>();
  let chainsValid = 0;
  for (const run of simRuns) {
    const detail = await get<{ tasks: unknown[] }>(`/api/runs/${run.id}`);
    tasksTotal += detail.tasks.length;
    for (let cursor: string | null = ""; cursor !== null; ) {
      const page: Page<ToolCallView> = await get(`/api/runs/${run.id}/tool-calls${cursor ? `?cursor=${cursor}` : ""}`);
      calls.push(...page.items);
      cursor = page.nextCursor;
    }
    const audit = await get<{ events: AuditEventView[]; chain: { valid: boolean } }>(`/api/runs/${run.id}/audit`);
    eventsByRun.set(run.id, audit.events);
    if (audit.chain.valid) chainsValid += 1;
  }
  const allEvents = [...eventsByRun.values()].flat();
  const detail = (e: AuditEventView) => (e.detail ?? {}) as Record<string, unknown>;
  const statusOf = (runId: string) => simRuns.find((r) => r.id === runId)?.status;

  const retried = allEvents.filter((e) => e.action === "task.failed" && detail(e)["willRetry"] === true);
  const runsWithRetry = new Set(retried.map((e) => e.runId ?? ""));
  const expiries = allEvents.filter((e) => e.action === "task.lease_expired");
  const recoveredExpiries = expiries.filter((e) =>
    (eventsByRun.get(e.runId ?? "") ?? []).some((later) => later.seq > e.seq && later.taskId === e.taskId && later.action === "task.succeeded"),
  );
  const refusals = allEvents.filter((e) => e.action === "task.claim_refused" && ["duplicate", "stale_dispatch", "in_flight"].includes(String(detail(e)["reason"])));
  const dlq: DlqMessageView[] = (await get<Page<DlqMessageView>>("/api/dlq")).items;
  const approvalCount = async (status: string) => {
    let total = 0;
    for (let cursor: string | null = ""; cursor !== null; ) {
      const page: Page<unknown> = await get(`/api/approvals?status=${status}&limit=100${cursor ? `&cursor=${cursor}` : ""}`);
      total += page.items.length;
      cursor = page.nextCursor;
    }
    return total;
  };
  const budgetRaised = new Set(allEvents.filter((e) => e.action === "budget.raised").map((e) => e.runId ?? ""));
  const noopSteps = new Set(
    dataset.runs.filter((r) => r.modifier === "silent_noop").map((r) => `${byRef.get(r.ref)?.id}:${r.sim?.faults?.[0]?.stepId}`),
  );
  const verifyFailures = allEvents.filter((e) => e.action === "verify.failed");
  const detections = verifyFailures.filter((e) => noopSteps.has(`${e.runId}:${String(detail(e)["stepId"])}`));
  const recoveryActions = ["run.paused", "run.resumed", "run.cancelled", "task.retried", "task.skipped", "budget.raised", "task.lease_released", "dlq.replayed", "approval.decided"];
  const sideEffects = await get<{ total: number; duplicateKeys: number; logicalDuplicates: number }>("/api/dev/people/side-effects");

  // 6. The 20 known-item queries: hits collapsed to one per run, in rank order.
  const searchLatencies: number[] = [];
  let at1 = 0;
  let at5 = 0;
  for (const q of dataset.searchQueries) {
    const target = byRef.get(q.targetRef)?.id;
    const started = performance.now();
    const page = await get<{ items: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q.query)}&limit=50`);
    searchLatencies.push(performance.now() - started);
    const ranked = [...new Set(page.items.map((h) => h.runId))];
    if (ranked[0] === target) at1 += 1;
    if (ranked.slice(0, 5).includes(target ?? "")) at5 += 1;
  }

  const durations = simRuns
    .filter((r) => r.finishedAt)
    .map((r) => Date.parse(r.finishedAt ?? "") - Date.parse(r.createdAt));
  const outcomeMatch = report.results.filter((r) => r.finalStatus === r.expectedStatus).length;
  const metrics = {
    runs_total: simRuns.length,
    runs_by_status: count(simRuns.map((r) => r.status)),
    runs_by_type: count(simRuns.map((r) => r.requestType)),
    expected_by_status: count(dataset.runs.map((r) => r.expectedStatus)),
    outcome_match: outcomeMatch,
    tasks_total: tasksTotal,
    tool_calls_total: calls.length,
    tool_calls_by_outcome: count(calls.map((c) => c.outcome)),
    replayed_calls: calls.filter((c) => c.outcome === "replayed").length,
    logical_replays: calls.filter((c) => c.outcome === "replayed" && c.logical).length,
    side_effects_total: sideEffects.total,
    duplicate_side_effects: sideEffects.duplicateKeys,
    logical_duplicate_effects: sideEffects.logicalDuplicates,
    task_retries: retried.length,
    runs_recovered_by_retry: [...runsWithRetry].filter((id) => statusOf(id) === "succeeded").length,
    lease_expiries: expiries.length,
    lease_expiry_recoveries: recoveredExpiries.length,
    stale_or_duplicate_deliveries_refused: refusals.length,
    dlq_messages: dlq.length,
    dlq_ignored_stale: dlq.filter((m) => m.outcome === "ignored_stale").length,
    approvals_requested: allEvents.filter((e) => e.action === "approval.requested").length,
    approvals_approved: await approvalCount("approved"),
    approvals_rejected: await approvalCount("rejected"),
    approvals_pending: await approvalCount("pending"),
    budget_exhaustions: allEvents.filter((e) => e.action === "budget.exhausted").length,
    budget_recoveries: [...budgetRaised].filter((id) => statusOf(id) === "succeeded").length,
    verifier_detections: detections.length,
    verifier_injected: noopSteps.size,
    verifier_false_positives: verifyFailures.length - detections.length,
    recovery_actions_by_type: count(allEvents.filter((e) => recoveryActions.includes(e.action)).map((e) => e.action)),
    audit_events_total: allEvents.length,
    audit_chains_valid: chainsValid,
    search_known_item_queries: dataset.searchQueries.length,
    search_known_item_at_1: at1,
    search_known_item_at_5: at5,
    run_duration_ms_p50: percentile(durations, 50),
    run_duration_ms_p95: percentile(durations, 95),
    search_latency_ms_p50: percentile(searchLatencies, 50),
    search_latency_ms_p95: percentile(searchLatencies, 95),
    driver_wall_clock_ms: report.finishedAt - report.startedAt,
  };
  const mismatches = report.results.filter((r) => r.finalStatus !== r.expectedStatus).map((r) => ({ ref: r.ref, modifier: r.modifier, expected: r.expectedStatus, measured: r.finalStatus, error: r.error }));
  const output = {
    meta: { ...resultMeta("stub", "stub-gold-plans"), bundleSha256, environment: "local wrangler dev (workerd, local D1, local queues)", concurrency: 8 },
    metrics,
    mismatches,
    datasetSha256: createHash("sha256").update(JSON.stringify(dataset)).digest("hex"),
  };
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(metrics, null, 2));
  if (simRuns.length !== 100 || outcomeMatch !== 100 || metrics.duplicate_side_effects !== 0 || metrics.logical_duplicate_effects !== 0 || report.timedOut) {
    console.error(`eval:sim: measured outcomes differ from expected-by-construction (${mismatches.length} mismatches)`);
    exitCode = 1;
  }
} finally {
  await worker.stop();
}
process.exit(exitCode);
