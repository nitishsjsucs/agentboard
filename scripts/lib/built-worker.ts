// Build, migrate, seed, spawn and health-check `wrangler dev` on the BUILT
// worker (SPEC sections 5.6 and 14.1). A bare `wrangler dev` is unsupported:
// the top-level config has no assets directory, and after a build wrangler
// would follow .wrangler/deploy/config.json to whatever dist/ holds.

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { assertLoopbackArgs } from "./loopback.ts";
import { ROOT } from "./meta.ts";

export const BUILT_CONFIG = join(ROOT, "dist/agentboard/wrangler.json");
export const PORT = 8784;
export const INSPECTOR_PORT = 9234;
export const HOST = "127.0.0.1";

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  execFileSync(command, args, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], env });
}

/** vite build with CLOUDFLARE_ENV removed, then asserts the built config is the local one. Returns the bundle sha256. */
export function buildLocal(): string {
  const env = { ...process.env };
  delete env["CLOUDFLARE_ENV"];
  run("npx", ["vite", "build"], env);
  const config = JSON.parse(readFileSync(BUILT_CONFIG, "utf8")) as { vars?: Record<string, string>; ai?: unknown };
  if (config.vars?.["ENVIRONMENT"] !== "development") throw new Error(`built config ENVIRONMENT is ${config.vars?.["ENVIRONMENT"]}, expected development`);
  if (config.ai) throw new Error("built config carries an ai binding; refusing to run it locally");
  return createHash("sha256").update(readFileSync(join(ROOT, "dist/agentboard/index.js"))).digest("hex");
}

/** Deletes and recreates local D1 state under `persistTo`: migrations, then the generated seeds. */
export function freshState(persistTo: string): void {
  rmSync(persistTo, { recursive: true, force: true });
  for (const db of ["agentboard", "agentboard-people"]) {
    run("npx", ["wrangler", "d1", "migrations", "apply", db, "--local", "--persist-to", persistTo, "--config", BUILT_CONFIG]);
  }
  run("npx", ["wrangler", "d1", "execute", "agentboard", "--local", "--persist-to", persistTo, "--config", BUILT_CONFIG, "--file", "seed/console.sql"]);
  run("npx", ["wrangler", "d1", "execute", "agentboard-people", "--local", "--persist-to", persistTo, "--config", BUILT_CONFIG, "--file", "seed/people.sql"]);
}

export interface RunningWorker {
  baseUrl: string;
  child: ChildProcess;
  stop(): Promise<void>;
}

/** Spawns wrangler dev on the built config, bound to loopback, and waits for /api/health. */
export async function startBuiltWorker(options: { persistTo: string; envFile: string; logFile?: string }): Promise<RunningWorker> {
  if (!isAbsolute(options.envFile)) throw new Error("the env file path must be absolute (a relative path is silently ignored)");
  if (!existsSync(options.envFile)) throw new Error(`env file ${options.envFile} does not exist`);
  const args = [
    "wrangler", "dev",
    "--config", BUILT_CONFIG,
    "--persist-to", options.persistTo,
    "--env-file", options.envFile,
    "--port", String(PORT),
    "--ip", HOST,
    "--inspector-port", String(INSPECTOR_PORT),
  ];
  assertLoopbackArgs(args, ["--ip"]);
  assertLoopbackArgs(process.argv, ["--ip", "--host"]);
  const child = spawn("npx", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const log: string[] = [];
  const sink = (chunk: Buffer) => {
    log.push(chunk.toString());
    if (options.logFile) writeFileSync(options.logFile, log.join(""));
  };
  child.stdout?.on("data", sink);
  child.stderr?.on("data", sink);
  const baseUrl = `http://${HOST}:${PORT}`;
  const stop = async () => {
    if (child.pid && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  };
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited early:\n${log.join("").slice(-2000)}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { baseUrl, child, stop };
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stop();
  throw new Error(`wrangler dev did not become healthy:\n${log.join("").slice(-2000)}`);
}
