import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlResponse } from "../../../shared/api-types.ts";
import { apiError, reply } from "../../components/__tests__/api.ts";
import { snapshot } from "../../components/__tests__/fixtures.ts";
import { api, ApiRequestError } from "../client.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
