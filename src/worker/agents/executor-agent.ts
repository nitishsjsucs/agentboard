import type { CompletionReport } from "./coordinator/schema.ts";
import { RoleAgent } from "./role-agent.ts";

/** Skeleton: the role work lands with its commit in SPEC section 19. */
export class ExecutorAgent extends RoleAgent {
  readonly role = "executor" as const;

  protected async work(): Promise<CompletionReport | null> {
    throw new Error("executor work is not implemented yet");
  }
}
