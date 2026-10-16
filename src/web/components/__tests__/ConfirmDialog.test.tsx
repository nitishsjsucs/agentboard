import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../ConfirmDialog.tsx";

afterEach(cleanup);

/** A button that opens the dialog, as the recovery controls do. */
function Opener({ onConfirm = vi.fn() }: { onConfirm?: (reason: string) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Pause run
      </button>
      {open ? (
        <ConfirmDialog
          title="Pause this run"
          confirmLabel="Confirm"
          onCancel={() => setOpen(false)}
          onConfirm={async (reason) => {
            await onConfirm(reason);
            setOpen(false);
          }}
        >
          <p>Tasks wait until someone resumes the run.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

describe("ConfirmDialog", { tags: ["ui"] }, () => {
  it("requires a trimmed reason of 3 to 500 characters and keeps the dialog open with the error when the command fails", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("run is not paused"));
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Resume run" confirmLabel="Resume" onConfirm={onConfirm} onCancel={onCancel}>
        <p>Releases checkpoint holds.</p>
      </ConfirmDialog>,
    );
    const reason = screen.getByLabelText("Reason (recorded in the audit log)") as HTMLTextAreaElement;
    const confirm = screen.getByRole("button", { name: "Resume" }) as HTMLButtonElement;
    expect(reason.maxLength).toBe(500);
    expect(confirm.disabled).toBe(true);
    fireEvent.change(reason, { target: { value: "  ok  " } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(reason, { target: { value: "  checked with the requester  " } });
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText("run is not paused")).toBeTruthy());
    expect(onConfirm).toHaveBeenCalledWith("checked with the requester");
    expect(screen.getByRole("dialog", { name: "Resume run" })).toBeTruthy();
    expect(confirm.disabled).toBe(false);

    // With a reason typed, a click on the backdrop does not throw it away; Cancel still closes.
    fireEvent.click(screen.getByRole("presentation"));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels on a backdrop click while the reason is empty", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Cancel this run" confirmLabel="Confirm" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("presentation"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and returns focus to the button that opened it", () => {
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Pause run" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Pause this run" });
    expect(document.activeElement).toBe(screen.getByLabelText("Reason (recorded in the audit log)"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab and Shift+Tab inside the dialog", () => {
    render(<Opener />);
    fireEvent.click(screen.getByRole("button", { name: "Pause run" }));
    const dialog = screen.getByRole("dialog");
    const reason = screen.getByLabelText("Reason (recorded in the audit log)");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.change(reason, { target: { value: "checking the lease" } });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(reason);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    // Tab between the middle controls is left to the browser.
    cancel.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
  });

  it("links its context to the dialog with aria-describedby, and returns focus after a confirm too", async () => {
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Pause run" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    const context = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(context?.textContent).toBe("Tasks wait until someone resumes the run.");
    fireEvent.change(screen.getByLabelText("Reason (recorded in the audit log)"), { target: { value: "end of the day" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("focuses fallbackFocus on close when the opener is gone, instead of dropping focus to the body", () => {
    function Replaced() {
      const [open, setOpen] = useState(false);
      const [replaced, setReplaced] = useState(false);
      return (
        <>
          {replaced ? null : (
            <button type="button" onClick={() => setOpen(true)}>
              Replay
            </button>
          )}
          <div role="status" tabIndex={-1} data-testid="outcome" />
          <button type="button" onClick={() => setReplaced(true)}>
            replace opener
          </button>
          {open ? (
            <ConfirmDialog title="Replay" confirmLabel="Replay" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} fallbackFocus={() => screen.getByTestId("outcome")}>
              <p>context</p>
            </ConfirmDialog>
          ) : null}
        </>
      );
    }
    render(<Replaced />);
    const opener = screen.getByRole("button", { name: "Replay" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "replace opener" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByTestId("outcome"));
  });
});
