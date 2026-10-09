import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../ConfirmDialog.tsx";

afterEach(cleanup);

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

    // Cancel and a click on the backdrop both close without confirming.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("presentation"));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
