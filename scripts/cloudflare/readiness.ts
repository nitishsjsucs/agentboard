// What a deployed environment has and lacks. `observe` only reads (wrangler
// list and info commands, a SELECT through `wrangler d1 execute`, GET calls to
// the Cloudflare API, and one unauthenticated GET of the Worker's URL);
// `findings` turns that into the report cf-doctor prints, and is pure so it is
// unit-tested.

import { existsSync, readFileSync } from "node:fs";
import { API_TOKEN_PERMISSIONS, API_TOKEN_VAR, ACCESS_POLICIES, ACCOUNT, PERSONAS, VERIFY_TOKENS, FREE_QUEUE_RETENTION_SECONDS, serviceTokenFile, type Environment } from "./env.ts";
import type { CloudflareApi } from "./api.ts";
import { currentVersion, listD1, pendingMigrations, query, queueInfo, secretNames, whoami } from "./wrangler.ts";

export interface Observed {
  wrangler: { loggedIn: boolean; authType: string | null; accountMatches: boolean };
  d1: { name: string; exists: boolean; pendingMigrations: string[] | null }[];
  queues: { name: string; exists: boolean; consumers: string[] }[];
  /** null: not checked (the database is missing). */
  peopleRows: number | null;
  agentControlRows: number | null;
  /** Principals that lack their role binding; null when not checked. */
  missingBindings: string[] | null;
  worker: { exists: boolean; secrets: string[]; version: { id: string; message: string; tag: string } | null };
  /** null: CF_API_TOKEN is not set, so Access and AI Gateway were not checked. */
  api: null | {
    error: string | null;
    gateway: boolean | null;
    policies: Record<string, boolean>;
    serviceTokens: { name: string; exists: boolean; localSecret: boolean; clientId: string | null }[];
    app: { exists: boolean; audIsTag: boolean; policiesAttached: boolean; oneTimePinOnly: boolean } | null;
  };
  /** One unauthenticated GET of /api/health; null when skipped. */
  probe: { status: number; location: string | null; body: string } | null;
}

export interface Finding {
  area: string;
  ok: boolean;
  detail: string;
  /** What to run or do when not ok. */
  fix?: string;
}

export function localServiceTokens(): Record<string, { clientId: string; clientSecret: string }> {
  const file = serviceTokenFile();
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, { clientId: string; clientSecret: string }>;
}

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** svc:<client id> for an Access service token, as principalFromClaims names it. */
export const servicePrincipal = (clientId: string) => `svc:${clientId.trim().toLowerCase()}`;

/** Every principal cf-setup binds, with its role and display name. */
export function expectedBindings(serviceClientIds: Record<string, string | null>): { principal: string; role: string; displayName: string }[] {
  const people = PERSONAS.map((p) => ({ principal: p.email.toLowerCase(), role: p.role, displayName: p.displayName }));
  const services = VERIFY_TOKENS.flatMap((t) => {
    const clientId = serviceClientIds[t.name];
    return clientId ? [{ principal: servicePrincipal(clientId), role: t.role, displayName: t.displayName }] : [];
  });
  return [...people, ...services];
}

/** Idempotent upsert of the role bindings: a binding that already has its role is left untouched. */
export function bindingsSql(bindings: { principal: string; role: string; displayName: string }[], now: string): string {
  return bindings
    .map(
      (b) =>
        `INSERT INTO role_bindings (principal, role, display_name, created_at, updated_at, updated_by) VALUES (${sqlString(b.principal)}, ${sqlString(b.role)}, ${sqlString(b.displayName)}, ${sqlString(now)}, ${sqlString(now)}, 'cf-setup') ` +
        `ON CONFLICT(principal) DO UPDATE SET role = excluded.role, display_name = excluded.display_name, updated_at = excluded.updated_at, updated_by = 'cf-setup' WHERE role_bindings.role IS NOT excluded.role;`,
    )
    .join("\n");
}

