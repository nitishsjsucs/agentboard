// Redaction (SPEC section 10.1). Without pii:read, addresses keep only city,
// region and country, and personal emails are masked; request text is null.
// Audit detail is redacted at write time for everyone.

import { createHash } from "node:crypto";
import { canonicalJson } from "../../shared/canonical-json.ts";

function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return "***";
  return `${value.charAt(0)}***${value.slice(at)}`;
}

function redactAddress(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const address = value as Record<string, unknown>;
  return { city: address["city"] ?? null, region: address["region"] ?? null, country: address["country"] ?? null };
}

/** Viewer-level redaction of any JSON value (tool args, results, task views). */
export function redactForViewer(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForViewer);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key === "address") out[key] = redactAddress(inner);
    else if (key === "personalEmail" && typeof inner === "string") out[key] = maskEmail(inner);
    else out[key] = redactForViewer(inner);
  }
  return out;
}

export function redactIf(value: unknown, canReadPii: boolean): unknown {
  return canReadPii ? value : redactForViewer(value);
}

export function argsSha256(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args ?? null)).digest("hex");
}

/** Non-PII view of tool arguments for audit detail: hash plus a few identifying fields. */
export function auditArgs(tool: string | null, args: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { argsSha256: argsSha256(args) };
  if (tool) out["tool"] = tool;
  if (args && typeof args["employeeId"] === "string") out["employeeId"] = args["employeeId"];
  return out;
}
