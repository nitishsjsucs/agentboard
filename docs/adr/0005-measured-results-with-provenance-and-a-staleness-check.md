# ADR 0005: Measured results with provenance and a staleness check

Status: accepted (2026-10-08)

## Context

This project exists to back specific claims (about 100 simulated runs, zero duplicate actions, about 100 orchestration and authorization tests, planner quality). Numbers typed into a README drift from the code the moment the code changes, and a number measured on an uncommitted tree cannot be reproduced by anyone. The simulation also needs to be deterministic enough to compare against an expected outcome, which a language model in the loop would prevent.

## Decision

- **Only scripts write numbers.** `eval:sim`, `eval:planner` and `count:tests` write JSON into `eval/results/`, each with provenance: git sha, a dirty flag over the measured paths, timestamp, Node and wrangler versions, seed, provider and model (and for the planner the llama.cpp build, GGUF, quantization and server flags). `results:render` rewrites the README block between `<!-- RESULTS:START -->` and `<!-- RESULTS:END -->` from those files; nobody edits it by hand.
- **CI refuses stale or unreproducible numbers.** `results:check` fails if the README block differs from what the JSON renders, if any result was measured on a dirty tree, or if `src`, `migrations`, `fixtures`, `scripts`, `wrangler.jsonc` or `package-lock.json` changed between the measured commit and HEAD. CI checks out the full history so the measured sha exists. `count:tests -- --check` also compares the tagged test count with the README.
- **Orchestration and planning are measured separately.** The 100-run simulation uses the deterministic stub planner, whose fixtures are generated from the dataset's gold plans, so its outcome distribution is fixed by the dataset design and `outcome_match` measures agreement with it. Planning quality is measured on its own by `eval:planner` against a local model, scored against the same gold plans.
- **Each number says where it came from.** The rendered block names the command, the date and the commit, labels local latencies as local, and reports production as "not measured" until something is deployed.

## Consequences

- A reader can rerun any number from a named commit, and a stale or hand-edited number fails CI.
- Any change under the measured paths, even one that cannot affect a number (a UI test, a stylesheet), makes `results:check` fail until all three measurements are taken again on a clean committed tree. Commits between such a change and the re-measurement are red on that one step; work is grouped so the head of each pull request is green.
- The simulation's success says nothing about model quality, and the planner score says nothing about orchestration; the README says both.
- Re-measuring the planner takes a local llama-server and roughly as long as 100 sequential plans, so changes under the measured paths have a real cost, which is intended.
