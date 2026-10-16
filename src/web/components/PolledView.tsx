import type { ReactNode } from "react";
import type { Polled } from "../api/hooks.ts";
import { ErrorNotice } from "./ErrorNotice.tsx";

/** A loading line that screen readers announce politely. */
export function LoadingLine({ text }: { text: string }) {
  return (
    <div role="status" className="small muted loading">
      {text}
    </div>
  );
}

/** Data from an earlier load is still shown, but the latest refresh failed. */
export function StaleNotice({ updatedAt, onRetry }: { updatedAt: Date | null; onRetry: () => void }) {
  return (
    <div className="notice notice--warning row" role="status" data-testid="stale-notice">
      <span>{updatedAt ? `Showing data from ${updatedAt.toLocaleTimeString()}; the last refresh failed.` : "The last refresh failed."}</span>
      <button type="button" className="btn btn--small" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/**
 * Renders one polled resource with its four states kept apart: loading (no data, no error), failed
 * (no data, an error, with Try again), stale (data from an earlier load plus a failed refresh) and
 * loaded. Children render only real data, so an empty state never stands in for missing data.
 */
export function PolledView<T>({
  polled,
  loading,
  action,
  card,
  padded = false,
  renderError,
  children,
}: {
  polled: Polled<T>;
  /** For example "Loading runs...". */
  loading: string;
  /** Completes "Your role cannot ..." in a refusal message. */
  action?: string;
  /** Render the loading and failed states inside a card with this heading (for panels that draw their own card). */
  card?: string;
  /** Pad the loading, failed and stale states (inside a card that has no body padding). */
  padded?: boolean;
  renderError?: (error: Error) => ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { data, error, updatedAt, refresh } = polled;
  const pad = (content: ReactNode) => (padded ? <div className="card__body">{content}</div> : content);
  if (data === null) {
    const content = error ? (renderError ? renderError(error) : <ErrorNotice error={error} action={action} onRetry={refresh} />) : <LoadingLine text={loading} />;
    if (card) {
      return (
        <div className="card">
          <div className="card__header">
            <h3>{card}</h3>
          </div>
          <div className="card__body">{content}</div>
        </div>
      );
    }
    return pad(content);
  }
  if (error) {
    return (
      <div className="stack" style={{ gap: "var(--space-2)" }}>
        {pad(<StaleNotice updatedAt={updatedAt} onRetry={refresh} />)}
        {children(data)}
      </div>
    );
  }
  return <>{children(data)}</>;
}
