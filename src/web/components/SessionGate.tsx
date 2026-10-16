import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ApiRequestError } from "../api/client.ts";
import { useSession } from "../api/hooks.ts";
import { clearLaunchDraft } from "../api/launchDraft.ts";
import { ErrorNotice } from "./ErrorNotice.tsx";
import { LoadingLine } from "./PolledView.tsx";

/** Cloudflare Access's own logout path on the app's hostname. */
export const ACCESS_LOGOUT = "/cdn-cgi/access/logout";

/**
 * Renders the pages only for a signed-in principal with a role, so no page fetches data before the
 * session is known (or for someone who cannot read it). The dev login page always renders.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const { me, health, loaded, meError, reload } = useSession();
  const location = useLocation();
  if (location.pathname === "/dev/login") return <>{children}</>;
  if (!loaded) return <LoadingLine text="Loading your session..." />;
  const authMode = health?.authMode ?? me?.authMode;
  if (!me) {
    const unauthenticated = meError instanceof ApiRequestError && meError.status === 401;
    // Dev mode navigates to the dev login (SessionProvider); nothing else renders meanwhile.
    if (unauthenticated && authMode === "dev") return <LoadingLine text="Opening the dev login..." />;
    if (unauthenticated) {
      return (
        <div className="stack" style={{ maxWidth: 640 }}>
          <h1>You are not signed in</h1>
          <p className="muted">Reload the page to sign in with Cloudflare Access.</p>
          <div>
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return <ErrorNotice error={meError} title="Your session could not be loaded." onRetry={() => void reload()} />;
  }
  if (me.role === null) {
    const email = me.principal.email ?? me.principal.id;
    return (
      <div className="stack" style={{ maxWidth: 640 }} data-testid="no-role">
        <h1>No AgentBoard role</h1>
        <p>
          You are signed in as <strong>{email}</strong>, but you have no AgentBoard role. Ask an admin to add a role binding for this email.
        </p>
        <div>
          {authMode === "access" ? (
            <a className="btn" href={ACCESS_LOGOUT} onClick={clearLaunchDraft}>
              Sign out
            </a>
          ) : (
            <Link className="btn" to="/dev/login">
              switch user
            </Link>
          )}
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
