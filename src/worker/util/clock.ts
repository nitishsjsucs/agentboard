/** Wall clock plus a test-only offset (set through runInDurableObject in tests). */
export class Clock {
  offsetMs = 0;

  now(): number {
    return Date.now() + this.offsetMs;
  }

  iso(ms: number = this.now()): string {
    return new Date(ms).toISOString();
  }
}

export function isoNow(): string {
  return new Date().toISOString();
}
