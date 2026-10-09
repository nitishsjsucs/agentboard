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

### Re-verification of the known-issue fixes (builder 7, 2026-10-09)

The workflow asked for this round again ("Try again"). Nothing planned was left at `6711458`, so the round re-checked the starting state, verified commits 71 to 75 from committed files only, and recorded the results. No file under a measured path changed.

| # | Commit | Status |
|---|---|---|
| 76 | docs: PROGRESS, README and CHANGELOG for the re-verification of the known-issue fixes | done |

Commit 76 joins PR 11, which now covers commits 71 to 76.

What was checked (details under "Check status"):

- Starting state in this working tree at `6711458`: every check green (typecheck, `types:check`, `synth:check`, 158 tests, `test:sim`, `count:tests -- --check`, `results:check`, build).
- A clean clone of `6711458` (no `.dev.vars`, no `.wrangler` state, `npm ci --prefer-offline`) passed every `ci.yml` step. The verification gate had done this for `52d601a`, but commits 71 to 75 had only run in this working tree.
- `npm run eval:sim` in that clone reproduced every count of the committed `b3f5ed8` measurement exactly, including 573 tool calls and 3228 audit events, which confirms that commit 71 made those totals stable; only latencies moved. The result file was not committed (the README cites it in one sentence), so the Results block still shows `b3f5ed8`.
- `npm run eval:planner -- --provider stub` in the clone: 100/100 on every metric; only per-request latencies differ from the committed file. The llama-server planner eval was not run again: its quality metrics and all 100 per-request results already reproduced at `b7db936`, `52d601a` and `b3f5ed8`, and commit 71 does not touch the code path it measures.
- Browser check against `serve:built` in the clone (dark mode): dev login as Admin, then switching to Ana Viewer; the viewer's dashboard made no `/api/dlq` request and no 403 appeared (known issue (a) stays fixed). As Kim Operator, launching sample `syn-0006` (address change) opened the live run detail, which reached `succeeded`, and the Audit tab reported a verified hash chain of 28 events. The only console error was the expected 401 for `/api/me` before login.

### Second review fixes (builder 8, 2026-10-09)

Three independent reviews (correctness, security, honesty) of `8b87a11` returned 17 findings (2 blocking, 4 important, 11 minor). Each was verified first; all 17 held and none was rejected (see "Review findings (builder 8)"). The work was done on the local branch `review-fixes-2`, and local `main` was fast-forwarded to it only after every check passed (deviation 66).

| # | Commit | Status |
|---|---|---|
| 77 | fix(queue): a redelivered DLQ message keeps its dead-letter and stays replayable | done (`4c7aded`) |
| 78 | test(coordinator): cover the verify, plan and expired-approval recovery rules | done (`561f864`) |
| 79 | test(budgets): test the planner's real output cap, including the repair and the exhausted path | done (`6d4c33d`) |
| 80 | test(executor): cover the journal fast path, and document where redispatches land | done (`ffa169d`) |
| 81 | fix(dlq): a dead letter is open only while its task is still dead-lettered, and a refused replay is shown | done (`3882cf5`) |
| 82 | test(synth): write the SPEC 12.1 request-type and modifier counts into the generator test | done (`a0be217`) |
| 83 | fix(security): anti-framing and other security headers on the console and the API | done (`45020e8`) |
| 84 | ci(preview): pass the Cloudflare token only to the migration and deploy steps | done (`e7af3fe`) |
| 85 | fix(config): deployed environments refuse the OpenAI-compatible LLM provider | done (`80cbef5`) |
| 86 | fix(eval): results:check names a measured commit that is missing from the history | done (`83fb6fb`) |
| 87 | chore(results): re-measure simulation, planner and test results after the second review's fixes | done (`ab705c7`, measured at `83fb6fb`) |
| 88 | docs: README, CHANGELOG, ADR 0005, milestone 4 demo and release comment for the second review | done |
| 89 | docs: PROGRESS for the second review | done |

