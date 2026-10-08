# AgentBoard build progress

Source of truth for the design: `SPEC.md` (revision 2). This file tracks where the build is in the commit plan (SPEC section 19), the exact check status, and every deviation from the spec with its reason. A later builder continues from here.

## Commit plan position

| # | Commit | Status |
|---|---|---|
| 1 | chore: pin toolchain and gate it with strict tsc and workerd smoke tests | done |
| 2 | chore: Vite 8 React 19 app with the Cloudflare Vite plugin, Hono worker, wrangler environments and generated types | done |
| 3 | feat(db): console and people D1 migrations | done |
| 4 | feat(synth): seeded generator for 100 runs, 60 employees and 9 principals with checksum | done |
| 5 | feat(config): fail-closed config loader with timing invariants | done |
| 6 | feat(auth): Access JWT verification with local RS256 dev keys and loopback-only dev login | done |
| 7 | feat(auth): permissions, CSRF guard, /api/me and /api/health | done |
| 8 | docs: README skeleton, CONTEXT.md and milestone 1 demo script | done (local tag v0.1.0) |
| 9 | feat(coordinator): RunCoordinator state machine with derived run status and recovery cascades | done |
| 10 | feat(coordinator): leases with fencing epochs, idempotent sweep, scheduled wake and call-bound credentials | done |
| 11 | feat(coordinator): execution budgets and active-time deadline | done |
| 12 | feat(audit): transactional outbox with synchronously hash-chained D1 audit events | done |
| 13 | feat(queue): sharded dispatch, role-agent skeleton, backoff, dispatch-fenced DLQ and bounded batch concurrency | done |
| 14 | feat(mcp): People Ops MCP server with 12 tools and call-bound token checks | done |

Next: commit 15 (`feat(mcp): integration ledger with lock takeover and logical dedupe, and dev-only fault directives`).

## Check status (last run)

- `npm run typecheck`: pass
- `npm test`: pass (projects worker, worker-ws, worker-access, node; 15 files, 68 tests)
- `npm run synth:check`: pass
- `npm run types:check`: pass
- `npm run build`: pass

## Deviations from SPEC.md

