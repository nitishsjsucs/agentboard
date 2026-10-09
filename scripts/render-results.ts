// npm run results:render: rewrites the README block between
// <!-- RESULTS:START --> and <!-- RESULTS:END --> from eval/results/*.json.
// npm run results:check (CI): fails if the README block differs from what the
// JSON renders, if any result is dirty, or if measured code changed after the
// measurement (git diff <gitSha> HEAD over the measured paths).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEASURED_PATHS, ROOT } from "./lib/meta.ts";

const START = "<!-- RESULTS:START -->";
const END = "<!-- RESULTS:END -->";
const README = join(ROOT, "README.md");

interface Meta {
  gitSha: string;
  dirty: boolean;
  generatedAt: string;
  node: string;
  wrangler: string;
  [key: string]: unknown;
}

function load<T>(name: string): (T & { meta: Meta }) | null {
  const file = join(ROOT, "eval/results", name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T & { meta: Meta }) : null;
}

const pct = (value: number, of: number) => `${value}/${of} (${of ? Math.round((value / of) * 1000) / 10 : 0}%)`;
const ms = (value: unknown) => (typeof value === "number" ? `${Math.round(value)} ms` : "n/a");
const day = (iso: string) => iso.slice(0, 10);
const short = (sha: string) => sha.slice(0, 7);

type Sim = {
  metrics: Record<string, unknown> & {
    runs_by_status: Record<string, number>;
    recovery_actions_by_type: Record<string, number>;
    tool_calls_by_outcome: Record<string, number>;
    injected_by_modifier: Record<string, number>;
  };
};
type Planner = { metrics: Record<string, number | null>; meta: Meta & { label: string; gguf: string; quant: string; server_flags: string; llama_cpp_build: string } };
type Tests = { orchestration: number; authz: number; total: number; passing: number };

