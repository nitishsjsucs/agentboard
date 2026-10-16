import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, useLocation, useNavigate } from "react-router";
import type { MeResponse } from "../shared/api-types.ts";
import { api, ApiRequestError, sessionEvents, type SessionProblem } from "./api/client.ts";
import { SessionContext, type Health } from "./api/hooks.ts";
import { devLoginPath } from "./api/navigation.ts";
import { AppShell } from "./components/AppShell.tsx";
import { SessionGate } from "./components/SessionGate.tsx";
import { AppRoutes } from "./routes.tsx";

function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [meError, setMeError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const latest = useRef(0);
  const current = useRef<{ me: MeResponse | null; health: Health | null }>({ me: null, health: null });
  current.current = { me, health };
  const navigate = useNavigate();
  const location = useLocation();

  // Resolves once the session state holds this load's answers, so a caller can wait for the new
  // principal (dev login) before it renders pages that fetch by permission. Only the latest load
  // applies its answers.
  const reload = useCallback(async () => {
    const load = ++latest.current;
    const [healthResult, meResult] = await Promise.allSettled([api.get<Health>("/api/health"), api.get<MeResponse>("/api/me")]);
    if (load !== latest.current) return;
    setHealth(healthResult.status === "fulfilled" ? healthResult.value : null);
    if (meResult.status === "fulfilled") {
      setMe(meResult.value);
      setMeError(null);
      setSessionEnded(false);
    } else {
      setMe(null);
      setMeError(meResult.reason);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A 401 (or, behind Access, a redirect to its login page or an HTML page below 500) after the session
  // loaded: show a banner and stay on the page, so whatever the user typed is still there.
  useEffect(() => {
    const onProblem = (event: Event) => {
      const problem = (event as CustomEvent<SessionProblem>).detail;
      const { me: signedIn, health: known } = current.current;
      if (!signedIn) return;
      const authMode = known?.authMode ?? signedIn.authMode;
      if (problem.status === 401 || ((problem.code === "redirected" || problem.code === "unavailable") && authMode === "access")) setSessionEnded(true);
    };
    sessionEvents.addEventListener("problem", onProblem);
    return () => sessionEvents.removeEventListener("problem", onProblem);
  }, []);

  const unauthenticated = meError instanceof ApiRequestError && meError.status === 401;
  useEffect(() => {
    if (unauthenticated && health?.authMode === "dev" && location.pathname !== "/dev/login") {
      navigate(devLoginPath(`${location.pathname}${location.search}`), { replace: true });
    }
  }, [unauthenticated, health?.authMode, location.pathname, location.search, navigate]);

  return <SessionContext.Provider value={{ me, health, loaded, meError, sessionEnded, reload }}>{children}</SessionContext.Provider>;
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <AppShell>
          <SessionGate>
            <AppRoutes />
          </SessionGate>
        </AppShell>
      </SessionProvider>
    </BrowserRouter>
  );
}
