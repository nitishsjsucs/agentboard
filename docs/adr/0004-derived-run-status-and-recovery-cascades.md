# ADR 0004: Derived run status and recovery commands with cascades

Status: accepted (2026-10-08)

## Context

A run's status is shown to operators, mirrored to D1, searched and counted by the evaluation. Operators change runs with recovery commands (pause, resume, cancel, retry a task, skip a task, release a lease, raise a budget, hold and release a role, replay a dead letter) while agents keep claiming and completing tasks concurrently. In revision 1 of the spec a command could set the run status directly, and two cases had no rule at all: what happens to a verify task when its execute task is skipped, and when its execute task is retried at a new generation. Six of the 100 simulated runs could not finish because of that gap.

## Decision

- **Status is derived, never set.** Commands change task state and two run flags (`paused`, `cancelled`); `deriveRunStatus()` recomputes the run status at the end of every coordinator transaction from the task states, the approvals and the flags, with a fixed precedence: terminal stays terminal; a rejected approval makes the run `rejected`; `cancelled`; `paused`; `needs_attention` for a failed, budget-blocked or dead-lettered task, an expired approval or an exceeded active-time deadline; `queued` or `planning` until the plan succeeds; `awaiting_approval` when only gated work remains; `succeeded` when every execute and verify task succeeded or was skipped; otherwise `running`.
- **Every command is one transaction, and cascades happen inside it.** Retrying an execute task resets its verify task to `pending` at generation + 1; skipping an execute task skips its verify task. Each cascade writes its own audit event with `cascadeFrom`. Retrying a verify task while its execute task is being re-run is impossible by construction: the verify task is `pending`, and a pending task cannot be retried or claimed.
- **Commands refuse instead of guessing.** A target outside a command's allowed states answers 409 with the reason and the current snapshot. Plan tasks and approval-gated tasks cannot be skipped.
- **Leaving a stopped state redispatches once.** When a transaction moves the run out of `paused` or `needs_attention`, every ready task is dispatched once with a new `dispatchId`, so a resume or a recovery command never double-dispatches and never strands a task that became ready while the run was stopped.

## Consequences

- The status shown anywhere is a pure function of task state, so it cannot drift from the tasks, and a table test (`state-machine.test.ts` #5) pins the precedence.
- All 100 simulated runs reach a defined end, including the skip and retry scenarios (`state-machine.test.ts` #8 and #9, `verifier.test.ts` #3, and the simulation's outcome match).
- New commands must be expressed as task-state changes plus cascades; there is no escape hatch that sets a status, which keeps the audit trail explainable.
- Cancel is a flag rather than a status write, so a late completion from an in-flight holder is refused by the task state (`cancelled`), not by a race on the run row.
