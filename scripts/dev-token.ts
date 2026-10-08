// npm run dev:token -- --principal ops.lead@agentboard.test
// Prints a dev-mode Access JWT for curl (header Cf-Access-Jwt-Assertion).
import { importJWK, SignJWT } from "jose";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readDevVars } from "./lib/dev-vars.ts";

const { values } = parseArgs({
  options: {
    principal: { type: "string" },
    hours: { type: "string", default: "12" },
    issuer: { type: "string", default: "https://agentboard-dev.local" },
    audience: { type: "string", default: "agentboard-dev" },
  },
});
if (!values.principal) {
  console.error("usage: npm run dev:token -- --principal <email or svc:name>");
  process.exit(1);
}
const vars = readDevVars(fileURLToPath(new URL("../.dev.vars", import.meta.url)));
const jwk = JSON.parse(vars["DEV_ACCESS_PRIVATE_JWK"] ?? "null") as Record<string, unknown> | null;
if (!jwk) {
  console.error("DEV_ACCESS_PRIVATE_JWK missing; run npm run dev:keys");
  process.exit(1);
}
const principal = values.principal.toLowerCase();
const claims = principal.startsWith("svc:") ? { common_name: principal.slice(4), sub: "" } : { email: principal, sub: principal };
const token = await new SignJWT(claims)
  .setProtectedHeader({ alg: "RS256", kid: String(jwk["kid"] ?? "dev") })
  .setIssuer(values.issuer)
  .setAudience(values.audience)
  .setIssuedAt()
  .setExpirationTime(`${Number(values.hours)}h`)
  .sign(await importJWK(jwk as Parameters<typeof importJWK>[0], "RS256"));
console.log(token);