1. **Test entry module.** The toolchain gate needs an Agent with a `schedule()` callback and WebSocket state before any production agent exists. Instead of adding a probe class to the production worker, `vitest.config.ts` sets the plugin's `main` to `test/helpers/test-worker.ts`, which re-exports the production worker and adds a test-only `ToolchainProbe` agent (bound through `miniflare.durableObjects`, routed under `/__probe/*`). Production code never imports it. Files not in the SPEC layout: `test/helpers/test-worker.ts`, `test/helpers/probe-agent.ts`.
2. **`tsconfig.web.json` arrived with commit 2**, not commit 1: TypeScript refuses a project with no input files, and `src/web` did not exist before commit 2.
3. **Port 8784 instead of 8788.** This machine shares ports with other builds, so the built worker (`serve:built`, `eval:sim`) listens on `127.0.0.1:8784`, and the dev `ALLOWED_ORIGINS` lists `http://127.0.0.1:8784`. The Vite plugin's inspector is pinned to 9234 for the same reason.
4. **Skeleton agent classes in commit 2.** `wrangler.jsonc` declares all four Durable Object classes from commit 2 so its shape (one `v1` migration tag) never changes; the classes are empty `Agent` subclasses until their commits. The queue handler retries every message (fails closed) until the consumer lands in commit 13.
5. **Production worker name.** Wrangler names the `production` environment's worker `agentboard-production` (it appends the environment name), so the production `ALLOWED_ORIGINS` placeholder is `https://agentboard-production.<subdomain>.workers.dev`. Keeping the suffix means an accidental top-level deploy can never overwrite the production script.
6. **Plan validator, tool registry, policy and materializer landed in commit 4.** `generator.test.ts` #4 must check the gold plans against the section 11.3 validator, so the pure modules `src/worker/planning/tool-registry.ts`, `policy.ts`, `materialize.ts` and the `validatePlan` part of `planner.ts` were written with the generator. Commit 9 wires `materialize.ts` into the coordinator and commit 17 adds the prompt, parse and repair loop to `planner.ts`.
7. **Synthetic dataset design choices the spec leaves open** (all within section 12.1): onboarding and offboarding subjects come from exclusive pools (an offboarded subject never reappears; onboarding subjects are `pending_start`), the 15 access-revocation subjects are distinct and revoke a seeded baseline role, `budget_exhausted` and `silent_noop` go only to approval-free runs, and the gold plans are linear chains whose first write is always `s2` (so `checkpointStep = "s2"` parks every pause/cancel run before any write).
8. **`wrangler types` reads `.dev.vars.example`.** `npm run types` and `types:check` pass `--env-file .dev.vars.example`, so the generated `Env` declares the three secrets (`INTEGRATION_SIGNING_KEY`, `ACCESS_DEV_JWKS`, `DEV_ACCESS_PRIVATE_JWK`) and never depends on a developer's local `.dev.vars` (which would make CI's check fail).
9. **Config bounds.** Section 5.2 says numeric vars are positive integers, but the test project itself sets `RETRY_BASE_DELAY_S=0` and `AGENT_CONTROLS_CACHE_MS=0`, so those two accept 0. `INTEGRATION_SIGNING_KEY` (at least 32 bytes) is required in every environment, not only production, because tokens are minted everywhere. `MCP_EXTERNAL=on` is refused outside `development` (section 3.1).
10. **`access-jwt.test.ts` #7 lands with commit 23.** "A valid token for an unbound email gets 403 everywhere except `/api/me`" needs the permission-gated run, approval, search, agent and DLQ routes, which arrive in commit 23. Until then the file has the other 7 tests. `/api/me` is implemented in commit 6 (not 7) because the Access and dev-login tests assert through it.
11. **Small helper files not in the layout:** `src/worker/api/types.ts` (Hono env and `Identity` types) and `scripts/lib/dev-vars.ts` (reads `.dev.vars` for `dev:token`).
12. **Empty dev secrets count as absent.** The vitest plugin loads a developer's local `.dev.vars`; the `worker-access` project sets `ACCESS_DEV_JWKS` and `DEV_ACCESS_PRIVATE_JWK` to empty strings so its tests are hermetic, and `parseConfig` treats an empty secret as absent.
13. **Commits are on local `main`; tags are local.** No branches, PRs or pushes are made by the builders (pushing happens after verification). The PR boundaries of section 19 map to commit ranges: PR 1 = commits 1 to 4, PR 2 = 5 to 8, PR 3 = 9 to 12, PR 4 = 13 to 16, PR 5 = 17 to 22, PR 6 = 23 to 25, PR 7 = 26 to 30, PR 8 = 31 to 36. Milestone tags (`v0.1.0` ...) are created locally on the last commit of each milestone; GitHub releases need a push.
14. **Coordinator internals.** Each RPC loads the whole run into an in-memory `RunTx` (`agents/coordinator/transitions.ts`, pure), applies the operation and re-derives status there, then persists dirty rows, hash-chained events and outbox rows inside the same `transactionSync`. DO SQLite columns added beyond section 6.3: `ab_run.cancelled` and `ab_run.finished_at` (cancel is a flag that `deriveRunStatus` reads, so status is still never set by a command), `ab_tasks.checkpoint_done` (a checkpoint parks a step only the first time it becomes ready) and `ab_tasks.created_at` (for the D1 mirror). A run is `rejected` when any approval was rejected by an approver.
15. **Dispatch rule.** A task that becomes ready is dispatched once when the run allows dispatch (queued, planning, running, awaiting approval). When a transaction moves the run out of `paused` or `needs_attention`, every ready task is redispatched once with a new `dispatchId`, which is how `resume` and the recovery commands satisfy "dispatches each ready task exactly once".
16. **Typed RPC interface.** Workers' generated `Rpc` types turn members that carry `unknown` (tool arguments and results) into `never`, so callers type coordinator stubs with the explicit `RunCoordinatorRpc` interface in `agents/coordinator/schema.ts`, which the class `implements`.
17. **Test-only manual dispatch.** Coordinator unit tests act as the role agents. `test/helpers/runs.ts` sets `test:manualDispatch` in the coordinator's KV storage before `initRun`; from commit 12 the outbox flush leaves queue rows local for such runs, and only when `ENVIRONMENT=test`. Tests read them with `takeDispatches`.
18. **Tool-call reservations land with leases (commit 10).** A grant reserves calls (execute 1, verify the registry's read count, planner 1) and the sweep releases them, so `leases.test.ts` #4 can assert the release. Commit 11 adds the budget gate that refuses claims.
19. **Wake on the real clock.** Deadlines are kept on the coordinator clock (which tests can offset); `armWake` converts to the real clock before scheduling, and stores `ab_run.wake_at` in real time.
20. **Outbox granularity.** Each coordinator transaction writes one `d1` outbox row holding all of its mirror statements (run, dirty tasks and approvals, tool calls, audit events) plus one `queue` row per dispatch. The flush delivers up to 25 rows per D1 `batch()` (atomic) and per `sendBatch`, in id order per lane; a failed row backs off (1 s doubling to 60 s) and holds back the rows after it. `tool_calls.result_json` stores `{ value, logical }` so the logical-replay flag survives without a schema change. Sent outbox rows are kept in DO storage.
21. **Consumer dependencies are injectable.** `handleQueueBatch(batch, env, config, deps)` takes the coordinator, role-agent and role-control lookups as `ConsumerDeps`, so `retries.test.ts` #2 can make the role agent unreachable (a failure before the claim) and `dispatch.test.ts` #3 can count in-flight `handleTask` calls. `getQueueResult` in `@cloudflare/vitest-plugin` 1.4.0 records which messages were retried but not their `delaySeconds`, so the delay is asserted through a spy on `message.retry`.
22. **`retries.test.ts` #3 uses a real role agent.** Until commit 17 the role work is a skeleton that throws; from commit 17 the same test makes the stub planner throw `StubMiss` (a request text with no fixture). Either way the exception happens inside role work after a granted claim.
23. **Ledger basics and fault directives landed with the tools (commit 14).** `tools.test.ts` (planned for commit 14) covers ledger replay, the args-hash conflict, `silent_noop` and faults being ignored when off, so the basic ledger (claim, replay, conflict, owner-guarded effect batch) and `mcp/faults.ts` are in commit 14. Commit 15 adds lock takeover and the cross-generation correlation guard (logical dedupe).
24. **MCP endpoint details.** The MCP SDK v2 client sends `initialize`, `notifications/initialized`, an SSE `GET` and then the call; the endpoint answers non-POST requests with 405 (stateless server, no standalone stream) and gates POSTs by method per token kind (`server/discover` is allowed alongside `initialize` for the 2026 protocol era). The ledger owner is `<agent instance>:<task id>:<epoch>` from the token claims (the token carries no lease id), and the generation used for `side_effects.generation` travels in `_meta["agentboard/generation"]`. Tool names keep their dots (`hris.get_employee`).
