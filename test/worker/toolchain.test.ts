import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { verifyProbeChain, type ToolchainProbe } from "../helpers/probe-agent.ts";

// Commit-1 gate: the prototype (P2) checks repeated in this repo on the exact pins.
describe("toolchain gate", { tags: ["tooling"] }, () => {
  it("40 concurrent RPCs that await I/O and then append inside transactionSync with node:crypto produce a contiguous, valid chain", async () => {
    const stub = env.ToolchainProbe.getByName("chain");
    const seqs = await Promise.all(Array.from({ length: 40 }, (_, i) => stub.append(`event-${i}`)));
    expect(new Set(seqs).size).toBe(40);
    const rows = await stub.chain();
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(verifyProbeChain(rows)).toBe(true);
    // A tampered copy no longer verifies.
    const tampered = rows.map((r, i) => (i === 7 ? { ...r, payload: "tampered" } : r));
    expect(verifyProbeChain(tampered)).toBe(false);
  });

  it("schedule() arms one idempotent wake at the ceiling second, and the alarm runs the callback", async () => {
    const stub = env.ToolchainProbe.getByName("wake");
    const deadline = Date.now() + 1500;
    const first = await stub.armWake(deadline);
    const second = await stub.armWake(deadline);
    expect(first.at % 1000).toBe(0);
    expect(first.at).toBeGreaterThanOrEqual(deadline);
    expect(second.schedules).toBe(1);
    // Wait for the real alarm (seconds granularity plus the ceiling).
    const started = Date.now();
    let wakes: { at: number; fired_at: number }[] = [];
    while (Date.now() - started < 6000) {
      wakes = await runInDurableObject(stub, (instance: ToolchainProbe) => instance.wakes());
      if (wakes.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(wakes).toHaveLength(1);
    // The one-shot schedule was consumed: no alarm is left to run.
    expect(await runDurableObjectAlarm(stub)).toBe(false);
    expect(wakes[0]?.at).toBe(first.at);
    expect(wakes[0]?.fired_at).toBeGreaterThanOrEqual(first.at - 1000);
  });
});
