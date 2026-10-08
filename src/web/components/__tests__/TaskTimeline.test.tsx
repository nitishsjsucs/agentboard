import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskTimeline } from "../TaskTimeline.tsx";
import { task } from "./fixtures.ts";
import { withSession } from "./session.tsx";

afterEach(cleanup);

describe("TaskTimeline", { tags: ["ui"] }, () => {
  it("orders the plan first, then steps numerically with each execute task before its verify task", () => {
    const tasks = [
      task({ id: "v10", kind: "verify", stepId: "s10", tool: "notify.send" }),
      task({ id: "x2", kind: "execute", stepId: "s2", tool: "hris.update_address" }),
      task({ id: "x10", kind: "execute", stepId: "s10", tool: "notify.send" }),
      task({ id: "v2", kind: "verify", stepId: "s2", tool: "hris.update_address" }),
      task({ id: "plan", kind: "plan" }),
      task({ id: "x1", kind: "execute", stepId: "s1", tool: "hris.get_employee" }),
    ];
    render(withSession("viewer", <TaskTimeline tasks={tasks} />));
    expect(screen.getAllByTestId("task-row").map((row) => row.getAttribute("data-task-id"))).toEqual(["plan", "x1", "x2", "v2", "x10", "v10"]);
  });

  it("shows attempt and generation badges, the lease owner and epoch, and the hold reason", () => {
    const tasks = [
      task({ id: "a", kind: "execute", stepId: "s1", status: "leased", attempts: 2, generation: 1, lease: { owner: "executor-1", epoch: 3, expiresAt: "2026-10-08T12:00:30.000Z" } }),
      task({ id: "b", kind: "execute", stepId: "s2", status: "held", attempts: 0, holdReason: "role_disabled" }),
    ];
    render(withSession("viewer", <TaskTimeline tasks={tasks} />));
    const [leased, held] = screen.getAllByTestId("task-row");
    expect(leased?.querySelector('[data-testid="attempts"]')?.textContent).toBe("attempt 2");
    expect(leased?.querySelector('[data-testid="generation"]')?.textContent).toBe("gen 1");
    expect(leased?.querySelector('[data-testid="lease"]')?.textContent).toContain("leased by executor-1, epoch 3");
    expect(held?.querySelector('[data-testid="attempts"]')?.textContent).toBe("attempt 0");
    expect(held?.querySelector('[data-testid="generation"]')).toBeNull();
    expect(held?.textContent).toContain("held: role disabled");
  });
});
