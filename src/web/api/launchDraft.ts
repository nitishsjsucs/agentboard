// The launch form's unsent request, kept in this tab's sessionStorage. Signing in again after a session
// ends leaves the page (the dev login) or reloads it (Cloudflare Access), so without this the request
// the banner promised to keep would be lost. A draft belongs to one principal and is never shown to
// another; a successful launch, "Clear form" and Sign out remove it. Storage can be missing or throw
// (a private window, blocked site data), so every access is guarded and the form works without it.

import { PRIORITIES, REQUEST_TYPES, type RequestType } from "../../shared/domain.ts";

const KEY = "agentboard.launch-draft";

export interface LaunchDraft {
  /** The form's idempotency key, kept so a resend after signing in again cannot start a second run. */
  clientRequestId: string;
  requestType: RequestType;
  subject: string;
  text: string;
  priority: (typeof PRIORITIES)[number];
  maxToolCalls: string;
  sampleRef: string;
}

interface Stored extends LaunchDraft {
  principal: string;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const isString = (value: unknown): value is string => typeof value === "string";

/** The draft `principal` left in this tab, or null when there is none (or it belongs to someone else). */
export function readLaunchDraft(principal: string | undefined): LaunchDraft | null {
  if (!principal) return null;
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (stored.principal !== principal) return null;
    const { clientRequestId, requestType, subject, text, priority, maxToolCalls, sampleRef } = stored;
    if (!isString(clientRequestId) || !clientRequestId || !isString(subject) || !isString(text) || !isString(maxToolCalls) || !isString(sampleRef)) return null;
    if (!REQUEST_TYPES.includes(requestType as RequestType) || !PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) return null;
    return { clientRequestId, requestType: requestType as RequestType, subject, text, priority: priority as (typeof PRIORITIES)[number], maxToolCalls, sampleRef };
  } catch {
    return null;
  }
}

/** Keeps `draft` for `principal`; a draft with nothing chosen or typed is removed instead. */
export function saveLaunchDraft(principal: string, draft: LaunchDraft): void {
  if (draft.subject === "" && draft.text.trim() === "" && draft.maxToolCalls === "") {
    clearLaunchDraft();
    return;
  }
  try {
    storage()?.setItem(KEY, JSON.stringify({ ...draft, principal } satisfies Stored));
  } catch {
    // Storage is full or blocked: the form still works, the draft just does not survive a reload.
  }
}

export function clearLaunchDraft(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to remove when storage is unavailable.
  }
}
