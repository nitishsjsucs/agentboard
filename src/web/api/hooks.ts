import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { MeResponse } from "../../shared/api-types.ts";
import type { Permission } from "../../shared/domain.ts";

export interface Health {
  ok: boolean;
  version: string;
  environment: string;
  authMode: "access" | "dev";
  llmProvider: string;
  faultInjection: boolean;
}

export interface Session {
  me: MeResponse | null;
  health: Health | null;
  reload: () => void;
}

export const SessionContext = createContext<Session>({ me: null, health: null, reload: () => undefined });

export function useSession(): Session {
  return useContext(SessionContext);
}

export function useCan(permission: Permission): boolean {
  return useSession().me?.permissions.includes(permission) ?? false;
}

export interface Polled<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refresh: () => void;
}

/** Loads `load()` now and every `intervalMs` (lists poll every 5 s, SPEC section 15). */
export function usePolling<T>(load: () => Promise<T>, deps: readonly unknown[], intervalMs = 5000): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const value = await loadRef.current();
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    const timer = intervalMs > 0 ? setInterval(run, intervalMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, intervalMs]);

  return { data, error, loading, refresh };
}
