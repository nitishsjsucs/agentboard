import { useState, type ReactNode } from "react";

export interface ConfirmDialogProps {
  title: string;
  /** Extra context shown above the reason field, for example the cascade a command causes. */
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Every recovery command carries an audited reason (3 to 500 characters). */
  onConfirm: (reason: string) => Promise<void> | void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, children, confirmLabel, danger = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= 3 && reason.trim().length <= 500;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        <div className="field">
          <label htmlFor="confirm-reason">Reason (recorded in the audit log)</label>
          <textarea id="confirm-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
        </div>
        {error ? <div className="error-text">{error}</div> : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? "btn--danger" : "btn--primary"}`} disabled={!valid || busy} onClick={() => void submit()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
