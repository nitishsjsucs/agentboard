# AgentBoard live demo

The script for showing AgentBoard in an interview: a short live walkthrough of the production deployment in a browser, then technical talking points. It covers a 60-second version, a 5-minute version, the full click path, likely questions, and what to do if Workers AI or Cloudflare Access misbehaves.

Everything People-related is simulated. The HRIS, ITSM, access-management and notification systems are tables in a separate D1 database filled with fictional employees. The Cloudflare side is real: in production the app runs on Workers, Durable Objects, Queues, D1, Workers AI and Access, on the Workers Free plan.

How to read the evidence in this doc:

- **Production** means measured by `npm run cf:verify` against the live Worker on 2026-10-15, written to `eval/results/production.json`. That pass launched four synthetic requests through Access with two service tokens, and Workers AI planned every one.
- **Local** means the 100-run simulation with injected faults on a laptop (`eval/results/simulation.json`) or another committed results file named next to the number. Fault injection is off in production, and the config refuses to load with it on. So retries, lease expiries, ledger replays and verifier detections have only been measured locally. The only production retries on record are the first verification's planner attempts, before the `/no_think` fix, and they all failed (talking point 7).
- **Tests** means a named test file in `test/`.
- A few configuration values (timeouts, budgets, shard counts) are quoted from the committed file named next to them. They are settings, not measurements.

## At a glance

| | |
|---|---|
| URL | https://agentboard-production.nitish-ratakonda.workers.dev |
| Login | Cloudflare Access, team `old-truth-a7dc`. One-time PIN is the only login method: type an allowed email, and a code arrives by email. All codes go to the `nitishsancs@gmail.com` inbox. |
| Deployed code | version `9b2bf0aa-0025-41e7-867d-9874f7e3a98c`, built from commit `c9130b5` (`production.json`). The console has changed since (`docs/USER-WORKFLOWS.md`: the 2026-10-15 and 2026-10-16 rounds), and production shows those changes only after a redeploy (`npm run cf:setup -- --env production`). Steps 2, 5 and 6 below describe the repository's console; until the redeploy, production shows the older stat cards, task cards and approval cards. |
| Planner model | Workers AI `@cf/qwen/qwen3-30b-a3b-fp8` through AI Gateway, with Qwen3's thinking turned off by `/no_think` |

The production personas, as `npm run cf:setup` binds them (`scripts/cloudflare/env.ts`):

| Email | Role | Use in the demo |
|---|---|---|
| `nitishsancs+ops@gmail.com` | operator | Window 1. Launches both requests. |
| `nitishsancs+approver@gmail.com` | approver | Window 2 (a private window). Approves one request and rejects the other. |
| `nitishsancs+viewer@gmail.com` | viewer | Optional: shows redaction. |
| `nitishsancs@gmail.com` | admin | Not needed. Admins hold every permission, including approvals, but never on their own runs. |

What each role may do (`src/worker/auth/permissions.ts`): a viewer reads runs, search, audit and agent state, without personal data. An operator also launches runs, pauses, resumes and cancels them, retries tasks, releases leases and reads the dead-letter queue. An approver reads and decides approvals. An admin can do all of that, and can also skip tasks, raise budgets, replay dead letters and disable or enable agent roles.

## Before the interview

1. Check that Access is in front of the app:
   ```sh
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://agentboard-production.nitish-ratakonda.workers.dev/
   ```
   It should print `302` and a login URL on `old-truth-a7dc.cloudflareaccess.com`. It did on 2026-10-15, when this doc was written.
2. Sign in once as the operator and the approver, then rehearse the whole walkthrough once, with the rehearsal subject from step 3 (E-1035), not E-1029. The People seed is applied only to an empty database, so a rehearsal's manager change stays in production; E-1029 must still report to E-1005 on the day. The repository has no record of a browser sign-in to production yet (`PROGRESS.md`, "What is left", step 5). The live WebSocket view has not been exercised in production either, because `cf:verify` uses plain HTTP.
3. Sign in to both windows shortly before the call, so the interviewer never waits for a code to arrive.
4. Keep rehearsals few. Every run spends Workers AI neurons from the account's daily allowance, which other apps on the account share (README, "Cloudflare Free plan"). For scale, the four verification runs used 3577 planner tokens, an estimated 17 to 109 neurons in total: the tokens priced as all input or as all output (`production.json`, `llm_tokens_total` and `neurons_estimate`). It is an estimate, not measured spend.
5. Get the local fallback ready in a terminal at the repository root. `.dev.vars` must exist (`npm run dev:keys` writes it). Check that `npm run serve:built -- --fresh` starts and that `http://127.0.0.1:8784/dev/login` loads, then stop it with Ctrl+C.
6. Keep `eval/results/production.json`, `eval/results/simulation.json` and this file open in editor tabs.

## The 60-second version

Say this over the dashboard, or with no screen at all:

> AgentBoard is an operations console for AI agent runs that serve a simulated People-operations team, built on Cloudflare Workers. An operator types a request, for example "move this employee under a new manager". A planner agent on Workers AI turns it into a plan of MCP tool calls. The console then checks that plan against an allowlist for the request type, pins it to the subject employee, and decides which steps need a human approval. The model decides none of that. An executor and a verifier carry the plan out through an MCP server, each step under its own lease.
>
> Underneath, each run has one Durable Object coordinator that is the only writer of its state. Agents work under leases with fencing epochs, work arrives through Queues, every write goes through an idempotency ledger, and every state change is one transaction that also appends a hash-chained audit event. In production on the Free plan, four verification runs all ended with the expected outcome, with zero duplicate side effects and valid audit chains. Locally, 100 runs with injected crashes, retries and duplicate deliveries also produced zero duplicate side effects.

