// Simulated IT service management tools.

import { getEmployee } from "../../db/people.ts";
import { failure, success } from "../results.ts";
import { shortId, type ReadImpl, type WriteImpl } from "./types.ts";

export const createTicket: WriteImpl = async (db, args, now) => {
  const employeeId = String(args["employeeId"]);
  if (!(await getEmployee(db, employeeId))) return failure("permanent", "not_found", `employee ${employeeId} does not exist`);
  const ticketId = shortId("TKT");
  const category = String(args["category"]);
  return {
    effects: [
      {
        sql: "INSERT INTO tickets (id, employee_id, category, summary, status, created_at) SELECT ?, ?, ?, ?, 'open', ? WHERE 1 = 1",
        params: [ticketId, employeeId, category, String(args["summary"]), now],
      },
    ],
    result: { ticketId, employeeId, category, status: "open" },
  };
};

export const getTicket: ReadImpl = async (db, args) => {
  const ticket = await db
    .prepare("SELECT id, employee_id, category, summary, status, created_at FROM tickets WHERE id = ?")
    .bind(String(args["ticketId"]))
    .first<{ id: string; employee_id: string; category: string; summary: string; status: string; created_at: string }>();
  return success({
    ticket: ticket
      ? { ticketId: ticket.id, employeeId: ticket.employee_id, category: ticket.category, summary: ticket.summary, status: ticket.status, createdAt: ticket.created_at }
      : null,
  });
};
