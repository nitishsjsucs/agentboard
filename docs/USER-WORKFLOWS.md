# User workflows

How each kind of user moves through the AgentBoard console, as the code in this repository works now. Labels in quotes are the console's own text from `src/web`. The production deployment was built from commit `c9130b5` and does not have the changes listed under "Changed on 2026-10-15" until it is redeployed.

Everything People-related is simulated: the employees, the HRIS, ITSM, access-management and notification systems are seeded tables, not real systems.

## Personas

| Persona | Role | Local dev principal | Can do |
|---|---|---|---|
| Viewer | `viewer` | Ana Viewer (`viewer.ana@agentboard.test`) | Read runs, search, read audit logs and agent roles. Personal data is redacted. |
| Operator | `operator` | Ops Lead (`ops.lead@agentboard.test`) | Everything a viewer can, plus launch runs, pause, resume and cancel runs, retry tasks, release leases and read the dead-letter queue. Sees personal data. |
| Approver | `approver` | Lee Approver (`approver.lee@agentboard.test`) | Everything a viewer can, plus decide approvals on runs they did not request. Sees personal data. |
| Admin | `admin` | Admin (`admin@agentboard.test`) | Everything above, plus skip tasks, raise budgets, replay dead letters and disable or enable agent roles. Cannot decide an approval on a run they requested. |
| No role | none | any signed-in email without a role binding | Nothing beyond seeing who they are signed in as. |

The server checks every permission on every request. The console only hides or explains what a role cannot do.

## Signing in

Locally (dev mode):

1. Open `http://127.0.0.1:8784` (`npm run serve:built`) or `http://127.0.0.1:5173` (`npm run dev`). Signed out, the console asks only for `/api/health` and `/api/me`, then opens "Dev login", with `?next=` set to the page you asked for unless it was the Dashboard.
2. Pick a principal. The one signed in now is marked "signed in".
3. You land on the page in `next` (only same-origin paths are honored), or on the Dashboard.
4. To change persona, click "switch user" in the nav.

Behind Cloudflare Access (production):

1. Open the app's URL; Access asks for an allowed email and a one-time PIN.
2. To change persona, click "Sign out" in the nav (it opens `/cdn-cgi/access/logout`), then sign in with another email.

If a session ends while you work (a request comes back 401, or Access answers with its login page), a banner appears and the page stays where it is, so typed text is kept: "Your dev session ended." with "Sign in again" (back to the same page after signing in), or "Your Cloudflare Access session may have ended. Reload to sign in again." with "Reload".

A principal without a role binding sees one page: "You are signed in as <email>, but you have no AgentBoard role. Ask an admin to add a role binding for this email." with Sign out or switch user. No other request is made.

## Viewer

Follow a run:

1. Dashboard shows the counts, "Needs attention", "Recent runs" and "Agent roles"; the "Dead-letter queue" panel is for operators and admins.
2. Open a run from "Recent runs" or Runs. The header shows the status badge and, when the run waits or needs attention, a notice that says why and who can act (for example "Waiting for an approver or an admin other than ops.lead@agentboard.test; the approval expires ...").
3. The request line reads "Request text is hidden for your role (it needs personal-data access)."
4. Use the tabs (Timeline, Tool calls, Approvals, Audit) with the mouse or with the arrow keys; the open tab is in the URL (`?tab=calls`), so a reload or a shared link keeps it.
5. In Tool calls, open a call with its tool-name button or by clicking the row. A viewer sees "Personal data is redacted for your role: addresses show only city, region and country, and personal email addresses are masked." above the arguments and result.
6. Audit shows "Hash chain verified: N events, ..." for the run.

Search the history:

1. On Runs, type a query (for example an employee name and a request type) and press Search, or use the status, type and date filters.
2. While results load, the page says "Searching..." and "Loading runs..."; an empty answer says "No matches." or "No runs match.".
3. A filter the server rejects shows "Some values were not accepted." with "Clear filters".

On the approval queue a viewer sees "Approvers and admins decide approvals." instead of a note field and buttons.

## Operator

Launch a run:

1. Click "Launch" in the nav ("Launch a run").
2. Locally, pick a "Sample request (dev only)"; choosing the placeholder again clears what it filled in. In production, type the request.
3. Choose the request type, the subject employee and "Request text". Until the form is complete, a hint under "Launch run" says what is missing ("Choose a subject employee." or "Request text needs at least 10 characters (n of 10).").
4. With the local stub planner, text that matches no sample gets a warning that it will probably fail planning. It does not block the launch.
5. Click "Launch run". The page moves to the new run.
6. If the answer was lost (network failure), the fields lock and "The launch may not have reached AgentBoard." offers "Try again" (the same request with the same key, so it cannot start a second run) or "Edit request" (a new request with a new key).
7. If the server says the form's key was already used for a different request, the page explains it with a link to Runs and "Start a new request".

If an agent role is disabled, the Launch page says so with the reason and who disabled it, because new runs will wait.

Recover a run that needs attention:

1. Open the run. The notice under the header names the cause and the next step for an operator (for example, with the stub planner: "The planner failed on every attempt." and "Cancel this run and launch a sample.").
2. On a phone-width screen the Recovery card comes before the tabs when the run needs attention or is paused.
3. Click a recovery button ("Pause run", "Cancel run", "Retry", "Release lease"). The dialog asks for "Reason (recorded in the audit log)"; Escape closes it, Tab stays inside it, and focus returns to the button afterwards.
4. Click "Confirm". The Recovery card says what happened ("Paused the run.", "Retry of the plan task requested.") or why the coordinator refused, in plain words.
5. An operator cannot raise a budget: on an exhausted budget the notice says "Ask an admin to raise the budget."

On their own runs an operator sees "You requested this run, so you cannot decide its approval." with the note field and buttons disabled.

