// Dev-only fault directives (SPEC section 8.5). The executor forwards the
// directive in _meta["agentboard/fault"]; it is honored only when
// FAULT_INJECTION=on, and ignored everywhere else (production refuses
// FAULT_INJECTION=on at load time).

import type { FaultKind } from "../../shared/domain.ts";

export const FAULT_META_KEY = "agentboard/fault";

const INTEGRATION_FAULTS = new Set<FaultKind>(["transient_error", "permanent_error", "silent_noop"]);

export function faultDirective(meta: Record<string, unknown> | undefined, faultInjection: boolean): FaultKind | null {
  if (!faultInjection || !meta) return null;
  const value = meta[FAULT_META_KEY];
  return typeof value === "string" && INTEGRATION_FAULTS.has(value as FaultKind) ? (value as FaultKind) : null;
}
