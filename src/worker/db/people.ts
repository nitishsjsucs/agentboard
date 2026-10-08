// Typed D1 queries for the simulated People systems (binding PEOPLE_DB).
// Only the People Ops MCP tools use these (plus a read-only directory lookup
// for run titles in the API; see PROGRESS.md).

import type { Address } from "../../shared/domain.ts";

export interface EmployeeRow {
  id: string;
  full_name: string;
  work_email: string;
  personal_email: string;
  department: string;
  title: string;
  manager_id: string | null;
  location: string;
  address_json: string;
  employment_status: string;
  updated_at: string;
}

export interface EmployeeRecord {
  id: string;
  fullName: string;
  workEmail: string;
  personalEmail: string;
  department: string;
  title: string;
  managerId: string | null;
  location: string;
  address: Address;
  employmentStatus: string;
}

export function employeeFromRow(row: EmployeeRow): EmployeeRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    workEmail: row.work_email,
    personalEmail: row.personal_email,
    department: row.department,
    title: row.title,
    managerId: row.manager_id,
    location: row.location,
    address: JSON.parse(row.address_json) as Address,
    employmentStatus: row.employment_status,
  };
}

export async function getEmployee(db: D1Database, id: string): Promise<EmployeeRecord | null> {
  const row = await db.prepare("SELECT * FROM employees WHERE id = ?").bind(id).first<EmployeeRow>();
  return row ? employeeFromRow(row) : null;
}

export async function activeRoles(db: D1Database, employeeId: string): Promise<{ id: string; system: string; role: string }[]> {
  const { results } = await db
    .prepare("SELECT id, system, role FROM access_grants WHERE employee_id = ? AND revoked_at IS NULL ORDER BY system, role")
    .bind(employeeId)
    .all<{ id: string; system: string; role: string }>();
  return results;
}

/** Read-only directory entry (id and display name) used for run titles. */
export async function directoryEntry(db: D1Database, id: string): Promise<{ id: string; fullName: string } | null> {
  const row = await db.prepare("SELECT id, full_name FROM employees WHERE id = ?").bind(id).first<{ id: string; full_name: string }>();
  return row ? { id: row.id, fullName: row.full_name } : null;
}

export async function listDirectory(db: D1Database): Promise<{ id: string; fullName: string; department: string; employmentStatus: string }[]> {
  const { results } = await db
    .prepare("SELECT id, full_name, department, employment_status FROM employees ORDER BY id")
    .all<{ id: string; full_name: string; department: string; employment_status: string }>();
  return results.map((r) => ({ id: r.id, fullName: r.full_name, department: r.department, employmentStatus: r.employment_status }));
}
