// Fetch wrappers for the AgentBoard API. Every call sends
// X-AgentBoard-Client: web (the CSRF guard requires it on mutations).

import type { ApiError } from "../../shared/api-types.ts";

/**
 * The server's error codes, plus three the client adds: `network` (the request never got an answer),
 * `redirected` (the answer was a redirect, which AgentBoard's API never sends: Cloudflare Access sends
 * an expired session to its login page this way) and `unavailable` (the answer was not AgentBoard
 * JSON, for example an HTML login or error page).
 */
export type ClientErrorCode = ApiError["error"]["code"] | "network" | "redirected" | "unavailable";

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

/** What a request saw that may mean the session ended: a 401, a redirect, or a non-JSON page below 500. */
export interface SessionProblem {
  status: number;
  code: ClientErrorCode;
  path: string;
}

/**
 * Every 401, every redirect and every non-JSON answer below 500 is announced here as a "problem" event,
 * so the session can show a banner without the page navigating away (and losing what the user typed).
 * A non-JSON 5xx page is a gateway or Worker failure, not a sign-in page, so it is not announced.
 */
export const sessionEvents = new EventTarget();

function announce(problem: SessionProblem): void {
  sessionEvents.dispatchEvent(new CustomEvent<SessionProblem>("problem", { detail: problem }));
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
      // Behind Access an expired session answers 302 to the cross-origin login page. Followed, that is a
      // CORS failure indistinguishable from being offline; not followed, it is an opaque redirect.
      redirect: "manual",
      headers: {
        "X-AgentBoard-Client": "web",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // fetch rejects only when no answer arrived (offline, DNS, a blocked request).
    throw new ApiRequestError(0, null, { code: "network", message: "the request got no answer" });
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    // The API never redirects, so something in front of the Worker answered: behind Access, its login page.
    announce({ status: response.status, code: "redirected", path });
    throw new ApiRequestError(response.status, null, { code: "redirected", message: "the request was redirected, probably to a sign-in page" });
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      // Not AgentBoard's JSON: an HTML page from something in front of the Worker. Below 500 it may be a
      // sign-in page; a 5xx page is a gateway or Worker failure and says nothing about the session.
      if (response.status < 500) announce({ status: response.status, code: "unavailable", path });
      throw new ApiRequestError(response.status, null, { code: "unavailable", message: "the response was not AgentBoard JSON" });
    }
  }
  if (!response.ok) {
    // Recovery commands answer 409 with a ControlResponse body; let callers see it.
    if (response.status === 409 && parsed && typeof parsed === "object" && "accepted" in parsed) return parsed as T;
    const error = new ApiRequestError(response.status, isApiError(parsed) ? parsed : null);
    if (response.status === 401) announce({ status: 401, code: error.code, path });
    throw error;
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