At commits 77 to 86 `results:check` reports the stale measurement by design (deviation 44), and from 78 (the first new tagged test) so does `count:tests -- --check`; commit 87 makes both green. Typecheck and the touched test files ran before each commit. New and changed tests were shown to fail without what they guard: the DLQ redelivery and DLQ open-state assertions on the unfixed code, the DlqPanel and header tests against the previous `DlqPanel.tsx` and `app.ts`, and the recovery-rule, output-cap, `reapedFrom` and journal tests under a mutation that disabled the rule (each of the four recovery rules in turn, `outputCap` returning 800, the `reapedFrom` fence removed, the journal fast path disabled). Not run that way: the new `dev-mode.test.ts` case (the old `parseConfig` had no rule for it, as the review showed) and the generator test (its constants already match SPEC 12.1). The full `npm test`, `test:sim`, `types:check`, `synth:check` and `build` ran at 86 before the measurement, and the whole CI sequence ran again at the head.

The GitHub repository is not this round's doing: an external publish loop (deviation 66) copies local `main` to GitHub about once an hour as an automatically merged pull request. It published `8b87a11` as PR #10 at 20:11 UTC while this round worked on its branch; the commits above reach GitHub only on a later pass after `main` was fast-forwarded.

### Final verification gate (builder 9, 2026-10-09)

The workflow asked for this round ("Try again") as the final gate, trusting no earlier report. It cloned `6541d6e` (commit 89) into a fresh directory, ran `npm ci` and every `ci.yml` step there, re-ran every eval as documented, judged the SPEC section 0 resume claims against the code, those numbers and the GitHub repository, and deleted the clone afterwards. Nothing planned was left.

| # | Commit | Status |
|---|---|---|
| 90 | chore(results): record the final verification gate's measurements of 6541d6e | done (`d7811c7`) |
| 91 | docs: PROGRESS for the final verification gate | done |

Every count, outcome and planner quality metric reproduced exactly, including all 100 per-request planner results and the worker bundle sha256; only local latencies moved, so the README Results block no longer matched what the gate measured. Commit 90 replaces the four result files with the gate's (measured in the clean clone of `6541d6e`, whose measured paths equal `83fb6fb`'s), re-renders the README block, updates the README note on latency variance to cite the `83fb6fb` numbers by commit, and adds a CHANGELOG line. Commit 91 updates this file. Neither changes a measured path, so `results:check` stays green. Both commits are local; GitHub's `main` was still at PR #10 (`8b87a11`) when this round checked it, so commits 77 to 91 reach GitHub only through the publish loop.

## What is left (human steps)

