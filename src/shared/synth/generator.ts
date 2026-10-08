// Deterministic synthetic dataset generator (SPEC section 12). Pure: no I/O,
// no clock, no Math.random. The same seed always yields the same bytes.

import {
  BASELINE_ROLES,
  PRIVILEGED_ROLES,
  REQUEST_TYPES,
  type Address,
  type Budget,
  type EmploymentStatus,
  type Plan,
  type Priority,
  type RequestType,
  type SimDirectives,
} from "../domain.ts";
import {
  ADMIN_PRINCIPAL,
  APPROVERS,
  DEPARTMENTS,
  FIRST_NAMES,
  LAST_NAMES,
  LOCATION_COUNTS,
  MANAGER_TITLES,
  OFFICE_CITIES,
  OPERATOR_LAUNCHERS,
  PRINCIPALS,
  REMOTE_CITIES,
  REQUEST_TEMPLATES,
  REQUEST_TYPE_LABELS,
  REQUEST_TYPE_QUERY_WORDS,
  STAFF_TITLES,
  STREET_NAMES,
  type CityInfo,
  type Location,
  type PrincipalSeed,
} from "./catalog.ts";
import { goldPlan, WRITE_TOOLS, type RunFields } from "./gold-plans.ts";
import { Prng, SEED } from "./prng.ts";

export const DATASET_VERSION = 1;
export const RUN_COUNT = 100;
export const EMPLOYEE_COUNT = 60;

export const RUNS_BY_TYPE: Record<RequestType, number> = {
  address_change: 20,
  manager_change: 15,
  onboarding_access: 20,
  privileged_access: 15,
  offboarding: 15,
  access_revocation: 15,
};

/** Request types whose plans always contain an approval-gated step. */
export const APPROVAL_TYPES: ReadonlySet<RequestType> = new Set(["manager_change", "privileged_access", "offboarding"]);

export const MODIFIERS = [
  "transient_error",
  "duplicate_delivery",
  "crash_after_call",
  "permanent_error",
  "silent_noop",
  "budget_exhausted",
  "pause_resume",
  "cancel",
] as const;
export type Modifier = (typeof MODIFIERS)[number];

export const MODIFIER_COUNTS: Record<Modifier, number> = {
  transient_error: 18,
  duplicate_delivery: 10,
  crash_after_call: 6,
  permanent_error: 4,
  silent_noop: 4,
  budget_exhausted: 3,
  pause_resume: 3,
  cancel: 2,
};

export const APPROVAL_DECISION_COUNTS = { approve: 36, reject: 6, pending: 3 } as const;
export const EXPECTED_STATUS_COUNTS = { succeeded: 87, rejected: 6, cancelled: 4, awaiting_approval: 3 } as const;
export const SEARCH_QUERY_COUNT = 20;

const SEED_TIMESTAMP = "2026-09-01T00:00:00.000Z";
const GRANT_TIMESTAMP = "2026-08-01T00:00:00.000Z";
/** requested_at spans 28 days ending 2026-10-07 (UTC). */
const WINDOW_START_MS = Date.UTC(2026, 8, 10, 0, 0, 0);
const WINDOW_END_MS = Date.UTC(2026, 9, 7, 23, 59, 0);

export interface SyntheticEmployee {
  id: string;
  fullName: string;
  workEmail: string;
  personalEmail: string;
  department: string;
  title: string;
  managerId: string | null;
  location: Location;
  address: Address;
  employmentStatus: EmploymentStatus;
}

export interface SyntheticGrant {
  id: string;
  employeeId: string;
  system: string;
  role: string;
}

export interface SyntheticApproval {
  decision: "approve" | "reject" | "pending";
  approver: string;
  note: string;
}

export type ExpectedStatus = keyof typeof EXPECTED_STATUS_COUNTS;

export interface SyntheticRun {
  ref: string;
  requestType: RequestType;
  subjectEmployeeId: string;
  subjectName: string;
  title: string;
  requestText: string;
  priority: Priority;
  requestedAt: string;
  launchedBy: string;
  approval: SyntheticApproval | null;
  modifier: Modifier | null;
  /** For `permanent_error`: the driver's recovery (admin skip or operator cancel). */
  recovery: "skip" | "cancel" | null;
  sim: SimDirectives | null;
  budget: Partial<Budget> | null;
  expectedStatus: ExpectedStatus;
  fields: RunFields;
  goldPlan: Plan;
}

