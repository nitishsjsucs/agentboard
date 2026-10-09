import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import assetHeaders from "../../../public/_headers?raw";
import { authHeaders, P } from "../../helpers/auth.ts";

const MUTATIONS: [string, string][] = [
  ["POST", "/api/runs"],
  ["POST", "/api/runs/run_01J00000000000000000000000/pause"],
  ["POST", "/api/approvals/apr_01J00000000000000000000000/decision"],
  ["PATCH", "/api/runs/run_01J00000000000000000000000/budget"],
  ["POST", "/api/dev/login"],
];

function corsHeaders(response: Response): string[] {
  return [...response.headers.keys()].filter((name) => name.toLowerCase().startsWith("access-control-"));
}

describe("CSRF guard", { tags: ["authz"] }, () => {
  it("refuses a mutation without X-AgentBoard-Client (or without a JSON content type) with 403", async () => {
    for (const [method, path] of MUTATIONS) {
      const base = await authHeaders(P.admin);
      const noClient = await exports.default.fetch(`http://127.0.0.1${path}`, {
        method,
        headers: { ...base, "Content-Type": "application/json" },
        body: JSON.stringify({ principal: P.admin, reason: "csrf probe" }),
      });
      expect(noClient.status, `${method} ${path}`).toBe(403);
      expect(await noClient.json(), `${method} ${path}`).toMatchObject({ error: { code: "forbidden", reason: "csrf_header" } });

      const formPost = await exports.default.fetch(`http://127.0.0.1${path}`, {
        method,
        headers: { ...base, "X-AgentBoard-Client": "web", "Content-Type": "application/x-www-form-urlencoded" },
        body: "principal=admin%40agentboard.test",
      });
      expect(formPost.status, `${method} ${path} form`).toBe(403);
    }
    // A GET needs no CSRF header.
    const read = await exports.default.fetch("http://127.0.0.1/api/me", { headers: await authHeaders(P.viewer) });
    expect(read.status).toBe(200);
  });

  it("refuses a mutation with a foreign Origin, /api never emits CORS headers, and neither /api nor the static assets may be framed", async () => {
    const headers = { ...(await authHeaders(P.admin)), "Content-Type": "application/json", "X-AgentBoard-Client": "web" };
    const foreign = await exports.default.fetch("http://127.0.0.1/api/dev/login", {
      method: "POST",
      headers: { ...headers, Origin: "https://evil.example" },
      body: JSON.stringify({ principal: P.admin }),
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: { reason: "csrf_origin" } });
    expect(corsHeaders(foreign)).toEqual([]);

    // An allowed origin passes the guard (dev login on loopback then succeeds).
    const allowed = await exports.default.fetch("http://127.0.0.1/api/dev/login", {
      method: "POST",
      headers: { ...headers, Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ principal: P.admin }),
    });
    expect(allowed.status).toBe(200);
    expect(corsHeaders(allowed)).toEqual([]);

    // A preflight gets no CORS headers either, so a cross-site browser can never send the mutation.
    const preflight = await exports.default.fetch("http://127.0.0.1/api/runs", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-agentboard-client,content-type" },
    });
    expect(corsHeaders(preflight)).toEqual([]);
    for (const path of ["/api/health", "/api/me", "/api/nope"]) {
      const response = await exports.default.fetch(`http://127.0.0.1${path}`, { headers: { ...(await authHeaders(P.viewer)), Origin: "https://evil.example" } });
      expect(corsHeaders(response), path).toEqual([]);
    }

    // Anti-framing (clickjacking of the approval and recovery buttons): every /api answer, errors included,
    // and the static assets through public/_headers (Workers Static Assets applies it to the SPA shell).
    for (const response of [foreign, allowed, await exports.default.fetch("http://127.0.0.1/api/me", { headers: await authHeaders(P.viewer) }), await exports.default.fetch("http://127.0.0.1/api/nope", { headers: await authHeaders(P.viewer) })]) {
      expect(response.headers.get("x-frame-options"), response.url).toBe("DENY");
      expect(response.headers.get("content-security-policy"), response.url).toContain("frame-ancestors 'none'");
      expect(response.headers.get("x-content-type-options"), response.url).toBe("nosniff");
      expect(response.headers.get("referrer-policy"), response.url).toBe("no-referrer");
    }
    const rules = assetHeaders.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#"));
    expect(rules[0]).toBe("/*");
    expect(rules.slice(1).map((line) => line.trim())).toEqual(
      expect.arrayContaining([
        "X-Frame-Options: DENY",
        expect.stringMatching(/^Content-Security-Policy: default-src 'self';.*frame-ancestors 'none'$/),
        "X-Content-Type-Options: nosniff",
        "Referrer-Policy: no-referrer",
      ]),
    );
  });
});
