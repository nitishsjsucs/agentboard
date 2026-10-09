import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import datasetRaw from "../../../fixtures/synthetic/dataset.v1.json?raw";
import checksumRaw from "../../../fixtures/synthetic/dataset.v1.sha256?raw";
import consoleSeed from "../../../seed/console.sql?raw";
import peopleSeed from "../../../seed/people.sql?raw";
import { REQUEST_TYPES } from "../../../src/shared/domain.ts";
import { REQUEST_TEMPLATES } from "../../../src/shared/synth/catalog.ts";
import {
  APPROVAL_TYPES,
  generateDataset,
  MODIFIER_COUNTS,
  renderConsoleSeed,
  renderPeopleSeed,
  RUNS_BY_TYPE,
  serializeDataset,
  type SyntheticDataset,
} from "../../../src/shared/synth/generator.ts";
import { WRITE_TOOLS } from "../../../src/shared/synth/gold-plans.ts";
import { validatePlan } from "../../../src/worker/planning/planner.ts";

const dataset: SyntheticDataset = generateDataset();

function countBy<T>(items: readonly T[], key: (item: T) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item) ?? "none";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

describe("synthetic generator", { tags: ["data"] }, () => {
  it("emits exactly 100 run requests, syn-0001..syn-0100, in requested_at order", () => {
    expect(dataset.runs).toHaveLength(100);
    expect(dataset.runs.map((r) => r.ref)).toEqual(Array.from({ length: 100 }, (_, i) => `syn-${String(i + 1).padStart(4, "0")}`));
    const times = dataset.runs.map((r) => Date.parse(r.requestedAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("matches every count in SPEC section 12.1", () => {
    const { employees, accessGrants, principals, runs, searchQueries } = dataset;
    expect(employees).toHaveLength(60);
    expect(employees.map((e) => e.id)).toEqual(Array.from({ length: 60 }, (_, i) => `E-${1001 + i}`));
    expect(Object.values(countBy(employees, (e) => e.department))).toEqual([10, 10, 10, 10, 10, 10]);
    expect(countBy(employees, (e) => e.location)).toEqual({ "San Jose": 18, Austin: 15, "New York": 15, Remote: 12 });
    expect(employees.filter((e) => e.managerId === null)).toHaveLength(6);
    expect(new Set(employees.map((e) => e.fullName)).size).toBe(60);

    expect(accessGrants).toHaveLength(180);
    expect(Object.values(countBy(accessGrants, (g) => g.employeeId)).every((n) => n === 3)).toBe(true);

    expect(principals).toHaveLength(9);
    expect(countBy(principals, (p) => p.role)).toEqual({ viewer: 2, operator: 4, approver: 2, admin: 1 });
    expect(principals.filter((p) => p.principal.startsWith("svc:"))).toEqual([
      { principal: "svc:agentboard-eval", role: "operator", displayName: "Eval service token" },
    ]);
    expect(principals.every((p) => p.principal === p.principal.toLowerCase())).toBe(true);

    // The SPEC 12.1 numbers are written out here, not imported from the generator, so a drifted constant fails.
    expect(countBy(runs, (r) => r.requestType)).toEqual({
      address_change: 20,
      manager_change: 15,
      onboarding_access: 20,
      privileged_access: 15,
      offboarding: 15,
      access_revocation: 15,
    });
    expect(RUNS_BY_TYPE).toEqual(countBy(runs, (r) => r.requestType));
    expect(runs.filter((r) => APPROVAL_TYPES.has(r.requestType))).toHaveLength(45);
    expect(countBy(runs.filter((r) => r.approval), (r) => r.approval?.decision ?? null)).toEqual({ approve: 36, reject: 6, pending: 3 });
    expect(countBy(runs, (r) => r.modifier)).toEqual({
      transient_error: 18,
      duplicate_delivery: 10,
      crash_after_call: 6,
      permanent_error: 4,
      silent_noop: 4,
      budget_exhausted: 3,
      pause_resume: 3,
      cancel: 2,
      none: 50,
    });
    expect({ ...MODIFIER_COUNTS, none: 50 }).toEqual(countBy(runs, (r) => r.modifier));
    const transient = runs.filter((r) => r.modifier === "transient_error");
    expect(transient.filter((r) => r.sim?.faults?.length === 2)).toHaveLength(3);
    expect(transient.filter((r) => r.sim?.faults?.length === 1)).toHaveLength(15);

    const first = Date.parse(runs[0]?.requestedAt ?? "");
    const last = Date.parse(runs[99]?.requestedAt ?? "");
    expect(first).toBeGreaterThanOrEqual(Date.UTC(2026, 8, 10));
    expect(last).toBeLessThan(Date.UTC(2026, 9, 8));
    expect(new Date(last).toISOString().slice(0, 10) <= "2026-10-07").toBe(true);

    expect(REQUEST_TYPES.map((t) => REQUEST_TEMPLATES[t].length)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(searchQueries).toHaveLength(20);
  });

  it("follows the constraint rules and the expected-by-construction outcome", () => {
    const { runs } = dataset;
    for (const run of runs) {
      if (run.approval && run.approval.decision !== "approve") expect(run.modifier).toBeNull();
      if (run.modifier === "cancel" || run.modifier === "pause_resume") {
        expect(run.approval === null || run.approval.decision === "approve").toBe(true);
        expect(run.sim?.checkpointStep).toBe("s2");
      }
      if (run.modifier === "silent_noop") {
        // A verifiable write before any approval step: the run has no approval-gated step at all.
        expect(APPROVAL_TYPES.has(run.requestType)).toBe(false);
        const fault = run.sim?.faults?.[0];
        expect(WRITE_TOOLS.has(run.goldPlan.steps.find((s) => s.id === fault?.stepId)?.tool ?? "")).toBe(true);
      }
      if (run.modifier === "budget_exhausted") {
        expect(run.budget).toEqual({ maxToolCalls: 3 });
        expect(run.launchedBy).toBe("admin@agentboard.test");
      }
      if (run.modifier === "permanent_error") {
        const fault = run.sim?.faults?.[0];
        expect(run.goldPlan.steps.find((s) => s.id === fault?.stepId)?.tool).toBe("notify.send");
      }
    }
    // An offboarding subject is the subject of no later run.
    runs.forEach((run, index) => {
      if (run.requestType !== "offboarding") return;
      expect(runs.slice(index + 1).some((later) => later.subjectEmployeeId === run.subjectEmployeeId)).toBe(false);
    });
    expect(countBy(runs, (r) => r.expectedStatus)).toEqual({ succeeded: 87, rejected: 6, cancelled: 4, awaiting_approval: 3 });
    expect(countBy(runs.filter((r) => r.modifier === "permanent_error"), (r) => r.recovery)).toEqual({ skip: 2, cancel: 2 });
    // Each known-item query targets exactly one run by employee name plus request type.
    for (const q of dataset.searchQueries) {
      const target = runs.find((r) => r.ref === q.targetRef);
      expect(target).toBeDefined();
      const sameKey = runs.filter((r) => r.subjectName === target?.subjectName && r.requestType === target?.requestType);
      expect(sameKey).toHaveLength(1);
      expect(q.query.startsWith(target?.subjectName ?? "?")).toBe(true);
    }
  });

  it("gold plans pass the SPEC 11.3 validator (allowlists, subject pinning, gating)", () => {
    for (const run of dataset.runs) {
      const result = validatePlan(JSON.stringify(run.goldPlan), {
        requestType: run.requestType,
        subjectEmployeeId: run.subjectEmployeeId,
        maxSteps: 8,
      });
      if (!result.ok) throw new Error(`${run.ref}: ${JSON.stringify(result.issues)}`);
      const gated = result.tasks.filter((t) => t.requiresApproval);
      expect(gated.length).toBe(APPROVAL_TYPES.has(run.requestType) ? 1 : 0);
    }
  });

  it("is byte-stable: regeneration equals the committed dataset and its sha256", () => {
    expect(serializeDataset(dataset)).toBe(datasetRaw);
    const digest = createHash("sha256").update(datasetRaw).digest("hex");
    expect(checksumRaw.split(/\s+/)[0]).toBe(digest);
    expect(renderConsoleSeed(dataset)).toBe(consoleSeed);
    expect(renderPeopleSeed(dataset)).toBe(peopleSeed);
  });

  it("seed SQL holds 60 employees, 180 grants, 9 principals and 3 agent roles", () => {
    const count = (sql: string, table: string) => sql.split("\n").filter((line) => line.startsWith(`INSERT INTO ${table} `)).length;
    expect(count(peopleSeed, "employees")).toBe(60);
    expect(count(peopleSeed, "access_grants")).toBe(180);
    expect(count(consoleSeed, "role_bindings")).toBe(9);
    expect(count(consoleSeed, "agent_controls")).toBe(3);
  });
});
