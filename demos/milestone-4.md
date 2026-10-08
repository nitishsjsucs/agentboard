# Milestone 4 demo: evaluation and release

What this milestone shows: one simulation driver used twice (in workerd by the test suite, and over HTTP against `wrangler dev` on the built worker), the planner evaluation against a local model, the tagged test count, and a README whose Results block is rendered from the measured JSON and checked in CI.

## Script

1. **Simulation in workerd.** `npm run test:sim`. All 100 synthetic requests go through the real API, identity, coordinator, local queue, agents and MCP tools; the test asserts 100 runs, the expected outcome for every run, valid hash chains, zero duplicate and logical-duplicate side effects, the approval counts and the recovery actions each scenario needs.
2. **Simulation against the built worker.** `npm run eval:sim` builds the worker, recreates local D1 state, starts `wrangler dev` on `127.0.0.1:8784` with an absolute `.dev.vars.eval`, refuses to continue unless `/api/health` reports `environment: "eval"`, drives the 100 runs over HTTP, and writes `eval/results/simulation.json`. The outcome distribution is fixed by the dataset design; outcome match is the measured agreement.
3. **Planner quality on a local model.** In one terminal: `AGENTBOARD_LLM_PORT=8140 npm run llm:serve` (Qwen3-1.7B Q4_0, one slot, 8192-token context, reasoning off). In another: `LLM_BASE_URL=http://127.0.0.1:8140 npm run eval:planner`. It plans the 100 requests one at a time and scores validity, policy violations, exact match, tool-set F1 and argument accuracy against the gold plans. `npm run eval:planner -- --provider stub` is a sanity run that must score 100%.
4. **Test count.** `npm run count:tests` lists the 61 orchestration and 39 authorization tests by tag, runs them and writes `eval/results/tests.json`.
5. **Results.** `npm run results:render` rewrites the README block from the JSON; `npm run results:check` (in CI) fails if the block differs, if a result was measured on a dirty tree, or if measured code changed after the measurement.