export function render(): { block: string; metas: { name: string; meta: Meta }[] } {
  const sim = load<Sim>("simulation.json");
  const tests = load<Tests>("tests.json");
  const planners = ["planner-qwen3-1.7b-q4_0.json"].map((name) => ({ name, data: load<Planner>(name) }));
  const metas: { name: string; meta: Meta }[] = [];
  const lines: string[] = [START, ""];

  lines.push("### Simulation (100 synthetic runs, local)");
  if (sim) {
    metas.push({ name: "simulation.json", meta: sim.meta });
    const m = sim.metrics;
    const status = m.runs_by_status;
    const injected = m.injected_by_modifier as Record<string, number> | undefined;
    const faults = injected
      ? ["transient_error", "duplicate_delivery", "crash_after_call", "permanent_error", "silent_noop", "budget_exhausted"]
          .map((k) => `${k} ${injected[k] ?? 0}${k === "transient_error" ? ` (${m["injected_transient_twice"]} of them twice)` : ""}`)
          .join(", ")
      : "not recorded";
    const parked = injected ? ["pause_resume", "cancel"].map((k) => `${k} ${injected[k] ?? 0}`).join(", ") : "not recorded";
    lines.push(
      "",
      `Command: \`npm run eval:sim\` (wrangler dev on the built worker: local workerd, local D1, local queues; stub planner). Measured ${day(sim.meta.generatedAt)} at commit \`${short(sim.meta.gitSha)}\`.`,
      "",
      "| Metric | Value |",
      "|---|---|",
      `| Runs executed | ${m["runs_total"]} |`,
      `| Injected by the seeded dataset: fault directives; checkpoint runs the driver pauses or cancels | ${faults}; ${parked} |`,
      `| Outcome distribution | ${Object.entries(status).sort().map(([k, v]) => `${k} ${v}`).join(", ")} |`,
      `| Outcome match (measured status equals expected) | ${m["outcome_match"]}/100 |`,
      `| Duplicate side effects (per idempotency key) | ${m["duplicate_side_effects"]} |`,
      `| Logical duplicate side effects (per run and step) | ${m["logical_duplicate_effects"]} |`,
      `| Duplicate; missing rows in the simulated domain tables (tickets, notifications, new grants) against applied steps | ${m["domain_duplicate_inserts"]}; ${m["domain_missing_inserts"]} |`,
      `| Tool calls | ${m["tool_calls_total"]} (${Object.entries(m.tool_calls_by_outcome).sort().map(([k, v]) => `${k} ${v}`).join(", ")}) |`,
      `| Ledger replays (of which logical) | ${m["replayed_calls"]} (${m["logical_replays"]}) |`,
      `| Task retries; runs recovered by retry | ${m["task_retries"]}; ${m["runs_recovered_by_retry"]} |`,
      `| Lease expiries; recovered | ${m["lease_expiries"]}; ${m["lease_expiry_recoveries"]} |`,
      `| Refused duplicate or stale deliveries | ${m["stale_or_duplicate_deliveries_refused"]} |`,
      `| Approvals requested; approved, rejected, pending | ${m["approvals_requested"]}; ${m["approvals_approved"]}, ${m["approvals_rejected"]}, ${m["approvals_pending"]} |`,
      `| Budget exhaustions; recoveries | ${m["budget_exhaustions"]}; ${m["budget_recoveries"]} |`,
      `| Silent no-ops detected by the verifier; false positives | ${m["verifier_detections"]}/${m["verifier_injected"]}; ${m["verifier_false_positives"]} |`,
      `| Recovery actions | ${Object.entries(m.recovery_actions_by_type).sort().map(([k, v]) => `${k} ${v}`).join(", ")} |`,
      `| Audit events; runs with a valid hash chain | ${m["audit_events_total"]}; ${m["audit_chains_valid"]}/100 |`,
      `| Search known-item smoke check (20 queries) at 1; at 5 | ${m["search_known_item_at_1"]}/20; ${m["search_known_item_at_5"]}/20 |`,
      `| Run duration p50; p95 (local wall clock) | ${ms(m["run_duration_ms_p50"])}; ${ms(m["run_duration_ms_p95"])} |`,
      `| Search latency p50; p95 (local) | ${ms(m["search_latency_ms_p50"])}; ${ms(m["search_latency_ms_p95"])} |`,
      "",
      "This distribution is fixed by the dataset design; outcome match is the measured agreement. It is not a success rate. Every failure above is injected by the dataset's fault directives, and every approval decision and recovery command is issued by the simulation driver acting as an operator, so the table measures how the system responds to those injected faults. The known-item search check is a smoke test of indexing and ranking (each query is unique by construction), not a retrieval-quality benchmark.",
    );
  } else {
    lines.push("", "Not measured yet.");
  }

  lines.push("", "### Planner (local model)");
  for (const { name, data } of planners) {
    if (!data) {
      lines.push("", `Not measured yet (\`${name}\`).`);
      continue;
    }
    metas.push({ name, meta: data.meta });
    const m = data.metrics;
    const n = Number(m["n"]);
    lines.push(
      "",
      `Command: \`npm run eval:planner\` against llama-server (${data.meta.llama_cpp_build}) serving \`${data.meta.gguf}\` (${data.meta.quant}), launched with \`${data.meta.server_flags}\` (model file, 8192-token context and single slot read back from the server), temperature 0, seed 7, one request at a time. Measured ${day(data.meta.generatedAt)} at commit \`${short(data.meta.gitSha)}\`.`,
      "",
      "| Metric | Value |",
      "|---|---|",
      `| Valid plans, first pass | ${pct(Number(m["valid_first_pass"]), n)} |`,
      `| Valid plans after one repair | ${pct(Number(m["valid_after_repair"]), n)} |`,
      `| Valid plans that contain every write of the gold plan | ${pct(Number(m["valid_with_gold_writes"]), n)} |`,
      `| Invalid after the repair; requests that failed at the transport (timeout or connection) | ${m["plan_invalid"]}; ${m["request_errors"]} |`,
      `| Plans rejected for policy violations | ${m["policy_violations"]} |`,
      `| Tool sequence exactly equal to gold | ${pct(Number(m["tool_sequence_exact"]), n)} |`,
      `| Tool-set F1 (macro) | ${Number(m["tool_set_f1_macro"]).toFixed(3)} |`,
      `| Argument accuracy (gold fields of matched steps) | ${Number(m["arg_accuracy"]).toFixed(3)} |`,
      `| Unknown-tool rate (0 by construction: the output schema enumerates the allowed tools) | ${Number(m["unknown_tool_rate"]).toFixed(3)} |`,
      `| Latency p50; p95 | ${ms(m["latency_ms_p50"])}; ${ms(m["latency_ms_p95"])} |`,
      `| Prompt tokens p50; max | ${m["prompt_tokens_p50"]}; ${m["prompt_tokens_max"]} |`,
    );
  }

  lines.push("", "### Tests");
  if (tests) {
    metas.push({ name: "tests.json", meta: (tests as unknown as { meta: Meta }).meta });
    lines.push(
      "",
      `Command: \`npm run count:tests\`. Measured ${day((tests as unknown as { meta: Meta }).meta.generatedAt)} at commit \`${short((tests as unknown as { meta: Meta }).meta.gitSha)}\`.`,
      "",
      `Tagged tests: ${tests.orchestration} orchestration + ${tests.authz} authorization = ${tests.total}; passing: ${tests.passing}.`,
    );
  } else {
    lines.push("", "Not measured yet.");
  }
  lines.push("", "### Production", "", "Not measured. Nothing has been deployed; every number above comes from local runs.", "", END);
  return { block: lines.join("\n"), metas };
}

function currentBlock(readme: string): string | null {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  return start >= 0 && end > start ? readme.slice(start, end + END.length) : null;
}

const { block, metas } = render();
const readme = readFileSync(README, "utf8");
const existing = currentBlock(readme);
if (process.argv.includes("--check")) {
  const problems: string[] = [];
  if (existing !== block) problems.push("the README results block differs from what eval/results renders (run npm run results:render)");
  for (const { name, meta } of metas) {
    if (meta.dirty) problems.push(`${name} was measured on a dirty tree`);
    try {
      execFileSync("git", ["diff", "--quiet", meta.gitSha, "HEAD", "--", ...MEASURED_PATHS], { cwd: ROOT, stdio: "ignore" });
    } catch {
      problems.push(`${name}: measured code changed since ${meta.gitSha.slice(0, 7)} (re-run the measurement)`);
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`results:check: ${p}`);
    process.exit(1);
  }
  console.log(`results:check: README block matches ${metas.length} result files; none dirty or stale`);
} else {
  if (!existing) throw new Error("README has no results block markers");
  writeFileSync(README, readme.replace(existing, block));
  console.log("results:render: README results block updated");
}
