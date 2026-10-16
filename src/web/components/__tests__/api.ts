import { vi } from "vitest";

/** A JSON response, as the worker sends it. */
export function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** An ApiError body (SPEC section 9.1). */
export function apiError(status: number, code: string, message: string, reason?: string, requestId = "req-test-1"): Response {
  return reply({ error: { code, message, requestId, ...(reason ? { reason } : {}) } }, status);
}

export interface SeenRequest {
  method: string;
  path: string;
  body: unknown;
  rawBody: string | undefined;
}

export type Handler = (request: SeenRequest) => Response | Promise<Response> | undefined;

/**
 * Stubs global fetch with `handler`; an unhandled request answers 404. Every request is recorded in
 * `seen`, with its JSON body parsed and the raw body kept for byte-for-byte comparisons.
 */
export function stubApi(handler: Handler) {
  const seen: SeenRequest[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const request: SeenRequest = { method: init?.method ?? "GET", path: String(input), body: rawBody ? (JSON.parse(rawBody) as unknown) : undefined, rawBody };
    seen.push(request);
    const response = await handler(request);
    return response ?? apiError(404, "not_found", "no such route");
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, seen, paths: () => seen.map((s) => s.path) };
}

/** A promise that never settles: a request still in flight. */
export function pending(): Promise<Response> {
  return new Promise<Response>(() => undefined);
}
