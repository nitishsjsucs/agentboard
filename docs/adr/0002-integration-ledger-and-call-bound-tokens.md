# ADR 0002: An integration ledger and call-bound tokens for the People Ops MCP server

Status: accepted (2026-10-08)

## Context

Writes to the (simulated) People systems must happen at most once per plan step, even when a worker crashes after a call, two holders race, or an operator retries a step at a new generation after a write that really applied but looked like a timeout. A token that only scopes a namespace (for example `hris:write`) would let a confused call path reach a tool that needs approval.

## Decision

- The coordinator mints a short-lived HS256 token after each lease grant, bound to exactly that call: tool, canonical arguments hash, idempotency key, run, task, step, epoch and the lease expiry in milliseconds. Verifier tokens bind the verify read tools, the run's subject and the execute result's ids; planner tokens can only list tools. The endpoint refuses a token at or after its lease expiry, and every tool handler re-checks the binding.
- The integration keeps its own ledger keyed by `ik_` + sha256(run, step, generation, tool, canonical args). A completed key replays its stored result; a different arguments hash is a conflict; an in-progress key is busy until its lock lapses, then taken over with a conditional update.
- The effect is one atomic D1 batch. Every effect statement and the `side_effects` insert are guarded on the caller still owning the key and on no side effect existing yet for the step's correlation (`<runId>:<stepId>` from the token). The completion stores the first side effect's result, so a generation-bump retry of an applied write replays it (a logical replay) instead of applying it twice.
- The guards are conditions on statements, not uniqueness constraints, so the evaluation metrics `duplicate_side_effects` and `logical_duplicate_effects` measure behavior instead of restating a schema rule.

## Consequences

- A token for `hris.update_address` cannot call `hris.set_employment_status`, cannot change its arguments and cannot be replayed into another task or after its lease. An approval-gated step is never leased before approval, so no write token for it exists before then.
- Limit: every class runs in one Worker that holds the signing key. The binding defends against confused or buggy call paths, not against arbitrary code running inside the Worker.
- A dev-only `silent_noop` fault completes the ledger without an effect or a side-effect row, so the verifier detects it and an operator retry at the next generation applies the write for real.
