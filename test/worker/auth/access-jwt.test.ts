// Runs in the worker-access project: AUTH_MODE=access, team domain
// https://agentboard-test.cloudflareaccess.com, no dev JWKS. The remote JWKS
// fetch is intercepted, so this exercises the production verification path.
import { exports } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEAM = "https://agentboard-test.cloudflareaccess.com";
const AUD = "agentboard-test-aud";
const CERTS = `${TEAM}/cdn-cgi/access/certs`;

let accessKey: CryptoKey;
let rogueKey: CryptoKey;
let certFetches = 0;

beforeAll(async () => {
  const access = await generateKeyPair("RS256", { extractable: true });
  const rogue = await generateKeyPair("RS256", { extractable: true });
  accessKey = access.privateKey;
  rogueKey = rogue.privateKey;
  const publicJwk = { ...(await exportJWK(access.publicKey)), kid: "access-key", alg: "RS256", use: "sig" };
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === CERTS) {
      certFetches += 1;
      return Response.json({ keys: [publicJwk] });
    }
    return realFetch(input, init);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

async function accessJwt(claims: JWTPayload, opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: number | string } = {}): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "access-key" })
    .setIssuer(opts.iss ?? TEAM)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "10m")
    .sign(opts.key ?? accessKey);
}

async function me(headers: Record<string, string>): Promise<Response> {
  return exports.default.fetch("http://agentboard.test/api/me", { headers });
}

describe("Access JWT verification (access mode)", { tags: ["authz"] }, () => {
  it("accepts a valid Access JWT in Cf-Access-Jwt-Assertion with a bound role; a mixed-case email matches its lowercase binding", async () => {
    const response = await me({ "Cf-Access-Jwt-Assertion": await accessJwt({ email: "Ops.Lead@AgentBoard.TEST", sub: "u1" }) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { principal: { id: string; kind: string }; role: string; authMode: string };
    expect(body.principal).toMatchObject({ kind: "user", id: "ops.lead@agentboard.test" });
    expect(body.role).toBe("operator");
    expect(body.authMode).toBe("access");
    expect(certFetches).toBeGreaterThanOrEqual(1);
  });

  it("returns 401 when the token is missing", async () => {
    const response = await me({});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("returns 401 for a signature from an unknown key", async () => {
    const response = await me({ "Cf-Access-Jwt-Assertion": await accessJwt({ email: "ops.lead@agentboard.test" }, { key: rogueKey }) });
    expect(response.status).toBe(401);
  });

  it("returns 401 for a wrong audience or a wrong issuer", async () => {
    const wrongAud = await accessJwt({ email: "ops.lead@agentboard.test" }, { aud: "some-other-app" });
    const wrongIss = await accessJwt({ email: "ops.lead@agentboard.test" }, { iss: "https://evil.cloudflareaccess.com" });
    expect((await me({ "Cf-Access-Jwt-Assertion": wrongAud })).status).toBe(401);
    expect((await me({ "Cf-Access-Jwt-Assertion": wrongIss })).status).toBe(401);
  });

  it("returns 401 for an expired token (beyond the 30 s clock tolerance)", async () => {
    const expired = await accessJwt({ email: "ops.lead@agentboard.test", iat: Math.floor(Date.now() / 1000) - 600 }, { exp: Math.floor(Date.now() / 1000) - 120 });
    expect((await me({ "Cf-Access-Jwt-Assertion": expired })).status).toBe(401);
  });

  it("does not accept the CF_Authorization cookie alone in access mode", async () => {
    const token = await accessJwt({ email: "ops.lead@agentboard.test" });
    expect((await me({ Cookie: `CF_Authorization=${token}` })).status).toBe(401);
    // The same token in the header is accepted, so the refusal is about the source.
    expect((await me({ "Cf-Access-Jwt-Assertion": token })).status).toBe(200);
  });

  it("maps an Access service token (common_name) to its svc: binding", async () => {
    const token = await accessJwt({ common_name: "AgentBoard-Eval", sub: "" });
    const response = await me({ "Cf-Access-Jwt-Assertion": token });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ principal: { kind: "service", id: "svc:agentboard-eval", email: null }, role: "operator" });
  });
});
