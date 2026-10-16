import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, opaqueRedirect } from "../../components/__tests__/api.ts";
import { me } from "../../components/__tests__/session.tsx";
import { api, ApiRequestError } from "../client.ts";
import { describeError, MESSAGES } from "../describeError.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The error the client throws for one canned response. */
async function failure(response: Response | (() => Promise<Response>)): Promise<unknown> {
  vi.stubGlobal("fetch", vi.fn(typeof response === "function" ? response : async () => response));
  try {
    await api.get("/api/anything");
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to fail");
}

describe("describeError", { tags: ["ui"] }, () => {
  it("says a 401 means the session ended", async () => {
    expect(describeError(await failure(apiError(401, "unauthenticated", "missing Access token")))).toEqual({ message: MESSAGES.sessionEnded });
  });

  it("names the role and the action for a 403 missing_permission, with a generic fallback, and never the permission name", async () => {
    const error = await failure(apiError(403, "forbidden", "requires runs:launch", "missing_permission"));
    expect(describeError(error, { me: me("approver"), action: "launch runs" }).message).toBe("Your role (approver) cannot launch runs.");
    expect(describeError(error, { me: me("viewer") }).message).toBe("Your role (viewer) cannot do this.");
    expect(describeError(error).message).toBe("Your role cannot do this.");
    expect(JSON.stringify(describeError(error, { me: me("viewer") }))).not.toContain("requires");
  });

  it("tells a principal without a role binding who they are signed in as and whom to ask", async () => {
    const error = await failure(apiError(403, "forbidden", "requires runs:read", "no_role_binding"));
    const principal = { ...me("viewer", "new.hire@example.test"), role: null, permissions: [] };
    expect(describeError(error, { me: principal })).toEqual({
      message: "You are signed in as new.hire@example.test but have no AgentBoard role.",
      next: "Ask an admin to add a role binding.",
    });
  });

  it("explains a self-approval refusal", async () => {
    expect(describeError(await failure(apiError(403, "forbidden", "decision refused: self_approval", "self_approval"))).message).toBe(MESSAGES.selfApproval);
  });

  it("explains a 404", async () => {
    expect(describeError(await failure(apiError(404, "not_found", "no such run"))).message).toBe(MESSAGES.notFound);
  });

  it("explains a decision refused because the approval was already decided or expired", async () => {
    for (const reason of ["already_decided", "expired"]) {
      const description = describeError(await failure(apiError(409, "conflict", `decision refused: ${reason}`, reason)));
      expect(description.message).toBe(MESSAGES.alreadyDecided);
      expect(description.message).not.toContain("decision refused");
      expect(description.message).not.toContain("_");
    }
  });

  it("explains an idempotency conflict", async () => {
    const error = await failure(apiError(409, "conflict", "clientRequestId was used with a different request", "idempotency_conflict"));
    expect(describeError(error).message).toBe(MESSAGES.idempotencyConflict);
  });

  it("replaces zod output for a 400 invalid_request", async () => {
    const zod = '✖ Invalid option: expected one of "queued"|"planning"\n  → at status';
    const description = describeError(await failure(apiError(400, "invalid_request", zod)));
    expect(description.message).toBe(MESSAGES.invalidRequest);
    expect(JSON.stringify(description)).not.toContain("Invalid option");
  });

  it("turns a rejected fetch into the network message instead of 'Failed to fetch'", async () => {
    const error = await failure(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(describeError(error)).toEqual({ message: MESSAGES.network });
    // A TypeError that reaches a page by another path reads the same.
    expect(describeError(new TypeError("Failed to fetch"))).toEqual({ message: MESSAGES.network });
  });

  it("turns an HTML page with status 200 into the unexpected-response message instead of a JSON parse error", async () => {
    const error = await failure(new Response("<!doctype html><title>Sign in</title>", { status: 200, headers: { "Content-Type": "text/html" } }));
    expect(describeError(error)).toEqual({ message: MESSAGES.unavailable });
    expect(describeError(new SyntaxError("Unexpected token '<'"))).toEqual({ message: MESSAGES.unavailable });
  });

  it("says a redirect probably means a sign-in page, and calls a 5xx HTML page a server failure, not a session end", async () => {
    expect(describeError(await failure(opaqueRedirect()))).toEqual({ message: MESSAGES.redirected });
    expect(describeError(await failure(new Response("<html>Error 1102</html>", { status: 503, headers: { "Content-Type": "text/html" } })))).toEqual({ message: MESSAGES.server });
    // A 401 sign-in page reads as an ended session even though its body is HTML.
    expect(describeError(await failure(new Response("<html>Sign in</html>", { status: 401 })))).toEqual({ message: MESSAGES.sessionEnded });
  });

  it("keeps the request id for a 500 and leaves it out for 4xx", async () => {
    expect(describeError(await failure(apiError(500, "internal", "internal error", undefined, "8c1f2a3b4c5d6e7f-SJC")))).toEqual({
      message: MESSAGES.server,
      requestId: "8c1f2a3b4c5d6e7f-SJC",
    });
    expect(describeError(await failure(apiError(404, "not_found", "no such run", undefined, "abc"))).requestId).toBeUndefined();
    expect(describeError(await failure(apiError(409, "conflict", "x", "already_decided", "abc"))).requestId).toBeUndefined();
  });

  it("passes through messages the console writes itself", () => {
    expect(describeError(new Error("run is not paused")).message).toBe("run is not paused");
    expect(describeError(new ApiRequestError(502, null)).message).toBe(MESSAGES.server);
  });
});
