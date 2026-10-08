// Simulated access-management tools.

import { activeRoles, getEmployee } from "../../db/people.ts";
import { failure, success } from "../results.ts";
import { shortId, type ReadImpl, type WriteImpl } from "./types.ts";

export const listRoles: ReadImpl = async (db, args) => {
  const employeeId = String(args["employeeId"]);
  if (!(await getEmployee(db, employeeId))) return failure("permanent", "not_found", `employee ${employeeId} does not exist`);
  const roles = await activeRoles(db, employeeId);
  return success({ employeeId, roles: roles.map((r) => `${r.system}:${r.role}`) });
};

export const grantRole: WriteImpl = async (db, args, now) => {
  const employeeId = String(args["employeeId"]);
  const system = String(args["system"]);
  const role = String(args["role"]);
  if (!(await getEmployee(db, employeeId))) return failure("permanent", "not_found", `employee ${employeeId} does not exist`);
  const existing = (await activeRoles(db, employeeId)).find((r) => r.system === system && r.role === role);
  const grantId = existing?.id ?? shortId("GRT");
  return {
    effects: [
      {
        sql: `INSERT INTO access_grants (id, employee_id, system, role, granted_at, revoked_at) SELECT ?, ?, ?, ?, ?, NULL
              WHERE NOT EXISTS (SELECT 1 FROM access_grants WHERE employee_id = ? AND system = ? AND role = ? AND revoked_at IS NULL)`,
        params: [grantId, employeeId, system, role, now, employeeId, system, role],
      },
    ],
    result: { employeeId, grantId, role: `${system}:${role}`, alreadyHeld: existing !== undefined },
  };
};

export const revokeRole: WriteImpl = async (db, args, now) => {
  const employeeId = String(args["employeeId"]);
  const system = String(args["system"]);
  const role = String(args["role"]);
  if (!(await getEmployee(db, employeeId))) return failure("permanent", "not_found", `employee ${employeeId} does not exist`);
  const held = (await activeRoles(db, employeeId)).some((r) => r.system === system && r.role === role);
  return {
    effects: [
      {
        sql: "UPDATE access_grants SET revoked_at = ? WHERE employee_id = ? AND system = ? AND role = ? AND revoked_at IS NULL",
        params: [now, employeeId, system, role],
      },
    ],
    result: { employeeId, role: `${system}:${role}`, revoked: held ? 1 : 0 },
  };
};

export const revokeAllRoles: WriteImpl = async (db, args, now) => {
  const employeeId = String(args["employeeId"]);
  if (!(await getEmployee(db, employeeId))) return failure("permanent", "not_found", `employee ${employeeId} does not exist`);
  const held = await activeRoles(db, employeeId);
  return {
    effects: [{ sql: "UPDATE access_grants SET revoked_at = ? WHERE employee_id = ? AND revoked_at IS NULL", params: [now, employeeId] }],
    result: { employeeId, revoked: held.length },
  };
};
