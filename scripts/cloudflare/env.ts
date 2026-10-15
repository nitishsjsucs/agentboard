// Known account facts and the deployed environments, read from wrangler.jsonc so
// resource names have one source. Used by cf-doctor, cf-setup and cf-verify.
//
// Everything here is public configuration (account ids, hostnames and the
// identity provider id are not secrets). Secrets are never committed: the
// account API token for Access, AI Gateway and analytics comes from CF_API_TOKEN
// in the environment, wrangler uses its own OAuth login, and the verification
// service tokens' client secrets are kept in a gitignored 0600 file
// (.secrets/cloudflare-service-tokens.json) that only cf:setup writes.

import { join } from "node:path";
import { unstable_readConfig } from "wrangler";
import type { Role } from "../../src/shared/domain.ts";
import { ROOT } from "../lib/meta.ts";

export const ACCOUNT = {
  id: "dc93c3bc8aa4f9e09a0d7e7354a80873",
  workersSubdomain: "nitish-ratakonda",
  /** Zero Trust organization on the Free plan, with One-time PIN login. */
  teamDomain: "https://old-truth-a7dc.cloudflareaccess.com",
  /** The One-time PIN identity provider, created in Zero Trust by hand; setup only references it. */
  oneTimePinIdpId: "743683e8-42d4-44e9-9991-ba57a1bb0dec",
  ownerEmail: "nitishsancs@gmail.com",
} as const;

/** People who may sign in through Access (One-time PIN), and their console roles. */
export const PERSONAS: readonly { email: string; role: Role; displayName: string }[] = [
  { email: ACCOUNT.ownerEmail, role: "admin", displayName: "Nitish (owner)" },
  { email: "nitishsancs+ops@gmail.com", role: "operator", displayName: "Ops persona" },
  { email: "nitishsancs+approver@gmail.com", role: "approver", displayName: "Approver persona" },
  { email: "nitishsancs+viewer@gmail.com", role: "viewer", displayName: "Viewer persona" },
];

/** Access service tokens for `npm run cf:verify` (two, for separation of duties); shared by both environments. */
export const VERIFY_TOKENS: readonly { name: string; role: Role; displayName: string }[] = [
  { name: "agentboard-verify-operator", role: "operator", displayName: "cf:verify operator (service token)" },
  { name: "agentboard-verify-approver", role: "approver", displayName: "cf:verify approver (service token)" },
];

/**
 * The synthetic requests cf:verify runs against a deployed Worker, each planned by Workers AI. Four,
 * because the account's 10,000 free neurons a day are shared with three other apps: at most 6,000
 * planner tokens per run (the default budget) is at most 183 neurons, so the four cost at most 732.
 * Repeatable on the same data: two address changes and an approved manager change re-apply
 * harmlessly, and the rejected privileged grant writes nothing, because every write waits behind
 * its approval.
 */
export const VERIFY_REFS: readonly string[] = ["syn-0006", "syn-0013", "syn-0022", "syn-0002"];

/** Reusable Access policies, shared by both environments' Access applications. */
export const ACCESS_POLICIES = { people: "agentboard-people", verify: "agentboard-verify" } as const;

/**
 * The account API token for Access, AI Gateway and analytics calls. Never printed, and never passed to
 * wrangler: wrangler still reads CF_API_TOKEN as a deprecated alias of CLOUDFLARE_API_TOKEN, so
 * scripts/cloudflare/wrangler.ts removes both from wrangler's environment and wrangler uses its login.
 */
export const API_TOKEN_VAR = "CF_API_TOKEN";

/** Permissions the CF_API_TOKEN account token needs (cf:setup, cf:doctor and cf:verify). */
export const API_TOKEN_PERMISSIONS = [
  "Access: Apps and Policies Edit",
  "Access: Service Tokens Edit",
  "AI Gateway Edit",
  "Account Analytics Read",
] as const;

/** Gitignored; holds only what cf:setup writes. AGENTBOARD_SECRETS_DIR overrides it (tests). */
export function secretsDir(): string {
  return process.env["AGENTBOARD_SECRETS_DIR"] ?? join(ROOT, ".secrets");
}

/** Where cf-setup keeps the verification service tokens' client secrets (mode 0600). */
export function serviceTokenFile(): string {
  return join(secretsDir(), "cloudflare-service-tokens.json");
}

