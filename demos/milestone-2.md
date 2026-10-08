# Milestone 2 demo: orchestration core

What this milestone shows: the per-run coordinator with leases, fencing and the sweep; the outbox and hash-chained audit; queue dispatch with a dispatch-fenced DLQ; the People Ops MCP server with call-bound tokens and the integration ledger; the three agents; approvals with separation of duties; role holds and DLQ replay.

## Script

1. **One run end to end through the real queue.** `npx vitest run --project worker test/worker/queue/dispatch.test.ts`. An address change goes from `initRun` through the local queue, the consumer and the planner, executor and verifier shards to `succeeded`; every lease went to the shard the consumer computed from role, run, task and attempt. An offboarding run stops at its approval, an approver approves through `POST /api/approvals/:id/decision`, and the run finishes with four writes.
2. **Leases and the sweep.** `test/worker/coordinator/leases.test.ts`: concurrent delivery of one dispatch grants one lease (`in_flight` for the other); an expired lease is reaped by the next RPC, by `onStart` after eviction, and by a real alarm within 6 s; a zombie's completion is refused by its old epoch.
3. **Duplicate-action prevention.** `test/worker/coordinator/idempotency.test.ts`: duplicate delivery, a crash after a successful call (the next attempt is a ledger replay), concurrent holders, ledger takeover and logical dedupe across generations each leave exactly one side effect.
4. **Recovery.** `state-machine.test.ts` #7 to #9 (pause, resume, skip and retry cascades), `budgets.test.ts` #5 (raise budget), `executor.test.ts` #4 (disable and enable a role, plus the wake recheck), `retries.test.ts` #5 and #6 (DLQ fencing and replay).
5. **Integrations are call-bound.** `test/worker/auth/mcp-auth.test.ts`: cross-tool calls, tampered arguments, mismatched `_meta`, verifier writes and expired leases are refused with no side effect.
6. **Prompt injection.** `test/worker/auth/plan-guard.test.ts`: a request text that asks to revoke another employee's roles produces a plan that is rejected after one repair, with no tasks, no write token and no side effect.
7. **Approvals.** `test/worker/approvals/approvals.test.ts` and `test/worker/auth/approvals-sod.test.ts`: approve dispatches once, reject cancels everything gated behind it, an expired approval gets 409, and nobody (admins included) decides their own run.
