// Call-bound HS256 integration tokens (SPEC section 10.4). Minted only by the
// coordinator after a lease grant; verified by the People Ops MCP endpoint and
// checked again inside every tool handler.

import { jwtVerify, SignJWT } from "jose";

export const INTEGRATION_ISSUER = "agentboard";
export const INTEGRATION_AUDIENCE = "people-ops-mcp";

export type IntegrationKind = "executor" | "verifier" | "planner";

export interface IntegrationClaims {
  iss: string;
  aud: string;
  /** Agent instance, for example executor-1. */
  sub: string;
  kind: IntegrationKind;
  jti: string;
  iat: number;
  exp: number;
  run_id: string;
  task_id: string;
  epoch: number;
  /** Lease expiry in epoch ms; the endpoint refuses the token at or after it. */
  lease_exp_ms: number;
  scope: string;
  step_id?: string;
  // executor
  tool?: string;
  args_sha256?: string;
  idem_key?: string;
  // verifier
  tools?: string[];
  subject?: string;
  refs?: string[];
}

export type IntegrationClaimInput = Omit<IntegrationClaims, "iss" | "aud" | "jti" | "iat" | "exp">;

export async function signIntegrationToken(input: IntegrationClaimInput, key: Uint8Array, nowMs: number = Date.now()): Promise<string> {
  const { sub, ...rest } = input;
  return new SignJWT({ ...rest })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(INTEGRATION_ISSUER)
    .setAudience(INTEGRATION_AUDIENCE)
    .setSubject(sub)
    .setJti(crypto.randomUUID())
    .setIssuedAt(Math.floor(nowMs / 1000))
    // Integer seconds, rounded up, so jose never rejects a token that is valid for its lease.
    .setExpirationTime(Math.ceil(input.lease_exp_ms / 1000))
    .sign(key);
}

export async function verifyIntegrationToken(token: string, key: Uint8Array): Promise<IntegrationClaims> {
  const { payload } = await jwtVerify(token, key, {
    issuer: INTEGRATION_ISSUER,
    audience: INTEGRATION_AUDIENCE,
    algorithms: ["HS256"],
  });
  const claims = payload as unknown as IntegrationClaims;
  if (typeof claims.lease_exp_ms !== "number" || typeof claims.kind !== "string" || typeof claims.run_id !== "string" || typeof claims.task_id !== "string") {
    throw new Error("integration token is missing required claims");
  }
  return claims;
}
