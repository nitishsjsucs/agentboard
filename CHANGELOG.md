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

Fixes from an independent review (correctness, security and honesty):

- Security: `access.revoke_all_roles` is accepted only in a plan that also terminates the subject, so it always waits behind that approval (an offboarding plan without the status change used to revoke every role with no approval). Run WebSockets accept only the coordinator's own path (the Agents SDK's `/sub/{class}/{name}` forwarding reached any agent class), and a socket is closed once its identity token expires. AI Gateway no longer logs planner prompts.
- Correctness: a plan must contain the writes its request type exists for, so a read-only plan can no longer reach `succeeded`. Workers AI calls and the planner's `tools/list` are bounded by their timeouts. A planning attempt whose model call throws still reports the tokens it spent. `raise_budget` must raise at least one field.
- Tests: tests that launch real runs wait for them to settle (`npm test` exited 1 on some runs), the RBAC matrix expects each allowed call's own status, and the retry test asserts a nonzero redispatch delay. Four tagged tests were added (104 in all).
- Evaluation: `count:tests` never counts passes from a stale report; `eval:sim` pages through the DLQ, checks the simulated domain tables for duplicate inserts independently of the ledger, and records the injected fault counts; `eval:planner` reports valid plans that contain every gold write and reads its provenance from the answering server; `results:check` also covers `test`, `seed` and the build and test configuration; `engines` requires Node 24.
- Simulation, planner and test results measured again on the fixed code.
- A final verification gate measured everything again in a fresh clone of `52d601a`: every count, outcome and planner quality metric matched, only local latencies moved, and the README now shows the gate's numbers with a note on latency variance.

Fixes for the three known minor issues:

- Planner tasks that reach a planner shard while its tool-catalog read is in flight wait for that read instead of reading the catalog again, so the simulation's tool-call and audit-event totals no longer vary between runs (one catalog read per shard).
- Run WebSockets are authorized again every five minutes: the coordinator closes a socket that is due with a normal closure, and the client reconnects through the route, which checks the token and the role binding. A removed or downgraded binding now reaches an open socket within five minutes instead of at token expiry.
- Switching principals on the dev login page waits for the new session before opening the dashboard, which no longer requests the DLQ with the previous principal's permissions.
- Two tagged tests were added (106 in all) and one React test; simulation, planner and test results measured again on the fixed code.
- README: a note on the `npm audit` advisory for the pinned MCP SDK packages (the affected OAuth client flow is not used).

Fixes from a second independent review (correctness, security and honesty):

- Dead-letter queue: a DLQ message delivered twice (or retried after the coordinator had already committed) no longer turns its row into `ignored_stale` and makes the dead letter unreplayable; the coordinator answers a repeated dead-letter for the same dispatch as accepted. A dead letter whose task an operator recovered otherwise (retry, skip, cancel) is no longer counted or offered for replay, and the DLQ panel shows a refused replay instead of closing silently.
- Security: the console's static assets (`public/_headers`) and every `/api` response forbid framing (`X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`) and send `nosniff` and `no-referrer`. `preview.yml` passes the Cloudflare token only to its migration and deploy steps (never to `npm ci`, the typecheck or the build) and is gated on the repository variable `PREVIEW_DEPLOYS` so the secrets can live in the protected `preview` environment. Production and preview refuse the OpenAI-compatible LLM provider, which would send planner prompts unauthenticated.
- Tests: the planner's real output cap is tested through a planner agent (the test used to check an unused copy), including the repair's smaller cap and the `llm_budget_exhausted` failure without a model call; the verify retry, verify skip, plan retry and expired-approval retry rules, the dead-letter of a lease reaped in the same transaction, and the executor journal fast path now have tests; the generator test spells out the SPEC 12.1 counts. Two tagged tests were added (108 in all) and one React test.
- Evaluation: `results:check` says when a measured commit is missing from the history instead of reporting that measured code changed.
- Simulation, planner and test results measured again on the fixed code.
- README and PROGRESS describe the state of the GitHub repository: CI history, the automated pull requests, the tags and the published commits without trailers.
- A final verification gate measured everything again in a fresh clone of `6541d6e` (same measured code as `83fb6fb`): every count, outcome and planner quality metric matched, including all 100 per-request planner results; only local latencies moved, and the README now shows the gate's numbers.

