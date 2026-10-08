import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecoveryControls } from "../RecoveryControls.tsx";
import { snapshot } from "./fixtures.ts";
import { withSession } from "./session.tsx";

afterEach(cleanup);

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
  });
});
