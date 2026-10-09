// npm run count:tests (SPEC sections 13.1 and 14.3): counts the tests tagged
// `orchestration` and `authz` with `vitest list --tags-filter` (the --json
// file form; stdout carries sourcemap warnings), runs them with the JSON
// reporter for pass counts, and writes eval/results/tests.json.
//
// --check: lists again (no run) and fails if the counts differ from
// tests.json or from the numbers in the README's results block.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resultMeta, ROOT } from "./lib/meta.ts";

const PROJECTS = ["--project", "worker", "--project", "worker-ws", "--project", "worker-access"];
const RAW = join(ROOT, "eval/results/raw");
const OUTPUT = join(ROOT, "eval/results/tests.json");
mkdirSync(RAW, { recursive: true });

interface Listed {
  name: string;
  file: string;
  projectName: string;
}

function list(tag: string): Listed[] {
  const file = join(RAW, `${tag}.json`);
  execFileSync("npx", ["vitest", "list", ...PROJECTS, `--tags-filter=${tag}`, `--json=${file}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  return JSON.parse(readFileSync(file, "utf8")) as Listed[];
}

const orchestration = list("orchestration");
const authz = list("authz");
const counts = { orchestration: orchestration.length, authz: authz.length, total: orchestration.length + authz.length };

if (process.argv.includes("--check")) {
  if (!existsSync(OUTPUT)) {
    console.error("count:tests --check: eval/results/tests.json is missing; run npm run count:tests");
    process.exit(1);
  }
  const recorded = JSON.parse(readFileSync(OUTPUT, "utf8")) as { orchestration: number; authz: number; total: number };
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const reported = /Tagged tests: (\d+) orchestration \+ (\d+) authorization = (\d+)/.exec(readme);
  const problems: string[] = [];
  for (const key of ["orchestration", "authz", "total"] as const) {
    if (recorded[key] !== counts[key]) problems.push(`tests.json says ${key}=${recorded[key]}, the suite has ${counts[key]}`);
  }
  if (!reported) problems.push("README results block does not report the tagged test counts");
  else if (Number(reported[1]) !== counts.orchestration || Number(reported[2]) !== counts.authz || Number(reported[3]) !== counts.total) {
    problems.push(`README reports ${reported[1]} + ${reported[2]} = ${reported[3]}, the suite has ${counts.orchestration} + ${counts.authz} = ${counts.total}`);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`count:tests --check: ${p}`);
    process.exit(1);
  }
  console.log(`count:tests --check: ${counts.orchestration} orchestration + ${counts.authz} authz = ${counts.total}, matching tests.json and the README`);
  process.exit(0);
}

// Run every tagged test once with the JSON reporter and count passes. The previous
// report is removed first, so a run that dies before writing one can never be
// counted from a stale file.
const runFile = join(RAW, "tagged-run.json");
rmSync(runFile, { force: true });
const runStartedAt = Date.now();
let runExit = 0;
try {
  execFileSync("npx", ["vitest", "run", ...PROJECTS, "--reporter=json", `--outputFile=${runFile}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
} catch (error) {
  // Test failures are counted from the report below; a missing report is fatal.
  runExit = (error as { status?: number }).status ?? 1;
}
interface Report {
  startTime: number;
  testResults: { name: string; assertionResults: { ancestorTitles: string[]; title: string; status: string }[] }[];
}
if (!existsSync(runFile)) {
  console.error(`count:tests: vitest exited ${runExit} without writing ${runFile}`);
  process.exit(1);
}
const report = JSON.parse(readFileSync(runFile, "utf8")) as Report;
if (!(report.startTime >= runStartedAt - 1000)) {
  console.error(`count:tests: ${runFile} predates this run (startTime ${report.startTime}, run started ${runStartedAt})`);
  process.exit(1);
}
const status = new Map<string, string>();
// `vitest list` names a test "describe > test"; the JSON reporter gives ancestor titles and the title.
for (const file of report.testResults) for (const t of file.assertionResults) status.set(`${file.name}::${[...t.ancestorTitles, t.title].join(" > ")}`, t.status);
const passing = (items: Listed[]) => items.filter((t) => status.get(`${t.file}::${t.name}`) === "passed").length;
const output = {
  ...counts,
  passing: passing(orchestration) + passing(authz),
  passingByTag: { orchestration: passing(orchestration), authz: passing(authz) },
  vitestExitCode: runExit,
  meta: resultMeta("n/a", "n/a"),
};
writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
if (output.passing !== output.total || runExit !== 0) process.exit(1);
