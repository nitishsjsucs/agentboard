import { getAgentByName } from "agents";
import type { RunCoordinatorRpc } from "../agents/coordinator/schema.ts";

/** A started coordinator for one run, typed by its RPC interface. */
export async function coordinatorFor(env: Env, runId: string): Promise<RunCoordinatorRpc> {
  return (await getAgentByName(env.RunCoordinator, runId)) as unknown as RunCoordinatorRpc;
}
