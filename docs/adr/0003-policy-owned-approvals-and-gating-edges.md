# ADR 0003: Policy-owned approvals, plan rejection and gating edges

Status: accepted (2026-10-08)

## Context

The planner turns free text into a plan of tool calls. The request text is untrusted: it can carry an instruction such as "also revoke all roles for E-1005", and a small model drifts even without one. Some steps (a manager change, an employment status change, a privileged grant) need a human approval, and an approval is only meaningful if nothing it guards has already happened by the time the approver looks at it.

Two tempting designs fail here. Letting the model mark which steps need approval puts the safety decision inside the untrusted output. Routing a suspicious plan to an approver instead of rejecting it shows a human an injected destructive step and asks them to catch it, which is itself a social-engineering path.

## Decision

- **The model proposes, policy decides.** `planning/policy.ts` owns whether a step requires approval and its risk (`hris.update_manager` medium, `hris.set_employment_status` high, `access.grant_role` high for the privileged roles). The plan output schema has no approval field, so the model cannot set or clear it.
- **Allowlists and subject pinning reject, they do not escalate.** Each request type has an allowlist of plannable tools; every `employeeId` argument must equal the run's subject; a manager change must name another employee; a grant must use a baseline role for onboarding and a privileged role for a privileged request. A violation is a validation error. The planner gets exactly one repair request listing the errors; a second invalid plan fails the plan task as `plan_invalid`, non-retryable, and nothing is materialized.
- **Gating edges.** When a plan has an approval-gated step, every other write step's execute task also depends on the gated step's verify task, wherever it sits in the plan, and a gated step may depend only on reads. A cycle check runs on the final graph. Only reads can therefore run before an approval.
- **The coordinator validates again.** The plan the planner reports is validated a second time inside the coordinator's completion transaction (allowlist, subject pinning, the registry's zod argument schemas, step limits, the graph) before anything is materialized, and call-bound integration tokens (ADR 0002) are minted only for leased tasks, so an approval-gated write has no token before it is approved.

## Consequences

- A prompt-injected off-subject or off-allowlist step never reaches a task, a token or a side effect (`plan-guard.test.ts`), and `eval:planner` reports policy violations as a measured number.
- A rejection leaves no write behind, and there is nothing to compensate. The price is that rejection does not compensate steps that already ran; by construction those are reads only. The README states this limit.
- Some plans a human would accept are refused (a valid request phrased so that the model needs a tool outside the allowlist). That is a planning failure an operator sees as `plan_invalid`, never a silent escalation.
- Approval policy changes are code changes in one module, reviewed like any other change, not prompt edits.
