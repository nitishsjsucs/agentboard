import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunSnapshot } from "../../../shared/api-types.ts";
import type { Role } from "../../../shared/domain.ts";
import { RecoveryControls } from "../RecoveryControls.tsx";
import { reply, stubApi, type SeenRequest } from "./api.ts";
import { snapshot, task } from "./fixtures.ts";
import { withSession } from "./session.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Answers every command with accepted, or refused with `refusal`. */
function serve(refusal?: string) {
  return stubApi(({ method }) => {
    if (method === "GET") return undefined;
    return refusal ? reply({ accepted: false, reason: refusal, snapshot: snapshot() }, 409) : reply({ accepted: true, snapshot: snapshot() });
  });
}

async function confirmWith(reason = "checked with the team") {
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Reason (recorded in the audit log)"), { target: { value: reason } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

const outcome = () => screen.getByTestId("recovery-outcome");

function controls(role: Role, snap: RunSnapshot = snapshot()) {
  return render(withSession(role, <RecoveryControls runId="run_x" snapshot={snap} onDone={() => undefined} />));
}

const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent?.trim());

describe("RecoveryControls", { tags: ["ui"] }, () => {
  it("shows no recovery actions to a viewer", () => {
    render(withSession("viewer", <RecoveryControls runId="run_x" snapshot={snapshot()} onDone={() => undefined} />));
    expect(buttons()).toEqual([]);
    expect(screen.getByTestId("no-controls")).toBeTruthy();
  });

  it("gives an operator run controls, retry and release-lease, but not skip or budget raises", () => {
    render(withSession("operator", <RecoveryControls runId="run_x" snapshot={snapshot()} onDone={() => undefined} />));
    const visible = buttons();
    expect(visible).toEqual(expect.arrayContaining(["Pause run", "Cancel run", "Retry", "Release lease"]));
    expect(visible).not.toContain("Skip");
    expect(visible).not.toContain("Raise budget");
    expect(visible).not.toContain("Resume run");
  });

  it("gives an admin skip and budget raises, and the retry dialog names the verify task it cascades to", () => {
    render(withSession("admin", <RecoveryControls runId="run_x" snapshot={snapshot()} onDone={() => undefined} />));
    const visible = buttons();
    expect(visible).toEqual(expect.arrayContaining(["Skip", "Raise budget", "Retry", "Release lease"]));
    // Retry is offered for the s2 write whose verification failed (and for that verify task itself).
    const retries = screen.getAllByRole("button", { name: "Retry" });
    fireEvent.click(retries[0] as HTMLElement);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Retry s2 execute (hris.update_address)");
    expect(dialog.textContent).toContain("Also resets its verify task (s2 verify) to pending at generation 1.");
    // A reason is required before confirming.
    const confirm = screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason (recorded in the audit log)"), { target: { value: "re-run the write" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // The budget dialog confirms only a real raise: some field above its current value, none below.
    fireEvent.click(screen.getByRole("button", { name: "Raise budget" }));
    fireEvent.change(screen.getByLabelText("Reason (recorded in the audit log)"), { target: { value: "more calls" } });
    const raise = screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    expect(raise.disabled).toBe(true);
    const toolCalls = screen.getByLabelText(/^Tool calls/) as HTMLInputElement;
    fireEvent.change(toolCalls, { target: { value: toolCalls.min } });
    expect(raise.disabled).toBe(true);
    fireEvent.change(toolCalls, { target: { value: String(Number(toolCalls.min) + 10) } });
    expect(raise.disabled).toBe(false);
  });

  it("lays out the budget fields in a form-two grid with no inline column template", () => {
    render(withSession("admin", <RecoveryControls runId="run_x" snapshot={snapshot()} onDone={() => undefined} />));
    fireEvent.click(screen.getByRole("button", { name: "Raise budget" }));
    const grid = screen.getByRole("dialog").querySelector(".form-two") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.style.gridTemplateColumns).toBe("");
    expect(grid.querySelectorAll("input")).toHaveLength(4);
  });

  it("announces what each accepted command did in a status region", async () => {
    serve();
    const cases: [Role, RunSnapshot, string, string][] = [
      ["operator", snapshot(), "Pause run", "Paused the run."],
      ["operator", snapshot({ status: "paused", statusReason: "paused" }), "Resume run", "Resumed the run."],
      ["operator", snapshot(), "Cancel run", "Cancelled the run."],
      ["admin", snapshot(), "Raise budget", "Raised the budget."],
    ];
    for (const [role, snap, button, text] of cases) {
      const view = controls(role, snap);
      fireEvent.click(screen.getByRole("button", { name: button }));
      if (button === "Raise budget") fireEvent.change(screen.getByLabelText(/^Tool calls/), { target: { value: "30" } });
      await confirmWith();
      expect(outcome().getAttribute("role")).toBe("status");
      expect(outcome().textContent).toBe(text);
      view.unmount();
    }
    const tasks = controls("admin");
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0] as HTMLElement);
    await confirmWith();
    expect(outcome().textContent).toBe("Retry of s2 execute (hris.update_address) requested.");
    fireEvent.click(screen.getByRole("button", { name: "Release lease" }));
    await confirmWith();
    expect(outcome().textContent).toBe("Released the lease of s3 execute (notify.send).");
    tasks.unmount();
    controls("admin", snapshot({ tasks: [task({ id: "x", kind: "execute", stepId: "s4", tool: "itsm.create_ticket", status: "failed" })] }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await confirmWith();
    expect(outcome().textContent).toBe("Skipped s4 execute (itsm.create_ticket).");
  });

  it.each([
    ["invalid_state", "The run is no longer in a state that allows this; the page now shows its current state."],
    ["not_retryable", "This task cannot be retried in its current state; the page now shows its current state."],
    ["not_found", "That task is no longer part of this run; the page now shows its current state."],
    ["not_a_raise", "The budget was not raised: raise at least one value above its current limit, and lower none."],
    ["something_new", "Refused: something_new."],
  ])("explains the refusal %s in plain words", async (code, text) => {
    serve(code);
    controls("operator");
    fireEvent.click(screen.getByRole("button", { name: "Pause run" }));
    await confirmWith();
    expect(outcome().textContent).toBe(text);
  });

  it("clears the previous outcome when the next dialog opens", async () => {
    serve();
    controls("operator");
    fireEvent.click(screen.getByRole("button", { name: "Pause run" }));
    await confirmWith();
    expect(outcome().textContent).toBe("Paused the run.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(outcome().textContent).toBe("");
  });

  it("prefills the budget form with current limits, marks the exhausted one, explains a disabled Confirm, and sends minutes as milliseconds", async () => {
    const api = serve();
    const exhausted = snapshot({ usage: { toolCalls: 24, toolCallsReserved: 0, llmTokens: 900, activeMs: 240_000, attempts: 5, replays: 0, skippedSteps: 0 } });
    controls("admin", exhausted);
    fireEvent.click(screen.getByRole("button", { name: "Raise budget" }));
    const value = (label: RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;
    expect(value(/^Tool calls \(used 24 of 24\)/)).toBe("24");
    expect(value(/^LLM tokens \(used 900 of 6000\)/)).toBe("6000");
    expect(value(/^Attempts per task \(now 3\)/)).toBe("3");
    expect(value(/^Active time in minutes \(used 4 of 15\)/)).toBe("15");
    expect(screen.getByText("Tool calls (used 24 of 24)", { exact: false }).closest("label")?.textContent).toContain("exhausted");
    expect(screen.getByLabelText(/^LLM tokens/).closest(".field")?.textContent).not.toContain("exhausted");

    const confirm = screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Reason (recorded in the audit log)"), { target: { value: "longer window" } });
    expect(confirm.disabled).toBe(true);
    const hint = document.getElementById(confirm.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe("Raise at least one value above its current limit, and lower none.");

    fireEvent.change(screen.getByLabelText(/^Active time in minutes/), { target: { value: "20" } });
    expect(confirm.disabled).toBe(false);
    expect(confirm.getAttribute("aria-describedby")).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = api.seen.find((r: SeenRequest) => r.method === "PATCH");
    expect(patch?.path).toBe("/api/runs/run_x/budget");
    expect(patch?.body).toEqual({ maxActiveMs: 1_200_000, reason: "longer window" });
  });

  /** Recovery controls whose snapshot becomes `next` once a command is done, as the live run view does. */
  function Live({ role, initial, next }: { role: Role; initial: RunSnapshot; next: RunSnapshot }) {
    const [snap, setSnap] = useState(initial);
    return withSession(role, <RecoveryControls runId="run_x" snapshot={snap} onDone={() => setSnap(next)} />);
  }

  it("moves focus to the outcome after a confirmed command that replaces or removes its own button", async () => {
    serve();
    const paused = snapshot({ status: "paused", statusReason: "paused" });
    const byName = (name: string) => () => screen.getByRole("button", { name });
    // The fixture lists s2's execute task before its verify task.
    const verifyRetry = () => screen.getAllByRole("button", { name: /^Retry/ })[1] as HTMLElement;
    const cases: [Role, RunSnapshot, RunSnapshot, () => HTMLElement, string][] = [
      ["operator", snapshot(), paused, byName("Pause run"), "Paused the run."],
      ["operator", paused, snapshot(), byName("Resume run"), "Resumed the run."],
      // Cancelling ends the run: the controls give way to "No recovery actions available".
      ["operator", snapshot(), snapshot({ status: "cancelled", statusReason: "cancelled" }), byName("Cancel run"), "Cancelled the run."],
      // The retried row disappears once the task is pending again.
      ["admin", snapshot(), snapshot({ tasks: snapshot().tasks.map((t) => (t.status === "failed" ? { ...t, status: "pending" as const } : t)) }), verifyRetry, "Retry of s2 verify (hris.update_address) requested."],
    ];
    for (const [role, initial, next, pick, text] of cases) {
      const view = render(<Live role={role} initial={initial} next={next} />);
      const opener = pick();
      opener.focus();
      fireEvent.click(opener);
      await confirmWith();
      await waitFor(() => expect(outcome().textContent).toBe(text));
      expect(opener.isConnected).toBe(false);
      expect(document.activeElement).toBe(outcome());
      expect(outcome().getAttribute("tabindex")).toBe("-1");
      view.unmount();
    }
  });

  it("keeps focus on the outcome when the opener is still there, and falls back to it when a live update removed the opener before a cancel", async () => {
    serve();
    const view = render(withSession("operator", <RecoveryControls runId="run_x" snapshot={snapshot()} onDone={() => undefined} />));
    fireEvent.click(screen.getByRole("button", { name: "Pause run" }));
    await confirmWith();
    expect(document.activeElement).toBe(outcome());

    // Someone else paused the run while this dialog was open: Escape cannot return focus to Pause run.
    fireEvent.click(screen.getByRole("button", { name: "Pause run" }));
    view.rerender(withSession("operator", <RecoveryControls runId="run_x" snapshot={snapshot({ status: "paused", statusReason: "paused" })} onDone={() => undefined} />));
    expect(screen.queryByRole("button", { name: "Pause run" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(outcome());
  });

  it("says that retrying a rejected approval-gated task asks for a new approval", () => {
    const gated = snapshot({
      statusReason: "approval_expired",
      tasks: [task({ id: "g", kind: "execute", stepId: "s2", tool: "hris.update_manager", status: "rejected", requiresApproval: true, lastError: "approval_expired" })],
    });
    controls("operator", gated);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("dialog").textContent).toContain("Retrying asks for a new approval.");
  });
});
