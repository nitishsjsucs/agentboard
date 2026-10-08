import { exports } from "cloudflare:workers";
import { authHeaders, mutationHeaders } from "./auth.ts";

export const BASE = "http://127.0.0.1:8784";

export async function apiGet(principal: string, path: string): Promise<Response> {
  return exports.default.fetch(`${BASE}${path}`, { headers: await authHeaders(principal) });
}

export async function apiPost(principal: string, path: string, body: unknown, method = "POST"): Promise<Response> {
  return exports.default.fetch(`${BASE}${path}`, { method, headers: await mutationHeaders(principal), body: JSON.stringify(body) });
}

export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
