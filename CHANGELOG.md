# Changelog

Milestone releases of AgentBoard. Each milestone has a demo script in `demos/`.

## Unreleased

Stretch items from SPEC section 1.1, built after v0.4.0:

- `npm run deploy` (documented in the deploy steps but missing from `package.json`), plus `build:preview` and `deploy:preview`.
- `.github/workflows/preview.yml`: per-PR deploys to the shared `preview` environment, gated on the Cloudflare secrets (skipped without them; never run against an account).
- `.github/workflows/release.yml`: a pushed `v*` tag runs CI on the tagged commit, then publishes a release from its changelog section and demo script; a manual run covers the four existing tags.
- ADRs 0003 (policy-owned approvals and gating edges), 0004 (derived run status and recovery cascades) and 0005 (measured results with provenance and a staleness check).
- Eight more UI component tests (16 in all): tool-call traces, the agent-role and DLQ panels, the confirm dialog, budget meters and the audit chain notice.
- Dark-mode design tokens that follow `prefers-color-scheme`.
- A dev-only external `/mcp` route for MCP Inspector (`MCP_EXTERNAL=on`, loopback hosts only) and `npm run dev:token -- --integration` for read-only, call-bound inspector tokens.
- Simulation, planner and test results measured again on the commit that contains all of the above.
- CI prints the worker bundle size after the build.
- Every measurement taken again in a separate session to check that it reproduces: every outcome, recovery and audit-chain count and every planner quality metric matched; only local latencies and the timing-dependent tool-catalog reads (2 more tool calls and 2 more audit events) moved.

## v0.4.0: Evaluation and release

- One simulation driver for the 100-run workerd simulation (`npm run test:sim`) and `npm run eval:sim` against `wrangler dev` on the built worker.
- `npm run eval:planner` against a local llama-server (Qwen3-1.7B Q4_0) with a stub sanity mode.
- `npm run count:tests` for the 100 tagged orchestration and authorization tests.
- README Results block rendered from `eval/results/*.json`, with a staleness and dirty-tree check in CI.
- README with architecture, local setup, deploy steps, the local versus production matrix and limitations.

## v0.3.0: Console

- HTTP API: launch with a per-requester idempotency reservation, run, tool-call, timeline and audit reads with redaction by permission, recovery commands, approvals, agent roles, DLQ and metrics.
- FTS5 history search over runs, tasks, tool calls and approvals with bm25 ranking, filters, safe snippets and cursor paging.
- Read-only run snapshots over WebSocket with identity, runs:read, an Origin allowlist and a run-exists check.
- React console: dashboard with agent-role and DLQ panels, runs with search, live run detail with timeline, tool-call traces and recovery controls, approval queue, launch form, dev login.

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