## Approver

Decide approvals:

1. Click "Approvals" ("Approval queue"). The status tabs (pending, approved, rejected, expired, all) are in the URL (`?status=rejected`) and work with the arrow keys.
2. Each card shows the risk, the tool, the summary and a link named after the run's title.
3. Type a note in "Decision note (required)" (the hint says "At least 3 characters"), then click "Approve" or "Reject".
4. A status line confirms the decision ("Approved: <summary>. <run title> continues." or "Rejected: <summary>. The run ends as rejected; no writes ran.") with a link to the run, and focus moves to the next card's note.
5. If someone else decided first, or the approval expired, the list refreshes and the status line says "This approval was already decided or has expired. The list now shows its current state."
6. Decided and expired cards show who decided and their note, or why the approval expired (for example "expired: run cancelled"), and no expiry date.

## Admin

Control agents and the dead-letter queue:

1. On the Dashboard, "Agent roles" offers "Disable" and "Enable" with an audited reason. While a role is disabled, runs that reach it show "Tasks are held because the executor role is disabled. An admin can enable it on the Dashboard."
2. "Dead-letter queue" offers "Replay" for open dead letters.
3. If a panel cannot load, it shows its own error card with "Try again" instead of disappearing.

Raise a budget:

1. Open a run whose notice says "The run is out of budget: ..." (it names the meter, for example "tool calls are at 24 of 24") and "Use Raise budget in Recovery.".
2. Click "Raise budget". The fields start at the current limits and read "Tool calls (used U of N)", "LLM tokens (used U of N)", "Attempts per task (now N)" and "Active time in minutes (used U of N)"; the exhausted one is marked.
3. Raise at least one value. Until then, "Raise at least one value above its current limit, and lower none." explains why Confirm is disabled.
4. Give a reason and confirm. "Raised the budget." appears and the blocked task runs again.

Admins also hold every operator and approver workflow above, except deciding approvals on runs they launched.

## Every page

- The first Tab press reaches "Skip to content".
- Each page has its own browser title ("Runs | AgentBoard", "Run: <title> | AgentBoard"), and after moving to another page focus is on its heading.
- Loading data shows a "Loading ..." line, a failed load shows a plain message with "Try again", and data from an earlier load stays visible with "Showing data from <time>; the last refresh failed." when a refresh fails. Empty states appear only for empty answers.
- Errors never show server internals (permission names, refusal codes, validation output). Server failures show a request id to quote.
- Layouts work at 375 px wide: the nav wraps to a second, scrolling row of links, forms stack to one column and wide tables scroll inside their card.

## Changed on 2026-10-15

What this round improved, and why. Each item is a commit in this repository with its tests.

1. **Phone-width layouts.** The nav links could be squeezed to nothing at 375 px, run detail left about 67 px for the tabs, and the launch form and approval note were cramped. The nav now wraps, run detail stacks (Recovery first when it is the next step), forms go to one column and the dashboard no longer scrolls sideways. The 1280 px layout is unchanged, measured before and after.
2. **Loading, empty, failed and stale data are told apart.** Before, the dashboard showed 0 for every count while loading or after a failure, panels disappeared on errors, and tabs said "No tool calls yet." while still loading. Now each polled view has a loading line, an error with Try again, a stale-data line, or real data.
3. **Plain error messages.** Pages showed server internals such as "requires runs:launch", "decision refused: already_decided", zod output, "Unexpected token <" or "Failed to fetch". They now show what happened and what to do, and an unknown run id links to the run list and a search.
4. **Session handling.** The dashboard fired requests before the session was known, a principal without a role met raw 403s everywhere, an expired session showed a raw error, and production had no way to sign out. Now pages wait for the session, a no-role page explains the situation, an expiry banner keeps typed text, the dev login returns to where you were, and Access mode has "Sign out".
5. **Launch form guidance and safe retries.** The disabled button gave no reason, the sample placeholder left stale fields, stub-planner misses failed silently about 9 s later, a lost answer could lead to an idempotency conflict, and roles without launch rights saw the form plus 403s. Each now has a hint, a reset, a warning, a same-key retry or an explanation.
6. **Why a run waits and what to do next.** Status reasons were raw codes, so operators retried runs that could not succeed and did not learn that only admins raise budgets. A notice now explains each reason for the viewer's role, and the Events table reads "approval rejected" (it read "approval rejectd") and lists a rejected plan's issue codes.
7. **Approver context and outcomes.** Cards linked a bare run id, a decision gave no confirmation and lost focus, a decision someone else made first showed a raw refusal, and cancelled approvals looked unexpired. Cards now show the run title, a status line confirms each decision and focus moves on, conflicts refresh the list, and non-deciders see who decides.
8. **Accessible dialogs and recovery outcomes.** The confirm dialog had no Escape, no focus trap and no focus return, and a backdrop click threw away a typed reason. Recovery results ("Accepted." or "Refused: code.") were not announced, and the budget dialog used internal field names and milliseconds. All of these are fixed.
9. **Keyboard and screen-reader basics.** There was no skip link, every page was titled "AgentBoard", tool-call details opened only on a mouse click, tabs had no tabpanels or arrow keys and were lost on reload, and status changes were silent. Now there is a skip link, per-page titles, focus on the heading after navigation, a details button, real tabs kept in the URL, meters with values and a status announcement.
10. **Viewers learn what is hidden.** The request text and redacted tool-call data looked absent or complete. Viewers now see a sentence for each, matching what the server's redaction does.

Server changes in this round are limited to two read paths: the Events summaries in `src/worker/api/routes/timeline.ts`, and the run title and request type added to approval list items (`src/worker/api/routes/approvals.ts`, `runs.ts`). Authorization, approvals, idempotency, budgets and redaction are unchanged.
