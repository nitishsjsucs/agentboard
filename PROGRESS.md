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
| 34 | chore(results): measured simulation, planner and test results | done (measured at 8cb6f3b) |
| 35 | docs: architecture, setup, deploy steps, local versus production and rendered results | done (CI adds count:tests --check and results:check) |
| 36 | chore(release): v0.4.0 changelog and milestone 4 demo script | done (local tag v0.4.0) |

All 36 planned commits are done, plus the extra fix commit 33a. Every item on the section 1.1 "must ship" list exists and is tested.

### After the plan: fixes and stretch items (builder 2)

The stretch items of section 1.1 are built in the spec's cut order where they do not touch measured paths, and the ones that change `src` or `scripts` are grouped before one re-measurement (deviation 44).

| # | Commit | Status |
|---|---|---|
| 37 | fix(scripts): add the npm deploy script that the deploy steps use | done |
| 38 | ci: gated per-PR deploys to the preview environment | done |
| 39 | ci: release workflow that publishes a milestone from its changelog section and demo script | done |
| 40 | docs: ADRs 0003 to 0005 | done |
| 41 | test(web): UI tests for tool-call traces, role and DLQ panels, the confirm dialog, meters and the audit badge | done (16 `ui` tests; results:check stale until 44) |
| 42 | feat(web): dark-mode tokens | done (results:check stale until 44) |
| 43 | feat(mcp): dev-only external /mcp route for MCP Inspector and dev:token --integration | done (results:check stale until 44) |
| 44 | chore(results): re-measure simulation, planner and test results after the stretch items | done (measured at `8f3f1c2`) |
| 45 | docs: README, CHANGELOG and PROGRESS for the stretch items | done |

### Verification round (builder 3)

Nothing planned was left. This round re-checked the starting state, ran the CI sequence in a clean clone, re-ran every measurement, checked the UI in a browser, and closed one small gap from SPEC section 20.

| # | Commit | Status |
|---|---|---|
| 46 | ci: print the worker bundle size after the build | done (deviation 47) |
| 47 | chore(results): re-measure simulation, planner and test results to check that they reproduce | done (measured at `cf21c23`, deviation 48) |
| 48 | docs: PROGRESS and CHANGELOG for the verification round | done |

### Review fixes (builder 4)

Three independent reviews (correctness, security, honesty) of `dd80f7b` returned 24 findings. Each was verified against the code before it was fixed, and all 24 held; none was rejected (see "Review findings" below). Every change under a measured path is followed by one re-measurement commit, as in deviation 44.

| # | Commit | Status |
|---|---|---|
| 49 | test: wait for runs launched through the real queue to settle before the file ends | done (`e549c2c`) |
| 50 | test(authz): the RBAC matrix expects each allowed call's own status | done (`957b8a0`) |
| 51 | test(retries): assert a nonzero task redispatch delay | done (`b364303`) |
| 52 | fix(policy): access.revoke_all_roles only behind the termination approval | done (`28ebd93`, the blocking security finding) |
| 53 | fix(planning): a plan must contain its request type's required writes | done (`fd7461e`) |
| 54 | fix(realtime): accept only the coordinator's own path for run WebSockets | done (`dadf766`) |
| 55 | fix(realtime): close run WebSockets whose identity token has expired | done (`1012b20`) |
| 56 | fix(llm): bound Workers AI calls and the planner's tools/list by their timeouts | done (`ef9922f`) |
| 57 | fix(llm): turn off AI Gateway log collection for planner prompts | done (`280454b`) |
| 58 | fix(planner): count the tokens of a planning attempt whose model call throws | done (`5bc9922`) |
| 59 | fix(budgets): raise_budget must raise at least one field | done (`b0e2ac1`) |
| 60 | fix(eval): count:tests never counts passes from a stale report | done (`0b043c6`) |
| 61 | feat(eval): independent domain-table duplicate check and injected-fault counts in eval:sim | done (`01444e3`) |
| 62 | feat(eval): complete-plan metric and server-read provenance in eval:planner | done (`facfbe2`) |
| 63 | fix(eval): the results staleness check also covers tests, seeds and build config | done (`c198c48`) |
| 64 | chore: require Node 24 in engines, as the README and .nvmrc say | done (`7a5a271`) |
| 65 | fix(eval): record model file names, not local paths, in the planner provenance | done (`b7db936`, extra: the first planner re-measurement at `7a5a271` recorded absolute model paths, so it was discarded and everything was measured again) |
| 66 | chore(results): re-measure simulation, planner and test results after the review fixes | done (`c499cfb`, measured at `b7db936`) |
| 67 | docs: README, ADRs, eval README and release workflow comment for the review fixes | done (`97124a7`) |
| 68 | docs: PROGRESS and CHANGELOG for the review fixes | done |