export interface SearchQuery {
  query: string;
  targetRef: string;
}

export interface SyntheticDataset {
  version: number;
  seed: number;
  employees: SyntheticEmployee[];
  accessGrants: SyntheticGrant[];
  principals: PrincipalSeed[];
  runs: SyntheticRun[];
  searchQueries: SearchQuery[];
}

export function generateDataset(seed: number = SEED): SyntheticDataset {
  const rng = new Prng(seed);
  const employees = generateEmployees(rng);
  const accessGrants = generateGrants(rng, employees);
  const runs = generateRuns(rng, employees, accessGrants);
  const searchQueries = pickSearchQueries(rng, runs);
  return { version: DATASET_VERSION, seed, employees, accessGrants, principals: [...PRINCIPALS], runs, searchQueries };
}

/** Byte-stable serialization (committed as fixtures/synthetic/dataset.v1.json). */
export function serializeDataset(dataset: SyntheticDataset): string {
  return `${JSON.stringify(dataset, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Employees and grants

function generateEmployees(rng: Prng): SyntheticEmployee[] {
  const combos: [string, string][] = [];
  for (const first of FIRST_NAMES) for (const last of LAST_NAMES) combos.push([first, last]);
  const names = rng.shuffle(combos).slice(0, EMPLOYEE_COUNT);

  const locations: Location[] = [];
  for (const [location, count] of Object.entries(LOCATION_COUNTS) as [Location, number][]) {
    for (let i = 0; i < count; i++) locations.push(location);
  }
  const shuffledLocations = rng.shuffle(locations);

  const employees: SyntheticEmployee[] = [];
  for (let i = 0; i < EMPLOYEE_COUNT; i++) {
    const [first, last] = names[i] as [string, string];
    const department = DEPARTMENTS[i % DEPARTMENTS.length] as (typeof DEPARTMENTS)[number];
    const isManager = i < DEPARTMENTS.length;
    const location = shuffledLocations[i] as Location;
    const id = employeeId(i);
    employees.push({
      id,
      fullName: `${first} ${last}`,
      workEmail: `${first}.${last}@agentboard.test`.toLowerCase(),
      personalEmail: `${first.toLowerCase()}${100 + i}@example.test`,
      department,
      title: isManager ? MANAGER_TITLES[department] : rng.pick(STAFF_TITLES[department]),
      managerId: isManager ? null : employeeId(i % DEPARTMENTS.length),
      location,
      address: randomAddress(rng, location),
      employmentStatus: "active",
    });
  }
  return employees;
}

function employeeId(index: number): string {
  return `E-${1001 + index}`;
}

function cityFor(rng: Prng, location: Location): CityInfo {
  return location === "Remote" ? rng.pick(REMOTE_CITIES) : OFFICE_CITIES[location];
}

function randomAddress(rng: Prng, location: Location): Address {
  const city = cityFor(rng, location);
  return {
    line1: `${100 + rng.int(9800)} ${rng.pick(STREET_NAMES)}`,
    city: city.city,
    region: city.region,
    postalCode: `${city.postalPrefix}${String(rng.int(100)).padStart(2, "0")}`,
    country: "US",
  };
}

function generateGrants(rng: Prng, employees: SyntheticEmployee[]): SyntheticGrant[] {
  const grants: SyntheticGrant[] = [];
  for (const employee of employees) {
    const omitted = rng.int(BASELINE_ROLES.length);
    BASELINE_ROLES.forEach((qualified, index) => {
      if (index === omitted) return;
      const [system, role] = splitRole(qualified);
      grants.push({ id: `G-${String(grants.length + 1).padStart(4, "0")}`, employeeId: employee.id, system, role });
    });
  }
  return grants;
}

export function splitRole(qualified: string): [string, string] {
  const at = qualified.indexOf(":");
  return [qualified.slice(0, at), qualified.slice(at + 1)];
}

// ---------------------------------------------------------------------------
// Runs

function generateRuns(rng: Prng, employees: SyntheticEmployee[], grants: SyntheticGrant[]): SyntheticRun[] {
  const managers = employees.slice(0, DEPARTMENTS.length);
  const staff = rng.shuffle(employees.slice(DEPARTMENTS.length));
  // Exclusive pools: onboarding and offboarding subjects appear in exactly one run.
  const onboardingPool = staff.slice(0, RUNS_BY_TYPE.onboarding_access);
  const offboardingPool = staff.slice(RUNS_BY_TYPE.onboarding_access, RUNS_BY_TYPE.onboarding_access + RUNS_BY_TYPE.offboarding);
  const generalPool = [...staff.slice(RUNS_BY_TYPE.onboarding_access + RUNS_BY_TYPE.offboarding), ...managers];
  const revocationPool = rng.shuffle(generalPool).slice(0, RUNS_BY_TYPE.access_revocation);
  for (const employee of onboardingPool) employee.employmentStatus = "pending_start";

  const types: RequestType[] = [];
  for (const type of REQUEST_TYPES) for (let i = 0; i < RUNS_BY_TYPE[type]; i++) types.push(type);
  const order = rng.shuffle(types);

  const times = Array.from({ length: RUN_COUNT }, () => WINDOW_START_MS + rng.int(Math.floor((WINDOW_END_MS - WINDOW_START_MS) / 60_000)) * 60_000).sort(
    (a, b) => a - b,
  );

  const cursors = { onboarding_access: 0, offboarding: 0, access_revocation: 0 };
  const byId = new Map(employees.map((e) => [e.id, e]));
  const grantsByEmployee = new Map<string, SyntheticGrant[]>();
  for (const grant of grants) grantsByEmployee.set(grant.employeeId, [...(grantsByEmployee.get(grant.employeeId) ?? []), grant]);

  const runs: SyntheticRun[] = order.map((requestType, index) => {
    let subject: SyntheticEmployee;
    if (requestType === "onboarding_access") subject = onboardingPool[cursors.onboarding_access++] as SyntheticEmployee;
    else if (requestType === "offboarding") subject = offboardingPool[cursors.offboarding++] as SyntheticEmployee;
    else if (requestType === "access_revocation") subject = revocationPool[cursors.access_revocation++] as SyntheticEmployee;
    else subject = rng.pick(generalPool);

    const requestedAtMs = times[index] as number;
    const fields = runFields(rng, requestType, subject, managers, grantsByEmployee.get(subject.id) ?? [], requestedAtMs);
    const plan = goldPlan(requestType, subject.id, fields);
    const template = rng.pick(REQUEST_TEMPLATES[requestType]);
    const priorityRoll = rng.next();
    const priority: Priority = priorityRoll < 0.2 ? "low" : priorityRoll < 0.8 ? "normal" : "high";
    const manager = fields.managerId ? byId.get(fields.managerId) : undefined;
    return {
      ref: `syn-${String(index + 1).padStart(4, "0")}`,
      requestType,
      subjectEmployeeId: subject.id,
      subjectName: subject.fullName,
      title: `${REQUEST_TYPE_LABELS[requestType]} for ${subject.fullName} (${subject.id})`,
      requestText: fillTemplate(template, subject, fields, manager?.fullName ?? null),
      priority,
      requestedAt: new Date(requestedAtMs).toISOString(),
      launchedBy: OPERATOR_LAUNCHERS[index % OPERATOR_LAUNCHERS.length] as string,
      approval: null,
      modifier: null,
      recovery: null,
      sim: null,
      budget: null,
      expectedStatus: "succeeded",
      fields,
      goldPlan: plan,
    };
  });

  assignApprovals(rng, runs);
  assignModifiers(rng, runs);
  return runs;
}

function runFields(
  rng: Prng,
  requestType: RequestType,
  subject: SyntheticEmployee,
  managers: SyntheticEmployee[],
  subjectGrants: SyntheticGrant[],
  requestedAtMs: number,
): RunFields {
  const fields: RunFields = {
    channel: rng.next() < 0.5 ? "email" : "slack",
    address: null,
    managerId: null,
    managerName: null,
    system: null,
    role: null,
    effectiveDate: null,
  };
  switch (requestType) {
    case "address_change": {
      let address = randomAddress(rng, rng.pick(["San Jose", "Austin", "New York", "Remote"] as const));
      while (address.line1 === subject.address.line1) address = randomAddress(rng, "Remote");
      fields.address = address;
      break;
    }
    case "manager_change": {
      const candidates = managers.filter((m) => m.id !== subject.id && m.id !== subject.managerId);
      const manager = rng.pick(candidates);
      fields.managerId = manager.id;
      fields.managerName = manager.fullName;
      break;
    }
    case "onboarding_access": {
      const held = new Set(subjectGrants.map((g) => `${g.system}:${g.role}`));
      const missing = BASELINE_ROLES.filter((r) => !held.has(r));
      [fields.system, fields.role] = splitRole(rng.pick(missing));
      break;
    }
    case "privileged_access":
      [fields.system, fields.role] = splitRole(rng.pick(PRIVILEGED_ROLES));
      break;
    case "offboarding":
      fields.effectiveDate = new Date(requestedAtMs + 14 * 86_400_000).toISOString().slice(0, 10);
      break;
    case "access_revocation": {
      const grant = rng.pick(subjectGrants);
      fields.system = grant.system;
      fields.role = grant.role;
      break;
    }
  }
  return fields;
}

export function formatAddress(address: Address): string {
  return `${address.line1}, ${address.city}, ${address.region} ${address.postalCode}, ${address.country}`;
}

function fillTemplate(template: string, subject: SyntheticEmployee, fields: RunFields, managerName: string | null): string {
  const values: Record<string, string> = {
    name: subject.fullName,
    id: subject.id,
    channel: fields.channel === "slack" ? "Slack" : "email",
    address: fields.address ? formatAddress(fields.address) : "",
    managerName: managerName ?? "",
    managerId: fields.managerId ?? "",
    system: fields.system ?? "",
    role: fields.role ?? "",
    effectiveDate: fields.effectiveDate ?? "",
  };
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined || value === "") throw new Error(`template placeholder {${key}} has no value`);
    return value;
  });
}

function assignApprovals(rng: Prng, runs: SyntheticRun[]): void {
  const approvalRuns = rng.shuffle(runs.filter((r) => APPROVAL_TYPES.has(r.requestType)));
  approvalRuns.forEach((run, index) => {
    const approver = APPROVERS[index % APPROVERS.length] as string;
    if (index < APPROVAL_DECISION_COUNTS.reject) {
      run.approval = { decision: "reject", approver, note: "Rejected: the request lacks a business justification." };
      run.expectedStatus = "rejected";
    } else if (index < APPROVAL_DECISION_COUNTS.reject + APPROVAL_DECISION_COUNTS.pending) {
      run.approval = { decision: "pending", approver, note: "Left pending by design." };
      run.expectedStatus = "awaiting_approval";
    } else {
      run.approval = { decision: "approve", approver, note: "Approved after checking the request against policy." };
    }
  });
}

function firstWriteStep(run: SyntheticRun): string {
  const step = run.goldPlan.steps.find((s) => WRITE_TOOLS.has(s.tool));
  if (!step) throw new Error(`${run.ref} has no write step`);
  return step.id;
}

function notifyStep(run: SyntheticRun): string {
  const step = run.goldPlan.steps.find((s) => s.tool === "notify.send");
  if (!step) throw new Error(`${run.ref} has no notify step`);
  return step.id;
}

function assignModifiers(rng: Prng, runs: SyntheticRun[]): void {
  // Rejected and pending runs get no modifier.
  const eligible = runs.filter((r) => r.approval === null || r.approval.decision === "approve");
  // silent_noop needs a verifiable write before any approval step; budget_exhausted is kept on
  // approval-free runs so its recovery never interleaves with an approval decision.
  const approvalFree = rng.shuffle(eligible.filter((r) => !APPROVAL_TYPES.has(r.requestType)));
  const constrained: [Modifier, number][] = [
    ["silent_noop", MODIFIER_COUNTS.silent_noop],
    ["budget_exhausted", MODIFIER_COUNTS.budget_exhausted],
  ];
  const taken = new Set<string>();
  let cursor = 0;
  for (const [modifier, count] of constrained) {
    for (let i = 0; i < count; i++) {
      const run = approvalFree[cursor++] as SyntheticRun;
      applyModifier(rng, run, modifier, 0);
      taken.add(run.ref);
    }
  }
  const rest = rng.shuffle(eligible.filter((r) => !taken.has(r.ref)));
  const unconstrained: Modifier[] = ["transient_error", "duplicate_delivery", "crash_after_call", "permanent_error", "pause_resume", "cancel"];
  cursor = 0;
  for (const modifier of unconstrained) {
    for (let i = 0; i < MODIFIER_COUNTS[modifier]; i++) {
      applyModifier(rng, rest[cursor++] as SyntheticRun, modifier, i);
    }
  }
}

function applyModifier(rng: Prng, run: SyntheticRun, modifier: Modifier, ordinal: number): void {
  run.modifier = modifier;
  switch (modifier) {
    case "transient_error": {
      const writes = run.goldPlan.steps.filter((s) => WRITE_TOOLS.has(s.tool));
      const stepId = rng.pick(writes).id;
      // The first three transient runs fail twice (attempts 1 and 2), the rest once.
      const attempts = ordinal < 3 ? [1, 2] : [1];
      run.sim = { faults: attempts.map((attempt) => ({ stepId, generation: 0, attempt, kind: "transient_error" as const })) };
      break;
    }
    case "duplicate_delivery":
      run.sim = { duplicateDeliveryStep: firstWriteStep(run) };
      break;
    case "crash_after_call":
      run.sim = { faults: [{ stepId: firstWriteStep(run), generation: 0, attempt: 1, kind: "crash_after_call" }] };
      break;
    case "permanent_error":
      run.sim = { faults: [{ stepId: notifyStep(run), generation: 0, attempt: 1, kind: "permanent_error" }] };
      run.recovery = ordinal < 2 ? "skip" : "cancel";
      if (run.recovery === "cancel") run.expectedStatus = "cancelled";
      break;
    case "silent_noop":
      run.sim = { faults: [{ stepId: firstWriteStep(run), generation: 0, attempt: 1, kind: "silent_noop" }] };
      break;
    case "budget_exhausted":
      run.budget = { maxToolCalls: 3 };
      run.launchedBy = ADMIN_PRINCIPAL;
      break;
    case "pause_resume":
      run.sim = { checkpointStep: "s2" };
      break;
    case "cancel":
      run.sim = { checkpointStep: "s2" };
      run.expectedStatus = "cancelled";
      break;
  }
}

function pickSearchQueries(rng: Prng, runs: SyntheticRun[]): SearchQuery[] {
  const pairCounts = new Map<string, number>();
  for (const run of runs) {
    const key = `${run.subjectName}|${run.requestType}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const unique = rng.shuffle(runs.filter((run) => pairCounts.get(`${run.subjectName}|${run.requestType}`) === 1));
  return unique
    .slice(0, SEARCH_QUERY_COUNT)
    .sort((a, b) => a.ref.localeCompare(b.ref))
    .map((run) => ({ query: `${run.subjectName} ${REQUEST_TYPE_QUERY_WORDS[run.requestType]}`, targetRef: run.ref }));
}

