# AgentBoard glossary

Terms used across the code, the API and the console. The design is in `SPEC.md`.

**Run.** One request from a People-operations operator (for example "address change for E-1014"), identified by `run_<ULID>`. A run owns a plan task, the execute and verify tasks materialized from the plan, its approvals, its budget and its audit stream. Its status is derived from its tasks, never set directly.

**Task.** One unit of work inside a run: `plan` (the planner turns the request into steps), `execute` (one tool call for one step) or `verify` (the postcondition check after a write step). Identified by `tsk_<ULID>`.

**Step.** One entry of the plan (`s1`, `s2`, ...): a tool, its arguments and the earlier steps it depends on. Each step becomes one execute task; each write step also gets a verify task.

**Lease.** The right to work on one task, granted by the coordinator to one agent instance with an owner, an expiry and an epoch. There is no renewal; every external call is bounded below the lease TTL instead.

**Epoch.** The lease's fencing number. It increases on every grant, and traces and completions must carry the current epoch, so a zombie holder of an older lease is refused (`stale_lease`).

**Dispatch.** One queue message for one task, identified by a `dispatchId` that is regenerated on every redispatch (lease expiry, retry, release, replay, resume). A claim with a superseded `dispatchId` is `stale_dispatch`; a redelivery of the live dispatch is `in_flight`.

**Generation.** A task's retry generation. An operator retry bumps it, which changes the idempotency key of a write; the attempt counter resets.

**Sweep.** The synchronous, idempotent `reapExpired(now)` that runs at the start of every coordinator transaction and in `onStart`: it reaps expired leases, expires pending approvals and enforces the active-time deadline.

**Wake.** A one-shot Agent `schedule()` armed after each commit at the ceiling second of the next deadline. It only triggers a sweep; correctness never depends on it firing exactly.

**Budget.** Per-run limits: `maxSteps`, `maxToolCalls`, `maxLlmTokens`, `maxAttemptsPerTask`, `maxActiveMs`. A claim that would exceed a budget leaves the task `budget_blocked` until an admin raises the budget.

**Approval.** A decision required before an approval-gated step may run (manager changes, employment status changes, privileged role grants). The coordinator is its only writer and enforces separation of duties: nobody decides an approval on a run they requested.

**Recovery command.** An operator or admin control on a run or task: pause, resume, cancel, retry task, skip task, release lease, raise budget, disable or enable an agent role, DLQ replay. Each is one coordinator transaction with its own audit events.

**Cascade.** The effect of a recovery command on a dependent task in the same transaction: retrying an execute task resets its verify task to `pending`; skipping an execute task skips its verify task. Each cascade writes its own audit event with `detail.cascadeFrom`.

**Correlation.** `<runId>:<stepId>`, taken from the integration token. The integration ledger applies a step's effect at most once per correlation, across all generations (logical dedupe).

**Principal.** An authenticated identity: a lowercase email for people, or `svc:<common_name>` for an Access service token. Its role (viewer, operator, approver, admin) comes from `role_bindings`; without a binding it can only call `/api/me`.

**Simulated People systems.** HRIS, ITSM, access management and notifications are tables in a separate D1 database behind an MCP server, filled with 60 fictional employees. There is no real People organization or HR system behind AgentBoard in any environment.
