// Plain messages for API and network failures. The server's own messages are
// internal (permission names, zod output, refusal codes), so pages render
// describeError(...) instead of error.message.

import type { MeResponse } from "../../shared/api-types.ts";
import { ApiRequestError } from "./client.ts";

export interface ErrorDescription {
  /** What happened, in plain words. */
  message: string;
  /** What to do next, when there is something better than retrying. */
  next?: string;
  /** Shown only for server failures (5xx), so a report can be matched to the server's logs. */
  requestId?: string;
}

export interface ErrorContext {
  me?: MeResponse | null;
  /** What the user tried, as a verb phrase that completes "Your role cannot ...", for example "launch runs". */
  action?: string;
}

export const MESSAGES = {
  network: "Could not reach AgentBoard. Check the connection and try again.",
  unavailable: "AgentBoard sent an unexpected response. If your session ended, reload the page to sign in again.",
  redirected: "Your session may have ended: the request was sent to a sign-in page. Reload the page to sign in again.",
  sessionEnded: "Your session ended. Sign in again.",
  selfApproval: "You requested this run, so you cannot decide its approval.",
  notFound: "Not found. It may have been mistyped, or it belongs to another environment.",
  alreadyDecided: "This approval was already decided or has expired. The list now shows its current state.",
  idempotencyConflict: "This form already launched a different request. Check Runs for it, or start a new request.",
  invalidRequest: "Some values were not accepted.",
  server: "AgentBoard could not finish this request. Try again in a moment.",
} as const;

function roleLabel(me: MeResponse | null | undefined): string {
  return me?.role ? `Your role (${me.role})` : "Your role";
}

export function describeError(error: unknown, context: ErrorContext = {}): ErrorDescription {
  const { me, action } = context;
  if (!(error instanceof ApiRequestError)) {
    // A rejected fetch outside the client, or a body that failed to parse.
    if (error instanceof TypeError) return { message: MESSAGES.network };
    if (error instanceof SyntaxError) return { message: MESSAGES.unavailable };
    // Errors the console throws itself carry messages written for people.
    if (error instanceof Error && error.message) return { message: error.message };
    return { message: MESSAGES.server };
  }
  const status = error.status;
  if (status === 401) return { message: MESSAGES.sessionEnded };
  if (error.code === "network") return { message: MESSAGES.network };
  if (error.code === "redirected") return { message: MESSAGES.redirected };
  // An HTML page instead of JSON: a 5xx one is a gateway or Worker failure, anything else may be a sign-in page.
  if (error.code === "unavailable") return { message: status >= 500 ? MESSAGES.server : MESSAGES.unavailable };
  if (status === 403) {
    if (error.reason === "no_role_binding") {
      const who = me?.principal.email ?? me?.principal.id ?? "this account";
      return { message: `You are signed in as ${who} but have no AgentBoard role.`, next: "Ask an admin to add a role binding." };
    }
    if (error.reason === "self_approval") return { message: MESSAGES.selfApproval };
    return { message: `${roleLabel(me)} cannot ${action ?? "do this"}.` };
  }
  if (status === 404) return { message: MESSAGES.notFound };
  if (status === 409) {
    if (error.reason === "already_decided" || error.reason === "expired") return { message: MESSAGES.alreadyDecided };
    if (error.reason === "idempotency_conflict") return { message: MESSAGES.idempotencyConflict };
    return { message: "This conflicts with the current state. Reload the page to see it, then try again." };
  }
  if (status === 400) {
    if (error.reason === "unknown_employee") return { message: "The subject employee was not found in the directory.", next: "Choose another employee." };
    return { message: MESSAGES.invalidRequest, next: "Check the values and try again." };
  }
  if (status >= 500) return { message: MESSAGES.server, ...(error.requestId ? { requestId: error.requestId } : {}) };
  return { message: MESSAGES.server };
}
