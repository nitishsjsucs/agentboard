// Stub LLM fixtures (SPEC section 11.2): for every request in the synthetic
// dataset, the planner prompt the agent would build (with the catalog it
// actually fetched) maps to that request's gold plan. Built lazily and
// memoized per catalog, so a prompt change can never silently desync them.

import { createHash } from "node:crypto";
import { canonicalJson } from "../../shared/canonical-json.ts";
import type { SyntheticDataset } from "../../shared/synth/generator.ts";
import { DEFAULT_BUDGET } from "../../shared/domain.ts";
import { buildPlanPrompt, type CatalogEntry } from "../planning/planner.ts";
import { promptHash } from "./stub.ts";

const cache = new Map<string, Map<string, string>>();

export async function goldFixtures(catalog: readonly CatalogEntry[], maxSteps: number = DEFAULT_BUDGET.maxSteps): Promise<Map<string, string>> {
  const key = createHash("sha256").update(`${maxSteps}|${canonicalJson(catalog)}`).digest("hex");
  const cached = cache.get(key);
  if (cached) return cached;
  const { default: dataset } = (await import("../../../fixtures/synthetic/dataset.v1.json", { with: { type: "json" } })) as { default: SyntheticDataset };
  const fixtures = new Map<string, string>();
  for (const run of dataset.runs) {
    const prompt = buildPlanPrompt({ requestType: run.requestType, subjectEmployeeId: run.subjectEmployeeId, requestText: run.requestText }, catalog, maxSteps);
    fixtures.set(promptHash(prompt.system, prompt.user), JSON.stringify(run.goldPlan));
  }
  cache.set(key, fixtures);
  return fixtures;
}