Deploy path for the Workers Free plan (production and preview deployed 2026-10-15):

- `npm run cf:setup -- --env production|preview` creates whatever the environment lacks (D1 databases, the task queue and its dead-letter queue, AI Gateway, migrations, the simulated People seed, agent controls, two Access service tokens, the reusable Access policies, role bindings), deploys the committed code fail-closed, creates the Access application for the `workers.dev` hostname with the One-time PIN identity provider, and redeploys with its AUD tag. Every step checks first, so a re-run changes nothing that is in place. `--dry-run` reads the account, builds, runs `wrangler deploy --dry-run` and prints the plan. `npm run cf:doctor` is a read-only report; `npm run cf:verify` runs four Workers AI-planned runs through Access and records outcomes, audit chains, duplicate side effects and CPU time in `eval/results/production.json`, which the README Results block renders.
- `wrangler.jsonc`'s production and preview environments carry the account id, the Zero Trust team domain and the `workers.dev` origins, and name their D1 databases and queues without ids (wrangler resolves them by name). Queue consumers there take batches of 5.
- Deployed environments require `ACCESS_AUD` to be an Access AUD tag (64 hex characters) and get it as a Worker secret, so a placeholder or a missing application fails closed with 500 `misconfigured`. Locally `npm run dev:keys` writes `ACCESS_AUD=agentboard-dev` into `.dev.vars`; in an existing checkout, run `npm run dev:keys -- --force` or add that line.
- One outbox flush makes at most 16 binding calls (8 rounds per lane), well under the Free plan's 50 subrequests per invocation; a backlog drains over the following wakes.
- `preview.yml` deploys through `cf:setup --ci`, skips cleanly without the `PREVIEW_DEPLOYS` variable or the `preview` environment's `CLOUDFLARE_API_TOKEN`, and needs no reviewer (a waiting job would block the publish script's merge on green checks).
- `results:check` no longer depends on a particular commit id: results record the measured commit's author date and a content address of the measured paths, and the check finds the measured commit by id or, in the published history, by author date and content. It also fails when a measured file cites a commit id. This is what made the `v0.4.0` tag's own CI fail on GitHub (see the note under v0.4.0). For `eval/results/production.json` alone, code changed since the measurement is a note, because measuring production again needs a deploy.
- Simulation, planner and test results measured again on the code above (109 tagged tests).
- Production deployed to the Workers Free plan with `cf:setup` and verified with `cf:verify` on 2026-10-15: 4/4 outcomes matched (succeeded 3, rejected 1), 0 duplicate side effects, 4/4 valid audit chains, 0 HTTP 5xx, and Access stops unauthenticated requests. Worker CPU from the GraphQL Analytics API: p50 4.8 ms and p99 40.6 ms over 92 requests, none stopped. Preview is not set up.
- Preview set up on 2026-10-15: `cf:setup -- --env preview` created the preview D1 databases, queues and Access application; the `preview` GitHub environment holds the deploy token and `PREVIEW_DEPLOYS=on`. The first GitHub Actions deploy was run 38812854783 (a rerun on #12). The four milestone releases, v0.1.0 to v0.4.0, were published the same day with `release.yml` run by hand.
- Workers AI: Qwen3's thinking is turned off with `/no_think` in the planner's user turn. On the first production verification, `@cf/qwen/qwen3-30b-a3b-fp8` spent the planner's 800 output tokens on reasoning and returned no content, so 2 of 4 runs failed. A budget spent on reasoning is now reported as such, and each agent exception's message is logged to Workers Logs.
- The README's production table renders the Analytics API's CPU quantiles, and shows limit outcomes as not observed when `wrangler tail` delivered no events (it showed 0).
- Simulation, planner and test results measured again after the provider fix: every count, outcome and per-request planner result unchanged.

Console workflows (2026-10-15; `docs/USER-WORKFLOWS.md` describes each persona's workflows as they now work):

- Layouts work at 375 px wide (the nav wraps to a scrolling row of links, run detail stacks with Recovery first when it is the next step, forms go to one column) and the 1280 px layout is unchanged.
- Every polled view tells loading, empty, failed and stale data apart; the dashboard no longer shows 0 for counts it does not have, and panels show an error card instead of disappearing.
- API and network failures read as plain sentences with a next step instead of server internals; server failures show the request id.
- Pages wait for the session; a principal without a role gets one explanation page; an expired session shows a banner that keeps typed text; the dev login returns to the page in `next` (same origin only); Access mode has a Sign out link.
- The launch form says why it cannot submit yet, resets with the sample placeholder, warns about requests the stub planner cannot plan, resends a launch whose answer was lost with the same key, explains an idempotency conflict, and shows roles without `runs:launch` a sentence instead of the form.
- Run detail explains why a run waits or needs attention and the next step for the viewer's role; the Events table reads "approval rejected" (it read "approval rejectd") and lists a rejected plan's issue codes.
- Approval cards show the run title (`GET /api/approvals` now includes `runTitle` and `requestType`), decisions are confirmed in a status line with focus moving to the next card, and a decision someone else made first refreshes the list.
- The confirm dialog handles Escape, keeps focus inside and returns it; recovery outcomes and refusals are announced in plain words; the budget dialog uses named fields, minutes and the current limits.
- A skip link, per-page titles, focus on the heading after navigation, real tabs with arrow keys kept in `?tab=` and `?status=`, a keyboard button for tool-call details, meters with values and announced status changes.
- Viewers see when the request text is hidden and what redaction changed in tool calls.

Console workflow fixes after a review of that round (2026-10-15; `docs/USER-WORKFLOWS.md`, "Fixed after review"):

- An expired Access session is detected: production answers it with a 302 to the team's cross-origin login page, which the console followed into a CORS failure ("Could not reach AgentBoard", no banner). Requests no longer follow redirects, so a redirect raises the Reload banner; a 5xx HTML page reads as a server failure instead of a possible session end. The session item above did not hold behind Access until this fix.
- The launch form keeps its unsent request, with its idempotency key, in the tab's sessionStorage for the signed-in principal, so "Sign in again" and "Reload" no longer lose it; a successful launch, Clear form and Sign out remove it. Before this, "keeps typed text" held only while the banner was on screen.
- Edit request after a lost launch keeps the idempotency key (it minted a new one, so an edit of a launch that had arrived started a second run); the server's conflict answer is explained instead.
- After a confirmed recovery command or DLQ replay, focus moves to the outcome line instead of falling to the page body when the command replaced or removed its own button; a refused replay reads as a sentence.
- The postcondition notice names the Recovery row that runs the write again, execute rows come before verify rows, and each task button's accessible name includes its task.
- The budget dialog counts an untouched field as its current limit, so minute rounding of active time can no longer block a raise or send one nobody made.
- The approval queue moves focus on after a conflict and clears its status line when the tab changes; Clear filters on Runs also empties the search box; dialogs scroll inside on short screens; nav focus rings are no longer clipped.

History note: commit `7ff7a92` ("docs: README with status, architecture, design decisions, local setup and roadmap") and the README part of `b7a3199` were written by a parallel session working in the same tree, not by this build's commit sequence; read them as AI-assisted like the rest. The README it wrote was later replaced entirely, and the history was left as it is (rewriting it would also move the four milestone tags). In the working repository the build commits to, every commit except that README commit carries a `Co-Authored-By: Claude` trailer. The GitHub history is copied from that repository by a separate publish step that removes those trailers, so no commit on GitHub carries one.

## v0.4.0: Evaluation and release

- One simulation driver for the 100-run workerd simulation (`npm run test:sim`) and `npm run eval:sim` against `wrangler dev` on the built worker.
- `npm run eval:planner` against a local llama-server (Qwen3-1.7B Q4_0) with a stub sanity mode.
- `npm run count:tests` for the 100 tagged orchestration and authorization tests.
- README Results block rendered from `eval/results/*.json`, with a staleness and dirty-tree check in CI.
- README with architecture, local setup, deploy steps, the local versus production matrix and limitations.

Note added after the tag: on GitHub, this tag's own CI run failed at `results:check`. Every step before it passed (types, typecheck, synthetic data check, tests, the 100-run simulation and the tagged test count), and the build step did not run. The tagged result files cite the working repository's commit id, which the published history does not contain. The tag was not moved. The `results:check` that tags cut later run identifies the measured commit by author date and measured content instead.

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