export type DeployEnv = "production" | "preview";
export const DEPLOY_ENVS: readonly DeployEnv[] = ["production", "preview"];

/** Queue retention on the Workers Free plan: 24 hours, not configurable (so queues are created without the flag). */
export const FREE_QUEUE_RETENTION_SECONDS = 86_400;

export interface Environment {
  env: DeployEnv;
  workerName: string;
  hostname: string;
  url: string;
  accountId: string;
  accessAppName: string;
  aiGatewayId: string;
  workersAiModel: string;
  d1: { binding: string; name: string }[];
  /** Every queue the environment produces to or consumes from, the DLQ included. */
  queues: string[];
  vars: Record<string, string>;
}

export function parseDeployEnv(value: string | undefined): DeployEnv {
  if (value === "production" || value === "preview") return value;
  throw new Error(`--env must be production or preview (got ${value ?? "nothing"})`);
}

/** Reads one deployed environment from wrangler.jsonc and checks it against the account facts. */
export function environment(env: DeployEnv): Environment {
  const config = unstable_readConfig({ config: join(ROOT, "wrangler.jsonc"), env }, { hideWarnings: true });
  const vars = Object.fromEntries(Object.entries(config.vars ?? {}).map(([k, v]) => [k, String(v)]));
  const queues = new Set<string>();
  for (const p of config.queues.producers ?? []) queues.add(p.queue);
  for (const c of config.queues.consumers ?? []) {
    queues.add(c.queue);
    if (c.dead_letter_queue) queues.add(c.dead_letter_queue);
  }
  const hostname = `${config.name}.${ACCOUNT.workersSubdomain}.workers.dev`;
  const result: Environment = {
    env,
    workerName: config.name ?? "",
    hostname,
    url: `https://${hostname}`,
    accountId: config.account_id ?? "",
    accessAppName: config.name ?? "",
    aiGatewayId: vars["AI_GATEWAY_ID"] ?? "",
    workersAiModel: vars["WORKERS_AI_MODEL"] ?? "",
    d1: config.d1_databases.map((d: { binding: string; database_name?: string }) => ({ binding: d.binding, name: d.database_name ?? "" })),
    queues: [...queues],
    vars,
  };
  const problems = environmentProblems(result);
  if (problems.length > 0) throw new Error(`wrangler.jsonc env.${env} does not match the account facts:\n- ${problems.join("\n- ")}`);
  return result;
}

/** Rules every deployed environment must keep (also run by a unit test against wrangler.jsonc). */
export function environmentProblems(e: Environment): string[] {
  const problems: string[] = [];
  const names = [e.workerName, e.accessAppName, ...e.d1.map((d) => d.name), ...e.queues, ...(e.aiGatewayId ? [e.aiGatewayId] : [])];
  for (const name of names) if (!name.startsWith("agentboard")) problems.push(`resource name ${JSON.stringify(name)} is not prefixed with agentboard`);
  if (e.accountId !== ACCOUNT.id) problems.push(`account_id is ${e.accountId || "unset"}, expected ${ACCOUNT.id}`);
  if (e.vars["ENVIRONMENT"] !== e.env) problems.push(`ENVIRONMENT is ${e.vars["ENVIRONMENT"]}`);
  if (e.vars["ACCESS_TEAM_DOMAIN"] !== ACCOUNT.teamDomain) problems.push(`ACCESS_TEAM_DOMAIN is ${e.vars["ACCESS_TEAM_DOMAIN"]}`);
  if ("ACCESS_AUD" in e.vars) problems.push("ACCESS_AUD must not be a var (it is a Worker secret set by cf:setup)");
  if (e.vars["ALLOWED_ORIGINS"] !== e.url) problems.push(`ALLOWED_ORIGINS is ${e.vars["ALLOWED_ORIGINS"]}, expected ${e.url}`);
  if (e.vars["AUTH_MODE"] !== "access" || e.vars["FAULT_INJECTION"] !== "off" || e.vars["MCP_EXTERNAL"] !== "off" || e.vars["LLM_PROVIDER"] !== "workers-ai") {
    problems.push("a deployed environment needs AUTH_MODE=access, FAULT_INJECTION=off, MCP_EXTERNAL=off and LLM_PROVIDER=workers-ai");
  }
  if (e.d1.length !== 2) problems.push("expected two D1 databases (DB and PEOPLE_DB)");
  return problems;
}
