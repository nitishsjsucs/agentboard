// How the simulation driver talks to AgentBoard: in workerd (vitest) through
// the worker's own fetch handler, or over HTTP to `wrangler dev` (eval:sim).
// Either way it goes through the real API, identity, queue and agents.

export interface SimResponse {
  status: number;
  body: unknown;
}

export interface SimTransport {
  /** Sends one API request as `principal` (the transport signs the identity). */
  request(principal: string, method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<SimResponse>;
  sleep(ms: number): Promise<void>;
  now(): number;
}
