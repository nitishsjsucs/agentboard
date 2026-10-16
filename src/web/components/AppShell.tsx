import { useEffect, useRef, type ReactNode } from "react";
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

/** After a client-side navigation (not on first load, not on a query change), focus the new page's h1. */
function useRouteFocus(): void {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const heading = document.querySelector<HTMLElement>("main h1");
      if (heading) {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus();
        return;
      }
      // Some pages show their heading once their data arrives; fall back to the main region.
      tries += 1;
      if (tries < 40) timer = setTimeout(attempt, 50);
      else document.getElementById("main")?.focus();
    };
    attempt();
    return () => clearTimeout(timer);
  }, [pathname]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { health } = useSession();
  useRouteFocus();
  return (
    <>
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <NavBar />
      <SessionEndedBanner />
      {health?.faultInjection ? (
        <div className="notice notice--warning" style={{ borderRadius: 0, textAlign: "center" }}>
          Simulation mode: fault injection is on. The People systems and every employee are simulated.
        </div>
      ) : null}
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
