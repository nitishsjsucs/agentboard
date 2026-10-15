// Thin wrappers around the pinned wrangler CLI for the deployed environments.
//
// Every call passes `--config wrangler.jsonc --env <env>`, so it reads the
// source configuration (never a build's .wrangler/deploy redirect) and the
// environment's account_id. stdin is closed, so wrangler takes its
// non-interactive defaults (it never edits wrangler.jsonc, and confirmations
// answer yes). Secrets are never passed as arguments: deploy takes them through
// a 0600 temporary file.
//
// Authentication: locally wrangler uses its OAuth login (`wrangler login`).
// wrangler also reads API tokens from the environment, including the deprecated
// alias CF_API_TOKEN, which is exactly where the scripts' Access token lives, so
// every credential variable is removed from wrangler's environment. Only CI
// (`useEnvironmentToken`) keeps CLOUDFLARE_API_TOKEN, its deploy token.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../lib/meta.ts";
import type { DeployEnv } from "./env.ts";

/** Variables wrangler reads credentials or the account from (current names and deprecated aliases). */
export const WRANGLER_CREDENTIAL_VARS = [
  "CLOUDFLARE_API_TOKEN",
  "CF_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CF_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CF_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_ACCOUNT_ID",
] as const;

let environmentToken = false;

/** CI only: let wrangler authenticate with CLOUDFLARE_API_TOKEN from the environment. */
export function useEnvironmentToken(): void {
  environmentToken = true;
}

/** The environment wrangler runs with: no credential variables, except CI's CLOUDFLARE_API_TOKEN. */
export function wranglerEnv(base: NodeJS.ProcessEnv = process.env, allowToken = environmentToken): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", FORCE_COLOR: "0" };
  for (const name of WRANGLER_CREDENTIAL_VARS) {
    if (allowToken && name === "CLOUDFLARE_API_TOKEN") continue;
    delete env[name];
  }
  return env;
}

export interface WranglerResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `npx wrangler <args>` and captures its output. `echo` also streams it to this process. */
export function wrangler(args: string[], options: { echo?: boolean; env?: NodeJS.ProcessEnv } = {}): WranglerResult {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...wranglerEnv(), ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = { ok: result.status === 0, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  if (options.echo) {
    process.stdout.write(out.stdout);
    process.stderr.write(out.stderr);
  }
  return out;
}

export const scoped = (env: DeployEnv): string[] => ["--config", "wrangler.jsonc", "--env", env];

/** Parses the first JSON value in wrangler's stdout (it may print a banner before it). */
export function jsonOutput<T>(stdout: string): T {
  const start = stdout.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in wrangler output: ${stdout.slice(0, 300)}`);
  return JSON.parse(stdout.slice(start)) as T;
}

export function whoami(): { loggedIn: boolean; authType?: string; email?: string; accounts?: { id: string; name: string }[] } {
  const result = wrangler(["whoami", "--json"]);
  try {
    return jsonOutput(result.stdout);
  } catch {
    return { loggedIn: false };
  }
}

export function listD1(env: DeployEnv): { uuid: string; name: string }[] {
  const result = wrangler(["d1", "list", "--json", ...scoped(env)]);
  if (!result.ok) throw new Error(`wrangler d1 list failed: ${result.stderr.slice(-500)}`);
  return jsonOutput(result.stdout);
}

export function createD1(env: DeployEnv, name: string): void {
  const result = wrangler(["d1", "create", name, "--no-update-config", ...scoped(env)], { echo: true });
  if (!result.ok) throw new Error(`wrangler d1 create ${name} failed`);
}

/** null when the queue does not exist; otherwise its consumers, as `queues info` prints them. */
export function queueInfo(env: DeployEnv, name: string): { consumers: string[] } | null {
  const result = wrangler(["queues", "info", name, ...scoped(env)]);
  const text = result.stdout + result.stderr;
  if (!new RegExp(`^Queue Name: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(text)) return null;
  const consumers = /^Consumers: (.*)$/m.exec(text)?.[1]?.split(",").map((c) => c.trim()) ?? [];
  return { consumers };
}