Sources: `production.json` (outcome match 4/4, 0 duplicate side effects, 4/4 valid audit chains) and `simulation.json` (100 runs, 0 duplicate side effects).

## The 5-minute version

Launch both requests at the start, because planning takes a while. In production, `cf:verify`'s wall clock per run, from its launch request until it had read the final status, audit and tool calls (polling every 3 s, its approval decisions included), was 14.9 s to 89.9 s (`production.json`, `runs[].durationMs`). Talk while the planner works.

| Time | Window | Do | Say |
|---|---|---|---|
| 0:00 | 1 (operator) | Show the dashboard. Point at the nav bar: the `production` badge, your email and the `operator` badge. | What it is. The People org is simulated; the Cloudflare stack is real. |
| 0:30 | 1 | Launch the manager change (step 3 below), then the privileged grant (step 4). | The planner is the only model. The request text is treated as untrusted data, and policy lives in code. |
| 1:15 | 1 | Open the manager change run. On the Timeline, the "Plan map" comes first: the `hris.update_manager` step carries the lock and reads `waiting for approval`, the notification step reads `runs after s2`, and the sentence under the map names the blocked step and who acts. One row per task follows. | One coordinator per run, leases, gating edges: before an approval, only reads run. |
| 2:00 | 1 | Open its approval. It says "You requested this run, so you cannot decide its approval." | Separation of duties. The notice is the console's own-run check. The operator role lacks `approvals:decide`, so the API would refuse any decision with 403 `missing_permission` before the coordinator. The coordinator's `self_approval` rule covers admins, the only role that can both launch and approve (`approvals-sod.test.ts`). |
| 2:30 | 2 (approver) | `Approvals`: approve the manager change, reject the privileged grant. Each needs a note. | Risk levels come from policy: `medium risk` for a manager change, `high risk` for a privileged grant. |
| 3:15 | 1 | The manager change reaches `succeeded`. In `Tool calls`, expand the `hris.update_manager` row to show its idempotency key. In `Audit`, show "Hash chain verified". | Call-bound tokens, the integration ledger, the verifier, the hash chain. |
| 4:00 | 1 | The privileged grant shows `rejected` with the reason `approval_rejected`. `Tool calls` shows no write: only reads, possibly including a `tools/list` catalog read by the planner. There is no `access.grant_role` row. | A rejection leaves no write behind, by construction. |
| 4:30 | any | Cite the production evidence (step 9). | Failure recovery is local evidence, and say so. |

## Full walkthrough

Every console label quoted below (page headings, button text, badges, notices, field names) comes from the console source under `src/web`. The Access sign-in page is Cloudflare's own and is described, not quoted.

### 1. Sign in

- **Window 1, a normal window.** Open the URL. Access redirects to its One-time PIN page on `old-truth-a7dc.cloudflareaccess.com`. Enter `nitishsancs+ops@gmail.com`, then the code from the `nitishsancs@gmail.com` inbox. You land on the dashboard.
- **Window 2, a private window.** Do the same with `nitishsancs+approver@gmail.com`.

Point out the nav bar: the environment badge `production`, the signed-in email, and the role badge. There is no "Simulation mode: fault injection is on" banner, because that banner appears only when fault injection is on, and a production config with it on refuses to load.

If a window ends up signed in as the wrong persona, close every private window and open a new one: in Chrome, all incognito windows share one set of cookies, so closing one is not enough while another is open. Or open `/cdn-cgi/access/logout` on the app's hostname, which is Cloudflare Access's logout path. Try that once during rehearsal.

If asked how identity works: Access adds a JWT in the `Cf-Access-Jwt-Assertion` header. The Worker verifies it against the team's JWKS and the Access application's AUD tag (the `ACCESS_AUD` secret), uses the lowercase email as the principal, and reads the role from `role_bindings` in D1. A principal with no binding can only call `/api/me`. If the `ACCESS_AUD` secret is missing, the Worker fails closed (`src/worker/api/middleware/identity.ts`, README "Production setup").

### 2. Dashboard (window 1)

- The heading is `Dashboard`, with the line "Agent runs serving a simulated People-operations team."
- "Needs a person" tiles: "Pending approvals" (for the operator, "Approvers and admins decide these"), "Needs attention", "Held by a disabled role", "Paused" and "Open dead letters". Under "Moving", the tile "Active (queued, planning, running)" and the line "N succeeded, N rejected, N cancelled (all time)."
- The run lists' "Waiting on" column says who acts next, in words (for example "Approver" and "waiting for an approval").
- "Recent runs" can already list runs from 2026-10-15. Those whose requester starts with `svc:` were launched by `cf:verify` through a service token. `cf:verify` also cancels any run that needs attention or times out.
- Expect `cancelled` `svc:` runs, and a matching "cancelled" count in the all-time line. They are most likely the first production verification, the one before `/no_think`: 2 of its 4 planner tasks failed as `agent_exception` on every attempt (`PROGRESS.md`), and `cf:verify` cancels a run that needs attention. That is talking point 7. Confirm the count during the rehearsal.
- "Agent roles" carries the note "planner calls a model; executor and verifier are deterministic".
- The "Dead-letter queue" panel is shown to operators and admins only.

### 3. Launch the manager change (window 1)

Click `Launch` in the nav to open "Launch a run". Production has no "Sample request (dev only)" list, so you type the request yourself.

