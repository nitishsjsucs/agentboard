import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlResponse } from "../../../shared/api-types.ts";
import { apiError, opaqueRedirect, reply } from "../../components/__tests__/api.ts";
import { snapshot } from "../../components/__tests__/fixtures.ts";
import { api, ApiRequestError, sessionEvents, type SessionProblem } from "../client.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Collects the session problems announced while `run` runs. */
async function announced(run: () => Promise<unknown>): Promise<SessionProblem[]> {
  const seen: SessionProblem[] = [];
  const listener = (event: Event) => seen.push((event as CustomEvent<SessionProblem>).detail);
  sessionEvents.addEventListener("problem", listener);
  try {
    await run().catch(() => undefined);
  } finally {
    sessionEvents.removeEventListener("problem", listener);
  }
  return seen;
}

async function rejection(promise: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiRequestError);
    return error as ApiRequestError;
  }
  throw new Error("expected a rejection");
}

describe("api client", { tags: ["ui"] }, () => {
  it("turns a non-JSON body (an HTML login or error page) into code unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><body>Sign in with Cloudflare Access</body></html>", { status: 200 })));
    const error = await rejection(api.get("/api/runs"));
    expect(error.code).toBe("unavailable");
    expect(error.message).not.toContain("Unexpected token");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 })));
    expect((await rejection(api.get("/api/runs"))).code).toBe("unavailable");
  });

  it("does not follow redirects, and turns one (Access sending an expired session to its login page) into an announced code redirected", async () => {
    const fetch = vi.fn(async () => opaqueRedirect());
    vi.stubGlobal("fetch", fetch);
    const problems = await announced(async () => {
      const error = await rejection(api.post("/api/runs", { x: 1 }));
      expect(error.code).toBe("redirected");
      expect(error.status).toBe(0);
    });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("manual");
    expect(problems).toEqual([{ status: 0, code: "redirected", path: "/api/runs" }]);

    // A runtime that exposes the 3xx itself (not a browser) is treated the same way.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/x" } })));
    expect(await announced(() => api.get("/api/me"))).toEqual([{ status: 302, code: "redirected", path: "/api/me" }]);
  });

  it("announces an HTML page below 500 as a possible session end, but not a 5xx error page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html><title>Sign in</title>", { status: 200 })));
    expect(await announced(() => api.get("/api/runs"))).toEqual([{ status: 200, code: "unavailable", path: "/api/runs" }]);
    for (const status of [500, 502, 503]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Error 1102: Worker exceeded resource limits</html>", { status })));
      expect(await announced(() => api.get("/api/runs"))).toEqual([]);
    }
  });

  it("turns a rejected fetch into code network with status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const error = await rejection(api.post("/api/runs", { x: 1 }));
    expect(error.code).toBe("network");
    expect(error.status).toBe(0);
  });

  it("still returns a 409 ControlResponse body to the caller", async () => {
    const body: ControlResponse = { accepted: false, reason: "invalid_state", snapshot: snapshot() };
    vi.stubGlobal("fetch", vi.fn(async () => reply(body, 409)));
    await expect(api.post("/api/runs/run_x/pause", { reason: "check" })).resolves.toEqual(body);
  });

  it("keeps the server's code, reason and request id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => apiError(409, "conflict", "decision refused: already_decided", "already_decided", "req-42")));
    const error = await rejection(api.post("/api/approvals/apr_x/decision", { decision: "approve", note: "fine" }));
    expect(error.status).toBe(409);
    expect(error.code).toBe("conflict");
    expect(error.reason).toBe("already_decided");
    expect(error.requestId).toBe("req-42");
  });

  it("returns null for an empty successful body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    await expect(api.get("/api/anything")).resolves.toBeNull();
  });
});
