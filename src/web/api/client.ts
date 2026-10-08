// Fetch wrappers for the AgentBoard API. Every call sends
// X-AgentBoard-Client: web (the CSRF guard requires it on mutations).

import type { ApiError } from "../../shared/api-types.ts";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason: string | undefined;

  constructor(status: number, body: ApiError | null) {
    super(body?.error.message ?? `HTTP ${status}`);
    this.status = status;
    this.code = body?.error.code ?? "internal";
    this.reason = body?.error.reason;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "X-AgentBoard-Client": "web",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    // Recovery commands answer 409 with a ControlResponse body; let callers see it.
    if (response.status === 409 && parsed && typeof parsed === "object" && "accepted" in parsed) return parsed as T;
    throw new ApiRequestError(response.status, parsed as ApiError | null);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
};

export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
