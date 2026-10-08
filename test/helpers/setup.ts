import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Runs before every test file in the workerd projects. Each `worker` file has
// isolated storage, so migrations (and, from commit 4, the generated seeds)
// are applied per file. Already-applied migrations are skipped.
await applyD1Migrations(env.DB, env.TEST_CONSOLE_MIGRATIONS);
await applyD1Migrations(env.PEOPLE_DB, env.TEST_PEOPLE_MIGRATIONS);
