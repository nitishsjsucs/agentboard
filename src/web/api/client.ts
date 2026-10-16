// Fetch wrappers for the AgentBoard API. Every call sends
// X-AgentBoard-Client: web (the CSRF guard requires it on mutations).

import type { ApiError } from "../../shared/api-types.ts";

/**
 * The server's error codes, plus two the client adds: `network` (the request never got an answer)
 * and `unavailable` (the answer was not AgentBoard JSON, for example an Access login or error page).
 */
export type ClientErrorCode = ApiError["error"]["code"] | "network" | "unavailable";

export class ApiRequestError extends Error {
  /** HTTP status; 0 when the request got no answer. */
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly reason: string | undefined;
  /** The server's request id (its cf-ray in production), for support. */
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiError | null, fallback?: { code: ClientErrorCode; message: string }) {
    super(body?.error.message ?? fallback?.message ?? `HTTP ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = body?.error.code ?? fallback?.code ?? "internal";
    this.reason = body?.error.reason;
    this.requestId = body?.error.requestId;
  }
}

function isApiError(value: unknown): value is ApiError {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return !!error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        "X-AgentBoard-Client": "web",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // fetch rejects only when no answer arrived (offline, DNS, a blocked cross-origin redirect).
    throw new ApiRequestError(0, null, { code: "network", message: "the request got no answer" });
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      // Not AgentBoard's JSON: an HTML login or error page from something in front of the Worker.
      throw new ApiRequestError(response.status, null, { code: "unavailable", message: "the response was not AgentBoard JSON" });
    }
  }
  if (!response.ok) {
    // Recovery commands answer 409 with a ControlResponse body; let callers see it.
    if (response.status === 409 && parsed && typeof parsed === "object" && "accepted" in parsed) return parsed as T;
    throw new ApiRequestError(response.status, isApiError(parsed) ? parsed : null);
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
