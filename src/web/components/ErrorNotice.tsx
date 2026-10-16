import type { ReactNode } from "react";
import { describeError } from "../api/describeError.ts";
import { useSession } from "../api/hooks.ts";

/**
 * A failed request in plain words, with what to do next. Never shows the server's internal message;
 * the request id appears only for server failures.
 */
export function ErrorNotice({ error, action, onRetry, children }: { error: unknown; action?: string | undefined; onRetry?: (() => void) | undefined; children?: ReactNode }) {
  const { me } = useSession();
  const description = describeError(error, { me, ...(action ? { action } : {}) });
  return (
    <div className="notice notice--danger" role="alert">
      <div>
        {description.message}
        {description.next ? ` ${description.next}` : ""}
      </div>
      {onRetry || children ? (
        <div className="row" style={{ marginTop: "var(--space-2)" }}>
          {onRetry ? (
            <button type="button" className="btn btn--small" onClick={onRetry}>
              Try again
            </button>
          ) : null}
          {children}
        </div>
      ) : null}
      {description.requestId ? <div className="small mono" style={{ marginTop: "var(--space-1)" }}>Request id {description.requestId}</div> : null}
    </div>
  );
}
