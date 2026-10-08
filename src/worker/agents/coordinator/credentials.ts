// Idempotency keys (SPEC section 7.1). Call-bound integration tokens are added in commit 10.

import { createHash } from "node:crypto";
import { canonicalJson } from "../../../shared/canonical-json.ts";

/** ik_ + base64url(sha256(runId|stepId|generation|tool|canonicalJson(args))). Stable across attempts and epochs. */
export function idempotencyKey(runId: string, stepId: string, generation: number, tool: string, args: unknown): string {
  const digest = createHash("sha256").update(`${runId}|${stepId}|${generation}|${tool}|${canonicalJson(args)}`).digest("base64url");
  return `ik_${digest}`;
}
