import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRolesResponse } from "../../../shared/api-types.ts";
import { AgentRolePanel } from "../AgentRolePanel.tsx";
import { withSession } from "./session.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const roles: AgentRolesResponse["roles"] = [
  { role: "planner", disabled: false, reason: null, updatedBy: "seed", updatedAt: "2026-10-01T00:00:00.000Z", heldTasks: 0 },
  { role: "executor", disabled: false, reason: null, updatedBy: "seed", updatedAt: "2026-10-01T00:00:00.000Z", heldTasks: 0 },
  { role: "verifier", disabled: true, reason: "investigating false negatives", updatedBy: "admin@agentboard.test", updatedAt: "2026-10-08T12:00:00.000Z", heldTasks: 4 },
];

const toggles = () => screen.queryAllByRole("button").map((b) => b.textContent?.trim());

describe("AgentRolePanel", { tags: ["ui"] }, () => {
  it("shows role state and held tasks to everyone, and the enable and disable toggles only with agents:toggle", () => {
    for (const role of ["viewer", "operator", "approver"] as const) {
      const view = render(withSession(role, <AgentRolePanel roles={roles} onChange={() => undefined} />));
      expect(toggles()).toEqual([]);
      view.unmount();
    }
    render(withSession("admin", <AgentRolePanel roles={roles} onChange={() => undefined} />));
    expect(toggles()).toEqual(["Disable", "Disable", "Enable"]);
    const verifier = screen.getByText("verifier").closest("tr") as HTMLElement;
    expect(verifier.textContent).toContain("disabled");
    expect(verifier.textContent).toContain("investigating false negatives");
    expect(verifier.textContent).toContain("4");
  });

  it("disables a role only after a reason is given, posting it with the CSRF header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ roles }));
    const onChange = vi.fn();
    render(withSession("admin", <AgentRolePanel roles={roles} onChange={onChange} />));
    const executor = screen.getByText("executor").closest("tr") as HTMLElement;
    fireEvent.click(within(executor).getByRole("button", { name: "Disable" }));

    const dialog = screen.getByRole("dialog", { name: "Disable the executor role" });
    expect(dialog.textContent).toContain("In-flight leases finish; new messages for this role are held");
    const confirm = within(dialog).getByRole("button", { name: "Disable" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Reason (recorded in the audit log)"), { target: { value: "  executor bug in notify  " } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/agents/executor/disable");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-AgentBoard-Client"]).toBe("web");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "executor bug in notify" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
