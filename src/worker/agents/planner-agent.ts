import type { CompletionReport } from "./coordinator/schema.ts";
import { RoleAgent } from "./role-agent.ts";

/** Skeleton: the role work lands with its commit in SPEC section 19. */
export class PlannerAgent extends RoleAgent {
  readonly role = "planner" as const;

  protected async work(): Promise<CompletionReport | null> {
    throw new Error("planner work is not implemented yet");
  }
}