/** The three agent roles, enabled; rows that exist (perhaps disabled by an admin) are left alone. */
export function agentControlsSql(now: string): string {
  return ["planner", "executor", "verifier"]
    .map((role) => `INSERT OR IGNORE INTO agent_controls (role, disabled, reason, updated_by, updated_at) VALUES ('${role}', 0, NULL, 'cf-setup', ${sqlString(now)});`)
    .join("\n");
}

export const GATEWAY_SETTINGS = {
  cache_ttl: 0,
  cache_invalidate_on_update: false,
  // Planner prompts carry request text; the provider also sends collectLog: false per request.
  collect_logs: false,
  // Caps model calls at 30 a minute, so a retry storm cannot burn the Free plan's 10,000 daily neurons in minutes.
  rate_limiting_interval: 60,
  rate_limiting_limit: 30,
  rate_limiting_technique: "fixed",
} as const;

export function peoplePolicyBody(): Record<string, unknown> {
  return { name: ACCESS_POLICIES.people, decision: "allow", include: PERSONAS.map((p) => ({ email: { email: p.email } })), session_duration: "24h" };
}

export function verifyPolicyBody(tokenIds: string[]): Record<string, unknown> {
  return { name: ACCESS_POLICIES.verify, decision: "non_identity", include: tokenIds.map((id) => ({ service_token: { token_id: id } })) };
}

/**
 * The self-hosted Access application for one environment's workers.dev hostname (hostname-based, not
 * Worker-level: Worker-level Access refuses WebSocket upgrades, and the console's live view is one).
 * Sign-in is the One-time PIN identity provider only, chosen without a picker; the reusable policies
 * decide who gets in (the persona emails, and the verification service tokens through Service Auth).
 */
export function accessAppBody(e: Environment, policyIds: string[]): Record<string, unknown> {
  return {
    name: e.accessAppName,
    type: "self_hosted",
    domain: e.hostname,
    destinations: [{ type: "public", uri: e.hostname }],
    allowed_idps: [ACCOUNT.oneTimePinIdpId],
    auto_redirect_to_identity: true,
    session_duration: "24h",
    app_launcher_visible: false,
    policies: policyIds.map((id, i) => ({ id, precedence: i + 1 })),
  };
}

/** Whether a policy's include rules already equal the wanted ones (order-insensitive). */
export function sameInclude(have: unknown[], want: unknown[]): boolean {
  const key = (rules: unknown[]) => rules.map((r) => JSON.stringify(r)).sort().join("|");
  return key(have) === key(want);
}

