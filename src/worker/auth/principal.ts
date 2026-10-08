import type { JWTPayload } from "jose";

export interface Principal {
  kind: "user" | "service";
  /** Lowercase email for users, `svc:<common_name>` for Access service tokens. */
  id: string;
  email: string | null;
}

/** Maps verified Access claims to a principal. Emails and service names are lowercased (SPEC section 10.2). */
export function principalFromClaims(claims: JWTPayload): Principal | null {
  const email = typeof claims["email"] === "string" ? claims["email"].trim().toLowerCase() : "";
  if (email) return { kind: "user", id: email, email };
  const commonName = typeof claims["common_name"] === "string" ? claims["common_name"].trim().toLowerCase() : "";
  if (commonName) return { kind: "service", id: `svc:${commonName}`, email: null };
  return null;
}

/** Claims a dev or test JWT carries for a principal id. */
export function claimsForPrincipal(principalId: string): Record<string, string> {
  const id = principalId.toLowerCase();
  return id.startsWith("svc:") ? { common_name: id.slice(4), sub: "" } : { email: id, sub: id };
}
