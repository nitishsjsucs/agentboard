import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalListItem } from "../../../shared/api-types.ts";
import { ApprovalCard } from "../ApprovalCard.tsx";
import { apiError, stubApi } from "./api.ts";
import { withSession } from "./session.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  runTitle: "Privileged access for Dorian Oakhurst (E-1043)",
  requestType: "privileged_access",
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

  it("lets the note row wrap on narrow screens (no inline nowrap)", () => {
    render(withSession("approver", <ApprovalCard approval={approval} onDecided={() => undefined} />, "approver.lee@agentboard.test"));
    const row = screen.getByTestId("note-row");
    expect(row.style.flexWrap).toBe("");
    expect(row.classList.contains("note-row")).toBe(true);
  });

  it("explains a decision refused because someone else decided first, without the raw refusal code", async () => {
    stubApi(() => apiError(409, "conflict", "decision refused: already_decided", "already_decided"));
    render(withSession("approver", <ApprovalCard approval={approval} onDecided={() => undefined} />, "approver.lee@agentboard.test"));
    fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: "checked with the manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alert")).textContent).toContain("This approval was already decided or has expired.");
    expect(document.body.textContent).not.toContain("decision refused");
  });

  it("links the run by its title and keeps the run id in the link's title attribute", () => {
    render(withSession("approver", <ApprovalCard approval={approval} onDecided={() => undefined} />, "approver.lee@agentboard.test"));
    const link = screen.getByRole("link", { name: "Privileged access for Dorian Oakhurst (E-1043)" });
    expect(link.getAttribute("href")).toBe(`/runs/${approval.runId}`);
    expect(link.getAttribute("title")).toBe(approval.runId);
  });

  it("shows why an approval expired with the run's cancellation, and no expiry date once it is no longer pending", () => {
    const expired = { ...approval, status: "expired" as const, decisionNote: "run cancelled", decidedAt: "2026-10-09T08:00:00.000Z", canDecide: false };
    render(withSession("approver", <ApprovalCard approval={expired} onDecided={() => undefined} />, "approver.lee@agentboard.test"));
    const card = screen.getByTestId("approval-card");
    expect(card.textContent).toContain("expired: run cancelled");
    expect(card.textContent).not.toContain("expires");
    expect(screen.queryByLabelText("Decision note")).toBeNull();
  });

  it("tells a viewer or an operator on someone else's run who decides, with no note field or buttons", () => {
    for (const role of ["viewer", "operator"] as const) {
      const view = render(withSession(role, <ApprovalCard approval={{ ...approval, canDecide: false }} onDecided={() => undefined} />, `${role}.someone@agentboard.test`));
      expect(screen.getByTestId("decide-elsewhere").textContent).toBe("Approvers and admins decide approvals.");
      expect(screen.queryByLabelText("Decision note")).toBeNull();
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
      view.unmount();
    }
  });

  it("keeps the own-run notice and the disabled note and buttons for an operator who requested the run", () => {
    render(withSession("operator", <ApprovalCard approval={{ ...approval, requester: "ops.lead@agentboard.test", canDecide: false }} onDecided={() => undefined} />, "ops.lead@agentboard.test"));
    expect(screen.getByText("You requested this run, so you cannot decide its approval.")).toBeTruthy();
    expect((screen.getByLabelText("Decision note") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("decide-elsewhere")).toBeNull();
  });

  it("describes the 3-character minimum under the note, linked by aria-describedby", () => {
    render(withSession("approver", <ApprovalCard approval={approval} onDecided={() => undefined} />, "approver.lee@agentboard.test"));
    const note = screen.getByLabelText("Decision note");
    const hint = document.getElementById(note.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe("At least 3 characters");
    expect(note.getAttribute("placeholder")).toBe("Decision note (required)");
  });
});
