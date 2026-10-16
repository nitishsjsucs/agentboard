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
  /** Loads /api/health and /api/me again; resolves once the session holds the answers. */
  reload: () => Promise<void>;
}

export const SessionContext = createContext<Session>({ me: null, health: null, reload: async () => undefined });

export function useSession(): Session {
  return useContext(SessionContext);
}

export function useCan(permission: Permission): boolean {
  return useSession().me?.permissions.includes(permission) ?? false;
}

export interface Polled<T> {
  data: T | null;
  error: Error | null;
  /** True until the first answer (data or error) for the current resetKey. */
  loading: boolean;
  /** When the last successful load finished; null before the first one. */
  updatedAt: Date | null;
  refresh: () => void;
}

export interface PollOptions {
  /** Poll interval; 0 loads once (and on refresh or a deps change). Lists poll every 5 s (SPEC section 15). */
  intervalMs?: number;
  /**
   * When this value changes, data and error are cleared before the next render, so a new filter or tab
   * never shows the previous one's rows. A plain deps change (for example a live version bump) keeps them.
   */
  resetKey?: unknown;
  /** False skips loading entirely (for example a tab that is not shown, or a panel the role cannot read). */
  enabled?: boolean;
}

interface PollState<T> {
  data: T | null;
  error: Error | null;
  updatedAt: Date | null;
  key: unknown;
}

/** Loads `load()` now and every `intervalMs`, keeping the last good data when a later poll fails. */
export function usePolling<T>(load: () => Promise<T>, deps: readonly unknown[], options: PollOptions = {}): Polled<T> {
  const { intervalMs = 5000, resetKey, enabled = true } = options;
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, updatedAt: null, key: resetKey });
  // A new resetKey clears the previous key's data during this render (React's derived-state pattern).
  if (!Object.is(state.key, resetKey)) setState({ data: null, error: null, updatedAt: null, key: resetKey });
  const loadRef = useRef(load);
  loadRef.current = load;
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      try {
        const value = await loadRef.current();
        if (!cancelled) setState((s) => ({ ...s, data: value, error: null, updatedAt: new Date() }));
      } catch (err) {
        if (!cancelled) setState((s) => ({ ...s, error: err instanceof Error ? err : new Error(String(err)) }));
      }
    };
    void run();
    const timer = intervalMs > 0 ? setInterval(run, intervalMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, intervalMs, enabled, resetKey]);

  const current = Object.is(state.key, resetKey) ? state : { data: null, error: null, updatedAt: null };
  return { data: current.data, error: current.error, loading: current.data === null && current.error === null, updatedAt: current.updatedAt, refresh };
}
