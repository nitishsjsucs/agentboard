// Simulated notification tools.

import { getEmployee } from "../../db/people.ts";
import { failure, success } from "../results.ts";
import { shortId, type ReadImpl, type WriteImpl } from "./types.ts";

export const sendNotification: WriteImpl = async (db, args, now) => {
  const employeeId = String(args["employeeId"]);
  if (!(await getEmployee(db, employeeId))) return failure("permanent", "not_found", `employee ${employeeId} does not exist`);
  const deliveryId = shortId("DLV");
  const channel = String(args["channel"]);
  const template = String(args["template"]);
  return {
    effects: [
      {
        sql: "INSERT INTO notifications (id, employee_id, channel, template, status, sent_at) SELECT ?, ?, ?, ?, 'sent', ? WHERE 1 = 1",
        params: [deliveryId, employeeId, channel, template, now],
      },
    ],
    result: { deliveryId, employeeId, channel, template, status: "sent" },
  };
};

export const getDelivery: ReadImpl = async (db, args) => {
  const row = await db
    .prepare("SELECT id, employee_id, channel, template, status, sent_at FROM notifications WHERE id = ?")
    .bind(String(args["deliveryId"]))
    .first<{ id: string; employee_id: string; channel: string; template: string; status: string; sent_at: string }>();
  return success({
    delivery: row ? { deliveryId: row.id, employeeId: row.employee_id, channel: row.channel, template: row.template, status: row.status, sentAt: row.sent_at } : null,
  });
};
