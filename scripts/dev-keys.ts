// npm run dev:keys: writes .dev.vars with an RS256 dev keypair (public JWKS and
// private JWK, for dev-mode Access JWTs) and an HS256 integration signing key.
// Refuses to overwrite an existing .dev.vars unless --force is given.
import { exportJWK, generateKeyPair } from "jose";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../.dev.vars", import.meta.url));
if (existsSync(target) && !process.argv.includes("--force")) {
  console.error(".dev.vars already exists; pass --force to replace it");
  process.exit(1);
}
const kid = `dev-${new Date().toISOString().slice(0, 10)}`;
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: "RS256" };
const lines = [
  "# Written by npm run dev:keys. Local development only; never commit.",
  `INTEGRATION_SIGNING_KEY=${randomBytes(48).toString("base64")}`,
  `ACCESS_DEV_JWKS=${JSON.stringify({ keys: [publicJwk] })}`,
  `DEV_ACCESS_PRIVATE_JWK=${JSON.stringify(privateJwk)}`,
  "",
];
writeFileSync(target, lines.join("\n"), { mode: 0o600 });
console.log(`wrote .dev.vars (kid ${kid})`);
