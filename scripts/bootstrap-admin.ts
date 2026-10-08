// node scripts/bootstrap-admin.ts --email you@example.com [--name "Your Name"]
// Prints the SQL that creates (or promotes) a production admin role binding.
// Execute it with: npx wrangler d1 execute agentboard --remote --env production --command "<sql>"
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const email = (values.email ?? "").trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("usage: node scripts/bootstrap-admin.ts --email <you@example.com> [--name <display name>]");
  process.exit(1);
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const name = values.name ?? email;
console.log(
  `INSERT INTO role_bindings (principal, role, display_name, created_at, updated_at, updated_by) VALUES (${quote(email)}, 'admin', ${quote(name)}, ${quote(now)}, ${quote(now)}, 'bootstrap-admin') ` +
    `ON CONFLICT(principal) DO UPDATE SET role = 'admin', updated_at = excluded.updated_at, updated_by = 'bootstrap-admin';`,
);
