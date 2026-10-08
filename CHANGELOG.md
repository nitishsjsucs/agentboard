# Changelog

Milestone releases of AgentBoard. Each milestone has a demo script in `demos/`.

## v0.2.0: Orchestration core

- RunCoordinator: derived run status, recovery commands with cascades, leases with fencing epochs, the synchronous sweep and scheduled wake, budgets and the active-time deadline.
- Transactional outbox with synchronously hash-chained audit events mirrored to D1.
- Queue dispatch to sharded role agents with bounded batch concurrency, backoff, poison handling and a dispatch-fenced DLQ.
- People Ops MCP server with 12 simulated tools, call-bound integration tokens and an integration ledger with lock takeover and logical dedupe.
- LLM providers (Workers AI, OpenAI-compatible, stub) and the planner, executor and verifier agents.
- Coordinator-owned approvals with separation of duties and expiry; role hold and release; DLQ replay.
- ADRs 0001 and 0002.

## v0.1.0: Foundations

- Pinned toolchain gated by strict `tsc` and workerd smoke tests (hash chain in `transactionSync`, `schedule()` wake, WebSocket state frames).
- Vite 8 + React 19 app with the Cloudflare Vite plugin, a Hono worker and local, production and preview wrangler environments.
- D1 migrations for the console (runs, tasks, tool calls, approvals, append-only audit, FTS5 search) and the simulated People systems.
- Seeded synthetic generator: 100 run requests, 60 fictional employees, 9 principals, with a checksum.
- Fail-closed config loader with lease timing invariants.
- Access JWT verification, local RS256 dev keys, loopback-only dev login, permissions and a CSRF guard.