- Request type: `manager change`
- Subject employee: `E-1029 Soren Galloway (Support)`
- Request text: `Reorg: move E-1029 (Soren Galloway) under manager E-1004 (Quillon Ashdown). Notify them by Slack when done.`
- Priority: `normal`
- Click `Launch run`. The button stays disabled until a subject is chosen and the text has at least 10 characters.

Why this text: it has the same shape as `syn-0022`, the synthetic manager change that Workers AI planned and production completed on 2026-10-15 (`production.json`). That run moved E-1017 under E-1004. E-1029 reports to E-1005 in the seed (`seed/people.sql`), so this change is a real one, as long as no rehearsal used E-1029.

For the rehearsal, use E-1035 instead, which is also active in Support and reports to E-1005 in the seed:

- Subject employee: `E-1035 Zelie Elsworth (Support)`
- Request text: `Reorg: move E-1035 (Zelie Elsworth) under manager E-1004 (Quillon Ashdown). Notify them by Slack when done.`

During the rehearsal the run title reads "Manager change for Zelie Elsworth (E-1035)" and the approval card "Change the manager of E-1035 to E-1004".

Say: the hint under the text box reads "Treated as untrusted data: the planner is told to ignore instructions inside it." Whatever the model returns must pass the output schema, the request type's tool allowlist, subject pinning and the request type's required writes. Approval flags come from `src/worker/planning/policy.ts`, never from the model.

The form sends one idempotency key per form, so submitting the same form twice returns the same run. After the launch, the page moves to `/runs/<runId>`.

### 4. Launch the privileged grant (window 1)

Click `Launch` again. The fresh form gets a fresh key.

- Request type: `privileged access`
- Subject employee: `E-1024 Dorian Oakhurst (Legal)`
- Request text: `Dorian Oakhurst (E-1024) needs the privileged role okta:super-admin for their new duties. Notify them by Slack once granted.`
- Click `Launch run`.

This is the text of `syn-0002`, which production planned and then rejected, as expected, on 2026-10-15 (`production.json`).

### 5. Watch the manager change (window 1)

Open the manager change from `Runs` or the dashboard.