// ---------------------------------------------------------------------------
// Seed SQL (committed as seed/console.sql and seed/people.sql)

function sql(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

export function renderConsoleSeed(dataset: SyntheticDataset): string {
  const lines = ["-- Generated by `npm run synth` from the seeded dataset. Do not edit by hand.", ""];
  for (const p of dataset.principals) {
    lines.push(
      `INSERT INTO role_bindings (principal, role, display_name, created_at, updated_at, updated_by) VALUES (${sql(p.principal)}, ${sql(p.role)}, ${sql(p.displayName)}, ${sql(SEED_TIMESTAMP)}, ${sql(SEED_TIMESTAMP)}, 'seed');`,
    );
  }
  for (const role of ["planner", "executor", "verifier"]) {
    lines.push(`INSERT INTO agent_controls (role, disabled, reason, updated_by, updated_at) VALUES (${sql(role)}, 0, NULL, 'seed', ${sql(SEED_TIMESTAMP)});`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderPeopleSeed(dataset: SyntheticDataset): string {
  const lines = ["-- Generated by `npm run synth` from the seeded dataset. Do not edit by hand.", "-- Every person, email and address here is fictional.", ""];
  for (const e of dataset.employees) {
    lines.push(
      `INSERT INTO employees (id, full_name, work_email, personal_email, department, title, manager_id, location, address_json, employment_status, updated_at) VALUES (${[
        e.id,
        e.fullName,
        e.workEmail,
        e.personalEmail,
        e.department,
        e.title,
        e.managerId,
        e.location,
        JSON.stringify(e.address),
        e.employmentStatus,
        SEED_TIMESTAMP,
      ]
        .map(sql)
        .join(", ")});`,
    );
  }
  for (const g of dataset.accessGrants) {
    lines.push(
      `INSERT INTO access_grants (id, employee_id, system, role, granted_at, revoked_at) VALUES (${sql(g.id)}, ${sql(g.employeeId)}, ${sql(g.system)}, ${sql(g.role)}, ${sql(GRANT_TIMESTAMP)}, NULL);`,
    );
  }
  return `${lines.join("\n")}\n`;
}
