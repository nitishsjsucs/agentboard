import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalListItem } from "../../../shared/api-types.ts";
import { ApprovalCard } from "../ApprovalCard.tsx";
import { apiError, reply, stubApi } from "./api.ts";
import { managerChange, offboardingGated } from "./planFixtures.ts";
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

describe("ApprovalCard: what approving unlocks", { tags: ["ui"] }, () => {
  const gated = { ...approval, taskId: "tsk_x2", tool: "hris.set_employment_status", summary: "Set the employment status of E-1054 to terminated effective 2026-09-24", risk: "high" as const };
  const groupItems = (testId: string) => [...(screen.queryByTestId(testId)?.querySelectorAll("li") ?? [])].map((li) => li.textContent);
  const open = () => fireEvent.click(screen.getByRole("button", { name: "What approving unlocks" }));

  it("groups the offboarding plan: s1 already ran, s2 needs this approval, s3 to s5 run after it", () => {
    render(withSession("approver", <ApprovalCard approval={gated} onDecided={() => undefined} tasks={offboardingGated()} />, "approver.lee@agentboard.test"));
    const button = screen.getByRole("button", { name: "What approving unlocks" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(panel?.hidden).toBe(true);
    open();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hidden).toBe(false);
    expect(groupItems("unlocks-ran")).toEqual(["s1 hris.get_employee, read"]);
    expect(groupItems("unlocks-gated")).toEqual(["s2 hris.set_employment_status, write: Set the employment status of E-1054 to terminated effective 2026-09-24"]);
    expect(groupItems("unlocks-after")).toEqual(["s3 access.revoke_all_roles, write", "s4 itsm.create_ticket, write", "s5 notify.send, write"]);
    expect(screen.queryByTestId("unlocks-other")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Already ran", "Needs this approval", "Runs after approval"]);
    expect(panel?.textContent).toContain("If you reject, the run ends as rejected and no step that has not run yet will run.");
    // The disclosure follows its button and comes before the note row.
    expect(button.compareDocumentPosition(screen.getByTestId("note-row")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("groups a manager change: s1 already ran, the manager update needs approval, the notification runs after it", () => {
    const manager = { ...approval, taskId: "m_x2", tool: "hris.update_manager", summary: "Change the manager of E-1017 to E-1004" };
    render(withSession("viewer", <ApprovalCard approval={{ ...manager, canDecide: false }} onDecided={() => undefined} tasks={managerChange()} />));
    open();
    expect(groupItems("unlocks-ran")).toEqual(["s1 hris.get_employee, read"]);
    expect(groupItems("unlocks-gated")).toEqual(["s2 hris.update_manager, write: Change the manager of E-1017 to E-1004"]);
    expect(groupItems("unlocks-after")).toEqual(["s3 notify.send, write"]);
  });

  it("loads the run once when opened without tasks, shows a loading line, then the groups; never renders arguments", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tasks = offboardingGated({}, { tsk_x2: { args: { employeeId: "E-1054", status: "terminated", effectiveDate: "2031-01-31", note: "argument-marker" } } });
    const calls = stubApi(async ({ path }) => {
      if (path === `/api/runs/${gated.runId}`) {
        await gate;
        return reply({ run: {}, tasks, approvals: [] });
      }
      return undefined;
    });
    render(withSession("approver", <ApprovalCard approval={gated} onDecided={() => undefined} />, "approver.lee@agentboard.test"));
    expect(calls.paths()).toEqual([]);
    open();
    expect((await screen.findByText("Loading the plan...")).getAttribute("role")).toBe("status");
    release?.();
    expect(await screen.findByTestId("unlocks-after")).toBeTruthy();
    expect(calls.paths()).toEqual([`/api/runs/${gated.runId}`]);
    expect(screen.getByTestId("unlocks").textContent).not.toContain("2031-01-31");
    expect(document.body.textContent).not.toContain("argument-marker");
  });

  it("shows an error with Try again when the run cannot be loaded, and a plain line when the gated task is not in the plan yet", async () => {
    let fail = true;
    const calls = stubApi(({ path }) => (path.startsWith("/api/runs/") ? (fail ? apiError(500, "internal", "boom") : reply({ run: {}, tasks: managerChange(), approvals: [] })) : undefined));
    render(withSession("approver", <ApprovalCard approval={gated} onDecided={() => undefined} />, "approver.lee@agentboard.test"));
    open();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The plan could not be loaded.");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    // The manager-change plan has no task tsk_x2: the mirror has not caught up with this approval.
    expect((await screen.findByTestId("unlocks-missing")).textContent).toBe("The plan for this approval is not available yet.");
    expect(calls.paths()).toHaveLength(2);
  });

  it("offers no disclosure on decided or expired approvals", () => {
    for (const status of ["approved", "rejected", "expired"] as const) {
      const view = render(withSession("approver", <ApprovalCard approval={{ ...gated, status, canDecide: false }} onDecided={() => undefined} tasks={offboardingGated()} />));
      expect(screen.queryByRole("button", { name: "What approving unlocks" })).toBeNull();
      view.unmount();
    }
  });
});
