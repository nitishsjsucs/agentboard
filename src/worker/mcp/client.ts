// In-process MCP client (SPEC section 8.1): StreamableHTTPClientTransport with
// a custom fetch that calls the People Ops endpoint function directly (no
// self-subrequest; the endpoint still verifies the bearer token). One Client
// per task: connect, call, close.

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Config } from "../config.ts";
import { PEOPLE_OPS_HOST, peopleOpsEndpoint } from "./endpoint.ts";

export function inProcessFetch(env: Env, config: Config): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set("Host", PEOPLE_OPS_HOST);
    return peopleOpsEndpoint(new Request(request, { headers }), env, config);
  };
}

export async function withPeopleOps<T>(env: Env, config: Config, token: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(`https://${PEOPLE_OPS_HOST}/mcp`), {
    authProvider: { token: async () => token },
    fetch: inProcessFetch(env, config),
  });
  const client = new Client({ name: "agentboard-agent", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}
