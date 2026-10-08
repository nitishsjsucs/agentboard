import { useCallback, useEffect, useState } from "react";
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
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    api.get<Health>("/api/health").then(setHealth).catch(() => setHealth(null));
    api
      .get<MeResponse>("/api/me")
      .then((value) => {
        setMe(value);
        setUnauthenticated(false);
      })
      .catch((error: unknown) => {
        setMe(null);
        setUnauthenticated(error instanceof ApiRequestError && error.status === 401);
      });
  }, [version]);

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
