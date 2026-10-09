// npm run dev:token -- --principal ops.lead@agentboard.test
// Prints a dev-mode Access JWT for curl (header Cf-Access-Jwt-Assertion).
//
// npm run dev:token -- --integration --tool hris.get_employee --args '{"employeeId":"E-1001"}'
// Prints an integration token for MCP Inspector against the dev-only /mcp
// route (MCP_EXTERNAL=on): bound to one read tool and its exact arguments, with
// a 60 s pseudo-lease (SPEC section 10.4).
import { importJWK, SignJWT } from "jose";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { signIntegrationToken, type IntegrationClaimInput } from "../src/worker/auth/integration-tokens.ts";
import { inspectorReadClaims } from "../src/worker/mcp/inspector-token.ts";
import { readDevVars } from "./lib/dev-vars.ts";

const { values } = parseArgs({
  options: {
    principal: { type: "string" },
    hours: { type: "string", default: "12" },
    issuer: { type: "string", default: "https://agentboard-dev.local" },
    audience: { type: "string", default: "agentboard-dev" },
    integration: { type: "boolean", default: false },
    tool: { type: "string" },
    args: { type: "string" },
  },
});
const vars = readDevVars(fileURLToPath(new URL("../.dev.vars", import.meta.url)));

if (values.integration) {
  if (!values.tool || values.args === undefined) {
    console.error('usage: npm run dev:token -- --integration --tool <read tool> --args \'{"employeeId":"E-1001"}\'');
    process.exit(1);
  }
  const key = Buffer.from(vars["INTEGRATION_SIGNING_KEY"] ?? "", "base64");
  if (key.length < 32) {
    console.error("INTEGRATION_SIGNING_KEY missing or shorter than 32 bytes; run npm run dev:keys");
    process.exit(1);
  }
  let claims: IntegrationClaimInput;
  try {
    claims = inspectorReadClaims(values.tool, JSON.parse(values.args) as unknown);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  console.log(await signIntegrationToken(claims, new Uint8Array(key)));
  console.error(`Valid for 60 s, for ${values.tool} with exactly these arguments, at http://127.0.0.1:<port>/mcp with MCP_EXTERNAL=on (development only).`);
  process.exit(0);
}

if (!values.principal) {
  console.error("usage: npm run dev:token -- --principal <email or svc:name>");
  process.exit(1);
}
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