These commits would form PR 10 (commits 49 to 68). At commits 52 to 65 `results:check` reports the stale measurement by design (deviation 44); commit 66 makes it green again. Commits 49 to 51 change only `test/`, which was not yet a measured path, so every check passes there. For each commit, typecheck and the test files it touches were run before committing; the full `npm test` and `test:sim` also ran at 59, and the whole CI sequence ran at 64 and at the head.

### Verification gate (builder 5)

A final gate that trusted no earlier report: it cloned `52d601a` into a fresh directory, ran `npm ci` and every `ci.yml` step there, ran all evals as documented, and judged the SPEC section 0 resume claims against the code and those numbers.

| # | Commit | Status |
|---|---|---|
| 69 | chore(results): record the verification gate's measurements of 52d601a | done |
| 70 | docs: PROGRESS for the verification gate | done |

Every count, outcome and planner quality metric reproduced exactly (all 100 per-request planner results are identical); only local latencies moved, so the README's Results block no longer matched what the gate measured. Commit 69 replaces the four result files with the gate's (measured in the clean clone of `52d601a`, whose measured paths equal `b7db936`'s), re-renders the README block, adds a README sentence on latency variance that cites the earlier numbers by commit, and adds a CHANGELOG line. Commit 70 updates this file. Neither changes a measured path. PR 10 now covers commits 49 to 70.

### Known-issue fixes (builder 6, 2026-10-09)

This round re-ran every check on `fb9b78e` (all green: typecheck, 155 tests, sim, count check, results check, build), found no planned work left, and fixed the three known minor issues that the earlier rounds had listed under "What is left", each with a test that fails without its fix, then measured everything again.

| # | Commit | Status |
|---|---|---|
| 71 | fix(planner): planner tasks on one shard share a catalog read in flight | done (`aae80c2`, deviation 60) |
| 72 | fix(realtime): run WebSockets are authorized again every five minutes | done (`be6eb22`, deviation 61) |
| 73 | fix(web): dev login waits for the new session before opening the dashboard | done (`b3f5ed8`, deviation 62) |
| 74 | chore(results): re-measure simulation, planner and test results after the known-issue fixes | done (`baf61df`, measured at `b3f5ed8`) |
| 75 | docs: README, CHANGELOG and PROGRESS for the known-issue fixes | done |

These commits would form PR 11 (commits 71 to 75). At commits 71 to 73 `results:check` and `count:tests -- --check` report the stale measurement by design (deviation 44); commit 74 makes them green again. Typecheck and the touched test files ran before each commit, and the full `npm test`, `test:sim`, `types:check`, `synth:check` and `build` ran at 73 before the measurement.

## What is left (human steps)

- Every planned commit (1 to 36, plus 33a), every stretch item of section 1.1, every review finding and the three known minor issues are done. There is no further planned build work in SPEC.md.
- Not done by the builders (needs Nitish, SPEC section 18): pushing; opening the PRs (PR 1 to 8 as in deviation 13, PR 9 = commits 37 to 48, PR 10 = commits 49 to 70, PR 11 = commits 71 to 75); GitHub releases for the local tags `v0.1.0` to `v0.4.0` (after the push: pushing the tags runs each tagged commit's own `ci.yml`, so check those runs, then `gh workflow run release.yml -f tag=v0.1.0` and so on; a hand-run release does not run CI itself); any deployment, Access setup, the preview secrets, and Workers AI planner quality.
- Decide the resume wording before using it: see "Resume claim status" below. Several phrases of SPEC section 0 are not true yet.
- Commit `7ff7a92` and the README hunk of `b7a3199` (deviation 43): history was kept and the CHANGELOG now says where they came from (deviation 57). Rewriting them out remains possible only before the first push; it would move the four tags and require re-running count:tests, eval:sim and eval:planner on the new head, because `results:check` diffs against the recorded `gitSha`.
- Known minor issues: the three listed by earlier rounds are fixed (commits 71 to 73): (a) the dashboard's one 403 for `/api/dlq` right after switching principals on the dev login page, (b) the timing-dependent catalog reads that made tool-call and audit-event totals vary between simulation runs, (c) open run WebSockets that kept their authorization until token expiry. None is known now. `npm audit` reports GHSA-6qxp-vccf-f47h (high) for the pinned MCP SDK packages; the affected OAuth client flow is not used (deviation 64), so the pins were kept.
- If any file under `src`, `migrations`, `fixtures`, `scripts`, `test` or `seed`, or `wrangler.jsonc`, `package.json`, `package-lock.json`, `vite.config.ts` or `vitest.config.ts` changes, `npm run results:check` fails until the measurements are taken again on a clean, committed tree. The exact procedure, used on 2026-10-08 (local time) for commit 66 and on 2026-10-09 for commit 74:
  1. `npm run count:tests`
  2. `npm run eval:sim` (wrangler dev on 127.0.0.1:8784, inspector 9234; it kills its process group when done)
  3. `llama-server -m ~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf --host 127.0.0.1 --port 8140 -np 1 -c 8192 -ngl 99 --reasoning off --jinja` in the background (the same flags as `npm run llm:serve`), then `LLM_BASE_URL=http://127.0.0.1:8140 LLM_SERVER_FLAGS="-np 1 -c 8192 -ngl 99 --reasoning off --jinja" npm run eval:planner` (it reads the model file, context and slot count from the server and refuses a mismatch), then stop llama-server
  4. `npm run eval:planner -- --provider stub` (sanity file, must score 100%)
  5. `npm run results:render`, then commit `eval/results` and the README block together.

## Check status (last run 2026-10-09 local time by builder 6)

In this repository at the head (commit 75; the measured commit is `b3f5ed8`, and commits 74 and 75 change no measured path), Node 25.9.0, npm 11.12.1, on AC power while three other repositories' workerd processes were running:

- `npm run types:check`: pass (exit 0)
- `npm run typecheck`: pass (exit 0)
- `npm run synth:check`: pass (4 files match; runs 100, employees 60)
- `npm test`: pass (exit 0; projects worker, worker-ws, worker-access, web, node; 42 files, 158 tests passed, 0 failed, 0 skipped)
- `npm run test:sim`: pass (1 file, 6 tests)
- `npm run count:tests -- --check`: pass (64 orchestration + 42 authz = 106)
- `npm run results:check`: pass (README block matches the result files, none dirty or stale)
- `npm run build`: pass (`dist/agentboard/index.js` 2479509 bytes, 597698 gzip; client bundle 384.27 kB)
- No `.skip`, `.todo` or `.only` in `test` or `src`.
- Measurements for commit 74, all on a clean tree at `b3f5ed8` with the procedure under "What is left":
  - `npm run count:tests`: 106 tagged, 106 passing, vitest exit 0.
  - `npm run eval:sim`: exit 0 in 2 min 56 s; identical to the `52d601a` measurement in every count except tool calls (573, was 575) and audit events (3228, was 3230): the eval's local D1 holds exactly one `tools/list` call per planner shard (planner-0 and planner-1). Run duration p50 9021 ms and p95 15324 ms, search latency p95 13 ms (was 7277, 10917 and 3 ms; the machine was loaded).
  - `npm run eval:planner` (llama-server b11146-7fe450e19 on 127.0.0.1:8140, `-np 1 -c 8192 -ngl 99 --reasoning off --jinja`): exit 0 in about 16 min; every quality metric and all 100 per-request results identical to `52d601a` (57/100 first pass, 77/100 after repair, 76/100 with every gold write, 0 policy violations, 34/100 exact, F1 0.932, argument accuracy 0.982, 0 transport errors); latency p50 7957 ms and p95 21630 ms (was 3123 and 8961).
  - `npm run eval:planner -- --provider stub`: 100/100 on every metric.
- Processes: this round's llama-server (port 8140) was stopped after the planner eval, and `eval:sim` stopped its `wrangler dev` (ports 8784 and 9234); no wrangler, workerd or llama-server process of this repository is left running. The other repositories' workerd processes were not touched.

Earlier, in the verification gate's clean clone of `52d601a` (builder 5, 2026-10-08), `npm ci` and every `ci.yml` step passed the same way with 155 tests.

## Resume claim status (SPEC sections 0 and 18)

Each phrase of the SPEC section 0 resume text, its state on 2026-10-08 (re-judged by the verification gate; counts updated on 2026-10-09), and what Nitish has to do before using it. Mirror this list in any builder status.

| Phrase | State now | Evidence | Action (SPEC section 18) |
|---|---|---|---|
| "operations console for launching, monitoring, and controlling agents" | true locally | launch, live run detail, recovery controls, approvals; checked in a browser (deviation 38, 48) | none |
| "serving the People organization" | not true: the People organization is simulated | 60 synthetic employees in a simulated D1 database | use "for a simulated People-operations org" |
| "React/TypeScript console on Cloudflare Workers" | runs only on local workerd; nothing is deployed | README "What runs where" | keep "on Cloudflare Workers" only while a deployment is live (deploy steps in the README) |
| "live execution updates, searchable task histories, approval controls, and D1-backed audit records across approximately 100 simulated agent runs" | true locally (local D1) | eval:sim 100 runs, 100/100 valid audit chains | none beyond "simulated" |
| "three specialized agents" | two of the three are deterministic workers | only PlannerAgent calls a model | keep and be ready to explain why, or "a planning agent plus execution and verification workers" |
| "Cloudflare Agents SDK, Durable Objects, Queues, and MCP, with task leases, bounded execution budgets, retry handling, and duplicate-action prevention" | true locally (workerd, Miniflare queues) | 104 tagged tests, eval:sim | none |
| "AI-assisted development workflow using Cursor or OpenCode" | false: the build used Claude Code | 76 of the 77 commits (after commit 75) carry a Claude `Co-Authored-By` trailer; `7ff7a92` lacks it | name the tool actually used, or do real follow-up work in Cursor or OpenCode |
| "Git pull requests" | none opened; all commits are on local `main` | deviation 13 | keep only after the PRs exist (PR 1 to 11) |
| "meaningful commits" | true | 77 conventional commits: plan commits 1 to 36 and 33a, then 37 to 75, plus the foreign `7ff7a92` | none |
| "Cloudflare preview deployments" | not done: `preview.yml` has never run, no account | Deploy step 11 | keep only after `preview.yml` has deployed a PR; wording "per-PR deployments to a preview environment" |
| "approximately 100 orchestration and authorization test cases" | true: 106 tagged, all passing (re-measured at `b3f5ed8`) | count:tests | read the test names before interviews |
| "four sprint demo releases" | four local tags made within one afternoon (14:40, 15:34, 15:59 and 16:54 on 2026-10-08); none is a GitHub release yet | `git for-each-ref refs/tags` | use "four incremental releases with demo scripts", and publish them after the push |

## Review findings (builder 4)

All 24 findings were verified first (by reading the code, and for the behavioral ones by reproducing them: the ungated revoke plan validated, the read-only manager change plan validated, the sub-agent WebSocket path answered 101, the expired-token socket stayed open, the repair call's tokens were lost, the empty budget patch was accepted). Each new or changed test was also run against the unfixed code and failed there. None was rejected as false.

| Lens | Severity | Finding | Disposition |
|---|---|---|---|
| correctness | important | `npm test` flaky: tests return while launched runs still plan | fixed, commits 49 and 50 (`settleRuns`) |
| correctness | important | a read-only plan is valid and the run "succeeds" | fixed, commit 53 (`REQUIRED_WRITES`, `missing_required_step`; deviation 50); measured, commit 66 |
| correctness | important | Workers AI ignores `timeoutMs`; `tools/list` unbounded | fixed, commit 56 |
| correctness | minor | retries #1 delay assertion is vacuous (base 0) | fixed, commit 51 |
| correctness | minor | `raise_budget` accepts an empty or equal patch | fixed, commit 59 |
| correctness | minor | RBAC matrix passes an allowed 500 | fixed, commit 50 |
| correctness | minor | LLM usage lost when the repair call throws | fixed, commit 58 (deviation 53) |
| correctness | minor | count:tests can read a stale report | fixed, commit 60 |
| correctness | minor | eval:sim reads one DLQ page | fixed, commit 61 |
| security | blocking | `access.revoke_all_roles` without the gated termination needs no approval | fixed, commit 52 (option b, `missing_gate`; deviation 50); SPEC 8.2's "behind its approval gate" is now enforced |
| security | important | `/sub/{class}/{name}` WebSocket path reaches any agent class | fixed, commit 54 (exact path check plus `onBeforeSubAgent` refusals; deviation 52) |
| security | minor | WebSocket authorization only at upgrade | fixed for token expiry, commit 55; role-binding re-check on open sockets not done (optional in the finding; README Limitations; deviation 51) |
| security | minor | AI Gateway logs keep request text | fixed, commit 57 (`collectLog: false`; README deploy step 4) |
| honesty | important | planner validity headline hides single-step plans | fixed: commit 53 (validator), commit 62 (`valid_with_gold_writes`), commit 67 (README bullet) |
| honesty | important | unknown-tool rate and policy violations are 0 by construction | fixed, commits 62 and 67 (row label, README bullet, ADR 0003, eval/README) |
| honesty | important | simulation failures are injected, not organic | fixed, commits 61 and 67 (injected counts rendered, sentence in the block, README bullet) |
| honesty | important | PROGRESS omits the resume-wording decisions | fixed, commit 68 ("Resume claim status" above) |
| honesty | important | `7ff7a92` lacks the trailer; `b7a3199` swept in a README hunk | resolved by keeping history with a CHANGELOG note (option b; deviation 57); rewriting stays Nitish's choice before the push |
| honesty | minor | planner provenance asserted, not read; `llm:serve` lacked `-ngl 99` | fixed, commits 62 and 65 |
| honesty | minor | staleness check misses tests, seeds and build config | fixed, commit 63 (deviation 55) |
| honesty | minor | duplicate side-effect zeros come only from the ledger's own table | fixed, commit 61 (independent domain-table check) and commit 67 (README bullet) |
| honesty | minor | README cites retries tests by SPEC number | fixed, commit 67 (cited by name) |
| honesty | minor | `engines.node` says `>=22.12` | fixed, commit 64 |
| honesty | minor | release.yml claims tagged commits passed CI | fixed, commit 67 (comment and README reworded; dispatched releases skip CI and the tags' own CI runs must be checked) |

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
13. **Commits are on local `main`; tags are local.** No branches, PRs or pushes are made by the builders (pushing happens after verification). The PR boundaries of section 19 map to commit ranges: PR 1 = commits 1 to 4, PR 2 = 5 to 8, PR 3 = 9 to 12, PR 4 = 13 to 16, PR 5 = 17 to 22, PR 6 = 23 to 25, PR 7 = 26 to 30, PR 8 = 31 to 36, and after the plan PR 9 = 37 to 48 (fixes, stretch items and the verification round). Milestone tags (`v0.1.0` ...) are created locally on the last commit of each milestone; GitHub releases need a push.
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
43. **Foreign README edits in history.** Another session edited `README.md` in this working tree while commits 12 to 14 were being built. Commit 12 (`b7a3199`, outbox and audit) swept that session's uncommitted 445-line README into its diff, and that session then committed `7ff7a92` ("docs: README with status, architecture, design decisions, local setup and roadmap", no Co-Authored-By trailer) between plan commits 13 and 14. Neither changed any other file. Commit 35 replaced the README entirely, so the current README is this build's. The history was not rewritten; whoever opens the PRs can decide whether to drop `7ff7a92` and the README hunk of `b7a3199`.
44. **Stretch items after the release, and the results staleness rule.** `results:check` fails whenever `src`, `migrations`, `fixtures`, `scripts`, `wrangler.jsonc` or `package-lock.json` differ from the measured commit, so any commit that changes those paths after the v0.4.0 results is red on that one CI step until the measurements are taken again. The stretch items are therefore ordered so the ones outside the measured paths (workflows, `package.json` scripts, ADRs) come first and stay fully green, the three that change `src` or `scripts` (UI tests, dark-mode tokens, the external `/mcp` route) come next, and one re-measurement commit follows them. At those three commits typecheck, tests and build pass and only `results:check` reports the stale measurement; the head of the group passes everything. The preview workflow's built-config check is inline in the workflow (not a new file under `scripts/`) for the same reason.
45. **ADRs 0003 to 0005 are new decisions, not revision 1's.** Section 1.1 removed revision 1's ADRs 0003 to 0005 (they covered features that were cut) and lists "ADRs beyond 0001 and 0002" as a stretch item. The new 0003 to 0005 record decisions of revision 2 that the build implements: policy-owned approvals with plan rejection and gating edges (sections 11.3, I3, I10), derived run status with recovery cascades (sections 3.3 to 3.5, B3), and measured results with provenance and the staleness check (section 14, M10).
46. **External `/mcp` route details.** Beyond section 8.1's `MCP_EXTERNAL=on` gate, the route also answers 404 unless the request hostname is loopback (like the dev routes; it also defeats a DNS name rebound to 127.0.0.1, and the agents handler's `allowedHostnames` would refuse such a host with 403 anyway). `dev:token -- --integration` mints an executor-shaped token for one read tool and its exact (schema-validated) arguments with a 60 s pseudo-lease (`sub` `mcp-inspector`, run and task ids `run_inspector` and `tsk_inspector`); it refuses write tools, so nothing applied through the external route can bypass a coordinator lease. The claim builder lives in `src/worker/mcp/inspector-token.ts` (not in the layout) so the Node script and the worker test share it. `test/worker/mcp/external-route.test.ts` (2 tests, tag `integration`, outside the 100) covers the 404 cases, the bound read, an args mismatch, an unbound write and a write token without its `_meta`.
47. **CI prints the worker bundle size (commit 46).** Section 20 says "CI prints the size of the built `index.js`", but the final CI shape in section 17 does not list the step and `ci.yml` lacked it. After `npm run build` CI now prints the raw and gzip size of `dist/agentboard/index.js` and its lazily loaded chunks, also into the job summary. It is outside the measured paths, so `results:check` is unaffected. Locally: `index.js` 2469115 bytes (591979 gzip), plus a dataset chunk (206969 bytes) and two library chunks (230860 and 1793 bytes).
48. **Re-measurement to check reproducibility (commit 47).** Builder 3 took every measurement again on `cf21c23`, whose measured paths equal `8f3f1c2`'s, with the procedure under "What is left". Everything reproduced: the simulation's outcome, retry, replay, lease, refusal, approval, budget, verifier, recovery, search and chain counts are identical, and so are all planner quality metrics (temperature 0, seed 7). Only local latencies moved, plus 2 tool calls and 2 audit events (575 to 577, 3230 to 3232). The cause is timing: `PlannerAgent` checks `ab_catalog_cache`, awaits `tools/list`, then fills the cache, so planner tasks that interleave on one shard before the first fetch finishes each fetch (and trace) the catalog; the new run had 6 such reads. This is harmless (each read is traced and budgeted) and the README now says these two totals vary between runs; a single-flight cache would make them stable but changes `src`, so it was left. After the commit, the full CI sequence (`npm ci --prefer-offline`, then every `ci.yml` step) passed in a clean clone of `799bb24` with no `.dev.vars` and no `.wrangler` state, on Node 25.9 (no Node 24 is installed on this Mac, so the README no longer implies Node 24 was verified). The UI was checked in a browser against `serve:built` in dark and light mode: dev login, launching a sample manager change, the live run detail reaching `awaiting_approval`, approving it as another principal, the run reaching `succeeded`, the verified audit chain (32 events) and search highlights.
49. **104 tagged tests instead of 100.** SPEC section 13.1 plans exactly 100 (61 orchestration, 39 authz). The review fixes added four tagged tests for new behavior: `plan-guard.test.ts` #2 (authz, the ungated revoke), `websocket-auth.test.ts` #5 (authz, socket closed at token expiry), `planner.test.ts` #5 (orchestration, missing required write) and #6 (orchestration, tokens of a failed model call). Where the topic was the same, existing tests were extended instead (`websocket-auth.test.ts` #3 sub-agent paths, `budgets.test.ts` #5 empty and equal patches, `retries.test.ts` #1 nonzero delay, every RBAC matrix call's expected status, `planner.test.ts` #3 now also expects `missing_required_step`). Measured: 63 + 41 = 104, all passing; "approximately 100" still holds. One untagged `llm` test (Workers AI timeout) was also added.
50. **Plan-level policy rules beyond section 11.3.** `policy.ts` adds `REQUIRED_WRITES` per request type, checked by `checkPlanPolicy` as the repairable issue `missing_required_step`, and `missing_gate` for `access.revoke_all_roles` without `hris.set_employment_status` to `terminated` in the same plan. `missing_gate` counts as a policy violation, so `policyViolations` and the eval's `policy_violations` include it (section 14.2 counts only `tool_not_allowed` and `off_subject`). Offboarding also requires `itsm.create_ticket` (the laptop return), because every offboarding request template asks for it; the review's table listed only the status change and the revoke. No type requires `notify.send`, which is not the requested change. The planner prompt names the required writes in one line after rule 4; the stub fixtures are built from the live prompt (deviation 25), so they follow. This prompt line is part of why the measured planner quality rose (README "Reading the results").
51. **WebSocket session expiry.** Not in section 10.2. `authenticate` returns the token's expiry; the route refuses a token without `exp` and forwards the expiry in `x-agentboard-session-expires`, always overwriting a client value; `RunCoordinator` sends no protocol frames to a connection without a live session, keeps the expiry in connection state (it survives hibernation) and, before every snapshot broadcast, closes expired sockets with code 4401. Role bindings are not re-checked on open sockets.
52. **Sub-agents refused.** The Agents SDK's sub-agent routing postdates the spec. The route accepts only the exact path `/agents/run-coordinator/<runId>`, and `RunCoordinator` and the role agents override `onBeforeSubAgent` to answer 404.
53. **Planner failure accounting.** A failed model call throws `PlanningError` with the tokens and calls so far; `PlannerAgent` logs the calls with error `llm_error` and rethrows; the role skeleton's `agent_exception` report carries the error's `llmTokens`. The failure code stays `agent_exception`, so `retries.test.ts` #3 is unchanged. `LlmResult` gains an optional `servedModel` (section 11.1 has no such field).
54. **Eval additions beyond section 14.** `simulation.json`: `domain_inserts`, `domain_inserts_expected`, `domain_duplicate_inserts`, `domain_missing_inserts` (eval:sim exits non-zero unless both are 0), `injected_by_modifier`, `injected_transient_twice`; the dev side-effects route returns the domain counts. `planner-*.json`: `valid_with_gold_writes`, `server` (from `/props` and `/v1/models`), `served_models` and per-request `servedModel` (file names only); `gguf`, `quant` and `llama_cpp_build` now come from the server, and the eval exits before measuring unless the server serves the expected file in one 8192-token slot. `tests.json`: `vitestExitCode`, which must be 0.
55. **Measured paths widened.** Beyond section 14's list, `MEASURED_PATHS` (the dirty check and `results:check`) includes `test`, `seed`, `vite.config.ts`, `vitest.config.ts` and `package.json`, so a change to a tagged test or the build configuration also makes the results stale. ADR 0005 and eval/README.md say so.
56. **Budget raises.** `BudgetPatchSchema` requires at least one budget field (400 otherwise), the coordinator refuses a patch that raises nothing as `not_a_raise`, and `ConfirmDialog` takes `confirmDisabled` so the raise dialog cannot confirm a non-raise.
57. **History kept for `7ff7a92` and `b7a3199`.** Of the honesty review's two options, the non-destructive one was taken: the CHANGELOG's Unreleased section says those changes came from a parallel session and that `7ff7a92` lacks the trailer. Rewriting history is a decision for Nitish before the first push (see "What is left").
58. **Environmental test failures.** Two full `npm test` runs in this round failed with "Timeout starting cloudflare-pool runner" and tests timing out after 90 to 900 s of wall clock while the Mac was on battery and heavily loaded by another repo's eval. The same tree passed on the following runs, including twice in a row at the head and in a clean clone. No test was changed in response.
59. **Verification gate results come from a clean clone.** The gate measured in a fresh clone of `52d601a` rather than in this working tree, so that the numbers come from `npm ci` and committed files only, and then copied the four result files into this repository unchanged. They record `gitSha` `52d601a` and `dirty: false`; since commits 69 and 70 change no measured path, `results:check` accepts them here. Only latencies differ from the `b7db936` measurement.
60. **Shared catalog read (commit 71).** `PlannerAgent` keeps the `tools/list` read in flight in memory (`catalogRead`); a planner task that finds the 5-minute cache empty while a read is in flight awaits that read instead of reading and tracing the catalog itself, and shares its outcome. A failed read fails every waiting task with `agent_exception` (retryable) rather than letting a waiter read again, so no task spends more than one `TOOL_TIMEOUT_MS` on the catalog and the planner lease bound of section 5.2 still holds. Only the task that made the read traces it, as before. A test-only hook, `PlannerAgent.catalogReadOverride` (set through `runInDurableObject`, like deviations 27 and 29), wraps the read so `planner.test.ts` #7 can hold it open; the race did not reproduce without it, because the in-process MCP read finishes before the other task's claim returns. In the simulation, the totals now include exactly one catalog read per shard.
61. **WebSocket reauthorization (commit 72).** Not in section 10.2. Besides the token expiry (`x-agentboard-session-expires`, deviation 51), the route forwards `x-agentboard-reauthorize-at`, set to `WS_REAUTHORIZE_MS` (5 minutes, a constant in `realtime.ts`, not a config var) after the upgrade and always overwriting a client value. Before every broadcast the coordinator closes a socket whose token has expired with 4401, and a socket past its reauthorization time with 1000. `useAgent` (agents 0.27.0, `isTerminalCloseEvent`) does not reconnect after 1008 or 4000 to 4999, so 4401 stays terminal for expired tokens, while after 1000 the client reconnects through the route, which runs `authenticate` (token and role binding) again. A socket with no broadcast stays open but receives nothing. `handleAgentRoute` takes the interval as an optional fourth parameter so `websocket-auth.test.ts` #6 can use 1.5 s.
62. **Awaitable session reload (commit 73).** `Session.reload` returns a promise that resolves once the session state holds the new `/api/health` and `/api/me` answers; only the latest load applies its answers. `DevLogin` awaits it before navigating to the dashboard. `src/web/pages/__tests__/DevLogin.test.tsx` (tag `ui`, not in the 106) renders the whole app against a fake dev API.
63. **106 tagged tests.** Commits 71 and 72 each add one tagged test (`planner.test.ts` #7, orchestration; `websocket-auth.test.ts` #6, authz), so the count is 64 + 42 = 106 after deviation 49's 104. The web project has 17 tests (16 component tests and the dev login page test).
64. **`npm audit` advisory left as is.** GHSA-6qxp-vccf-f47h (high) covers `@modelcontextprotocol/client` below 2.2.0 and `@modelcontextprotocol/sdk` below 1.31.0 (both direct pins here, also required by `agents`): the SDK's OAuth client could send credentials to an authorization server chosen by the MCP server. The only MCP client here (`mcp/client.ts`) passes `authProvider: { token }`, which the SDK's `isOAuthClientProvider` does not treat as an OAuth provider (it needs `tokens()` and `clientInformation()`), it talks only to the in-process People Ops endpoint, and the Agents SDK's MCP client manager is not used. Upgrading would leave the versions section 2.2 verified, so the pins were kept and the README Limitations section records the advisory.
