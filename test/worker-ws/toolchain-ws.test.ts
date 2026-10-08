import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

interface Frame {
  type: string;
  state?: unknown;
  error?: string;
}

async function openProbeSocket(name: string): Promise<{ ws: WebSocket; frames: Frame[]; next: (type: string) => Promise<Frame> }> {
  const response = await exports.default.fetch(`http://localhost/__probe/toolchain-probe/${name}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  if (!ws) throw new Error("no webSocket on the upgrade response");
  ws.accept();
  const frames: Frame[] = [];
  const waiters: { type: string; resolve: (f: Frame) => void }[] = [];
  ws.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data)) as Frame;
    frames.push(frame);
    for (const waiter of [...waiters]) {
      if (waiter.type === frame.type) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(frame);
      }
    }
  });
  const next = (type: string) =>
    new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 5000);
      waiters.push({
        type,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  return { ws, frames, next };
}

describe("toolchain gate (WebSocket)", { tags: ["tooling"] }, () => {
  it("an Agent WebSocket receives a state frame on connect, an update after setState, and a read-only refusal for client writes", async () => {
    const name = `ws-${crypto.randomUUID()}`;
    const { ws, frames, next } = await openProbeSocket(name);
    const initial = await (frames.find((f) => f.type === "cf_agent_state") ?? next("cf_agent_state"));
    expect(initial.state).toEqual({ label: "probe", writes: 0 });

    const update = next("cf_agent_state");
    const probe = env.ToolchainProbe.getByName(name);
    await probe.bump();
    expect((await update).state).toEqual({ label: "probe", writes: 1 });

    const refusal = next("cf_agent_state_error");
    ws.send(JSON.stringify({ type: "cf_agent_state", state: { label: "hacked", writes: 99 } }));
    expect((await refusal).error).toBe("Connection is readonly");
    const after = await probe.bump();
    expect(after).toEqual({ label: "probe", writes: 2 });
    ws.close();
  });
});
