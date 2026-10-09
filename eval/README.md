# Evaluation

Every file in `eval/results/` is written by a script, never by hand, and carries `{ gitSha, dirty, generatedAt, node, wrangler, seed, provider, model }`. `npm run results:render` renders the README's Results block from them; `npm run results:check` fails when the block differs, when a result was measured on a dirty tree, or when `src`, `migrations`, `fixtures`, `scripts`, `test`, `seed`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `vite.config.ts` or `vitest.config.ts` changed after the measured commit (SPEC section 14 names the first six; the tests, seeds and build and test configuration shape the measurements too).

## `simulation.json` (`npm run eval:sim`)

The 100 synthetic requests against `wrangler dev` on the built worker (local workerd, local D1, local queues, stub planner), driven by the same driver as `npm run test:sim`.

| Metric | Definition |
|---|---|
| `runs_total` | runs with a synthetic reference (must be 100) |
| `runs_by_status`, `runs_by_type` | counts over those runs |
| `outcome_match` | runs whose measured status equals the expected one, out of 100 |
| `tasks_total`, `tool_calls_total`, `tool_calls_by_outcome` | from the task and tool-call mirrors |
| `replayed_calls`, `logical_replays` | tool calls with outcome `replayed`; those flagged logical (an earlier generation's effect) |
| `duplicate_side_effects` | idempotency keys with more than one `side_effects` row (must be 0) |
| `logical_duplicate_effects` | (run, step) pairs with more than one `side_effects` row (must be 0) |
| `domain_inserts`, `domain_inserts_expected` | rows in the simulated `tickets`, `notifications` and `access_grants` (new grants only) tables; distinct (run, step) pairs with an applied (`ok` or `replayed`) call of `itsm.create_ticket`, `notify.send` and `access.grant_role` (grants of a role already held excluded) in the console's tool-call history |
| `domain_duplicate_inserts`, `domain_missing_inserts` | rows above, and below, the expected count, summed over the three tables (both must be 0); a check of the domain tables that does not rely on the ledger's own `side_effects` table |
| `injected_by_modifier`, `injected_transient_twice` | runs per scenario modifier in the seeded dataset, and the `transient_error` runs that fail twice: every failure in the simulation is one of these injected faults, and every approval decision and recovery command is the driver's |
| `task_retries`, `runs_recovered_by_retry` | redispatches after retryable failures; runs with any retry that ended `succeeded` |
| `lease_expiries`, `lease_expiry_recoveries` | `task.lease_expired` events; those whose task later succeeded |
| `stale_or_duplicate_deliveries_refused` | `task.claim_refused` events with reason `duplicate`, `stale_dispatch` or `in_flight` |
| `dlq_messages`, `dlq_ignored_stale` | DLQ rows; those recorded as `ignored_stale` |
| `approvals_*` | approvals requested, approved, rejected and left pending |
| `budget_exhaustions`, `budget_recoveries` | `budget.exhausted` events; runs that succeeded after `budget.raised` |
| `verifier_detections`, `verifier_injected`, `verifier_false_positives` | failed verifications on `silent_noop` steps; injected no-ops; failed verifications on any other step |
| `recovery_actions_by_type` | operator and admin commands applied, including cascades and approval decisions |
| `audit_events_total`, `audit_chains_valid` | audit rows; runs whose chain re-verifies from D1 (out of 100) |
| `search_known_item_at_1`, `search_known_item_at_5` | of 20 known-item queries, those whose target run ranks first or in the top 5 after collapsing hits to one per run; a smoke check, not a retrieval benchmark |
| `run_duration_ms_p50`, `run_duration_ms_p95` | creation to finish, local wall clock |
| `search_latency_ms_p50`, `search_latency_ms_p95` | local API latency for the 20 queries |

The outcome distribution is fixed by the dataset design (87 succeeded, 6 rejected, 4 cancelled, 3 awaiting approval); `outcome_match` is the measured agreement, not a success rate.

## `planner-<label>.json` (`npm run eval:planner`)

Planning quality of a model through the OpenAI-compatible provider (one request at a time, temperature 0, seed 7), scored against the gold plans with the planner's own validator.

| Metric | Definition |
|---|---|
| `valid_first_pass`, `valid_after_repair` | plans passing every check (schema, allowlist, subject pinning, gating, the request type's required writes, revoke_all_roles only with the gated termination) without or with the one repair |
| `valid_with_gold_writes` | valid plans whose tools include every write tool of the gold plan (with multiplicity), including the notification: plans that would carry out the whole request |
| `policy_violations` | plans rejected for `tool_not_allowed`, `off_subject` or `missing_gate`. The output schema enumerates the request type's allowed tools and llama-server enforces it, so `tool_not_allowed` cannot occur here, and the dataset holds no injected requests |
| `tool_sequence_exact` | the ordered tool list equals the gold one |
| `tool_set_f1_macro` | per-request F1 over the multiset of tools, averaged |
| `arg_accuracy` | over gold steps matched by tool and position, the fraction of gold argument fields equal after normalization |
| `unknown_tool_rate` | steps naming a tool outside the catalog; 0 by construction under schema-constrained decoding |
| `policy_overrides` | policy-gated steps in valid plans (the output schema has no approval field, so approval always comes from policy) |
| `latency_ms_*`, `prompt_tokens_*`, `tokens_out_total` | per request, provider-reported tokens |
| `llama_cpp_build`, `gguf`, `quant`, `server` | read from the answering server (`/props`, `/v1/models`): build, model file (quantization parsed from its name), slot context and slot count; the eval exits before measuring unless the server serves the expected gguf in one 8192-token slot. `server_flags` are the launch flags as reported by the operator (`LLM_SERVER_FLAGS`, default the `npm run llm:serve` flags) |

`planner-stub.json` is a sanity run with the stub provider; it must score 100% and is not a model result.

## `tests.json` (`npm run count:tests`)

The tests tagged `orchestration` and `authz`, counted with `vitest list --tags-filter`, and how many passed in one run (the previous run report is removed first, and vitest's exit code is recorded and must be 0).