- Every planned commit (1 to 36, plus 33a), every stretch item of section 1.1, every review finding and the three known minor issues are done. There is no further planned build work in SPEC.md.
- The builders never push. The GitHub repository is filled by Nitish's publish loop (`~/Developer/projects/_publish/loop.sh` running `sync.sh agentboard --pr` about once an hour), which copies each local `main` commit without its `Co-Authored-By: Claude` trailer, rewrites commit ids cited in files to the published ones, and opens and merges one pull request per increment within seconds, without review. Its state on 2026-10-09 is in the README section "History, pull requests and authorship" and in "Resume claim status" below. The PR boundaries planned in deviation 13 (PR 1 to 11) were never used.
- Needs Nitish (SPEC section 18): GitHub releases for the four tags (none exists). The tags' own CI passed for `v0.1.0` to `v0.3.0` and failed for `v0.4.0`: the result files in that tagged commit cite the working repository's commit id, which the published history does not contain, so `results:check` cannot pass there without moving the tag. Decide whether to publish `v0.4.0` as is (with that note), or move the tag, then run `gh workflow run release.yml -f tag=v0.1.0` and so on (a hand-run release does not run CI itself). Also: any deployment, Access setup, the preview environment (`preview` GitHub environment with required reviewers and the two secrets, repository variable `PREVIEW_DEPLOYS=on`, README deploy step 11), and Workers AI planner quality.
- Whether the published history should carry the `Co-Authored-By` trailers is Nitish's choice in the publish step (the honesty review's option (a)); this round took option (b) and made every document say that the published commits carry none.
- Decide the resume wording before using it: see "Resume claim status" below. Several phrases of SPEC section 0 are not true yet.
- Commit `7ff7a92` and the README hunk of `b7a3199` (deviation 43): history was kept and the CHANGELOG says where they came from (deviation 57). Both are on GitHub's `main` already (merged with PR #1), so removing them now means force-pushing the public history and the four tags, and measuring again on the new head, because `results:check` diffs against the recorded `gitSha`.
- Known minor issues: the three listed by earlier rounds are fixed (commits 71 to 73). Known now: a DLQ message whose first delivery inserted its row and then failed before the coordinator committed, followed by a change to the task before the redelivery, keeps the outcome `dead_lettered` (deviation 67); it is not counted as open. The executor journal is reachable only at attempt 3 with the default 2 shards (deviation 73). `npm audit` reports GHSA-6qxp-vccf-f47h (high) for the pinned MCP SDK packages; the affected OAuth client flow is not used (deviation 64), so the pins were kept.
- If any file under `src`, `migrations`, `fixtures`, `scripts`, `test` or `seed`, or `wrangler.jsonc`, `package.json`, `package-lock.json`, `vite.config.ts` or `vitest.config.ts` changes, `npm run results:check` fails until the measurements are taken again on a clean, committed tree. The exact procedure, used on 2026-10-08 (local time) for commit 66 and on 2026-10-09 for commit 74:
  1. `npm run count:tests`
  2. `npm run eval:sim` (wrangler dev on 127.0.0.1:8784, inspector 9234; it kills its process group when done)
  3. `llama-server -m ~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf --host 127.0.0.1 --port 8140 -np 1 -c 8192 -ngl 99 --reasoning off --jinja` in the background (the same flags as `npm run llm:serve`), then `LLM_BASE_URL=http://127.0.0.1:8140 LLM_SERVER_FLAGS="-np 1 -c 8192 -ngl 99 --reasoning off --jinja" npm run eval:planner` (it reads the model file, context and slot count from the server and refuses a mismatch), then stop llama-server
  4. `npm run eval:planner -- --provider stub` (sanity file, must score 100%)
  5. `npm run results:render`, then commit `eval/results` and the README block together.
  Builder 8 used the same procedure on 2026-10-09 for commit 87, and builder 9 (the final gate) in a fresh clone of `6541d6e` for commit 90.

## Check status (last run 2026-10-09 local time by builder 9)

Builder 9 (the final verification gate), Node 25.9.0, npm 11.12.1, on AC power (Low Power Mode off) while another repository's wrangler dev and workerd processes were running.

- In a fresh clone of `6541d6e` (`git clone` of this repository into `/tmp/gate-agentboard`; no `.dev.vars`, no `.wrangler` state): `npm ci` (281 packages; `npm audit` reports 3 high-severity entries, all GHSA-6qxp-vccf-f47h through the pinned MCP SDK packages and `agents`, as the README describes), `types:check`, `typecheck`, `synth:check` (4 files match; runs 100, employees 60), `npm test` (projects worker, worker-ws, worker-access, web, node; 42 files, 161 tests passed, 0 failed, 0 skipped), `test:sim` (1 file, 6 tests), `count:tests -- --check` (66 orchestration + 42 authz = 108), `results:check` (block matches 3 result files, none dirty or stale) and `build` all exit 0. The CI bundle-size step's method gives `dist/agentboard/index.js` 2489364 bytes (597945 gzip -9), plus the dataset chunk 206969, a library chunk 230860 and the rolldown runtime 1793 bytes; client bundle 384.57 kB (118.05 kB gzip). No `.skip`, `.todo` or `.only` in `test`, `src` or `scripts`.
- Measurements for commit 90, all in that clone on the clean tree at `6541d6e` with the procedure under "What is left":
  - `npm run count:tests`: 108 tagged (66 + 42), 108 passing, vitest exit 0 (1 min 21 s, 20:27 to 20:28 UTC).
  - `npm run eval:sim`: exit 0 in 1 min 54 s (20:28 to 20:30 UTC); bundle sha256 and every count equal to the `83fb6fb` measurement (100 runs, 100/100 outcome match, 573 tool calls, 3228 audit events, 100/100 valid chains, 0 duplicate and logical-duplicate side effects, 0 duplicate and 0 missing domain-table rows, 20/20 known-item search at 1 and at 5); run duration p50 7296 ms and p95 10884 ms, search latency p50 2 ms and p95 5 ms.
  - `npm run eval:planner` (llama-server b11146-7fe450e19 on 127.0.0.1:8140, `-np 1 -c 8192 -ngl 99 --reasoning off --jinja`): exit 0 in 7 min 20 s (20:30 to 20:38 UTC); every quality metric and all 100 per-request results identical to `83fb6fb` (57/100 first pass, 77/100 after repair, 76/100 with every gold write, 0 policy violations, 34/100 exact, F1 0.932, argument accuracy 0.982, 0 transport errors); latency p50 3141 ms and p95 8530 ms.
  - `npm run eval:planner -- --provider stub`: 100/100 on every metric.
