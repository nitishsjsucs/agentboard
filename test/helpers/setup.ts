import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Runs before every test file in the workerd projects. Each `worker` file has
// isolated storage, so migrations and the generated seeds are applied per
// file. Already-applied entries are skipped (the seeds are tracked in their
// own `seed_migrations` table).
await applyD1Migrations(env.DB, env.TEST_CONSOLE_MIGRATIONS);
await applyD1Migrations(env.PEOPLE_DB, env.TEST_PEOPLE_MIGRATIONS);
await applyD1Migrations(env.DB, env.TEST_CONSOLE_SEED, "seed_migrations");
await applyD1Migrations(env.PEOPLE_DB, env.TEST_PEOPLE_SEED, "seed_migrations");