- The header shows the breadcrumb "Runs / run_..." and a live indicator. It reads `live` while the WebSocket is connected and `offline` otherwise. The page also polls every 5 s (`usePolling` and `LiveIndicator` in `src/web`), so the demo works either way.
- The title is "Manager change for Soren Galloway (E-1029)". The status badge moves from `queued` to `planning`, then `running`, then `awaiting approval`.
- The meters are `Tool calls`, `LLM tokens` and `Active time (s)`. The default token budget is 6000 per run (`DEFAULT_BUDGET` in `src/shared/domain.ts`).
- On the `Timeline` tab, the "Plan map" comes first: one node per step, in columns by dependency. The `hris.update_manager` node carries the lock and reads `waiting for approval`, the notification step reads `runs after s2` (its name for screen readers ends that way too), and the sentence under the map reads like "Blocked at s2 hris.update_manager: waiting for an approver. s3 runs after it." The step ids are the ones the plan uses (s1 to s3 in the dataset's plan for this request). On an offboarding, s3 to s5 wait behind the termination step, and the edges that skip steps arc above the row. Activating a node moves focus to its task row.
- "Time in each status" follows: one bar from the run's creation to now and a table (Status, Total time, Share, Intervals). While the approval waits, "awaiting approval" grows with "so far".
- Then one row per task: `Plan` first, then `s1 execute`, `s2 execute`, and so on, with a `verify` task after each write. The `hris.update_manager` row carries the `approval` badge and stays `awaiting approval`. While a task runs, its row reads "leased by executor-0, epoch 1, until ...". The owner and epoch vary. The model numbers the steps, so they can differ from run to run.
- The Events card shows "Key events" by default (`run.created`, the status changes, `plan.accepted`, `approval.requested`); "All events (N)" adds `task.leased`, `task.dispatched` and `tool.called`.
- Open `Approvals (1)`. The card shows `pending`, `medium risk`, `hris.update_manager` and "Change the manager of E-1029 to E-1004", plus the notice "You requested this run, so you cannot decide its approval." The note field and both buttons are disabled.

Say: gating edges make every other write depend on the verification of the gated step, so before the approval only reads have run.

Say, about the notice: it is the console's own-run check. This operator could not decide any approval anyway. The operator role lacks `approvals:decide`, so the API answers 403 `missing_permission` before the coordinator is asked. The coordinator's `self_approval` rule matters for admins, the only role that holds both `runs:launch` and `approvals:decide`. The console disables the buttons on your own run, so the UI never sends that request, and the refusal can only be seen through the API. `approvals-sod.test.ts` shows an admin refused with 403 `self_approval`, and the local API check under "Local fallback" showed both refusals.

### 6. Decide in window 2 (approver)

- Click `Approvals`. The page is "Approval queue", and the `pending` tab shows both cards, the one that expires soonest first, under a line such as "2 waiting: 2 you can decide, 1 high risk. Next expires in 2 d 23 h.": "Change the manager of E-1029 to E-1004" (`medium risk`) and "Grant okta:super-admin to E-1024" (`high risk`). Each has a time-left meter.
- Open "What approving unlocks" on the manager change: "Already ran" lists the read, "Needs this approval" the `hris.update_manager` step, and "Runs after approval" the notification. Say: on a termination the same list shows `access.revoke_all_roles`, the laptop ticket and the notification after the status change, which is how an approver sees that approving it also releases the revoke, which has no approval of its own.
- On the manager change, type a note in "Decision note (required)", for example `Checked against the reorg plan.`, and click `Approve`. The buttons stay disabled until the note has at least 3 characters.
- On the privileged grant, type `Rejected: no business justification.` and click `Reject`.

Say: the approver's nav has no `Launch` link, because the role lacks `runs:launch`. The coordinator is the only writer of approvals. It refuses a decision from the run's own requester, admins included, and the API answers that with 403 `self_approval`. An undecided approval expires after `APPROVAL_TTL_MS` (72 hours in `wrangler.jsonc`). The sweep then marks it expired, and the run moves to `needs attention`.

### 7. The approved run finishes (window 1)

- The approved `hris.update_manager` execute task is leased by an executor and makes the call. Its verify task reads the employee back and checks the manager. Then the notification step runs, followed by its verify task. The status becomes `succeeded`.
- `Tool calls` has the columns Tool, Outcome, Agent, Attempt, Duration and Started. A planner shard's catalog read, `tools/list`, can appear first; shards cache the catalog, so not every run shows one. Click the `hris.update_manager` row to open "Arguments" and "Result" and the line "idempotency key ik_...". The Attempt column reads like "1 (gen 0, epoch 1)".
- `Audit` shows "Hash chain verified: N events, each linked to the previous one by SHA-256." with the columns Seq, Time, Actor, Action and Hash. The API re-reads the chain from D1 and verifies it on every request (`GET /api/runs/:id/audit`).
- The `Recovery` card reads "No recovery actions available (the run is finished)."

### 8. The rejected run (window 1)

- The status is `rejected`, with the reason `approval_rejected`.
- On the Timeline, the `access.grant_role` step is `rejected` and every task after it is `cancelled`. Any read the model planned before it is `succeeded`.
- `Tool calls` shows no write: only the reads that ran before the gate, plus possibly a `tools/list` catalog read by the planner (as in step 7, a planner shard whose 5-minute catalog cache is cold traces one into the run it plans). There is no `access.grant_role` row. No write token was ever minted for the grant, because a gated step is not leased before its approval (`docs/adr/0002-integration-ledger-and-call-bound-tokens.md`). Production's rejected run `syn-0002` recorded 1 tool call (`production.json`); locally, the same request showed `tools/list` and `hris.get_employee`.
- `Audit` still shows a verified chain.

### 9. Close with the production evidence

From `eval/results/production.json` (`npm run cf:verify -- --env production`, 2026-10-15):

| Metric | Value |
|---|---|
| Runs, all planned by Workers AI | 4 |
| Outcomes | succeeded 3 (two address changes, one approved manager change), rejected 1 (the privileged grant) |
| Outcome match with the dataset's expected status | 4/4 |
| Runs with a valid audit hash chain | 4/4 |
| Duplicate side effects per idempotency key; per run and step | 0; 0, over 6 ledger rows |
| Tool calls | 14 |
| HTTP 5xx responses | 0 |
| Unauthenticated request | 302 to the Access login |
| Planner tokens; Workers AI neurons (estimated from the tokens) | 3577; 17 to 109 |
| Worker CPU per request (Analytics API, the verification window) | 92 requests, all successful; p50 4.8 ms, p99 40.6 ms |
| Run duration p50; p95 (`cf:verify`'s wall clock per run) | 46939 ms; 88291 ms |

### Optional extras (rehearse first; no recorded production check covers them)

- **Redaction.** Sign in as `nitishsancs+viewer@gmail.com` in a session of its own: a second browser or a separate browser profile, or window 2 after signing it out with `/cdn-cgi/access/logout` once the approvals are done. A new private window is not enough while window 2 is open, because Chrome's incognito windows share cookies. Run detail hides the request text, and addresses in tool-call arguments and results show only city, region and country (`test/worker/auth/redaction.test.ts`). The viewer has no `Launch` link, but the `Audit` tab still works.
- **Search.** On `Runs`, search for `Soren Galloway manager change`. History search uses D1 FTS5 over runs, tasks, tool calls and approvals.

## Technical talking points

### 1. One coordinator per run, with leases and fencing epochs

- Each run gets one `RunCoordinator` Durable Object, the only writer of that run's tasks, leases, approvals, budgets and audit stream. Agents never call each other: they claim, trace and complete through the coordinator.
- Every coordinator RPC is one synchronous `transactionSync`. It sweeps expired leases, approvals and deadlines, applies the operation, derives the run status from task states, and writes rows, audit events and outbox rows. Nothing inside it awaits.
- A claim succeeds only for the task's current `dispatchId`. A redelivery of a live dispatch is refused as `in_flight`, a superseded one as `stale_dispatch`, and a finished task as `duplicate`. A grant sets a new lease id, increments the epoch and the attempt count, and sets an expiry. Completions and traces must carry the current lease and epoch, so a zombie holder of an older lease gets `stale_lease`.
- Leases are never renewed. In production, an executor or verifier lease lasts 30 s and a planner lease 120 s, with tool calls bounded at 5 s and model calls at 45 s (production vars in `wrangler.jsonc`). The config loader refuses any setting where a bounded call could outlive its lease.
- The sweep reaps expired leases; no timer does. The Agents SDK `schedule()` only wakes the coordinator at the ceiling second of the next deadline.
- Code: `src/worker/agents/coordinator/leases.ts`, `sweep.ts`; `docs/adr/0001-coordinator-leases-and-queues.md`.
- Evidence. **Local**: 6 lease expiries, all 6 recovered, and 10 duplicate or stale deliveries refused (`simulation.json`). **Tests**: `leases.test.ts` covers concurrent delivery granting one claim, a completion with an old epoch being refused, and a real alarm reaping a lease.

### 2. A transactional outbox with hash-chained audit events

- Audit events are appended to the Durable Object's SQLite in the same transaction as the state change, each with `seq`, `prev_hash` and `hash = SHA-256(prev_hash + canonical JSON of the event)`. The hash uses `node:crypto` because nothing inside `transactionSync` may await, and WebCrypto is asynchronous.
- The same transaction writes the outbox: one D1 mirror row with the run, task, approval, tool-call and audit statements, and one queue row per dispatch. After the commit the coordinator flushes them. A failed send backs off, and the wake retries it. Mirror writes are version-guarded and audit inserts ignore `(stream, seq)` conflicts, so a re-flush never duplicates or regresses anything.
- A change for the Free plan: one flush makes at most 8 rounds per lane (`OUTBOX_ROUNDS_PER_FLUSH` in `src/worker/agents/run-coordinator.ts`), so at most 16 binding calls across the D1 and queue lanes. A backlog drains over later wakes.
- An honest limit: the chain makes an edited event, or a gap in the sequence, detectable. It has no external anchor, so it does not catch events cut from the end of a stream, or a whole stream rewritten by someone with write access to D1.
- Code: `src/worker/agents/coordinator/outbox.ts`, `src/worker/audit/hash-chain.ts`.
- Evidence. **Production**: 4/4 runs with a valid chain (`production.json`). **Local**: 3228 audit events and 100/100 valid chains (`simulation.json`). **Tests**: `outbox-audit.test.ts` shows a failing D1 write leaving the outbox row pending until the wake delivers it in order without duplicates, concurrent transitions producing a contiguous valid chain, and a tampered copy reporting the first altered seq.

### 3. Sharded queue dispatch with a dead-letter queue

- Each task dispatch is one queue message, `{ runId, taskId, role, dispatchId, attempt }`. It carries no epoch, because the epoch is assigned at claim time.
- The consumer routes each message to the agent instance `<role>-<n>`, where `n = fnv1a32(runId:taskId:attempt) % AGENT_SHARDS`. `AGENT_SHARDS` is 2 in production (`wrangler.jsonc`). A redelivery of the same dispatch reaches the same shard. A lease-expiry redispatch increments the attempt, and with 2 shards it always lands on the other shard (`src/worker/queue/sharding.ts` explains why). So duplicate prevention never depends on one instance's memory: the ledger is the authority, and the executor journal is only a fast path.
- There are two retry layers. Infrastructure retries use Queues `retry()` with backoff and consume no task attempt; after 5 of them the message goes to the dead-letter queue (`max_retries` in `wrangler.jsonc`). Task retries are coordinator redispatches with capped exponential backoff, up to `maxAttemptsPerTask`, which defaults to 3 (`src/shared/domain.ts`).
- The DLQ consumer dead-letters a task only when the message's `dispatchId` is still the task's current one. Otherwise it records the message as `ignored_stale`. An admin's `Replay` in the "Dead-letter queue" panel redispatches the task with a new `dispatchId`. A poison message (an invalid body) is acked and audited, not retried.
- A change for the Free plan: deployed consumers take batches of 5 (`wrangler.jsonc`).
- Evidence. **Local**: 21 task retries and 18 runs recovered by retry (`simulation.json`). The DLQ never fired in the simulation, because no injected fault exhausts the queue retries (0 DLQ messages, `simulation.json`). **Tests** are the only evidence for the DLQ: in `retries.test.ts`, the DLQ consumer dead-letters only for the current `dispatchId`, and a DLQ replay redispatches the task. **Production**: no recovery has been observed, because fault injection is off. The only production retries on record are the first verification's planner attempts, which all failed before the `/no_think` fix (an observation in `PROGRESS.md`, not a results file).

### 4. The integration ledger: exactly-once side effects

- At-least-once delivery plus retries give at-least-once attempts. The ledger turns those into at most one effect per plan step. The verifier then reads the real state to check that the effect happened, and a failed check (`postcondition_failed`) stops the run in `needs attention` until an operator retries the step at the next generation. So no effect is applied twice, and none is missed silently.
- The idempotency key is `ik_` + base64url(sha256(runId | stepId | generation | tool | canonical args)). It stays the same across attempts and changes with the generation, which an operator retry bumps.
- To claim, the caller inserts the key as `in_progress` for owner `<agent instance>:<lease>`. A completed key replays its stored result. A different arguments hash is a conflict. A live `in_progress` key held by someone else is busy, and a lapsed one is taken over with a conditional update.
- The effect is one atomic D1 batch. Every statement is guarded on the caller still owning the key and on no side effect existing yet for the correlation `<runId>:<stepId>`, which comes from the token, not from the caller. So a step's effect applies at most once across all generations, which is the logical dedupe.
- Launches are deduplicated too: the API reserves `(requester, clientRequestId)` in D1 before any coordinator exists.
- Code: `src/worker/mcp/ledger.ts`, `src/worker/agents/coordinator/credentials.ts`; `docs/adr/0002-integration-ledger-and-call-bound-tokens.md`.
- Evidence. **Local** (`simulation.json`, fault injection on): 100 runs, with injected faults transient_error 18 (3 of them twice), duplicate_delivery 10, crash_after_call 6, permanent_error 4, silent_noop 4 and budget_exhausted 3. There were 573 tool calls and 6 ledger replays (0 logical). Duplicate side effects were 0 per idempotency key and 0 per run and step. Counted apart from the ledger, the three insert-only tables had 0 duplicate and 0 missing inserts (tickets 31, notifications 85, grants 31). That count does not cover updates such as `hris.update_manager`; those rely on the ledger guards and the verifier's read-back. The verifier detected 4/4 silent no-ops with 0 false positives, and outcome match was 100/100. **Production** (`production.json`): 0 duplicates per key and per run and step, over 6 ledger rows, with no faults injected.
- A caveat: by design, no simulated scenario re-runs a write that really applied, so logical replays stay at 0 there. `idempotency.test.ts` covers that path ("the idempotency key is stable across attempts and changes with generation ...").

### 5. Call-bound MCP credentials

- After each lease grant, the coordinator mints an HS256 token bound to that one call: the tool, the SHA-256 of the canonical arguments, the idempotency key, the run, task and step, the epoch, and the lease expiry in milliseconds.
- The People Ops MCP endpoint refuses the token at or after the lease expiry, and every tool handler checks the binding again (`checkCall` in `src/worker/mcp/call-guard.ts`). Calling another tool fails as `tool_not_bound`, other arguments as `args_mismatch`, and a different key, run, task or step as `meta_mismatch`. Verifier tokens allow only read tools, only the run's subject, and only ids that the verified step returned. Planner tokens can only list tools.
- MCP runs in-process: Streamable HTTP inside the Worker. Production has no external `/mcp` route, and the config refuses `MCP_EXTERNAL=on` there.
- An honest limit: every class runs in one Worker that holds the signing key. The binding defends against confused or buggy call paths, not against arbitrary code running inside the Worker.
- Evidence. **Tests**: `mcp-auth.test.ts` refuses cross-tool calls, tampered arguments, a mismatched `_meta`, verifier writes and expired leases, each with no side effect. **Production**: the four verification runs made 14 tool calls through this path (`production.json`). No refusal was provoked there.

### 6. The model proposes, the code decides

- The planner is the only component that calls a model. The output schema enumerates the request type's allowed tools. Validation checks the schema, the allowlist, subject pinning, the request type's required writes, and that `access.revoke_all_roles` appears only together with the gated termination step. A failed plan gets one repair attempt. If the repair fails too, the plan task fails and nothing executes.
- Approval comes from policy (`approvalFor` in `src/worker/planning/policy.ts`): `hris.update_manager` is medium risk, while `hris.set_employment_status` and a grant of a privileged role are high risk.
- Gating edges make every other write wait for the gated step's verification. Only reads run before an approval, so a rejection never needs compensation.
- Evidence. **Production**: the privileged grant was rejected with 1 tool call recorded (`production.json`, run `syn-0002`). The file counts tool calls without naming them; none was the grant, because a gated step is not leased before its approval. **Local**, against a small local model rather than the production one (Qwen3-1.7B Q4_0 on llama-server): 57/100 plans valid on the first pass, 77/100 after one repair, 0 policy violations (`planner-qwen3-1.7b-q4_0.json`). **Tests**: `plan-guard.test.ts`, where a request text that asks to revoke another employee's roles produces a rejected plan with no tasks, no write token and no side effect.

### 7. The Qwen3 finding from production

- On Workers AI, `@cf/qwen/qwen3-30b-a3b-fp8` thinks before it answers, and the thinking counts against `max_tokens`. The planner caps output at 800 tokens per call (`MAX_PLAN_OUTPUT_TOKENS` in `src/worker/planning/planner.ts`). In the first production verification on 2026-10-15, the model spent the whole budget on reasoning and returned `content: null` with `finish_reason: "length"`. The planner tasks that hit this failed on every attempt with `agent_exception`.
- The fix, commit `c9130b5`, appends Qwen3's `/no_think` switch to the user turn (`userTurnFor` in `src/worker/llm/workers-ai.ts`). Checked against the REST API, `chat_template_kwargs.enable_thinking: false` did not turn reasoning off. A budget spent on reasoning now throws a named error ("used its whole output budget before answering"), and each agent exception's message goes to Workers Logs.
- After the fix: outcome match 4/4, with 3577 planner tokens across the four runs (`production.json`).
- The lesson: the local eval runs llama-server with `--reasoning off`, so it could not catch this. Only the real deployment did. `test/worker/llm/providers.test.ts` now covers it ("turns Qwen3 thinking off with /no_think ...").
- The failing pass is recorded in README "Limitations" and `PROGRESS.md`, not in a results file. Present it as an observation, not a measurement.

### 8. Fitting the Workers Free plan

- Worker CPU came from the GraphQL Analytics API. Over the verification window there were 92 requests, all successful, with p50 4.8 ms and p99 40.6 ms (`production.json`, `analytics.workerWindow`, raw values 4770 and 40562 µs). The p99 is above the Free plan's per-request CPU limit, and no request was stopped. Say this up front.
- Three things changed for Free: the outbox flush bound, consumer batches of 5, and queues created without a retention flag (README, "Cloudflare Free plan").

## Likely questions

**Why one Durable Object per run instead of Workflows or a central scheduler?**
Each run needs one place that serializes claims, approvals, recovery commands and the audit stream. A Durable Object gives that with no locks: one object per run, one synchronous transaction per operation. The hot spot is per run, not per fleet, so runs scale out as separate objects. Workflows were not used because they would duplicate retry semantics the coordinator must own anyway for leases, fencing and operator recovery (ADR 0001).

**The executor crashes right after the People system applied a write. What happens?**
Its lease expires. The next sweep makes the task ready again with a new `dispatchId` and attempt + 1, and the shard function sends it to the other executor shard. That shard claims the same idempotency key, finds it completed, and replays the stored result, so the write does not happen twice. Locally, all 6 injected crashes after a call ended as 6 ledger replays, with 0 duplicate side effects (`simulation.json`). Production has not shown this, because fault injection is off there.

**Is it really exactly once?**
Effects are at most once per plan step, because the ledger guards are conditions inside one atomic batch. A missing effect is caught rather than passed: the verifier reads the real state after every write, and a failed check stops the run for an operator retry. The local simulation found 0 duplicate and 0 missing inserts in the three insert-only tables (tickets 31, notifications 85, grants 31; `simulation.json`), counted apart from the ledger's own table. Updates such as `hris.update_manager` are covered by the ledger guards and the verifier's read-back, not by that count. The honest limit is that this is shown for simulated systems. A real HR system would need its own idempotency support, or a ledger in front of it with the same guards.

**Why no lease heartbeats?**
Every external call has a bound below the lease TTL, and the config loader refuses configurations that break that. Without renewal there are fewer RPCs and fewer races, and a lease that runs out is simply reaped by the sweep and redispatched.

**What stops the model from doing something dangerous, such as acting on a prompt injection?**
The model only proposes a plan. The code enforces the allowlist per request type, subject pinning, required writes and approval flags. The model cannot mark a step as not needing approval, because the output schema has no such field. `plan-guard.test.ts` shows an injected instruction producing a rejected plan with no side effect. Beyond that, each tool call carries a token bound to the exact validated arguments.

**Why is only the planner an LLM?**
Execution and verification should be deterministic and checkable. The executor calls exactly the validated step, and the verifier checks a postcondition such as "the manager is now E-1004". A model in those seats would add variance where it buys nothing. README "Limitations" records this as a design choice.

**How tamper-proof is the audit trail?**
It is tamper-evident. Each event's hash covers the previous hash, and the API re-verifies the chain from D1 on every read, reporting the first broken seq. It has no external anchor, so it does not catch events cut from the end of a stream, and someone able to rewrite a whole stream could rebuild it. A periodic digest written outside D1 would close that gap. That is a next step, not something built.

**What failed in production?**
The one recorded production failure is the Qwen3 thinking budget (talking point 7). Since the fix, the verification shows outcome match 4/4, 0 HTTP 5xx and 0 duplicates (`production.json`). Everything about crash recovery comes from the local simulation and the tests, and I label it that way.

**Who can approve, and what if nobody does?**
Approvers and admins can decide approvals, but never on a run they requested. Of the two, only admins can launch runs, so the coordinator's `self_approval` refusal is what stops an admin; an operator, who can launch but not decide, is stopped earlier by RBAC (`missing_permission`). An undecided approval expires after the configured TTL (72 hours in `wrangler.jsonc`). The run then moves to `needs attention`, and an operator can retry the gated step, which requests a new approval.

**How does it stay within the Free plan?**
It uses bounded outbox flushes, small consumer batches, in-process MCP calls (no subrequests), and at most two model calls per planner attempt (a plan and one repair). A model error is retryable, so a plan task gets at most three attempts by default, and every attempt draws on the run's 6000-token budget (`DEFAULT_BUDGET` in `src/shared/domain.ts`). The measured production CPU is p50 4.8 ms and p99 40.6 ms over 92 requests, none stopped (`production.json`). The binding daily limits are documented in the README, and they make this a demo-scale deployment.

**How do you know the numbers are real?**
Every number comes from a script that writes `eval/results/*.json` with its commit, a content hash of the measured code, and a dirty flag. `npm run results:check` in CI fails when the README block differs from the JSON, and for the local results files also when measured code changed after the measurement (ADR 0005). For `production.json` a code change is only a note, because measuring again needs a deploy. What ties `production.json` to the deployed code is `cf:verify` itself: it writes that file only from a clean tree whose measured-content hash the deployed version's message carries (`cf:setup` writes the hash there), and otherwise writes to `eval/results/raw/`. The simulation's outcome distribution is fixed by the dataset design, so outcome match is agreement with that design, not a success rate.

**How was it built?**
It was built with Claude Code, an AI coding agent, from `SPEC.md`, in rounds recorded in `PROGRESS.md`. The reviews were AI reviews, and no human has reviewed the code (README, "History, pull requests and authorship"). Be ready to open any file named in this doc and walk through it.

**What would you do next for real People systems?**
- Give the MCP server its own Worker and signing key, so the call-bound tokens defend against more than confused call paths.
- Anchor the audit chain outside D1.
- Measure planning quality on the production model, which only four verification runs have exercised.
- Put idempotency support or the ledger in front of each real system.

## If something misbehaves

### Access

- **The code does not arrive.** Check spam in `nitishsancs@gmail.com`, then request a new code. Check that you typed the exact plus-address: only the four addresses above are allowed.
- **Wrong persona.** Close every private window and open a new one, or use `/cdn-cgi/access/logout` (see step 1). A build that includes the session changes of 2026-10-15 (`docs/USER-WORKFLOWS.md`) shows a `Sign out` link in the nav that opens that path. Production, deployed from `c9130b5`, does not have it yet.
- **The role badge says `no role`.** That email has no role binding. Sign in as one of the four personas.
- **Access will not let you in at all.** Switch to the local fallback below, and say why: the same code runs locally with a dev login in place of Access.

### Workers AI

- **Planning is slow.** Each model call is bounded at 45 s, and the planner lease lasts 120 s (`wrangler.jsonc`). Keep talking: `cf:verify`'s wall clock per production run was up to 89.9 s (`production.json`).
- **The plan fails.** The run shows `needs attention` and the plan task `failed`. That is the safety story: nothing executed, because no execute task exists without an accepted plan. As the operator, the `Recovery` card offers `Retry` next to "the plan task". Its dialog is "Retry the plan task", with "Reason (recorded in the audit log)" and `Confirm`. Or click `Cancel run`, which opens "Cancel this run"; type a reason, then click `Confirm`.
- **Workers AI stays down, or the daily allowance is used up.** Show the four runs Workers AI planned in production on 2026-10-15 instead. Their `Audit` tabs still re-verify live. The ids come from `production.json`:
  - `/runs/run_01M50Q9YM3WFAG0NYDGJERH6RE`: manager change, approved, succeeded
  - `/runs/run_01M50Q773MTZEA4A2CGNN9EMMW`: privileged grant, rejected
  - `/runs/run_01M50Q7767G7E4XP2R6AMEHV2G` and `/runs/run_01M50Q9KVYZXSVBJ7VB4GZJ5PK`: address changes, succeeded

### Local fallback (no Cloudflare needed)

1. Run `npm run serve:built -- --fresh`. It builds the worker, resets local state and starts `wrangler dev`. Wait for "AgentBoard is running at http://127.0.0.1:8784".
2. Open `http://127.0.0.1:8784/dev/login` and click "Ops Lead" (operator). These local principals come from `seed/console.sql` and do not exist in production.
3. On `Launch`, pick `syn-0022: manager change for E-1017` from "Sample request (dev only)", then click `Launch run`. Do the same with `syn-0002: privileged access for E-1024`.
4. Click "switch user" in the nav, then "Lee Approver". On `Approvals`, write a note, then `Approve` the manager change and `Reject` the grant.
5. The run page, tabs and labels are the repository's, which production shows only after a redeploy (see "At a glance"). Say up front what differs: a banner reads "Simulation mode: fault injection is on. The People systems and every employee are simulated.", and the planner is the deterministic stub, as a notice on the Launch page says. This shows orchestration, not Workers AI.
6. For failure recovery, run `npm run test:sim`. It drives all 100 synthetic requests, with their injected faults, through the real API, queue, coordinator, agents and MCP tools in workerd. It asserts every outcome, valid chains and zero duplicate side effects, and it is short enough to run while you talk. Do not run `npm run eval:sim` in an interview, because it rewrites `eval/results/simulation.json`.
7. Stop the server with Ctrl+C.

On 2026-10-15 the same requests were sent to the built worker (`npm run serve:built -- --fresh`) through its API, as the same local principals. The UI path of steps 1 to 4 was not clicked through. The manager change ended `succeeded` and the grant `rejected` (`approval_rejected`), both with a verified chain; the grant's tool calls were `tools/list` and `hris.get_employee`. Ops Lead's attempt to decide the approval on their own run got 403 `missing_permission` (RBAC: operators lack `approvals:decide`). An admin launching the same grant as `admin@agentboard.test` and then deciding its approval got 403 `self_approval` from the coordinator. `npm run test:sim` also passed that day.

`npm run dev` works too, with the dev login at `http://127.0.0.1:5173/dev/login` (README, "Local setup").

### Milestone demos

`demos/` holds four scripts, all local:

- `demos/milestone-2.md`: the orchestration core, as single test commands. Each finishes quickly enough to run live:
  ```sh
  npx vitest run --project worker test/worker/coordinator/leases.test.ts
  npx vitest run --project worker test/worker/coordinator/idempotency.test.ts
  npx vitest run --project worker test/worker/auth/mcp-auth.test.ts
  npx vitest run --project worker test/worker/auth/plan-guard.test.ts
  npx vitest run --project worker test/worker/coordinator/retries.test.ts
  ```
- `demos/milestone-3.md`: the console locally, including recovery controls (disabling the executor role so tasks show "held: role disabled") and viewer redaction.
- `demos/milestone-4.md`: the simulation, the planner eval and the results check.
- `demos/milestone-1.md`: the toolchain, fail-closed configuration and identity.

## What not to claim

- Real users, employees or HR systems. Everything People-related is simulated, in production too.
- Failure recovery in production. Fault injection is off there, so retries, lease expiries, replays, verifier detections and recovery commands are local evidence (`simulation.json`) or tests.
- That the DLQ has fired. It has not, even locally (0 DLQ messages, `simulation.json`). Only tests cover it.
- Production planning quality. Workers AI has planned only the verification's four runs, plus whatever you launch in the demo.
- A working live WebSocket in production, until a rehearsal shows `live`. Polling works either way.
- The preview environment. It has no recorded verification, so keep it out of the demo.
- Human code review. There has been none.
- "Exactly once" without the qualifier "for the simulated integrations, shown locally under injected faults".

## Sources

- `eval/results/production.json`: production verification, 2026-10-15, commit `c9130b5`
- `eval/results/simulation.json`: 100-run local simulation, commit `0dbe380`
- `eval/results/planner-qwen3-1.7b-q4_0.json`: local planner eval
- `eval/results/tests.json`: tagged test count, 109 (67 orchestration, 42 authorization), all passing
- `scripts/cloudflare/env.ts`: production personas and roles
- `src/web/`: every label quoted above
- `docs/adr/`: design decisions; `README.md`: architecture, Free plan limits, limitations; `PROGRESS.md`: what is done and what is left