- In this working tree after commit 90 (result files and docs only): `types:check`, `typecheck`, `synth:check`, `npm test` (42 files, 161 passed, 0 failed), `test:sim` (6), `count:tests -- --check` (108), `results:check` and `build` all exit 0.
- No browser check this round: no UI code changed since builder 8's browser check after commit 83.
- Processes: `eval:sim` stopped its own `wrangler dev`, and this round's llama-server on port 8140 was stopped with SIGTERM after the planner eval; no wrangler, workerd or llama-server process of this repository or its clone is left running, ports 8784, 9234 and 8140 have no listener, and the clone was deleted. The other repository's processes (onboardflow, port 8781) were not touched.

### Builder 8's run

Builder 8, Node 25.9.0, npm 11.12.1, on AC power while other repositories' workerd and llama-server processes were running.

- Starting state at `8b87a11`: the correctness reviewer re-ran every check there and reported all green; this round did not repeat the full run before its first change (it ran the touched test files against the unfixed code).
- In this working tree at `ba67028` (commit 88, the last commit before this file's update; commit 89 changes only this file): `types:check`, `typecheck`, `synth:check` (4 files match), `npm test` (projects worker, worker-ws, worker-access, web, node; 42 files, 161 tests passed, 0 failed, 0 skipped), `test:sim` (1 file, 6 tests), `count:tests -- --check` (66 orchestration + 42 authz = 108), `results:check` (block matches 3 result files, none dirty or stale) and `build` all exit 0. `dist/agentboard/index.js` 2489364 bytes (597945 gzip -9); client bundle 384.57 kB (118.05 kB gzip).
- In a clean clone of `ba67028` (no `.dev.vars`, no `.wrangler` state, `npm ci --prefer-offline`): all nine `ci.yml` steps exit 0 with the same counts (42 files and 161 tests, sim 6, 66 + 42 = 108, results block matches).
- Measurements for commit 87, all on the clean tree at `83fb6fb` with the procedure under "What is left":
  - `npm run count:tests`: 108 tagged (66 + 42), 108 passing, vitest exit 0 (3 min 17 s).
  - `npm run eval:sim`: exit 0 in 2 min 25 s; every count equal to the `b3f5ed8` measurement (573 tool calls, 3228 audit events, 100/100 outcome match, 0 duplicate and logical-duplicate side effects); run duration p50 8398 ms and p95 14025 ms, search latency p50 2 ms and p95 3 ms.
  - `npm run eval:planner` (llama-server b11146-7fe450e19 on 127.0.0.1:8140, `-np 1 -c 8192 -ngl 99 --reasoning off --jinja`): exit 0 in about 8 min; every quality metric and all 100 per-request results identical to `b3f5ed8` (57/100 first pass, 77/100 after repair, 76/100 with every gold write, 0 policy violations, 34/100 exact, F1 0.932, argument accuracy 0.982, 0 transport errors); latency p50 3250 ms and p95 8828 ms.
  - `npm run eval:planner -- --provider stub`: 100/100 on every metric.
- Browser check against `serve:built` (port 8784) after commit 83: the security headers on `/`, an SPA route and `/api/health`; dev login as Kim Operator, launching sample `syn-0006`, the live run detail reaching `succeeded`, and the dashboard (0 open dead letters) under the new CSP, with no CSP violation in the console (only the expected 401 for `/api/me` before login).
- Processes: this round's `serve:built` was stopped with SIGTERM, `eval:sim` stopped its own `wrangler dev`, and the llama-server on port 8140 was stopped after the planner eval; no wrangler, workerd or llama-server process of this repository is left running, and ports 8784, 9234 and 8140 have no listener. The other repositories' processes (including a llama-server on port 8120) were not touched.

### Earlier runs

Builder 7, Node 25.9.0, npm 11.12.1, on AC power (Low Power Mode off) while other repositories' vitest and workerd processes were running. The measured commit is still `b3f5ed8`; commits 74 to 76 change no measured path.

- In this working tree at `6711458` (start of the round) and again at the head after commit 76: `types:check`, `typecheck`, `synth:check` (4 files match), `npm test` (42 files, 158 passed, 0 failed, 0 skipped), `test:sim` (1 file, 6 tests), `count:tests -- --check` (64 + 42 = 106), `results:check` (block matches, none dirty or stale) and `build` all pass with exit 0.
- In a clean clone of `6711458` after `npm ci --prefer-offline`: the same eight `ci.yml` steps all exit 0 with the same counts. The CI bundle-size step's method gives `dist/agentboard/index.js` 2479509 bytes (595320 gzip -9), plus the dataset chunk 206969, a library chunk 230860 and the rolldown runtime 1793 bytes; client bundle 384.27 kB (117.95 kB gzip).
- `npm run eval:sim` in the clone (2026-10-09 19:11 to 19:13 UTC, exit 0, 1 min 54 s, result `gitSha` `6711458`, `dirty: false`, bundle sha256 identical to the `b3f5ed8` measurement): every metric equal to the committed `simulation.json` except run duration p50 7327 ms and p95 11175 ms (committed 9021 and 15324), search latency p50 1.8 ms and p95 3.2 ms (committed 7.6 and 12.5) and the driver's wall clock. Not committed (see the round section above).
- `npm run eval:planner -- --provider stub` in the clone: exit 0, 100/100 on every metric; only `latencyMs` differs per request.
- Processes: the clone's `eval:sim` stopped its own `wrangler dev`, and the clone's `serve:built` (ports 8784 and 9234) was stopped with SIGTERM after the browser check; no wrangler, workerd or llama-server process of this repository or its clone is left running, and ports 8784, 9234 and 8140 have no listener. No llama-server was started this round.

Builder 6's run at commit 75 (it produced the committed measurements), in this repository, on AC power while three other repositories' workerd processes were running:

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

Each phrase of the SPEC section 0 resume text, its state (re-judged by builder 9, the final verification gate, on 2026-10-09 against the code, the gate's own measurements in a fresh clone of `6541d6e`, and the GitHub repository as of about 20:50 UTC: PRs #1 to #10 with 0 reviews each, `ci.yml` 35 runs with 16 failures, `preview.yml` 8 runs with the deploy job skipped, 0 deployments, 0 releases, the four tags with CI passing for `v0.1.0` to `v0.3.0` and failing for `v0.4.0`, and no `Co-Authored-By` trailer in the 89 commits on GitHub's `main`; every one of those matched builder 8's judgement), and what Nitish has to do before using it. Mirror this list in any builder status. The publish loop keeps adding pull requests and CI runs after that time, so check GitHub for later numbers.

| Phrase | State now | Evidence | Action (SPEC section 18) |
|---|---|---|---|
| "operations console for launching, monitoring, and controlling agents" | true locally | launch, live run detail, recovery controls, approvals; checked in a browser (deviation 38, 48) | none |
| "serving the People organization" | not true: the People organization is simulated | 60 synthetic employees in a simulated D1 database | use "for a simulated People-operations org" |
| "React/TypeScript console on Cloudflare Workers" | runs only on local workerd; nothing is deployed | README "What runs where" | keep "on Cloudflare Workers" only while a deployment is live (deploy steps in the README) |
| "live execution updates, searchable task histories, approval controls, and D1-backed audit records across approximately 100 simulated agent runs" | true locally (local D1) | eval:sim 100 runs, 100/100 valid audit chains | none beyond "simulated" |
| "three specialized agents" | two of the three are deterministic workers | only PlannerAgent calls a model | keep and be ready to explain why, or "a planning agent plus execution and verification workers" |
| "Cloudflare Agents SDK, Durable Objects, Queues, and MCP, with task leases, bounded execution budgets, retry handling, and duplicate-action prevention" | true locally (workerd, Miniflare queues) | 108 tagged tests, eval:sim | none |
| "AI-assisted development workflow using Cursor or OpenCode" | false: the build used Claude Code | In this working repository every commit except `7ff7a92` carries a Claude `Co-Authored-By` trailer; on GitHub none of the 89 published commits does, because the publish step strips them. The README section "History, pull requests and authorship" names Claude Code | name the tool actually used (Claude Code), or do real follow-up work in Cursor or OpenCode. Do not use the "Cursor or OpenCode" wording |
| "Git pull requests" | not true as a workflow: PRs #1 to #10 exist, but each was opened and merged by the publish loop within 2 to 4 seconds, with no review and before its CI finished; #3 to #6 and #8 were merged with failing CI; commits 1 to 8 were pushed straight to `main`; #7 holds only a commit the publish loop made itself | `gh pr list --state all`, `gh run list` | do not claim a review-based pull-request workflow; claim pull requests only after real ones are reviewed and merged on green CI |
| "meaningful commits" | true | 93 conventional commits in this working repository after commit 91 (plan commits 1 to 36 and 33a, then 37 to 91, plus the foreign `7ff7a92`); GitHub shows the same commits without trailers plus merge commits and the publish loop's own commit | none |
| "Cloudflare preview deployments" | not done: `preview.yml` ran on 8 pull requests and its deploy job was skipped every time; the repository has 0 deployments | `gh run list --workflow preview`, `gh api repos/nitishsjsucs/agentboard/deployments` | keep only after `preview.yml` has deployed a PR (README deploy step 11); wording "per-PR deployments to a preview environment" |
| "approximately 100 orchestration and authorization test cases" | true: 108 tagged (66 orchestration, 42 authz), all passing (measured by the final gate at `6541d6e`) | count:tests | read the test names before interviews |
| "four sprint demo releases" | four tags made within one afternoon (14:40, 15:34, 15:59 and 16:54 on 2026-10-08) and pushed to GitHub by the publish loop; no GitHub release exists; the `v0.4.0` tag's CI failed (`results:check`, see "What is left") | `git ls-remote --tags origin`, `gh release list` | use "four incremental releases with demo scripts", and only after the releases are published |

## Review findings (builder 8)

Three reviews of `8b87a11` (correctness, security, honesty) returned 17 findings. Each was verified before it was fixed: the behavioral ones by reproducing them in a test that failed first (the DLQ redelivery turning the row `ignored_stale`, the recovered dead letter still counted open, the missing headers) or, where the code was already right, by a mutation that disables the rule and now fails the new test (the reviewers had shown that the old suite stayed green under the same mutations: the four recovery rules, `outputCap`, the `reapedFrom` fence, the journal fast path), the FNV shard parity by hashing 10,000 random id pairs (attempts 1 and 2 never shared a shard mod 2; attempts 1 and 3 always did), and the GitHub claims with `gh` (PR, run, tag, release, deployment and commit listings) and the publish loop's script. None was rejected.

| Lens | Severity | Finding | Disposition |
|---|---|---|---|
| correctness | important | a redelivered DLQ message turns into `ignored_stale` and cannot be replayed | fixed, commit 77 (idempotent `dead_letter`, first-delivery outcome rule; deviation 67) |
| correctness | important | budgets #2 tests an unused copy of the output cap; `llm_budget_exhausted` untested | fixed, commit 79 (one implementation in `planner.ts`, test through a real planner; deviation 74) |
| correctness | important | five recovery rules of SPEC 3.4 and 3.5 have no test | fixed, commits 77 (`reapedFrom`) and 78 (verify retry, plan retry, verify skip, expired-approval retry) |
| correctness | minor | executor journal untested and unreachable in the simulation (FNV parity) | fixed by documentation and a test, commit 80; the hash was kept (deviation 73) |
| correctness | minor | DLQ rows of recovered tasks stay open; DlqPanel ignores a refused replay | fixed, commit 81 (deviation 68) |
| correctness | minor | generator test compares with the generator's own constants | fixed, commit 82 |
| security | minor | no anti-framing or security headers | fixed, commit 83 (deviation 69) |
| security | minor | preview job exposes the Cloudflare token to `npm ci`, typecheck and build | fixed, commit 84 (step-scoped secrets, variable gate; deviation 70); moving the secrets into the `preview` environment with reviewers is Nitish's GitHub setting (README deploy step 11) |
| security | minor | deployed environments accept `openai-compatible` with any base URL | fixed, commit 85 (refused in production and preview; deviation 71) |
| honesty | blocking | CHANGELOG and PROGRESS say commits carry trailers; the published history has none | fixed by option (b), commit 88 and this file: CHANGELOG history note, README "History, pull requests and authorship", the resume table above; option (a) (keeping trailers in the publish step) is Nitish's |
| honesty | blocking | README says nothing is pushed and CI never ran | fixed, commit 88 (dated GitHub state in README Local setup, Tests, Releases and the new history section; release.yml comment) |
| honesty | important | PROGRESS resume rows and "What is left" contradict GitHub | fixed, this file (rows dated, "What is left" rewritten) |
| honesty | minor | ADR 0005 says PR heads are green and hand-edited numbers fail CI | fixed, commit 88 |
| honesty | minor | README and CHANGELOG cite an uncommitted reproduction (`6711458`) | fixed, commit 88: removed; the prose now cites only committed measurements (deviation 75) |
| honesty | minor | `results:check` reports a missing commit as changed code | fixed, commit 86 |
| honesty | minor | PROGRESS says 104 tagged tests | fixed, this file (108 after this round) |
| honesty | minor | milestone 4 demo says 61 + 39 | fixed, commit 88 (61 + 39 at v0.4.0; current count in `eval/results/tests.json`) |

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
13. **Commits are on local `main`; tags are local.** No branches, PRs or pushes are made by the builders (pushing happens after verification). The PR boundaries of section 19 map to commit ranges: PR 1 = commits 1 to 4, PR 2 = 5 to 8, PR 3 = 9 to 12, PR 4 = 13 to 16, PR 5 = 17 to 22, PR 6 = 23 to 25, PR 7 = 26 to 30, PR 8 = 31 to 36, and after the plan PR 9 = 37 to 48 (fixes, stretch items and the verification round). Milestone tags (`v0.1.0` ...) are created locally on the last commit of each milestone; GitHub releases need a push. (Later, Nitish's publish loop pushed the commits and the tags and opened and merged its own pull requests at other boundaries; see deviation 66 and "What is left".)
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
65. **A reproduction cited in prose, not committed (commit 76).** Builder 7 ran `eval:sim` again in a clean clone of `6711458` to check that commit 71 made the tool-call and audit-event totals stable. Its numbers appear in one README sentence under "Reading the results" (with the command, date and clone commit) and in "Check status" above, but its result file was not committed: the rendered Results block keeps the `b3f5ed8` measurement, so the planner, test and simulation sections still come from one commit and the README's latency note stays accurate. The rendered block and `results:check` are unaffected.
66. **Working branch, then a fast-forward of `main` (builder 8).** An external publish loop of Nitish's (`~/Developer/projects/_publish/loop.sh` and `sync.sh`, outside this repository) copies local `main` to GitHub about once an hour and merges it as a pull request. When it ran between fix commits and their re-measurement, public `main` went red (PR #8). So this round committed on the local branch `review-fixes-2`, fast-forwarded `main` to it once the head passed every check (the commit ids do not change), and then deleted the branch. The builders still never push.
67. **Idempotent dead-letter (commit 77).** SPEC 7.2 says a dead-letter that does not match the current dispatch is ignored and the consumer sets `ignored_stale`. The coordinator now also answers a dead-letter for a task that is already `dead_lettered` with the same `dispatchId` as accepted (reason `already_dead_lettered`, no event), and the consumer writes `ignored_stale` only on the message's first delivery (the `INSERT OR IGNORE` changed a row) and only while the row is an unreplayed `dead_lettered`. The row is still inserted before the coordinator call, as the spec says, so a message is recorded even when the coordinator stays unreachable. Remaining gap: if a first delivery inserts the row and fails before the coordinator commits, and the task changes before the redelivery (a cancel or a resume), the row keeps `dead_lettered`; deviation 68 keeps such a row out of the open count.
68. **DLQ open state (commit 81).** `DlqMessageView` gains `taskStatus` (from a `LEFT JOIN` on the D1 task mirror) and `open` (not replayed and the task still `dead_lettered`). `/api/metrics/summary`'s `dlqOpen` counts distinct dead-lettered tasks with such a row, so a task with two open rows counts once. The replay route itself is unchanged: a replay of a row whose task moved on is refused by the coordinator (409 `invalid_state`), and the panel now shows that refusal.
69. **Security headers (commit 83).** Not in the spec. `public/_headers` (Vite copies `public/` into `dist/client`; Workers Static Assets applies it, and local `wrangler dev` does too, checked with curl) sets `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, `nosniff` and `no-referrer`. The UI was checked in a browser under that policy (dev login, launch, live run detail, dashboard) with no violation. `/api` uses `hono/secure-headers` with `X-Frame-Options: DENY`, `default-src 'none'; frame-ancestors 'none'` and `no-referrer`. `public/` is not a measured path.
70. **Preview gate (commit 84).** SPEC 17 gates `preview.yml` on `secrets.CLOUDFLARE_API_TOKEN`. A gate job that reads the secrets keeps them in repository scope, where every step of the job could read them, so the gate is now the repository variable `PREVIEW_DEPLOYS=on` plus a same-repository check, the deploy job keeps `environment: preview` (where the secrets should live, with required reviewers), and only the migration and deploy steps get the token. README deploy step 11 describes the setup.
71. **Deployed LLM provider (commit 85).** SPEC 5.2 requires only `LLM_PROVIDER !== "stub"` in production and preview; `parseConfig` now also refuses `openai-compatible` there, so a deployed planner can only use Workers AI through the AI binding. `eval:planner` runs locally and is unaffected.
72. **108 tagged tests.** This round adds two tagged orchestration tests (`state-machine.test.ts` "verify and plan recovery ...", `executor.test.ts` "journal fast path ...") and extends four existing ones where the topic was the same (`retries.test.ts` DLQ consumer and DLQ replay, `approvals.test.ts` #4, `budgets.test.ts` #2), so the count is 66 + 42 = 108. The web project has 18 tests (one more `DlqPanel` test).
73. **Shard hash kept.** The review offered an avalanche finalizer for the FNV shard hash or documenting its behavior. The hash was kept and documented in `queue/sharding.ts`: with an even shard count, attempt n + 1 (n < 9) never lands on attempt n's shard, and with 2 shards attempt 3 always returns to attempt 1's. Changing the hash would change which recovery path the measured simulation exercises (some crash recoveries would move from the ledger to the journal) for a minor finding; the journal is covered by `executor.test.ts` instead, and the README says the simulation never reaches it.
74. **One output-cap implementation (commit 79).** `plannerMaxOutputTokens`, `MAX_PLAN_OUTPUT_TOKENS` and `MIN_PLAN_OUTPUT_TOKENS` were removed from `agents/coordinator/budgets.ts`; `outputCap` in `planning/planner.ts` owns the constants. `PLANNER_TOKEN_FLOOR` stays with the claim gate in `budgets.ts`.
75. **Prose results only from committed files (supersedes deviation 65).** The `6711458` reproduction is no longer cited in the README or the CHANGELOG, because its result file was never committed. The "Reading the results" bullets cite only measurements whose result files are committed (at `83fb6fb`, `b3f5ed8`, `52d601a`, `b7db936` and `cf21c23`); "Check status" below keeps builder 7's log of that run as a log entry.
