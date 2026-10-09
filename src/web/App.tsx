import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, useLocation, useNavigate } from "react-router";
import type { MeResponse } from "../shared/api-types.ts";
import { api, ApiRequestError } from "./api/client.ts";
import { SessionContext, type Health } from "./api/hooks.ts";
import { AppShell } from "./components/AppShell.tsx";
import { AppRoutes } from "./routes.tsx";

function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const latest = useRef(0);
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
      setUnauthenticated(false);
    } else {
      setMe(null);
      setUnauthenticated(meResult.reason instanceof ApiRequestError && meResult.reason.status === 401);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (unauthenticated && health?.authMode === "dev" && location.pathname !== "/dev/login") navigate("/dev/login");
  }, [unauthenticated, health?.authMode, location.pathname, navigate]);

  return <SessionContext.Provider value={{ me, health, reload }}>{children}</SessionContext.Provider>;
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </SessionProvider>
    </BrowserRouter>
  );
}
