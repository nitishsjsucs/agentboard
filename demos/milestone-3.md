# Milestone 3 demo: the console

What this milestone shows: the HTTP API with launch idempotency and redaction, FTS5 history search, read-only live snapshots over WebSocket, and the React console (dashboard, runs with search, live run detail with recovery controls, approval queue, launch form, dev login).

## Setup

1. `npm run dev:keys` (once), then `npm run build`.
2. Fresh local state for the built worker:
   - `npx wrangler d1 migrations apply agentboard --local --persist-to .wrangler/demo-state --config dist/agentboard/wrangler.json` and the same for `agentboard-people`.
   - `npx wrangler d1 execute agentboard --local --persist-to .wrangler/demo-state --config dist/agentboard/wrangler.json --file seed/console.sql` and the same for `agentboard-people` with `seed/people.sql`.
3. `npx wrangler dev --config dist/agentboard/wrangler.json --persist-to .wrangler/demo-state --env-file "$PWD/.dev.vars" --port 8784 --ip 127.0.0.1` (the env file path must be absolute).

## Script

1. Open `http://127.0.0.1:8784/dev/login` and sign in as Ops Lead (operator). The banner says simulation mode: every People system and employee is simulated.
2. **Launch.** Go to Launch, choose a sample request (for example syn-0006, an address change), and launch. Submitting the same form again returns the same run (one idempotency key per form).
3. **Live detail.** The run page shows the green live indicator; tasks move from ready to leased to succeeded as the coordinator pushes snapshots. Open Tool calls to see the catalog read, the executor's calls with idempotency keys, and the verifier's reads. Open Audit to see the verified hash chain.
4. **Approvals.** Launch a manager change sample (for example syn-0022). It stops at awaiting approval after the read. As Ops Lead the approval card is disabled (your own run). Switch user to Lee Approver, open Approvals, write a note and approve; the run finishes.
5. **Recovery.** As Admin, disable the executor role on the dashboard and launch another sample: its execute task shows "held: role disabled". Enable the role and it continues. The dialogs require an audited reason.
6. **Search.** On Runs, search for an employee name plus a request type (for example "Rosalind Galloway address change"); highlights render as marks, never as HTML.
7. **Redaction.** Sign in as Ana Viewer: the request text is hidden, and addresses in tool-call arguments and results show only city, region and country.

## Tests behind it

`test/worker/auth/rbac-matrix.test.ts` (every endpoint group against every role), `redaction.test.ts`, `launch-scope.test.ts`, `test/worker/search/search.test.ts`, `test/worker-ws/live-updates.test.ts` and `websocket-auth.test.ts`, and the UI component tests under `src/web/components/__tests__/`.
