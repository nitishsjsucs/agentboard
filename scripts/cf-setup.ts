// npm run cf:setup -- --env production|preview [--dry-run] [--redeploy] [--ci --skip-build]
//
// Creates whatever the environment lacks and deploys the committed code. Every
// step checks first, so running it again changes nothing that is in place; the
// deploy is skipped when the deployed version is already this commit and both
// Worker secrets exist (--redeploy forces it). Steps, in order:
//
//   1. D1 databases (wrangler resolves them by name at migration and deploy time)
//   2. the task queue and its dead-letter queue (Free plan: 24-hour retention)
//   3. AI Gateway `agentboard` (logs off, 30 calls a minute)              [token]
//   4. D1 migrations (only pending ones)
//   5. the simulated People seed (only into an empty database) and the
//      agent-role controls (only missing rows)
//   6. Access service tokens for cf:verify and the reusable policies
//      agentboard-people (Allow: owner and persona emails) and
//      agentboard-verify (Service Auth: the two tokens)                 [token]
//   7. role bindings for the personas and the service-token principals
//   8. the vite build for the environment, refused unless the built config
//      is that environment's
//   9. deploy, tagged with the commit, with INTEGRATION_SIGNING_KEY (generated
//      once) and, when the Access application already exists, ACCESS_AUD, sent
//      as secrets through a 0600 temporary file. Without ACCESS_AUD the Worker
//      fails closed: 500 misconfigured on every route.
//  10. the self-hosted Access application for the workers.dev hostname (allowed
//      identity provider: the One-time PIN id; both policies), then a redeploy
//      with its AUD tag as ACCESS_AUD                                       [token]
//  11. an unauthenticated GET that must end at the Access login
//
// [token] steps need CF_API_TOKEN, an account API token with Access: Apps and
// Policies Edit, Access: Service Tokens Edit, AI Gateway Edit and Account
// Analytics Read. Without it they are skipped and the Worker stays fail-closed.
// wrangler never sees that token: it uses its OAuth login (npx wrangler login),
// and every credential variable is removed from its environment.
//
// --dry-run: reads the account (wrangler lists, a SELECT, GET calls), builds
// locally and runs `wrangler deploy --dry-run`, then prints the steps above as
// they would run. It creates, changes and deploys nothing.
//
// --ci (the preview workflow): creates nothing and touches no Access state.
// wrangler authenticates with the workflow's CLOUDFLARE_API_TOKEN. It requires
// the resources and both secrets to exist, applies pending migrations, deploys
// a build made by an earlier step (--skip-build) and checks Access.
//
// No secret is printed. The service tokens' client secrets are written to
// .secrets/cloudflare-service-tokens.json (gitignored, mode 0600) for cf:verify.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { apiFromEnv, type AccessApp, type AccessPolicy, type CloudflareApi } from "./cloudflare/api.ts";
import { builtConfigProblems, readBuiltConfig } from "./cloudflare/built-config.ts";
import { ACCOUNT, API_TOKEN_VAR, VERIFY_TOKENS, environment, parseDeployEnv, serviceTokenFile, type Environment } from "./cloudflare/env.ts";
import {
  GATEWAY_SETTINGS,
  accessAppBody,
  agentControlsSql,
  bindingsSql,
  describeProbe,
  expectedBindings,
  localServiceTokens,
  observe,
  oneTimePinOnly,
  peoplePolicyBody,
  sameInclude,
  setupPlan,
  verifyPolicyBody,
} from "./cloudflare/readiness.ts";
import { applyMigrations, createD1, createQueue, currentVersion, deployBuilt, executeFile, listD1, query, queueInfo, secretNames, useEnvironmentToken, whoami, wranglerEnv } from "./cloudflare/wrangler.ts";
import { isDirty, MEASURED_PATHS, ROOT } from "./lib/meta.ts";
import { commitProvenance, gitIn } from "./lib/provenance.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    redeploy: { type: "boolean", default: false },
    ci: { type: "boolean", default: false },
    "skip-build": { type: "boolean", default: false },
  },
});
const e = environment(parseDeployEnv(values.env));
const ci = values.ci ?? false;
const dryRun = values["dry-run"] ?? false;
const log = (message: string) => console.log(`cf:setup ${e.env}: ${message}`);
function fail(message: string): never {
  console.error(`cf:setup ${e.env}: ${message}`);
  process.exit(1);
}
const now = new Date().toISOString();
const provenance = commitProvenance(gitIn(ROOT), "HEAD", MEASURED_PATHS);
/** cf:verify compares this with HEAD to know which code is deployed. */
const deployMessage = `agentboard ${provenance.gitSha} measured ${provenance.measuredTree.slice("sha256:".length, "sha256:".length + 16)}`;
const deployTag = provenance.gitSha.slice(0, 7);

