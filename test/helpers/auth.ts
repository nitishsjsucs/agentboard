import { env } from "cloudflare:workers";
import { importJWK, SignJWT, type JWTPayload } from "jose";
import { claimsForPrincipal } from "../../src/worker/auth/principal.ts";

export const DEV_ISSUER = "https://agentboard-dev.local";
export const DEV_AUDIENCE = "agentboard-dev";

export const P = {
  viewer: "viewer.ana@agentboard.test",
  viewer2: "viewer.ben@agentboard.test",
  operator: "ops.lead@agentboard.test",
  operator2: "ops.kim@agentboard.test",
  operator3: "ops.raj@agentboard.test",
  approver: "approver.lee@agentboard.test",
  approver2: "approver.mia@agentboard.test",
  admin: "admin@agentboard.test",
  service: "svc:agentboard-eval",
  unbound: "nobody@agentboard.test",
} as const;

/** Signs a dev-mode JWT with the per-run test key (TEST_ACCESS_PRIVATE_JWK). */
export async function signTestJwt(principal: string, overrides: JWTPayload & { expiresIn?: string } = {}): Promise<string> {
  const jwk = JSON.parse(env.TEST_ACCESS_PRIVATE_JWK) as Record<string, unknown>;
  const key = await importJWK(jwk as Parameters<typeof importJWK>[0], "RS256");
  const { expiresIn, ...claims } = overrides;
  return new SignJWT({ ...claimsForPrincipal(principal), ...claims })
    .setProtectedHeader({ alg: "RS256", kid: String(jwk["kid"]) })
    .setIssuer(typeof claims.iss === "string" ? claims.iss : DEV_ISSUER)
    .setAudience(claims.aud ?? DEV_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn ?? "1h")
    .sign(key);
}

/** Headers for an authenticated API call; mutations also need the CSRF header. */
export async function authHeaders(principal: string, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return { "Cf-Access-Jwt-Assertion": await signTestJwt(principal), ...extra };
}

export async function mutationHeaders(principal: string): Promise<Record<string, string>> {
  return authHeaders(principal, { "Content-Type": "application/json", "X-AgentBoard-Client": "web" });
}
