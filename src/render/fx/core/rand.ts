/** Tiny allocation-free PRNG + hashes for FX (visual only; never gameplay). */

let state = 0x9e3779b9 >>> 0;

/** Re-seeds the shared FX random stream (the lab uses this for reproducible captures). */
export function seedFx(seed: number): void { state = (seed >>> 0) || 1; }

/** Uniform [0, 1). xorshift32. */
export function rand(): number {
  let x = state;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  state = x;
  return x / 4294967296;
}

/** Uniform [a, b). */
export function range(a: number, b: number): number { return a + (b - a) * rand(); }

/** Symmetric [-a, a). */
export function spread(a: number): number { return (rand() * 2 - 1) * a; }

/** Deterministic hash of an integer + salt to [0, 1). */
export function hash01(n: number, salt = 0): number {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
