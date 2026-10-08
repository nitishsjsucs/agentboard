// Evaluation math (SPEC section 14). Pure.

/** Percentile with linear interpolation between closest ranks; p in [0, 100]. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sorted[low] as number;
  const highValue = sorted[high] as number;
  return lowValue + (highValue - lowValue) * (rank - low);
}

/** F1 over two multisets of strings (for example the tools of a predicted and a gold plan). */
export function multisetF1(predicted: readonly string[], gold: readonly string[]): number {
  if (predicted.length === 0 && gold.length === 0) return 1;
  const remaining = new Map<string, number>();
  for (const g of gold) remaining.set(g, (remaining.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const p of predicted) {
    const left = remaining.get(p) ?? 0;
    if (left > 0) {
      overlap += 1;
      remaining.set(p, left - 1);
    }
  }
  if (overlap === 0) return 0;
  const precision = overlap / predicted.length;
  const recall = overlap / gold.length;
  return (2 * precision * recall) / (precision + recall);
}

export function sequenceExact(predicted: readonly string[], gold: readonly string[]): boolean {
  return predicted.length === gold.length && predicted.every((value, i) => value === gold[i]);
}

/** Normalizes a scalar for comparison: trimmed, collapsed whitespace, case-insensitive. */
export function normalize(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Flattens nested objects into dotted fields: { address: { city } } becomes { "address.city": ... }. */
export function flatten(value: unknown, prefix = ""): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? { [prefix]: value } : {};
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) Object.assign(out, flatten(inner, prefix ? `${prefix}.${key}` : key));
  return out;
}

export interface StepLike {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Over gold steps matched by tool and position, the fraction of gold argument
 * fields that the predicted step has equal after normalization.
 */
export function argAccuracy(predicted: readonly StepLike[], gold: readonly StepLike[]): { matchedFields: number; equalFields: number } {
  let matchedFields = 0;
  let equalFields = 0;
  gold.forEach((goldStep, i) => {
    const step = predicted[i];
    if (!step || step.tool !== goldStep.tool) return;
    const want = flatten(goldStep.args);
    const got = flatten(step.args);
    for (const [field, value] of Object.entries(want)) {
      matchedFields += 1;
      if (field in got && normalize(got[field]) === normalize(value)) equalFields += 1;
    }
  });
  return { matchedFields, equalFields };
}
