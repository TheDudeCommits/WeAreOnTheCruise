/**
 * Deterministic noise for world generation (WORLD-owned). Pure TypeScript: no three.js, no Math.random, so the
 * simulation, the renderer and node tests all derive identical islands from the same seed.
 */
import type { SeededRandom } from '../core/rng';

const INV_U32 = 1 / 4294967296;
export const TAU = Math.PI * 2;

export function mix32(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Integer hash of a seed and two lattice coordinates. */
export function hash2i(seed: number, a: number, b: number): number {
  return mix32(seed ^ Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(((b | 0) + 0x632be5ab) | 0, 0x85ebca77));
}

/** Hash to [0, 1). */
export function hash01(seed: number, a: number, b = 0): number {
  return hash2i(seed, a, b) * INV_U32;
}

/** Smooth 2D value noise in [-1, 1]. */
export function valueNoise(seed: number, x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash01(seed, xi, zi), b = hash01(seed, xi + 1, zi);
  const c = hash01(seed, xi, zi + 1), d = hash01(seed, xi + 1, zi + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

/** Fractal value noise in roughly [-1, 1]. */
export function fbm(seed: number, x: number, z: number, octaves = 4): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(seed + o * 1013, x * f, z * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/**
 * Periodic noise on the circle: a random Fourier series with RMS ≈ 1 (peaks ≈ ±2.5).
 * Harmonics kMin..kMax, amplitude ∝ k^-slope. Evaluated per coastline vertex, so it must be cheap and exact.
 */
export class CircleNoise {
  private readonly k: Float64Array;
  private readonly amp: Float64Array;
  private readonly phase: Float64Array;

  constructor(rng: SeededRandom, kMin: number, kMax: number, slope = 1) {
    const count = Math.max(1, kMax - kMin + 1);
    this.k = new Float64Array(count);
    this.amp = new Float64Array(count);
    this.phase = new Float64Array(count);
    let power = 0;
    for (let j = 0; j < count; j++) {
      const k = kMin + j;
      const a = Math.pow(k, -slope) * (0.55 + rng.next() * 0.9);
      this.k[j] = k;
      this.amp[j] = a;
      this.phase[j] = rng.next() * TAU;
      power += a * a * 0.5;
    }
    const norm = 1 / Math.sqrt(power || 1);
    for (let j = 0; j < count; j++) this.amp[j]! *= norm;
  }

  at(theta: number): number {
    let v = 0;
    for (let j = 0; j < this.k.length; j++) v += this.amp[j]! * Math.sin(this.k[j]! * theta + this.phase[j]!);
    return v;
  }
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Signed smallest difference between two angles, in (-π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}
