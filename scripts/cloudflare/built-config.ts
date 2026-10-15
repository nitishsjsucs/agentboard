// The configuration `wrangler deploy` will use after a vite build: the vite
// plugin writes it under dist/ and points .wrangler/deploy/config.json at it.
// Deploying anything but the intended environment's build is refused.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ROOT } from "../lib/meta.ts";
import type { Environment } from "./env.ts";

export interface BuiltConfig {
  path: string;
  name?: string;
  account_id?: string;
  vars?: Record<string, string>;
}

export function readBuiltConfig(): BuiltConfig {
  const redirect = join(ROOT, ".wrangler/deploy/config.json");
  if (!existsSync(redirect)) throw new Error("no build found (.wrangler/deploy/config.json); run the vite build for the environment first");
  const path = resolve(dirname(redirect), (JSON.parse(readFileSync(redirect, "utf8")) as { configPath: string }).configPath);
  return { path, ...(JSON.parse(readFileSync(path, "utf8")) as Omit<BuiltConfig, "path">) };
}

/** Problems that make the built configuration unfit to deploy as `e` (empty when it is fit). */
export function builtConfigProblems(config: BuiltConfig, e: Environment): string[] {
  const problems: string[] = [];
  const vars = config.vars ?? {};
  if (config.name !== e.workerName) problems.push(`built Worker name is ${config.name}, expected ${e.workerName}`);
  if (config.account_id !== e.accountId) problems.push(`built account_id is ${config.account_id}, expected ${e.accountId}`);
  const want: Record<string, string> = { ENVIRONMENT: e.env, AUTH_MODE: "access", FAULT_INJECTION: "off", MCP_EXTERNAL: "off", LLM_PROVIDER: "workers-ai" };
  for (const [key, value] of Object.entries(want)) if (vars[key] !== value) problems.push(`built ${key} is ${vars[key]}, expected ${value}`);
  if ("ACCESS_AUD" in vars) problems.push("the built config carries ACCESS_AUD as a var, which would collide with the Worker secret");
  return problems;
}
