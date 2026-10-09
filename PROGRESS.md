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
| 15 | feat(mcp): integration ledger with lock takeover and logical dedupe, and dev-only fault directives | done (fault directives landed in 14) |
| 16 | feat(llm): provider interface with Workers AI, OpenAI-compatible and stub providers | done |
| 17 | feat(agents): PlannerAgent with allowlists, subject pinning, one repair and gating edges | done |
| 18 | feat(agents): ExecutorAgent with call journal and in-process MCP client | done (dispatch.test.ts #1 moved to commit 19) |
| 19 | feat(agents): VerifierAgent with registry postconditions | done (includes dispatch.test.ts #1) |
| 20 | feat(approvals): coordinator-owned approvals with separation of duties and expiry | done |
| 21 | feat(controls): role hold and release, DLQ replay | done |
| 22 | docs: ADR 0001 and 0002 and milestone 2 demo script | done (local tag v0.2.0) |
| 23 | feat(api): launch reservation and run, tool-call, timeline, approval, agent and DLQ endpoints with redaction | done |
| 24 | feat(search): FTS5 search documents and ranked search API | done |
| 25 | feat(realtime): read-only run snapshots over WebSocket with an Origin allowlist | done |
| 26 | feat(web): app shell, role-aware navigation, dev login and design tokens | done |
| 27 | feat(web): dashboard with agent-role and DLQ panels, and runs list with search | done |
| 28 | feat(web): live run detail with timeline, tool-call traces and recovery controls | done (includes ApprovalCard and its test) |
| 29 | feat(web): approval queue and launch form | done |
| 30 | docs: milestone 3 demo script | done (local tag v0.3.0) |
| 31 | feat(sim): shared simulation driver and 100-run workerd simulation test | done |
| 32 | feat(eval): eval-sim against wrangler dev on the built worker, and eval-planner against llama-server | done |
| 33 | feat(eval): tagged test counter and README results renderer with staleness check | done (CI steps moved to 35) |
| 33a | fix(eval): record the llama.cpp build and separate transport errors in the planner eval | done (extra commit, see deviation 42) |
| 34 | chore(results): measured simulation, planner and test results | done (measured at 83f4c08) |
| 35 | docs: architecture, setup, deploy steps, local versus production and rendered results | done (CI adds count:tests --check and results:check) |
| 36 | chore(release): v0.4.0 changelog and milestone 4 demo script | done (local tag v0.4.0) |

All 36 planned commits are done, plus the extra fix commit 33a. Every item on the section 1.1 "must ship" list exists and is tested.

### After the plan: fixes and stretch items (builder 2)

The stretch items of section 1.1 are built in the spec's cut order where they do not touch measured paths, and the ones that change `src` or `scripts` are grouped before one re-measurement (deviation 44).

| # | Commit | Status |
|---|---|---|
| 37 | fix(scripts): add the npm deploy script that the deploy steps use | done |
| 38 | ci: gated per-PR deploys to the preview environment | done |
| 39 | ci: release workflow that publishes a milestone from its changelog section and demo script | next |
| 40 | docs: ADRs 0003 to 0005 | planned |
| 41 | test(web): UI tests for tool-call traces, role and DLQ panels, the confirm dialog, meters and the audit badge | planned |
| 42 | feat(web): dark-mode tokens | planned |
| 43 | feat(mcp): dev-only external /mcp route for MCP Inspector and dev:token --integration | planned |
| 44 | chore(results): re-measure simulation, planner and test results after the stretch items | planned |
| 45 | docs: README, CHANGELOG and PROGRESS for the stretch items | planned |

## What is left (stretch items, cut first per SPEC section 1.1, and human steps)

- Stretch, in progress (see the table above): `.github/workflows/preview.yml` is built (gated, never run against an account); still to build: `.github/workflows/release.yml`, UI component tests beyond the 8, dark-mode tokens, ADRs beyond 0001 and 0002, the external `/mcp` route for MCP Inspector (`MCP_EXTERNAL=on`; the worker answers 404 on `/mcp`, and `dev:token --integration` is not implemented).
- Not done by the builders (needs Nitish, SPEC section 18): pushing, opening the 8 PRs, GitHub releases for the local tags `v0.1.0` to `v0.4.0`, any deployment, Access setup, Workers AI planner quality.
- If any file under `src`, `migrations`, `fixtures`, `scripts`, `wrangler.jsonc` or `package-lock.json` changes, `npm run results:check` fails until `npm run count:tests`, `npm run eval:sim` and `npm run eval:planner` (with `AGENTBOARD_LLM_PORT=8140 npm run llm:serve` running and `LLM_BASE_URL=http://127.0.0.1:8140`) are re-run on a clean, committed tree and `npm run results:render` is re-run.

## Check status (last run, 2026-10-08, at the release commit)

- `npm run types:check`: pass
- `npm run typecheck`: pass
- `npm run synth:check`: pass
- `npm test`: pass (projects worker, worker-ws, worker-access, web, node; 34 files, 140 tests)
- `npm run test:sim`: pass (6 tests; all 100 runs reach their expected status; several consecutive runs of 22 to 34 s)
- `npm run count:tests -- --check`: pass (61 orchestration + 39 authz = 100)
- `npm run results:check`: pass (results measured at `83f4c08`, clean tree)
- `npm run build`: pass
- Measured (in `eval/results/`, rendered in the README): eval:sim 100/100 outcome match, 0 duplicate and 0 logical-duplicate side effects, 100/100 valid chains; eval:planner (Qwen3-1.7B Q4_0, llama-server 0.5.0 build 11146) 84/100 valid plans, 9/100 exact tool sequences; count:tests 100/100 passing.

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
25. **Stub fixtures are built from the live catalog.** `llm/fixtures.ts` renders the planner prompt for every dataset request with the catalog the agent actually fetched over MCP (memoized per catalog) and maps its hash to the gold plan, so a prompt or schema change can never desync the stub. The dataset JSON is loaded with a dynamic import (a separate chunk). The plan output schema enumerates the request type's allowed tools, so schema-constrained decoding cannot name another tool; the validator and the coordinator still check everything.
26. **Prompt conventions.** The planner prompt states the notification template for the request type, the ticket-summary wording, the system/role split and the date format. These are console conventions, not policy decisions, and they make the gold arguments reachable for a model; `eval:planner` measures whatever the model then produces.
27. **Planner tests inject providers.** `PlannerAgent.providerOverride` (set through `runInDurableObject`) lets `planner.test.ts` and `plan-guard.test.ts` script model outputs; production code never sets it.
28. **`dispatch.test.ts` #1 lands with commit 19.** "Through the real queue, a launched address_change run reaches succeeded" needs the verifier, which commit 19 implements; at commit 18 every verify task would fail.
29. **Executor test hooks.** `ExecutorAgent.callOverride` (set through `runInDurableObject`) replaces the MCP call so `executor.test.ts` #3 can simulate a call that never returns; production code never sets it. Tests choose the executor instance explicitly (for example attempt 2 on `executor-1`) so the crash-after-call test exercises the integration ledger's replay rather than one shard's journal.
30. **Tests within one file share D1 state** (the plugin isolates storage per test file), so tests that change People data use dataset runs with distinct subjects (`distinctRuns` in `test/helpers/agents.ts`) and count side effects per run or as deltas.
31. **Approval routes arrive with commit 20.** `GET /api/approvals` and `POST /api/approvals/:id/decision` land with the approvals feature (not commit 23) because `approvals-sod.test.ts` asserts the 403 and 409 mappings and `dispatch.test.ts` #2 approves through the API. Shared request schemas and response types now live in `src/shared/api-types.ts`; validation failures answer 400 `invalid_request` in the ApiError shape. A cancelled run's pending approvals are marked `expired` with the note "run cancelled", so they can no longer be decided.
32. **Agent and DLQ routes arrive with commit 21.** `GET /api/agents`, `POST /api/agents/:role/disable|enable`, `GET /api/dlq` and `POST /api/dlq/:id/replay` land with the controls they drive. DLQ replays are audited on the run stream (coordinator) and on the global stream (API).
33. **Launch details.** The API checks the subject against a read-only directory lookup in `PEOPLE_DB` (to reject unknown employees and to build the run title with the employee's name, which feeds search). Section 8.5 says no production path other than the People Ops tools touches `PEOPLE_DB`; this read-only directory (`db/people.ts` `directoryEntry` and `GET /api/people/directory` for the launch picker, permission `runs:launch`) is the one exception. `LaunchRunRequest` also accepts `syntheticRef` and `requestedAt`, gated by `FAULT_INJECTION=on` exactly like `sim`, so the simulator can record its dataset references and business timestamps.
34. **`rbac-matrix.test.ts` #7** covers the audit read now; the search half joins in commit 24 with the search route. `dev-mode.test.ts` #1 shows the `sim` refusal on an app built with `FAULT_INJECTION=off` and dev auth, because an Access-mode token cannot be verified in the `worker` project; `access-jwt.test.ts` #7 (unbound principal) landed here.
35. **Control responses.** A refused recovery command answers 409 with `{ accepted: false, reason, snapshot }`; an accepted one answers 200.
36. **Search response shape.** `GET /api/search` returns `{ items: SearchHit[], nextCursor }` (the spec's table says `SearchHit[]`) because `search.test.ts` requires cursor paging; the cursor is an opaque offset. Queries are reduced to letter and digit runs, each quoted and ANDed, so no FTS5 syntax reaches SQLite. Search documents are upserted by the coordinator's outbox in the same D1 batch as the mirrors.
37. **`ApprovalCard` and its test landed with commit 28**, because the run detail page uses the card; commit 29 adds the approval queue and launch pages. The launch form offers dev-only sample requests from the synthetic dataset (`GET /api/dev/samples`, dev mode and loopback only), because the local stub planner only knows the dataset's prompts.
38. **UI checked by hand** on 2026-10-08 against `wrangler dev` on the built worker (port 8784): dev login, launching a dataset sample, the live run detail reaching `succeeded`, tool-call traces, the verified audit chain, the dashboard and search highlights all rendered and worked.
39. **Eval provenance helper.** `scripts/lib/meta.ts` (not in the layout) writes `{ gitSha, dirty, generatedAt, node, wrangler, seed, provider, model }` into every result. "Dirty" means a tracked or untracked change under the measured paths (`src`, `migrations`, `fixtures`, `scripts`, `wrangler.jsonc`, `package-lock.json`), the same set `results:check` diffs. `eval:sim` writes its own `.dev.vars.eval` with a fresh dev keypair (no dependency on `npm run dev:keys`), runs wrangler dev on port 8784 with inspector port 9234, and kills the process group when done. `npm run llm:serve` takes `AGENTBOARD_LLM_PORT` (default 8080); on this machine the eval used port 8140.
40. **`eval:planner` scoring choices.** Exact match, F1 and argument accuracy score the last plan the model produced (the repair when there was one). The plan output schema has no approval field, so `policy_overrides` counts every policy-gated step in the final valid plans (the model never sets approval).
41. **`count:tests -- --check` and `results:check` join CI in commit 35**, where the README with the rendered counts lands. The check compares the suite with `eval/results/tests.json` and the README's reported counts, and neither exists until the measured results are committed, so adding it at commit 33 would break CI there. `scripts/bootstrap-admin.ts` (SQL for a production admin binding) also lands here.
42. **Extra commit 33a.** The first full planner measurement showed two defects in the scripts: `llama-server --version` prints to stderr, so the recorded build was empty, and two requests that failed at the transport (one timeout, one connection failure) were indistinguishable from invalid plans. Fixing them changed `scripts/`, which made every earlier measurement stale by the `results:check` rule, so all three measurements were taken again at the fixed commit.
43. **Foreign README edits in history.** Another session edited `README.md` in this working tree while commits 12 to 14 were being built. Commit 12 (`cfde7d4`, outbox and audit) swept that session's uncommitted 445-line README into its diff, and that session then committed `6ffb555` ("docs: README with status, architecture, design decisions, local setup and roadmap", no Co-Authored-By trailer) between plan commits 13 and 14. Neither changed any other file. Commit 35 replaced the README entirely, so the current README is this build's. The history was not rewritten; whoever opens the PRs can decide whether to drop `6ffb555` and the README hunk of `cfde7d4`.
44. **Stretch items after the release, and the results staleness rule.** `results:check` fails whenever `src`, `migrations`, `fixtures`, `scripts`, `wrangler.jsonc` or `package-lock.json` differ from the measured commit, so any commit that changes those paths after the v0.4.0 results is red on that one CI step until the measurements are taken again. The stretch items are therefore ordered so the ones outside the measured paths (workflows, `package.json` scripts, ADRs) come first and stay fully green, the three that change `src` or `scripts` (UI tests, dark-mode tokens, the external `/mcp` route) come next, and one re-measurement commit follows them. At those three commits typecheck, tests and build pass and only `results:check` reports the stale measurement; the head of the group passes everything. The preview workflow's built-config check is inline in the workflow (not a new file under `scripts/`) for the same reason.
