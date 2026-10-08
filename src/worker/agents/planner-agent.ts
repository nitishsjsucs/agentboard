import { Agent } from "agents";

/** Skeleton. The behavior lands with its commit in SPEC section 19. */
export class PlannerAgent extends Agent<Env> {
  override async onRequest(): Promise<Response> {
    return new Response("not found", { status: 404 });
  }
}
