import type { CompletionReport } from "./coordinator/schema.ts";
import { RoleAgent } from "./role-agent.ts";

/** Skeleton: the role work lands with its commit in SPEC section 19. */
export class VerifierAgent extends RoleAgent {
  readonly role = "verifier" as const;

  protected async work(): Promise<CompletionReport | null> {
    throw new Error("verifier work is not implemented yet");
  }
}