/** Retention is left to the plan: 24 hours and not configurable on Workers Free. */
export function createQueue(env: DeployEnv, name: string): void {
  const result = wrangler(["queues", "create", name, ...scoped(env)], { echo: true });
  if (!result.ok) throw new Error(`wrangler queues create ${name} failed`);
}

/** Migration file names not yet applied to the remote database. */
export function pendingMigrations(env: DeployEnv, database: string): string[] {
  const result = wrangler(["d1", "migrations", "list", database, "--remote", ...scoped(env)]);
  const text = result.stdout + result.stderr;
  if (/No migrations to apply/i.test(text)) return [];
  if (!result.ok) throw new Error(`wrangler d1 migrations list ${database} failed: ${text.slice(-500)}`);
  return [...text.matchAll(/(\d{4}_[A-Za-z0-9_]+\.sql)/g)].map((m) => m[1] as string);
}

export function applyMigrations(env: DeployEnv, database: string): void {
  const result = wrangler(["d1", "migrations", "apply", database, "--remote", ...scoped(env)], { echo: true });
  if (!result.ok) throw new Error(`wrangler d1 migrations apply ${database} failed`);
}

/** Runs SQL on the remote database and returns the rows of the last statement. */
export function query<T>(env: DeployEnv, database: string, sql: string): T[] {
  const result = wrangler(["d1", "execute", database, "--remote", "--yes", "--json", "--command", sql, ...scoped(env)]);
  if (!result.ok) throw new Error(`wrangler d1 execute ${database} failed: ${(result.stdout + result.stderr).slice(-500)}`);
  const parsed = jsonOutput<{ results?: T[] }[]>(result.stdout);
  return parsed[parsed.length - 1]?.results ?? [];
}

export function executeFile(env: DeployEnv, database: string, file: string): void {
  const result = wrangler(["d1", "execute", database, "--remote", "--yes", "--file", file, ...scoped(env)], { echo: true });
  if (!result.ok) throw new Error(`wrangler d1 execute ${database} --file ${file} failed`);
}

/** Secret names on the deployed Worker; null when the Worker does not exist yet. */
export function secretNames(env: DeployEnv): string[] | null {
  const result = wrangler(["secret", "list", "--format", "json", ...scoped(env)]);
  if (!result.ok) return null;
  return jsonOutput<{ name: string }[]>(result.stdout).map((s) => s.name);
}

/** The version currently serving 100% of traffic, with its message (cf-setup writes the deployed commit there). */
export function currentVersion(env: DeployEnv): { id: string; message: string; tag: string } | null {
  const status = wrangler(["deployments", "status", "--json", ...scoped(env)]);
  if (!status.ok) return null;
  const deployment = jsonOutput<{ versions?: { version_id: string; percentage: number }[] }>(status.stdout);
  const id = deployment.versions?.find((v) => v.percentage === 100)?.version_id;
  if (!id) return null;
  const view = wrangler(["versions", "view", id, "--json", ...scoped(env)]);
  if (!view.ok) return { id, message: "", tag: "" };
  const version = jsonOutput<{ annotations?: Record<string, string> }>(view.stdout);
  return { id, message: version.annotations?.["workers/message"] ?? "", tag: version.annotations?.["workers/tag"] ?? "" };
}

/**
 * Deploys the BUILT configuration (`.wrangler/deploy/config.json`, written by the vite build).
 * Secrets go through a temporary 0600 file that is removed afterwards; their values are never printed.
 */
export function deployBuilt(options: { tag: string; message: string; secrets: Record<string, string>; dryRun?: boolean }): WranglerResult {
  const dir = mkdtempSync(join(tmpdir(), "agentboard-deploy-"));
  try {
    const args = ["deploy", "--tag", options.tag, "--message", options.message, ...(options.dryRun ? ["--dry-run"] : [])];
    if (Object.keys(options.secrets).length > 0) {
      const file = join(dir, "secrets.json");
      writeFileSync(file, JSON.stringify(options.secrets), { mode: 0o600 });
      args.push("--secrets-file", file);
    }
    return wrangler(args, { echo: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