// 0. Preconditions: committed code and the right login.
const dirty = isDirty();
if (dirty && !dryRun) fail(`uncommitted changes under ${MEASURED_PATHS.join(", ")}; commit them so the deployed code is a commit`);
if (ci) {
  if (!process.env["CLOUDFLARE_API_TOKEN"]) fail("--ci needs CLOUDFLARE_API_TOKEN (the preview workflow's deploy token)");
  useEnvironmentToken();
} else {
  if (process.env["CLOUDFLARE_API_TOKEN"]) log("CLOUDFLARE_API_TOKEN is set in this shell; it is not passed to wrangler, which uses its OAuth login");
  const who = whoami();
  if (!who.loggedIn) fail("wrangler is not logged in: run npx wrangler login");
  if (who.authType !== "OAuth Token") fail(`wrangler authenticates with ${who.authType ?? "an unknown method"}, not its OAuth login`);
  if (!(who.accounts ?? []).some((a) => a.id === ACCOUNT.id)) fail(`wrangler's login does not reach account ${ACCOUNT.id}`);
}
const api = ci ? null : apiFromEnv(e.accountId, API_TOKEN_VAR);
const consoleDb = e.d1.find((d) => d.binding === "DB")?.name ?? "";
const peopleDb = e.d1.find((d) => d.binding === "PEOPLE_DB")?.name ?? "";
const notInCi = (what: string) => fail(`${what}; run npm run cf:setup -- --env ${e.env} locally first (the workflow creates nothing)`);

if (dryRun) {
  if (ci) fail("--dry-run and --ci do not combine");
  log(`dry run: nothing is created, changed or deployed${dirty ? " (the tree has uncommitted changes, so a real run would refuse)" : ""}`);
  if (!api) log(`${API_TOKEN_VAR} is not set: Access and AI Gateway are reported as blocked`);
  const observed = await observe(e, api, { ci: false, probe: true });
  build();
  const checked = deployBuilt({ tag: deployTag, message: deployMessage, secrets: {}, dryRun: true });
  if (!checked.ok) fail("wrangler deploy --dry-run failed");
  log("wrangler deploy --dry-run: the built Worker and its bindings pass wrangler's checks");
  for (const s of setupPlan(observed, e, { token: Boolean(api), deployMessage })) {
    console.log(`  ${s.action === "ok" ? "ok     " : s.action === "do" ? "would  " : "blocked"} ${s.step}: ${s.detail}`);
  }
  process.exit(0);
}
if (!ci && !api) log(`${API_TOKEN_VAR} is not set: the AI Gateway and Access steps are skipped, and the Worker will answer 500 misconfigured until this runs again with the token`);

// 1. D1 databases.
const databases = new Set(listD1(e.env).map((d) => d.name));
for (const d of e.d1) {
  if (databases.has(d.name)) log(`D1 ${d.name}: exists`);
  else if (ci) notInCi(`D1 ${d.name} does not exist`);
  else {
    log(`D1 ${d.name}: creating`);
    createD1(e.env, d.name);
  }
}

// 2. Queues (retention is the Free plan's fixed 24 hours).
for (const name of e.queues) {
  if (queueInfo(e.env, name)) log(`queue ${name}: exists`);
  else if (ci) notInCi(`queue ${name} does not exist`);
  else {
    log(`queue ${name}: creating`);
    createQueue(e.env, name);
  }
}

// 3. AI Gateway (only the id "default" is created on first use; any other id must exist).
if (api && e.aiGatewayId) {
  if (await api.getGateway(e.aiGatewayId)) log(`AI Gateway ${e.aiGatewayId}: exists`);
  else {
    log(`AI Gateway ${e.aiGatewayId}: creating (logs off, ${GATEWAY_SETTINGS.rate_limiting_limit} calls per ${GATEWAY_SETTINGS.rate_limiting_interval} s)`);
    await api.createGateway({ id: e.aiGatewayId, ...GATEWAY_SETTINGS });
  }
}

