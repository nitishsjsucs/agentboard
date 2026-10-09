// npm run serve:built: the built worker under wrangler dev on 127.0.0.1:8784,
// with local state in .wrangler/serve-state and the secrets from .dev.vars.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildLocal, freshState, startBuiltWorker } from "./lib/built-worker.ts";
import { ROOT } from "./lib/meta.ts";

const envFile = join(ROOT, ".dev.vars");
if (!existsSync(envFile)) {
  console.error(".dev.vars is missing; run npm run dev:keys first");
  process.exit(1);
}
const persistTo = join(ROOT, ".wrangler/serve-state");
buildLocal();
if (process.argv.includes("--fresh") || !existsSync(persistTo)) freshState(persistTo);
const worker = await startBuiltWorker({ persistTo, envFile });
console.log(`AgentBoard is running at ${worker.baseUrl} (dev login at ${worker.baseUrl}/dev/login). Ctrl+C stops it.`);
const shutdown = async () => {
  await worker.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
await new Promise(() => undefined);
