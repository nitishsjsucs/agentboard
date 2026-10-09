// Provenance written into every eval/results/*.json (SPEC section 14).

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

export interface ResultMeta {
  gitSha: string;
  dirty: boolean;
  generatedAt: string;
  node: string;
  wrangler: string;
  seed: number;
  provider: string;
  model: string;
}

/**
 * Paths whose content determines a measurement; results:check compares the same set. SPEC section 14
 * names src, migrations, fixtures, scripts, wrangler.jsonc and package-lock.json. The tests (behind
 * tests.json), the generated seeds, the build and test configuration and package.json also shape what
 * is measured, so they are included too.
 */
export const MEASURED_PATHS = [
  "src",
  "migrations",
  "fixtures",
  "scripts",
  "wrangler.jsonc",
  "package-lock.json",
  "package.json",
  "test",
  "seed",
  "vite.config.ts",
  "vitest.config.ts",
];

/** Dirty when any measured path differs from HEAD (tracked changes or untracked files). */
export function isDirty(): boolean {
  return git(["status", "--porcelain", "--", ...MEASURED_PATHS]).length > 0;
}

export function wranglerVersion(): string {
  return execFileSync("npx", ["wrangler", "--version"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").pop() ?? "unknown";
}

export function resultMeta(provider: string, model: string, seed = 20261008): ResultMeta {
  return {
    gitSha: git(["rev-parse", "HEAD"]),
    dirty: isDirty(),
    generatedAt: new Date().toISOString(),
    node: process.version,
    wrangler: wranglerVersion(),
    seed,
    provider,
    model,
  };
}
