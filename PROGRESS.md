# AgentBoard build progress

Source of truth for the design: `SPEC.md` (revision 2). This file tracks where the build is in the commit plan (SPEC section 19), the exact check status, and every deviation from the spec with its reason. A later builder continues from here.

## Commit plan position

| # | Commit | Status |
|---|---|---|
| 1 | chore: pin toolchain and gate it with strict tsc and workerd smoke tests | done |

Next: commit 2 (`chore: Vite 8 React 19 app with the Cloudflare Vite plugin, Hono worker, wrangler environments and generated types`).

## Check status (last run)

- `npm run typecheck`: pass
- `npm test`: pass (2 files, 3 tests: toolchain gate in `worker` and `worker-ws`)
- `npm run build`: not yet defined (commit 2)

## Deviations from SPEC.md

1. **Test entry module.** The toolchain gate needs an Agent with a `schedule()` callback and WebSocket state before any production agent exists. Instead of adding a probe class to the production worker, `vitest.config.ts` sets the plugin's `main` to `test/helpers/test-worker.ts`, which re-exports the production worker and adds a test-only `ToolchainProbe` agent (bound through `miniflare.durableObjects`, routed under `/__probe/*`). Production code never imports it. Files not in the SPEC layout: `test/helpers/test-worker.ts`, `test/helpers/probe-agent.ts`.
2. **`tsconfig.web.json` arrives with commit 2.** TypeScript refuses a project with no input files, and `src/web` does not exist until commit 2.
