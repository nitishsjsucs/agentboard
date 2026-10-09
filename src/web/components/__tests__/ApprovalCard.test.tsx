import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ApprovalListItem } from "../../../shared/api-types.ts";
import { ApprovalCard } from "../ApprovalCard.tsx";
import { withSession } from "./session.tsx";

afterEach(cleanup);

const approval: ApprovalListItem = {
  id: "apr_01J00000000000000000000000",
  runId: "run_01J00000000000000000000000",
  taskId: "tsk_01J00000000000000000000000",
  tool: "access.grant_role",
  summary: "Grant aws:prod-admin to E-1043",
  risk: "high",
  requester: "admin@agentboard.test",
  status: "pending",
  requestedAt: "2026-10-08T12:00:00.000Z",
  expiresAt: "2026-10-11T12:00:00.000Z",
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  canDecide: true,
};

describe("ApprovalCard", { tags: ["ui"] }, () => {
  it("disables the decision on the viewer's own run, and enables it for another approver once a note is written", () => {
    const own = render(withSession("admin", <ApprovalCard approval={approval} onDecided={() => undefined} />, "admin@agentboard.test"));
    expect(screen.getByText("You requested this run, so you cannot decide its approval.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Decision note") as HTMLInputElement).disabled).toBe(true);
    own.unmount();

    render(withSession("approver", <ApprovalCard approval={approval} onDecided={() => undefined} />, "approver.lee@agentboard.test"));
    const approve = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: "checked with the manager" } });
    expect(approve.disabled).toBe(false);
  });
});
