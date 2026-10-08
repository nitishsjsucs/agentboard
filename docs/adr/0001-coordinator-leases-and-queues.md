# ADR 0001: A per-run coordinator with leases, a synchronous sweep and queue dispatch

Status: accepted (2026-10-08)

## Context

Three agents (planner, executor, verifier) work on one run's tasks. Cloudflare Queues deliver at least once, Durable Object RPCs can interleave at every `await`, workers can crash between a tool call and its report, and operators need to pause, retry, skip and cancel work safely. The Agents SDK `schedule()` is asynchronous, second-granular and cannot run inside a storage transaction.

## Decision

- One `RunCoordinator` Durable Object per run is the single writer of that run's tasks, leases, approvals, budgets and audit stream. Agents never call each other; they claim, trace and complete through coordinator RPCs.
- Every RPC is one `ctx.storage.transactionSync`: load the run, sweep, apply the operation, re-derive the run status, dispatch ready tasks, persist rows, append hash-chained events and write outbox rows. Nothing inside awaits. The run status is derived from task states, never set by a command.
- A claim grants a lease (owner, TTL, fencing epoch) only for the task's current `dispatchId`. A redelivery of a live dispatch is refused `in_flight`, a superseded one `stale_dispatch`, a finished task `duplicate`. Traces and completions must carry the current lease id and epoch, and one report per lease is accepted.
- Lease, approval and active-time expiry are enforced by a synchronous, idempotent sweep at the start of every transaction and in `onStart`. The `schedule()` wake is only a trigger, armed after the commit at the ceiling second of the next deadline with an idempotent `{ at }` payload.
- There is no lease renewal. `loadConfig` refuses configurations where a role's bounded external calls could outlive its lease.
- Dispatch is a transactional outbox: queue messages are written in the same transaction and sent after the commit. Two retry layers stay separate: queue redelivery for infrastructure failures (then a dispatch-fenced DLQ) and coordinator redispatch for task failures.

## Consequences

- At-least-once delivery, crashes in the commit-to-wake window, evictions and zombie holders are all recovered by the next sweep; tests drive the sweep with an injected clock and one test keeps a real alarm.
- The coordinator is a hot spot per run, not per fleet; runs scale out as separate objects.
- Recovery commands and their cascades (retry resets the verify task, skip skips it) are single transactions with their own audit events.
- Workflows were not used: they would duplicate retry semantics the coordinator must own anyway for leases, fencing and operator recovery.
