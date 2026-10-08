/**
 * Canonical JSON: object keys sorted recursively, no whitespace, `undefined`
 * object members dropped (as JSON.stringify does). Used for the audit hash
 * chain, argument hashes and idempotency keys, so the same value always hashes
 * to the same bytes in every store.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : serialize(item))).join(",")}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

/**
 * Removes object members whose value is undefined, recursively. zod's output
 * types mark optional members `T | undefined`; this turns parsed input into
 * the exact-optional domain types.
 */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => compact(item)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (inner !== undefined) out[key] = compact(inner);
  }
  return out as T;
}
