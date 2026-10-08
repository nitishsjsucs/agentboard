import { runInDurableObject } from "cloudflare:test";
import type { RunCoordinator } from "../../src/worker/agents/run-coordinator.ts";
import { raw, type CoordinatorStub } from "./runs.ts";

/**
 * Moves the coordinator's clock by `offsetMs` (in memory, lost on eviction).
 * Time-dependent paths are tested by moving this clock and calling an RPC,
 * whose sweep then sees the expiry, instead of waiting for alarms.
 */
export async function setCoordinatorClock(stub: CoordinatorStub, offsetMs: number): Promise<void> {
  await runInDurableObject(raw(stub), (instance: RunCoordinator) => {
    instance.clock.offsetMs = offsetMs;
  });
}

/** Simulates a crash between the commit and armWake: no wake is armed. */
export async function disarmWake(stub: CoordinatorStub): Promise<void> {
  await runInDurableObject(raw(stub), async (instance: RunCoordinator) => {
    for (const schedule of await instance.listSchedules()) await instance.cancelSchedule(schedule.id);
    instance.sql`UPDATE ab_run SET wake_at = NULL`;
  });
}
