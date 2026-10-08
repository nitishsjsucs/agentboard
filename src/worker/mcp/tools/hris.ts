// Simulated HRIS tools.

import type { Address } from "../../../shared/domain.ts";
import { getEmployee } from "../../db/people.ts";
import { failure, success } from "../results.ts";
import type { ReadImpl, WriteImpl } from "./types.ts";

export const getEmployeeTool: ReadImpl = async (db, args) => {
  const employee = await getEmployee(db, String(args["employeeId"]));
  if (!employee) return failure("permanent", "not_found", `employee ${String(args["employeeId"])} does not exist`);
  return success({ employee });
};

export const updateAddress: WriteImpl = async (db, args, now) => {
  const employeeId = String(args["employeeId"]);
  if (!(await getEmployee(db, employeeId))) return failure("permanent", "not_found", `employee ${employeeId} does not exist`);
  const address = args["address"] as Address;
  return {
    effects: [{ sql: "UPDATE employees SET address_json = ?, updated_at = ? WHERE id = ?", params: [JSON.stringify(address), now, employeeId] }],
    result: { employeeId, address },
  };
};

export const updateManager: WriteImpl = async (db, args, now) => {
  const employeeId = String(args["employeeId"]);
  const managerId = String(args["managerId"]);
  if (!(await getEmployee(db, employeeId))) return failure("permanent", "not_found", `employee ${employeeId} does not exist`);
  if (!(await getEmployee(db, managerId))) return failure("permanent", "not_found", `manager ${managerId} does not exist`);
  return {
    effects: [{ sql: "UPDATE employees SET manager_id = ?, updated_at = ? WHERE id = ?", params: [managerId, now, employeeId] }],
    result: { employeeId, managerId },
  };
};

export const setEmploymentStatus: WriteImpl = async (db, args, now) => {
  const employeeId = String(args["employeeId"]);
  if (!(await getEmployee(db, employeeId))) return failure("permanent", "not_found", `employee ${employeeId} does not exist`);
  const status = String(args["status"]);
  return {
    effects: [{ sql: "UPDATE employees SET employment_status = ?, updated_at = ? WHERE id = ?", params: [status, now, employeeId] }],
    result: { employeeId, status, effectiveDate: String(args["effectiveDate"]) },
  };
};
