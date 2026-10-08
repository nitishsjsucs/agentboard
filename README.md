# AgentBoard

AgentBoard is an operations console for launching, monitoring and controlling agent runs that serve a **simulated** People-operations organization. A planning agent turns a request (an address change, an onboarding, an offboarding) into a plan; execution and verification workers carry it out through an MCP server; a per-run coordinator owns the shared task state, leases, budgets, approvals and a hash-chained audit trail. It runs on Cloudflare Workers with the Agents SDK, Durable Objects, Queues and D1.

**Everything People-related is simulated.** The HRIS, ITSM, access-management and notification systems are tables in a separate D1 database, filled with 60 fictional employees by a seeded generator. There are no real users, employees or HR systems behind it in any environment.

> Status: under construction (milestone 1 of 4). This README grows with the build; sections marked "planned" describe work that has not landed yet. The design is in [`SPEC.md`](SPEC.md) and build progress in [`PROGRESS.md`](PROGRESS.md).

## What runs where

| Capability | Local (this repo, offline) | Production (after a Cloudflare login) |
|---|---|---|
| Worker, Hono API, static assets | workerd via `@cloudflare/vite-plugin` or Miniflare in vitest | Cloudflare Workers (not deployed yet) |
| Identity | dev mode: RS256 JWTs from a locally generated key, verified by the same code as Access; dev login on loopback only | Cloudflare Access JWT in `Cf-Access-Jwt-Assertion`, verified against the team JWKS |
| People systems | simulated, in D1 | simulated, in D1 (the same tables) |

The full matrix (agents, queues, LLM providers, search) is planned for the final README.

## Local setup

Requires Node 24 (Node 25.9 also verified).

1. `nvm use && npm ci`
2. `npm run dev:keys` writes `.dev.vars` with a local RS256 dev keypair and an integration signing key (never committed).
3. `npm run db:migrate:local && npm run db:seed:local`
4. `npm run dev`, then open `http://127.0.0.1:5173`.
5. `npm test`

A bare `wrangler dev` is **unsupported**: the top-level `wrangler.jsonc` has an `assets` block without `directory` (the Vite plugin supplies it at build time), so wrangler refuses it, and after a `vite build` it would follow `.wrangler/deploy/config.json` to whatever `dist/` holds.

## Tests

`npm test` runs the workerd projects (`worker`, `worker-ws` for WebSockets with isolation off, `worker-access` for production Access verification against an intercepted JWKS) and a Node project for scripts. Tests are tagged; the orchestration and authorization suites are counted by a script once the counter lands (planned).

## Results

Not measured yet. Every number that appears here will be produced by this repo's own scripts, with the command and date.

## License

MIT
