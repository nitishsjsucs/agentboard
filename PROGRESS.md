# AgentBoard build progress

Source of truth for the design: `SPEC.md` (revision 2). This file tracks where the build is in the commit plan (SPEC section 19), the exact check status, and every deviation from the spec with its reason. A later builder continues from here.

## Commit plan position

| # | Commit | Status |
|---|---|---|
| 1 | chore: pin toolchain and gate it with strict tsc and workerd smoke tests | done |
| 2 | chore: Vite 8 React 19 app with the Cloudflare Vite plugin, Hono worker, wrangler environments and generated types | done |
| 3 | feat(db): console and people D1 migrations | done |
| 4 | feat(synth): seeded generator for 100 runs, 60 employees and 9 principals with checksum | done |
| 5 | feat(config): fail-closed config loader with timing invariants | done |
| 6 | feat(auth): Access JWT verification with local RS256 dev keys and loopback-only dev login | done |
| 7 | feat(auth): permissions, CSRF guard, /api/me and /api/health | done |

Next: commit 8 (`docs: README skeleton, CONTEXT.md and milestone 1 demo script`).

## Check status (last run)

- `npm run typecheck`: pass
- `npm test`: pass (projects worker, worker-ws, worker-access, node; 7 files, 23 tests)
- `npm run synth:check`: pass
- `npm run types:check`: pass
- `npm run build`: pass

## Deviations from SPEC.md

1. **Test entry module.** The toolchain gate needs an Agent with a `schedule()` callback and WebSocket state before any production agent exists. Instead of adding a probe class to the production worker, `vitest.config.ts` sets the plugin's `main` to `test/helpers/test-worker.ts`, which re-exports the production worker and adds a test-only `ToolchainProbe` agent (bound through `miniflare.durableObjects`, routed under `/__probe/*`). Production code never imports it. Files not in the SPEC layout: `test/helpers/test-worker.ts`, `test/helpers/probe-agent.ts`.
2. **`tsconfig.web.json` arrived with commit 2**, not commit 1: TypeScript refuses a project with no input files, and `src/web` did not exist before commit 2.
3. **Port 8784 instead of 8788.** This machine shares ports with other builds, so the built worker (`serve:built`, `eval:sim`) listens on `127.0.0.1:8784`, and the dev `ALLOWED_ORIGINS` lists `http://127.0.0.1:8784`. The Vite plugin's inspector is pinned to 9234 for the same reason.
4. **Skeleton agent classes in commit 2.** `wrangler.jsonc` declares all four Durable Object classes from commit 2 so its shape (one `v1` migration tag) never changes; the classes are empty `Agent` subclasses until their commits. The queue handler retries every message (fails closed) until the consumer lands in commit 13.
5. **Production worker name.** Wrangler names the `production` environment's worker `agentboard-production` (it appends the environment name), so the production `ALLOWED_ORIGINS` placeholder is `https://agentboard-production.<subdomain>.workers.dev`. Keeping the suffix means an accidental top-level deploy can never overwrite the production script.
6. **Plan validator, tool registry, policy and materializer landed in commit 4.** `generator.test.ts` #4 must check the gold plans against the section 11.3 validator, so the pure modules `src/worker/planning/tool-registry.ts`, `policy.ts`, `materialize.ts` and the `validatePlan` part of `planner.ts` were written with the generator. Commit 9 wires `materialize.ts` into the coordinator and commit 17 adds the prompt, parse and repair loop to `planner.ts`.
7. **Synthetic dataset design choices the spec leaves open** (all within section 12.1): onboarding and offboarding subjects come from exclusive pools (an offboarded subject never reappears; onboarding subjects are `pending_start`), the 15 access-revocation subjects are distinct and revoke a seeded baseline role, `budget_exhausted` and `silent_noop` go only to approval-free runs, and the gold plans are linear chains whose first write is always `s2` (so `checkpointStep = "s2"` parks every pause/cancel run before any write).
8. **`wrangler types` reads `.dev.vars.example`.** `npm run types` and `types:check` pass `--env-file .dev.vars.example`, so the generated `Env` declares the three secrets (`INTEGRATION_SIGNING_KEY`, `ACCESS_DEV_JWKS`, `DEV_ACCESS_PRIVATE_JWK`) and never depends on a developer's local `.dev.vars` (which would make CI's check fail).
9. **Config bounds.** Section 5.2 says numeric vars are positive integers, but the test project itself sets `RETRY_BASE_DELAY_S=0` and `AGENT_CONTROLS_CACHE_MS=0`, so those two accept 0. `INTEGRATION_SIGNING_KEY` (at least 32 bytes) is required in every environment, not only production, because tokens are minted everywhere. `MCP_EXTERNAL=on` is refused outside `development` (section 3.1).
10. **`access-jwt.test.ts` #7 lands with commit 23.** "A valid token for an unbound email gets 403 everywhere except `/api/me`" needs the permission-gated run, approval, search, agent and DLQ routes, which arrive in commit 23. Until then the file has the other 7 tests. `/api/me` is implemented in commit 6 (not 7) because the Access and dev-login tests assert through it.
11. **Small helper files not in the layout:** `src/worker/api/types.ts` (Hono env and `Identity` types) and `scripts/lib/dev-vars.ts` (reads `.dev.vars` for `dev:token`).
12. **Empty dev secrets count as absent.** The vitest plugin loads a developer's local `.dev.vars`; the `worker-access` project sets `ACCESS_DEV_JWKS` and `DEV_ACCESS_PRIVATE_JWK` to empty strings so its tests are hermetic, and `parseConfig` treats an empty secret as absent.
