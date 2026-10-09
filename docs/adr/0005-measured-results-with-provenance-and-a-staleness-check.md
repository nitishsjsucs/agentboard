# ADR 0005: Measured results with provenance and a staleness check

Status: accepted (2026-10-08)

## Context

This project exists to back specific claims (about 100 simulated runs, zero duplicate actions, about 100 orchestration and authorization tests, planner quality). Numbers typed into a README drift from the code the moment the code changes, and a number measured on an uncommitted tree cannot be reproduced by anyone. The simulation also needs to be deterministic enough to compare against an expected outcome, which a language model in the loop would prevent.

## Decision

- **Only scripts write numbers.** `eval:sim`, `eval:planner` and `count:tests` write JSON into `eval/results/`, each with provenance: git sha, a dirty flag over the measured paths, timestamp, Node and wrangler versions, seed, provider and model (and for the planner the llama.cpp build, model file, slot context and slot count read back from the answering server's `/props`, the quantization parsed from that file name, and the operator-reported launch flags; the eval refuses to measure a server that is not serving the recorded model in one 8192-token slot). `results:render` rewrites the README block between `<!-- RESULTS:START -->` and `<!-- RESULTS:END -->` from those files; nobody edits it by hand.
- **CI refuses stale or unreproducible numbers.** `results:check` fails if the README block differs from what the JSON renders, if any result was measured on a dirty tree, or if `src`, `migrations`, `fixtures`, `scripts`, `test`, `seed`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `vite.config.ts` or `vitest.config.ts` changed between the measured commit and HEAD (the last five were added after a review found that editing a tagged test or the build configuration left the check green). CI checks out the full history so the measured sha exists, and the check says so when the measured commit is missing from the history (a shallow clone, or rewritten history). `count:tests -- --check` also compares the tagged test count with the README.
- **Orchestration and planning are measured separately.** The 100-run simulation uses the deterministic stub planner, whose fixtures are generated from the dataset's gold plans, so its outcome distribution is fixed by the dataset design and `outcome_match` measures agreement with it. Planning quality is measured on its own by `eval:planner` against a local model, scored against the same gold plans.
- **Each number says where it came from.** The rendered block names the command, the date and the commit, labels local latencies as local, and reports production as "not measured" until something is deployed.

## Consequences

- A reader can rerun any number from a named commit, and a stale or hand-edited number inside the rendered block fails CI. Numbers in the README's prose bullets under "Reading the results" are typed by hand; each cites the commit whose committed result file holds it, and CI does not check them.
- Any change under the measured paths, even one that cannot affect a number (a UI test, a stylesheet), makes `results:check` fail until all three measurements are taken again on a clean committed tree. Commits between such a change and the re-measurement are red on that one step, so work is grouped so that the last commit of each planned group is green. The pull requests on GitHub were cut by a publish step at other points, and five of them (#3 to #6 and #8) were merged with this step red: four because their result files cited working-repository commit ids that the published history did not contain, one because it ended between fixes and their re-measurement (see the README).
- The simulation's success says nothing about model quality, and the planner score says nothing about orchestration; the README says both.
- Re-measuring the planner takes a local llama-server and roughly as long as 100 sequential plans, so changes under the measured paths have a real cost, which is intended.