export async function observe(e: Environment, api: CloudflareApi | null, options: { ci: boolean; probe: boolean }): Promise<Observed> {
  const who = options.ci ? { loggedIn: true, authType: "CLOUDFLARE_API_TOKEN (not checked in CI)" } : whoami();
  const wranglerState = {
    loggedIn: who.loggedIn,
    authType: who.authType ?? null,
    // An account-scoped API token (CI) may not list memberships; account_id in wrangler.jsonc pins the account anyway.
    accountMatches: options.ci || ("accounts" in who && (who.accounts ?? []).some((a) => a.id === ACCOUNT.id)),
  };
  const existing = new Set(listD1(e.env).map((d) => d.name));
  const d1 = e.d1.map((d) => ({
    name: d.name,
    exists: existing.has(d.name),
    pendingMigrations: existing.has(d.name) ? pendingMigrations(e.env, d.name) : null,
  }));
  const queues = e.queues.map((name) => {
    const info = queueInfo(e.env, name);
    return { name, exists: info !== null, consumers: info?.consumers ?? [] };
  });
  const consoleDb = e.d1.find((d) => d.binding === "DB")?.name ?? "";
  const peopleDb = e.d1.find((d) => d.binding === "PEOPLE_DB")?.name ?? "";
  const migrated = (name: string) => d1.some((d) => d.name === name && d.exists && d.pendingMigrations?.length === 0);
  const peopleRows = migrated(peopleDb) ? Number(query<{ n: number }>(e.env, peopleDb, "SELECT COUNT(*) AS n FROM employees")[0]?.n ?? 0) : null;
  const agentControlRows = migrated(consoleDb) ? Number(query<{ n: number }>(e.env, consoleDb, "SELECT COUNT(*) AS n FROM agent_controls")[0]?.n ?? 0) : null;
  const secrets = secretNames(e.env);
  const worker = { exists: secrets !== null, secrets: secrets ?? [], version: secrets !== null ? currentVersion(e.env) : null };

  let apiState: Observed["api"] = null;
  const clientIds: Record<string, string | null> = {};
  if (api) {
    apiState = { error: null, gateway: null, policies: {}, serviceTokens: [], app: null };
    try {
      apiState.gateway = e.aiGatewayId ? (await api.getGateway(e.aiGatewayId)) !== null : true;
      const local = localServiceTokens();
      const tokens = await api.listServiceTokens();
      for (const t of VERIFY_TOKENS) {
        const found = tokens.find((x) => x.name === t.name);
        clientIds[t.name] = found?.client_id ?? null;
        apiState.serviceTokens.push({ name: t.name, exists: Boolean(found), localSecret: Boolean(found && local[t.name]?.clientId === found.client_id), clientId: found?.client_id ?? null });
      }
      const policies = await api.listPolicies();
      const people = policies.find((p) => p.name === ACCESS_POLICIES.people);
      const verify = policies.find((p) => p.name === ACCESS_POLICIES.verify);
      const tokenIds = tokens.filter((x) => VERIFY_TOKENS.some((t) => t.name === x.name)).map((x) => x.id);
      apiState.policies[ACCESS_POLICIES.people] = Boolean(people && people.decision === "allow" && sameInclude(people.include, peoplePolicyBody()["include"] as unknown[]));
      apiState.policies[ACCESS_POLICIES.verify] = Boolean(verify && verify.decision === "non_identity" && tokenIds.length === VERIFY_TOKENS.length && sameInclude(verify.include, verifyPolicyBody(tokenIds)["include"] as unknown[]));
      const app = (await api.listApps()).find((a) => a.domain === e.hostname);
      const attached = new Set((app?.policies ?? []).map((p) => p.id));
      apiState.app = app
        ? {
            exists: true,
            audIsTag: /^[0-9a-f]{64}$/.test(app.aud ?? ""),
            policiesAttached: Boolean(people && verify && attached.has(people.id) && attached.has(verify.id)),
            oneTimePinOnly: oneTimePinOnly(app),
          }
        : { exists: false, audIsTag: false, policiesAttached: false, oneTimePinOnly: false };
    } catch (error) {
      apiState.error = error instanceof Error ? error.message : String(error);
    }
  }

  let missingBindings: string[] | null = null;
  if (migrated(consoleDb)) {
    const wanted = expectedBindings(clientIds);
    const have = new Map(query<{ principal: string; role: string }>(e.env, consoleDb, "SELECT principal, role FROM role_bindings").map((r) => [r.principal, r.role]));
    missingBindings = wanted.filter((b) => have.get(b.principal) !== b.role).map((b) => `${b.principal} (${b.role})`);
  }

  let probe: Observed["probe"] = null;
  if (options.probe) {
    try {
      const response = await fetch(`${e.url}/api/health`, { redirect: "manual" });
      probe = { status: response.status, location: response.headers.get("location"), body: (await response.text()).slice(0, 300) };
    } catch (error) {
      probe = { status: 0, location: null, body: error instanceof Error ? error.message : String(error) };
    }
  }
  return { wrangler: wranglerState, d1, queues, peopleRows, agentControlRows, missingBindings, worker, api: apiState, probe };
}

