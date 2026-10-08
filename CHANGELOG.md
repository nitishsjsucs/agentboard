# Changelog

Milestone releases of AgentBoard. Each milestone has a demo script in `demos/`.

## v0.1.0: Foundations

- Pinned toolchain gated by strict `tsc` and workerd smoke tests (hash chain in `transactionSync`, `schedule()` wake, WebSocket state frames).
- Vite 8 + React 19 app with the Cloudflare Vite plugin, a Hono worker and local, production and preview wrangler environments.
- D1 migrations for the console (runs, tasks, tool calls, approvals, append-only audit, FTS5 search) and the simulated People systems.
- Seeded synthetic generator: 100 run requests, 60 fictional employees, 9 principals, with a checksum.
- Fail-closed config loader with lease timing invariants.
- Access JWT verification, local RS256 dev keys, loopback-only dev login, permissions and a CSRF guard.
