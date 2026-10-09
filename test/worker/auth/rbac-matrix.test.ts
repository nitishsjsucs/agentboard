import { describe, expect, it } from "vitest";
import { distinctRuns, driveAgents, inputFromDataset } from "../../helpers/agents.ts";
import { apiGet, apiPost } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import { readState, settleRuns, startManualRun, takeDispatches } from "../../helpers/runs.ts";

const PRINCIPALS = { viewer: P.viewer, operator: P.operator2, approver: P.approver, admin: P.admin, unbound: P.unbound } as const;
type Who = keyof typeof PRINCIPALS;
type Allowed = Record<Who, boolean>;

const READ_ROLES: Allowed = { viewer: true, operator: true, approver: true, admin: true, unbound: false };
const OPERATE: Allowed = { viewer: false, operator: true, approver: false, admin: true, unbound: false };
const DECIDE: Allowed = { viewer: false, operator: false, approver: true, admin: true, unbound: false };
const ADMIN_ONLY: Allowed = { viewer: false, operator: false, approver: false, admin: true, unbound: false };

/**
 * Calls the endpoint as every principal. A denied principal must get 403
 * `forbidden`; an allowed one must get one of `expected` (the endpoint's own
 * answer, for example 409 for a command the run's state refuses), so a server
 * error on an allowed path fails the test too.
 */
async function matrix(label: string, allowed: Allowed, expected: readonly number[], call: (principal: string, who: Who) => Promise<Response>): Promise<void> {
  for (const [who, principal] of Object.entries(PRINCIPALS) as [Who, string][]) {
    const response = await call(principal, who);
    if (allowed[who]) {
      expect(expected, `${label}: ${who} should be allowed (got ${response.status})`).toContain(response.status);
    } else {
      expect(response.status, `${label}: ${who} should be denied`).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    }
  }
}

let launchCounter = 0;
function launchBody(extra: Record<string, unknown> = {}) {
  launchCounter += 1;
  return { clientRequestId: `rbac-${Date.now()}-${launchCounter}`, requestType: "address_change", requestText: "Please update the address on file for this employee.", subjectEmployeeId: "E-1033", ...extra };
}

describe("RBAC matrix", { tags: ["authz"] }, () => {
  it("run reads: list, detail, tool calls and timeline", async () => {
    const { runId } = await startManualRun();
    await matrix("GET /api/runs", READ_ROLES, [200], (p) => apiGet(p, "/api/runs"));
    await matrix("GET /api/runs/:id", READ_ROLES, [200], (p) => apiGet(p, `/api/runs/${runId}`));
    await matrix("GET /api/runs/:id/tool-calls", READ_ROLES, [200], (p) => apiGet(p, `/api/runs/${runId}/tool-calls`));
    await matrix("GET /api/runs/:id/timeline", READ_ROLES, [200], (p) => apiGet(p, `/api/runs/${runId}/timeline`));
    await matrix("GET /api/metrics/summary", READ_ROLES, [200], (p) => apiGet(p, "/api/metrics/summary"));
  });

  it("launch, and launch with a budget override", async () => {
    const launched: string[] = [];
    const launch = async (principal: string, body: Record<string, unknown>) => {
      const response = await apiPost(principal, "/api/runs", body);
      if (response.status === 201) launched.push(((await response.clone().json()) as { runId: string }).runId);
      return response;
    };
    await matrix("POST /api/runs", OPERATE, [201], (p) => launch(p, launchBody()));
    await matrix("POST /api/runs with budget", ADMIN_ONLY, [201], (p) => launch(p, launchBody({ budget: { maxToolCalls: 30 } })));
    // The allowed launches started real runs; let their planner work finish before the file ends.
    expect(launched).toHaveLength(3);
    await settleRuns(launched);
  });

  it("run controls: pause, resume, cancel", async () => {
    const { runId } = await startManualRun();
    for (const command of ["pause", "resume", "cancel"]) {
      await matrix(`POST /api/runs/:id/${command}`, OPERATE, [200, 409], (p) => apiPost(p, `/api/runs/${runId}/${command}`, { reason: `rbac ${command}` }));
    }
  });

  it("task retry and release-lease", async () => {
    const { stub, runId } = await startManualRun();
    const [plan] = await takeDispatches(stub);
    const taskId = plan?.message.taskId ?? "";
    await matrix("retry", OPERATE, [200, 409], (p) => apiPost(p, `/api/runs/${runId}/tasks/${taskId}/retry`, { reason: "rbac retry" }));
    await matrix("release-lease", OPERATE, [200, 409], (p) => apiPost(p, `/api/runs/${runId}/tasks/${taskId}/release-lease`, { reason: "rbac release" }));
  });

  it("task skip and budget patch", async () => {
    const { stub, runId } = await startManualRun();
    const [plan] = await takeDispatches(stub);
    await matrix("skip", ADMIN_ONLY, [200, 409], (p) => apiPost(p, `/api/runs/${runId}/tasks/${plan?.message.taskId ?? ""}/skip`, { reason: "rbac skip" }));
    await matrix("budget", ADMIN_ONLY, [200], (p) => apiPost(p, `/api/runs/${runId}/budget`, { maxToolCalls: 40, reason: "rbac budget" }, "PATCH"));
  });

  it("approval decisions", async () => {
    const [run] = distinctRuns("manager_change", 1);
    if (!run) throw new Error("no dataset run");
    const { stub } = await startManualRun(inputFromDataset(run, { requester: P.operator }));
    await driveAgents(stub);
    const approval = [...(await readState(stub)).approvals.values()][0];
    await matrix("POST /api/approvals/:id/decision", DECIDE, [200, 409], (p) => apiPost(p, `/api/approvals/${approval?.id ?? ""}/decision`, { decision: "approve", note: "rbac decision" }));
    await matrix("GET /api/approvals", READ_ROLES, [200], (p) => apiGet(p, "/api/approvals"));
  });

  it("search and run audit read", async () => {
    const { runId } = await startManualRun();
    await matrix("GET /api/search", READ_ROLES, [200], (p) => apiGet(p, "/api/search?q=address%20change"));
    await matrix("GET /api/runs/:id/audit", READ_ROLES, [200], (p) => apiGet(p, `/api/runs/${runId}/audit`));
  });

  it("agent roles: read and toggle", async () => {
    await matrix("GET /api/agents", READ_ROLES, [200], (p) => apiGet(p, "/api/agents"));
    await matrix("POST /api/agents/:role/enable", ADMIN_ONLY, [200], (p) => apiPost(p, "/api/agents/verifier/enable", { reason: "rbac toggle" }));
    await matrix("POST /api/agents/:role/disable", ADMIN_ONLY, [200], (p, who) =>
      who === "admin" ? apiPost(p, "/api/agents/verifier/enable", { reason: "keep enabled" }) : apiPost(p, "/api/agents/verifier/disable", { reason: "rbac toggle" }),
    );
  });

  it("DLQ: read and replay", async () => {
    await matrix("GET /api/dlq", OPERATE, [200], (p) => apiGet(p, "/api/dlq"));
    await matrix("POST /api/dlq/:id/replay", ADMIN_ONLY, [404], (p) => apiPost(p, "/api/dlq/msg-does-not-exist/replay", { reason: "rbac replay" }));
  });
});