/** The application lets people sign in only with the One-time PIN provider. */
export function oneTimePinOnly(app: { allowed_idps?: string[] }): boolean {
  const idps = app.allowed_idps ?? [];
  return idps.length === 1 && idps[0] === ACCOUNT.oneTimePinIdpId;
}

/** Describes what an unauthenticated request to the Worker's URL got. */
export function describeProbe(probe: NonNullable<Observed["probe"]>): { accessProtected: boolean; text: string } {
  if (probe.status === 302 && (probe.location ?? "").startsWith(ACCOUNT.teamDomain)) {
    return { accessProtected: true, text: "302 to the Access login: Access protects the hostname" };
  }
  if (probe.status === 0) return { accessProtected: false, text: `no response (${probe.body})` };
  if (probe.status === 500 && probe.body.includes("misconfigured")) return { accessProtected: false, text: "500 misconfigured: the Worker is deployed and failing closed, and Access does not protect the hostname yet" };
  if (probe.status === 401) return { accessProtected: false, text: "401 from the Worker: it is deployed with an AUD, but Access does not protect the hostname" };
  return { accessProtected: false, text: `HTTP ${probe.status}${probe.location ? ` to ${probe.location}` : ""}: not deployed or not protected by Access` };
}

export function findings(o: Observed, e: Environment, options: { ci: boolean }): Finding[] {
  const setup = `npm run cf:setup -- --env ${e.env}`;
  const out: Finding[] = [];
  out.push({
    area: "wrangler",
    ok: o.wrangler.loggedIn && o.wrangler.accountMatches,
    detail: o.wrangler.loggedIn ? `logged in (${o.wrangler.authType ?? "unknown auth"})${o.wrangler.accountMatches ? `, account ${ACCOUNT.id}` : `, but account ${ACCOUNT.id} is not among its accounts`}` : "not logged in",
    fix: "npx wrangler login",
  });
  for (const d of o.d1) {
    out.push({ area: `D1 ${d.name}`, ok: d.exists, detail: d.exists ? "exists" : "missing", fix: setup });
    if (d.exists) {
      const pending = d.pendingMigrations ?? [];
      // CI applies pending migrations itself; locally they are something to do.
      out.push({ area: `D1 ${d.name} migrations`, ok: options.ci || pending.length === 0, detail: pending.length === 0 ? "all applied" : `pending: ${pending.join(", ")}`, fix: setup });
    }
  }
  for (const q of o.queues) {
    out.push({ area: `queue ${q.name}`, ok: q.exists, detail: q.exists ? `exists (retention ${FREE_QUEUE_RETENTION_SECONDS / 3600} h on the Free plan); consumers: ${q.consumers.join(", ") || "none yet"}` : "missing", fix: setup });
  }
  if (!options.ci) {
    out.push({ area: "people seed", ok: (o.peopleRows ?? 0) > 0, detail: o.peopleRows === null ? "not checked (database missing or not migrated)" : `${o.peopleRows} employees`, fix: setup });
    out.push({ area: "agent controls", ok: (o.agentControlRows ?? 0) === 3, detail: o.agentControlRows === null ? "not checked" : `${o.agentControlRows} of 3 rows`, fix: setup });
    out.push({
      area: "role bindings",
      ok: o.missingBindings !== null && o.missingBindings.length === 0,
      detail: o.missingBindings === null ? "not checked (console database missing or not migrated)" : o.missingBindings.length === 0 ? "every persona and verification token is bound" : `missing or wrong role: ${o.missingBindings.join(", ")}`,
      fix: setup,
    });
  }
  out.push({ area: `Worker ${e.workerName}`, ok: o.worker.exists, detail: o.worker.exists ? `deployed${o.worker.version ? `, version ${o.worker.version.id} (${o.worker.version.message || "no message"})` : ""}` : "not deployed", fix: setup });
  for (const secret of ["INTEGRATION_SIGNING_KEY", "ACCESS_AUD"]) {
    const has = o.worker.secrets.includes(secret);
    out.push({
      area: `secret ${secret}`,
      ok: has,
      detail: has ? "set" : secret === "ACCESS_AUD" ? "not set: the Worker fails closed (500 misconfigured) until the Access application exists" : "not set",
      fix: secret === "ACCESS_AUD" ? `${API_TOKEN_VAR}=... ${setup}` : setup,
    });
  }
  if (!options.ci) {
    if (o.api === null) {
      out.push({ area: "Access and AI Gateway", ok: false, detail: `not checked: ${API_TOKEN_VAR} is not set`, fix: `export ${API_TOKEN_VAR}=<account API token: ${API_TOKEN_PERMISSIONS.join(", ")}>` });
    } else if (o.api.error) {
      out.push({ area: "Access and AI Gateway", ok: false, detail: `API error: ${o.api.error}`, fix: "check the token's permissions (README, Production setup)" });
    } else {
      out.push({ area: `AI Gateway ${e.aiGatewayId}`, ok: o.api.gateway === true, detail: o.api.gateway ? "exists" : "missing (Workers AI calls through it would fail)", fix: setup });
      for (const t of o.api.serviceTokens) {
        out.push({ area: `service token ${t.name}`, ok: t.exists && t.localSecret, detail: !t.exists ? "missing" : t.localSecret ? `exists; client secret in ${serviceTokenFile()}` : `exists, but its client secret is not in ${serviceTokenFile()} (cf:setup rotates it)`, fix: setup });
      }
      for (const [name, ok] of Object.entries(o.api.policies)) out.push({ area: `Access policy ${name}`, ok, detail: ok ? "up to date" : "missing or out of date", fix: setup });
      const app = o.api.app;
      out.push({
        area: `Access application for ${e.hostname}`,
        ok: Boolean(app?.exists && app.audIsTag && app.policiesAttached && app.oneTimePinOnly),
        detail: !app?.exists
          ? "missing"
          : !app.audIsTag
            ? "exists, but its AUD is not a 64-hex tag"
            : !app.policiesAttached
              ? "exists, but the agentboard policies are not attached"
              : app.oneTimePinOnly
                ? "exists with both policies; sign-in by One-time PIN only"
                : `exists with both policies, but its allowed identity providers are not just One-time PIN (${ACCOUNT.oneTimePinIdpId})`,
        fix: setup,
      });
    }
  }
  if (o.probe) {
    const probe = describeProbe(o.probe);
    out.push({ area: `GET ${e.url}/api/health (no credentials)`, ok: probe.accessProtected, detail: probe.text, fix: setup });
  }
  return out;
}

