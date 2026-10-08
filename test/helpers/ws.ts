import { exports } from "cloudflare:workers";

export interface Frame {
  type: string;
  state?: unknown;
  error?: string;
}

export interface OpenSocket {
  ws: WebSocket;
  frames: Frame[];
  next(type: string, predicate?: (frame: Frame) => boolean): Promise<Frame>;
}

export async function upgrade(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(`http://127.0.0.1:8784${path}`, { headers: { Upgrade: "websocket", ...headers } });
}

/** Accepts an upgrade response and collects frames; `next` waits for the next matching frame. */
export function openSocket(response: Response): OpenSocket {
  const ws = response.webSocket;
  if (!ws) throw new Error(`no webSocket (status ${response.status})`);
  ws.accept();
  const frames: Frame[] = [];
  const waiters: { type: string; predicate: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];
  ws.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data)) as Frame;
    frames.push(frame);
    for (const waiter of [...waiters]) {
      if (waiter.type === frame.type && waiter.predicate(frame)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(frame);
      }
    }
  });
  const next = (type: string, predicate: (f: Frame) => boolean = () => true) => {
    const seen = frames.find((f) => f.type === type && predicate(f));
    if (seen) {
      frames.splice(frames.indexOf(seen), 1);
      return Promise.resolve(seen);
    }
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 5000);
      waiters.push({
        type,
        predicate,
        resolve: (f) => {
          clearTimeout(timer);
          frames.splice(frames.indexOf(f), 1);
          resolve(f);
        },
      });
    });
  };
  return { ws, frames, next };
}
