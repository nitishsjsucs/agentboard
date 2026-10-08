import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { VerifierAgent } from "../../../src/worker/agents/verifier-agent.ts";
import { distinctRuns, driveAgents, inputFromDataset, verifierAgent } from "../../helpers/agents.ts";
import { events, readState, startManualRun } from "../../helpers/runs.ts";

const OPERATOR = { kind: "user" as const, id: "ops.lead@agentboard.test" };
// One address-change request per test, each for a different employee.
const [PASSING, NOOP, RETRIED] = distinctRuns("address_change", 3) as [ReturnType<typeof distinctRuns>[number], ReturnType<typeof distinctRuns>[number], ReturnType<typeof distinctRuns>[number]];

async function verificationLog() {
  const agent = await verifierAgent("verifier-0");
  return runInDurableObject(agent as unknown as DurableObjectStub<VerifierAgent>, (instance: VerifierAgent) =>
    instance.sql<{ task_id: string; check: string; passed: number; evidence_json: string }>`SELECT task_id, "check", passed, evidence_json FROM ab_verification_log ORDER BY rowid`,
  );
}

describe("VerifierAgent", { tags: ["orchestration"] }, () => {
  it("passes when the postcondition read matches the executed write", async () => {
    const run = PASSING;
    const { stub, runId } = await startManualRun(inputFromDataset(run));
    await driveAgents(stub);
    const state = await readState(stub);
    const verifies = [...state.tasks.values()].filter((t) => t.kind === "verify");
    expect(verifies.map((t) => [t.tool, t.status])).toEqual([
      ["hris.update_address", "succeeded"],
      ["notify.send", "succeeded"],
    ]);
    expect(state.run.status).toBe("succeeded");
    const log = (await verificationLog()).filter((row) => verifies.some((v) => v.id === row.task_id));
    expect(log.map((r) => [r.check, r.passed])).toEqual([
      ["address_matches", 1],
      ["delivery_sent", 1],
    ]);
    // The verifier used only read tools.
    const verifierCalls = await env.DB.prepare("SELECT tool FROM tool_calls WHERE run_id = ? AND agent LIKE 'verifier-%'").bind(runId).all<{ tool: string }>();
    expect(verifierCalls.results.map((c) => c.tool)).toEqual(["hris.get_employee", "notify.get_delivery"]);
    expect((await events(stub)).filter((e) => e.action === "verify.passed")).toHaveLength(2);
  });

  it("detects a silent no-op: verification fails with evidence and the run moves to needs_attention", async () => {
    const run = NOOP;
    const { stub } = await startManualRun(inputFromDataset(run, { sim: { faults: [{ stepId: "s2", generation: 0, attempt: 1, kind: "silent_noop" }] } }));
    await driveAgents(stub);
    const state = await readState(stub);
    const verify = [...state.tasks.values()].find((t) => t.kind === "verify" && t.stepId === "s2");
    expect([verify?.status, verify?.lastError]).toEqual(["failed", "postcondition_failed"]);
    expect(state.run.status).toBe("needs_attention");
    const failed = (await events(stub)).find((e) => e.action === "verify.failed");
    expect(failed?.detail["evidence"]).toMatchObject({ check: "address_matches", expected: { address: { city: run.fields.address?.city } } });
    // Audit detail is redacted at write time: no street or postal code.
    expect(JSON.stringify(failed?.detail)).not.toContain(run.fields.address?.line1 ?? "never");
    // s3 (notify) never ran: it waits behind the failed verification.
    expect([...state.tasks.values()].find((t) => t.kind === "execute" && t.stepId === "s3")?.status).toBe("pending");
  });

  it("an operator retry of the execute task re-executes at generation + 1, the verify task re-runs, and the run succeeds", async () => {
    const run = RETRIED;
    const { stub, runId } = await startManualRun(inputFromDataset(run, { sim: { faults: [{ stepId: "s2", generation: 0, attempt: 1, kind: "silent_noop" }] } }));
    await driveAgents(stub);
    const execute = [...(await readState(stub)).tasks.values()].find((t) => t.kind === "execute" && t.stepId === "s2");
    const result = await stub.control({ type: "retry_task", taskId: execute?.id ?? "", actor: OPERATOR, reason: "re-run the address change" });
    expect(result.accepted).toBe(true);
    await driveAgents(stub);
    const state = await readState(stub);
    expect(state.run.status).toBe("succeeded");
    const x2 = state.tasks.get(execute?.id ?? "");
    const v2 = [...state.tasks.values()].find((t) => t.kind === "verify" && t.stepId === "s2");
    expect([x2?.generation, x2?.status, v2?.generation, v2?.status]).toEqual([1, "succeeded", 1, "succeeded"]);
    const employee = await env.PEOPLE_DB.prepare("SELECT address_json FROM employees WHERE id = ?").bind(run.subjectEmployeeId).first<{ address_json: string }>();
    expect(JSON.parse(employee?.address_json ?? "{}")).toEqual(run.fields.address);
    // The no-op wrote no side effect, so generation 1 applied for real, exactly once.
    const effects = await env.PEOPLE_DB.prepare("SELECT generation FROM side_effects WHERE run_id = ? AND step_id = 's2'").bind(runId).all<{ generation: number }>();
    expect(effects.results).toEqual([{ generation: 1 }]);
  });
});