export interface PlannedStep {
  step: string;
  /** "ok" needs nothing; "do" changes something; "blocked" cannot happen in this run. */
  action: "ok" | "do" | "blocked";
  detail: string;
}

/**
 * What `cf:setup` would do, from a read-only observation: the `--dry-run` report. Pure, so it is
 * unit-tested; cf-setup itself re-checks each step as it goes.
 */
export function setupPlan(o: Observed, e: Environment, options: { token: boolean; deployMessage: string }): PlannedStep[] {
  const steps: PlannedStep[] = [];
  const add = (step: string, action: PlannedStep["action"], detail: string) => steps.push({ step, action, detail });
  if (!o.wrangler.loggedIn || !o.wrangler.accountMatches) add("wrangler login", "blocked", "run npx wrangler login (OAuth) with access to the account first");
  for (const d of o.d1) add(`D1 ${d.name}`, d.exists ? "ok" : "do", d.exists ? "exists" : "create");
  for (const q of o.queues) add(`queue ${q.name}`, q.exists ? "ok" : "do", q.exists ? "exists" : "create (retention: the Free plan's fixed 24 hours)");
  if (e.aiGatewayId) {
    const gateway = o.api && !o.api.error ? o.api.gateway : null;
    add(`AI Gateway ${e.aiGatewayId}`, gateway === true ? "ok" : options.token ? "do" : "blocked", gateway === true ? "exists" : options.token ? "create with logs off and 30 calls a minute" : `needs ${API_TOKEN_VAR}`);
  }
  for (const d of o.d1) {
    const pending = d.pendingMigrations;
    add(`D1 ${d.name} migrations`, d.exists && pending?.length === 0 ? "ok" : "do", !d.exists ? "apply all after creating the database" : pending?.length ? `apply ${pending.join(", ")}` : "all applied");
  }
  add("people seed", (o.peopleRows ?? 0) > 0 ? "ok" : "do", (o.peopleRows ?? 0) > 0 ? `${o.peopleRows} employees present` : "seed the 60 fictional employees from seed/people.sql");
  add("agent controls", o.agentControlRows === 3 ? "ok" : "do", o.agentControlRows === 3 ? "3 rows" : "insert the missing planner, executor and verifier rows (enabled)");
  if (!options.token) {
    add("Access service tokens and policies", "blocked", `needs ${API_TOKEN_VAR}`);
  } else if (o.api?.error) {
    add("Access service tokens and policies", "blocked", `the API refused the read: ${o.api.error}`);
  } else if (o.api) {
    for (const t of o.api.serviceTokens) add(`service token ${t.name}`, t.exists && t.localSecret ? "ok" : "do", !t.exists ? "create (duration 8760h)" : t.localSecret ? "exists; client secret on this machine" : "rotate: its client secret is not on this machine");
    for (const [name, ok] of Object.entries(o.api.policies)) add(`Access policy ${name}`, ok ? "ok" : "do", ok ? "up to date" : "create or update its rules");
  }
  const bindings = o.missingBindings;
  add("role bindings", bindings !== null && bindings.length === 0 ? "ok" : "do", bindings === null ? "upsert the personas and the service-token principals" : bindings.length === 0 ? "every persona and verification token is bound" : `upsert ${bindings.join(", ")}`);
  const deployed = o.worker.version?.message ?? "";
  const secretsMissing = ["INTEGRATION_SIGNING_KEY", "ACCESS_AUD"].filter((s) => !o.worker.secrets.includes(s));
  const appReady = Boolean(o.api?.app?.exists && o.api.app.audIsTag);
  const current = o.worker.exists && deployed === options.deployMessage;
  const deploySecrets = [...(o.worker.secrets.includes("INTEGRATION_SIGNING_KEY") ? [] : ["INTEGRATION_SIGNING_KEY (generated)"]), ...(appReady ? ["ACCESS_AUD"] : [])];
  if (current && secretsMissing.length === 0) add(`deploy ${e.workerName}`, "ok", `the deployed version is this commit (${deployed})`);
  else add(`deploy ${e.workerName}`, "do", `build with CLOUDFLARE_ENV=${e.env}, check the built config, deploy "${options.deployMessage}"${deploySecrets.length ? ` with secrets ${deploySecrets.join(", ")}` : ""}`);
  const app = o.api?.app ?? null;
  if (!options.token) {
    add(`Access application for ${e.hostname}`, "blocked", `needs ${API_TOKEN_VAR}; until then the Worker answers 500 misconfigured (no ACCESS_AUD)`);
  } else if (!app?.exists) {
    add(`Access application for ${e.hostname}`, "do", "create (One-time PIN only, both policies), then redeploy with its AUD tag as ACCESS_AUD");
  } else {
    const ready = app.audIsTag && app.policiesAttached && app.oneTimePinOnly;
    add(`Access application for ${e.hostname}`, ready ? "ok" : "do", ready ? "exists with both policies; One-time PIN only" : "update: attach both policies and allow only the One-time PIN provider");
    if (!o.worker.secrets.includes("ACCESS_AUD") && current) add("ACCESS_AUD", "do", "redeploy with the application's AUD tag");
  }
  add("check", "do", `an unauthenticated GET ${e.url}/api/health must end at the Access login`);
  return steps;
}
