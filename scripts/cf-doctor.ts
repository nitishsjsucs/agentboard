// npm run cf:doctor -- --env production|preview [--ci] [--no-probe]
//
// Read-only: reports exactly what the environment has and lacks, and what to
// run for each missing piece. It creates, changes and deploys nothing. Exit 0
// when everything is in place, 1 otherwise. --ci checks only what the preview
// workflow's deploy needs (wrangler resources and Worker secrets), without the
// Access API token.

import { parseArgs } from "node:util";
import { apiFromEnv } from "./cloudflare/api.ts";
import { API_TOKEN_VAR, environment, parseDeployEnv } from "./cloudflare/env.ts";
import { findings, observe } from "./cloudflare/readiness.ts";

const { values } = parseArgs({ options: { env: { type: "string" }, ci: { type: "boolean", default: false }, "no-probe": { type: "boolean", default: false } } });
const e = environment(parseDeployEnv(values.env));
const api = values.ci ? null : apiFromEnv(e.accountId, API_TOKEN_VAR);
console.log(`cf:doctor ${e.env}: Worker ${e.workerName}, ${e.url}, account ${e.accountId}${values.ci ? " (ci checks only)" : ""}`);
const observed = await observe(e, api, { ci: values.ci ?? false, probe: !values["no-probe"] });
const report = findings(observed, e, { ci: values.ci ?? false });
for (const f of report) console.log(`${f.ok ? "ok     " : "MISSING"} ${f.area}: ${f.detail}${f.ok || !f.fix ? "" : `\n        fix: ${f.fix}`}`);
const missing = report.filter((f) => !f.ok).length;
console.log(missing === 0 ? `cf:doctor: ${e.env} is ready` : `cf:doctor: ${missing} of ${report.length} checks are not satisfied`);
process.exit(missing === 0 ? 0 : 1);
