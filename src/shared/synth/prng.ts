/** Seed for every synthetic artifact (SPEC section 12). */
export const SEED = 20261008;

/** splitmix32, used only to expand one seed into sfc32's four words. */
function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Deterministic PRNG (sfc32). */
export class Prng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number = SEED) {
    const mix = splitmix32(seed);
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = mix();
    for (let i = 0; i < 15; i++) this.nextUint32();
  }

  nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError(`int(${n})`);
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new RangeError("pick from an empty list");
    return item;
  }

  /** Fisher-Yates shuffle into a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = out[i] as T;
      out[i] = out[j] as T;
      out[j] = a;
    }
    return out;
  }
}
