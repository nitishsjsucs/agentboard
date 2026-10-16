import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useSession } from "../api/hooks.ts";
import { devLoginPath } from "../api/navigation.ts";
import { NavBar } from "./NavBar.tsx";

/** Shown when a request after sign-in was refused as signed out; it never navigates, so typed text stays. */
function SessionEndedBanner() {
  const { sessionEnded, health, me } = useSession();
  const location = useLocation();
  if (!sessionEnded || location.pathname === "/dev/login") return null;
  const authMode = health?.authMode ?? me?.authMode;
  return (
    <div className="notice notice--warning row session-banner" role="alert" style={{ borderRadius: 0, justifyContent: "center" }}>
      {authMode === "access" ? (
        <>
          <span>Your Cloudflare Access session may have ended. Reload to sign in again.</span>
          <button type="button" className="btn btn--small" onClick={() => window.location.reload()}>
            Reload
          </button>
        </>
      ) : (
        <>
          <span>Your dev session ended.</span>
          <Link to={devLoginPath(`${location.pathname}${location.search}`)}>Sign in again</Link>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { health } = useSession();
  return (
    <>
      <NavBar />
      <SessionEndedBanner />
      {health?.faultInjection ? (
        <div className="notice notice--warning" style={{ borderRadius: 0, textAlign: "center" }}>
          Simulation mode: fault injection is on. The People systems and every employee are simulated.
        </div>
      ) : null}
      <main className="main">{children}</main>
    </>
  );
}
