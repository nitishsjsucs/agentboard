import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ErrorNotice } from "./ErrorNotice.tsx";

export interface ConfirmDialogProps {
  title: string;
  /** Extra context shown above the reason field, for example the cascade a command causes. */
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Every recovery command carries an audited reason (3 to 500 characters). */
  onConfirm: (reason: string) => Promise<void> | void;
  onCancel: () => void;
  /** Extra condition from the dialog's own fields (for example a budget raise with no field set). */
  confirmDisabled?: boolean;
  /** Says why Confirm is disabled by the dialog's own fields; linked to the button. */
  confirmHint?: string | undefined;
  /** What the command does, completing "Your role cannot ..." in a refusal message (for example "pause runs"). */
  action?: string;
  /**
   * Where focus goes on close when the button that opened the dialog is gone (a live update replaced it),
   * for example the region that announces outcomes. Without it, focus would fall to the page body.
   */
  fallbackFocus?: () => HTMLElement | null;
}

const FOCUSABLE = 'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({ title, children, confirmLabel, danger = false, onConfirm, onCancel, confirmDisabled = false, confirmHint, action, fallbackFocus }: ConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  // The element that opened the dialog, captured before the dialog takes focus; focus returns to it on close.
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const fallback = useRef(fallbackFocus);
  fallback.current = fallbackFocus;
  const ids = useId();
  const describedBy = `${ids}-context`;
  const hintId = `${ids}-hint`;
  const valid = reason.trim().length >= 3 && reason.trim().length <= 500;

  // A layout effect, so focus is back on the opener in the same commit that removes the dialog.
  useLayoutEffect(() => {
    reasonRef.current?.focus();
    const returnTo = opener.current;
    return () => {
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
      else fallback.current?.()?.focus();
    };
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    // Keep Tab and Shift+Tab inside the dialog.
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={() => {
        // A click outside cancels only while nothing was typed, so a stray click never loses a reason.
        if (!busy && reason.trim() === "") onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={children ? describedBy : undefined}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2>{title}</h2>
        {children ? <div id={describedBy}>{children}</div> : null}
        <div className="field">
          <label htmlFor={`${ids}-reason`}>Reason (recorded in the audit log)</label>
          <textarea ref={reasonRef} id={`${ids}-reason`} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
        {error ? <ErrorNotice error={error} action={action} /> : null}
        {confirmHint ? (
          <div id={hintId} className="small muted">
            {confirmHint}
          </div>
        ) : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn--danger" : "btn--primary"}`}
            disabled={!valid || busy || confirmDisabled}
            aria-describedby={confirmHint ? hintId : undefined}
            onClick={() => void submit()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