// 4. Migrations (wrangler applies only pending ones).
for (const d of e.d1) applyMigrations(e.env, d.name);

// 5. Seed the simulated People systems once, and the agent-role controls.
if (!ci) {
  const employees = Number(query<{ n: number }>(e.env, peopleDb, "SELECT COUNT(*) AS n FROM employees")[0]?.n ?? 0);
  if (employees > 0) log(`${peopleDb}: ${employees} employees already seeded`);
  else {
    log(`${peopleDb}: seeding the 60 fictional employees`);
    executeFile(e.env, peopleDb, "seed/people.sql");
  }
  query(e.env, consoleDb, agentControlsSql(now));
}

// 6. Access service tokens and reusable policies (they do not depend on the Worker).
const clientIds: Record<string, string | null> = {};
let policies: AccessPolicy[] = [];
let app: AccessApp | null = null;
if (api) {
  try {
    const tokenIds = await ensureServiceTokens(api, clientIds);
    policies = [await ensurePolicy(api, peoplePolicyBody()), await ensurePolicy(api, verifyPolicyBody(tokenIds))];
    app = (await api.listApps()).find((a) => a.domain === e.hostname) ?? null;
  } catch (error) {
    fail(`Access setup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 7. Role bindings.
if (!ci) {
  const bindings = expectedBindings(clientIds);
  query(e.env, consoleDb, bindingsSql(bindings, now));
  log(`role bindings: ${bindings.map((b) => `${b.principal.startsWith("svc:") ? "svc:<client id>" : b.principal} ${b.role}`).join(", ")}`);
}

// 8 and 9. Build and deploy (skipped when the deployed version is this commit with both secrets).
const deployedVersion = currentVersion(e.env);
const listedSecrets = secretNames(e.env);
// Never mistake a failed listing for a Worker without secrets: that would replace the signing key.
if (listedSecrets === null && deployedVersion !== null) fail(`could not list the secrets of ${e.workerName}`);
const existingSecrets = listedSecrets ?? [];
if (ci) {
  for (const secret of ["INTEGRATION_SIGNING_KEY", "ACCESS_AUD"]) if (!existingSecrets.includes(secret)) notInCi(`the Worker has no ${secret}`);
}
const knownAud = app && /^[0-9a-f]{64}$/.test(app.aud) ? app.aud : null;
const deployedMessage = deployedVersion?.message ?? "";
const upToDate = deployedMessage === deployMessage && existingSecrets.includes("INTEGRATION_SIGNING_KEY") && existingSecrets.includes("ACCESS_AUD");
if (upToDate && !values.redeploy && !ci) {
  log(`deploy: skipped, ${e.workerName} already runs ${deployTag} with both secrets (--redeploy forces it)`);
} else {
  if (!values["skip-build"]) build();
  const secrets: Record<string, string> = {};
  if (!existingSecrets.includes("INTEGRATION_SIGNING_KEY")) secrets["INTEGRATION_SIGNING_KEY"] = randomBytes(48).toString("base64");
  if (knownAud) secrets["ACCESS_AUD"] = knownAud;
  deploy(secrets);
}

// 10. The Access application, then a redeploy with its AUD tag.
if (api) {
  try {
    const ensured = await ensureApp(api, e, policies, app);
    if (!/^[0-9a-f]{64}$/.test(ensured.aud)) fail(`the Access application for ${e.hostname} has no 64-hex AUD tag`);
    if (ensured.aud !== knownAud || !secretNames(e.env)?.includes("ACCESS_AUD")) {
      log("redeploying with the Access application's AUD tag as ACCESS_AUD");
      deploy({ ACCESS_AUD: ensured.aud });
    }
  } catch (error) {
    fail(`Access application setup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 11. What an unauthenticated visitor gets.
const probe = await probeUrl(e);
log(`GET ${e.url}/api/health without credentials: ${probe.text}`);
if (!probe.accessProtected) {
  if (ci || api) fail(`${e.url} is not behind Access`);
  log(`the Worker is deployed without Access and fails closed; run this again with ${API_TOKEN_VAR} to finish`);
}
log(`done. Check with: npm run cf:doctor -- --env ${e.env}${api ? `; measure with: npm run cf:verify -- --env ${e.env}` : ""}`);

// ---------------------------------------------------------------------------

function build(): void {
  log(`building with CLOUDFLARE_ENV=${e.env}`);
  execFileSync("npx", ["vite", "build"], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], env: { ...wranglerEnv(), CLOUDFLARE_ENV: e.env } });
  const problems = builtConfigProblems(readBuiltConfig(), e);
  if (problems.length > 0) fail(`refusing the build: ${problems.join("; ")}`);
}

function deploy(secrets: Record<string, string>): void {
  const built = readBuiltConfig();
  const problems = builtConfigProblems(built, e);
  if (problems.length > 0) fail(`refusing to deploy ${built.path}: ${problems.join("; ")}`);
  const names = Object.keys(secrets);
  log(`deploying ${deployTag}${names.length ? ` with secrets ${names.join(", ")} (values not shown)` : ""}`);
  if (!deployBuilt({ tag: deployTag, message: deployMessage, secrets }).ok) fail("wrangler deploy failed");
}

async function probeUrl(target: Environment): Promise<{ accessProtected: boolean; text: string }> {
  try {
    const response = await fetch(`${target.url}/api/health`, { redirect: "manual" });
    return describeProbe({ status: response.status, location: response.headers.get("location"), body: (await response.text()).slice(0, 300) });
  } catch (error) {
    return describeProbe({ status: 0, location: null, body: error instanceof Error ? error.message : String(error) });
  }
}

/** Creates missing verification tokens, and rotates a token whose secret is not on this machine. Returns their ids. */
async function ensureServiceTokens(client: CloudflareApi, ids: Record<string, string | null>): Promise<string[]> {
  const local = localServiceTokens();
  const existing = await client.listServiceTokens();
  const tokenIds: string[] = [];
  let changed = false;
  for (const t of VERIFY_TOKENS) {
    const found = existing.find((x) => x.name === t.name);
    if (!found) {
      const created = await client.createServiceToken(t.name);
      local[t.name] = { clientId: created.client_id, clientSecret: created.client_secret ?? "" };
      tokenIds.push(created.id);
      ids[t.name] = created.client_id;
      changed = true;
      log(`service token ${t.name}: created`);
    } else {
      if (local[t.name]?.clientId !== found.client_id || !local[t.name]?.clientSecret) {
        const rotated = await client.rotateServiceToken(found.id);
        local[t.name] = { clientId: found.client_id, clientSecret: rotated.client_secret ?? "" };
        changed = true;
        log(`service token ${t.name}: its client secret was not on this machine, so it was rotated`);
      } else log(`service token ${t.name}: exists`);
      tokenIds.push(found.id);
      ids[t.name] = found.client_id;
    }
  }
  if (changed) {
    const file = serviceTokenFile();
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${JSON.stringify(local, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    log(`client secrets written to ${file} (gitignored, mode 0600)`);
  }
  return tokenIds;
}

async function ensurePolicy(client: CloudflareApi, body: Record<string, unknown>): Promise<AccessPolicy> {
  const name = String(body["name"]);
  const found = (await client.listPolicies()).find((p) => p.name === name);
  if (!found) {
    log(`Access policy ${name}: creating`);
    return client.createPolicy(body);
  }
  if (found.decision === body["decision"] && sameInclude(found.include, body["include"] as unknown[])) {
    log(`Access policy ${name}: up to date`);
    return found;
  }
  log(`Access policy ${name}: updating its rules`);
  return client.updatePolicy(found.id, body);
}

/** Creates the application, or brings an existing one (found by hostname) to the wanted IdP and policies. */
async function ensureApp(client: CloudflareApi, target: Environment, wanted: AccessPolicy[], found: AccessApp | null): Promise<AccessApp> {
  const ids = wanted.map((p) => p.id);
  if (!found) {
    log(`Access application for ${target.hostname}: creating (One-time PIN only, policies ${wanted.map((p) => p.name).join(" and ")})`);
    return client.createApp(accessAppBody(target, ids));
  }
  const attached = new Set((found.policies ?? []).map((p) => p.id));
  if (ids.every((id) => attached.has(id)) && oneTimePinOnly(found)) {
    log(`Access application for ${target.hostname}: exists with both policies, One-time PIN only`);
    return found;
  }
  // Keep any other policy someone attached by hand, after ours.
  const others = (found.policies ?? []).map((p) => p.id).filter((id) => !ids.includes(id));
  log(`Access application for ${target.hostname}: updating its identity provider and policies`);
  return client.updateApp(found.id, accessAppBody(target, [...ids, ...others]));
}
