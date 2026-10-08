# Milestone 1 demo: foundations

What this milestone shows: the pinned toolchain running in workerd, the seeded synthetic People dataset, fail-closed configuration and the identity layer (Access JWT verification, dev keys, loopback-only dev login, permissions and the CSRF guard).

## Script

1. **Toolchain gate.** `npm test -- --project worker test/worker/toolchain.test.ts`. Forty concurrent Durable Object RPCs append to a `node:crypto` hash chain inside `transactionSync` and the chain re-verifies; a one-shot `schedule()` wake fires at the ceiling second.
2. **Synthetic data.** `npm run synth:check` regenerates the dataset in memory and compares bytes. Open `fixtures/synthetic/dataset.v1.json`: 100 run requests (20 address changes, 15 manager changes, 20 onboardings, 15 privileged grants, 15 offboardings, 15 revocations), 60 fictional employees, 9 console principals. `generator.test.ts` checks every count and validates each gold plan against the planner's allowlists and subject pinning.
3. **Fail closed.** In `dev-mode.test.ts`, a production configuration with dev auth, fault injection, an external MCP route, a stub LLM, a short signing key or a broken lease timing invariant answers `500 misconfigured` on every path and retries every queue message.
4. **Identity.** `npm run dev:keys`, `npm run db:migrate:local && npm run db:seed:local`, `npm run dev`, then:
   - `curl -s http://127.0.0.1:5173/api/health`
   - `curl -s -H "Cf-Access-Jwt-Assertion: $(npm run -s dev:token -- --principal ops.lead@agentboard.test)" http://127.0.0.1:5173/api/me` shows role `operator` and its permissions.
   - `curl -s -X POST -H 'Content-Type: application/json' http://127.0.0.1:5173/api/dev/login -d '{"principal":"admin@agentboard.test"}'` is refused with 403 by the CSRF guard (no `X-AgentBoard-Client` header).
5. **Access mode.** `access-jwt.test.ts` runs the production verification path against an intercepted team JWKS: wrong audience, wrong issuer, unknown key, expiry and cookie-only requests are all 401; a service token maps to `svc:agentboard-eval`.
