/**
 * Island surface model (WORLD-owned, pure). Turns an IslandDef + IslandShape into:
 *  - per-coast-vertex profiles (beach weight, rim height, crest/rim radii) and an analytic height query used to
 *    place props, and
 *  - a ring-stack model: closed rings of (radius, height) per coast vertex, grouped into smooth sections. The
 *    renderer stitches rings into triangles; ring `water` is exactly the collision polygon at y = 0.
 *
 * Ring order per vertex (outside/below → inside/top): skirt · water · wet · shore │ strata bands (face + ledge
 * sections, absolute heights so layers line up across the island) │ lip underside │ top rings (plateau, optional
 * second tier with its own strata) → centre.
 */
import type { IslandDef } from '../game/types';
import { TAU, clamp, lerp, smoothstep } from './noise';
import { type Archetype, type IslandShape, shapeOf } from './shape';

export type RingRole = 'skirt' | 'water' | 'wet' | 'shore' | 'face' | 'ledge' | 'lip' | 'top' | 'tier-face' | 'tier-ledge' | 'tier-lip';

export interface RingData {
  role: RingRole;
  /** Strata band index (faces/ledges), else −1. */
  band: number;
  r: Float32Array;
  y: Float32Array;
}

/** Rings inside a section share vertices (smooth normals); sections meet at hard edges. */
export interface RingSection { rings: RingData[] }

export interface RingModel {
  surface: IslandSurface;
  lod: number;
  /** Number of vertices per ring. */
  n: number;
  /** Coast vertex index for each ring vertex. */
  index: Int32Array;
  sin: Float32Array;
  cos: Float32Array;
  sections: RingSection[];
  /** Height of the centre vertex closing the last section (fan). */
  centerY: number;
}

export type SurfaceZone = 'water' | 'beach' | 'slope' | 'cliff' | 'top';

export interface SurfaceSample { zone: SurfaceZone; y: number; /** 0 = flat .. 1 = vertical. */ steep: number; beach: number; s: number }

const TOP_RINGS: Record<Archetype, readonly (readonly number[])[]> = {
  dome: [[0.95, 0.88, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1], [0.88, 0.7, 0.5, 0.3, 0.12], [0.8, 0.5, 0.2]],
  mesa: [[0.96, 0.9, 0.8, 0.66, 0.5, 0.33, 0.16], [0.9, 0.6, 0.3], [0.8, 0.4]],
  stack: [[0.93, 0.8, 0.6, 0.35, 0.12], [0.85, 0.45], [0.6]],
  pillar: [[0.95, 0.86, 0.72, 0.55, 0.36, 0.16], [0.88, 0.55, 0.22], [0.7, 0.3]],
  reef: [[0.9, 0.72, 0.5, 0.26], [0.8, 0.4], [0.6]],
  rock: [[0.9, 0.75, 0.55, 0.35, 0.15], [0.8, 0.45, 0.15], [0.6, 0.2]],
  cone: [[0.93, 0.83, 0.72, 0.6, 0.48, 0.36, 0.27, 0.21, 0.15, 0.07], [0.85, 0.6, 0.38, 0.21, 0.1], [0.7, 0.38, 0.21]],
};
/** Tier split: fractions of the plateau-1 annulus and of the plateau-2 disc. */
const TIER_OUTER: readonly (readonly number[])[] = [[0.3, 0.65, 0.92], [0.5, 0.92], [0.9]];
const TIER_INNER: readonly (readonly number[])[] = [[0.93, 0.75, 0.52, 0.28, 0.1], [0.85, 0.45, 0.15], [0.6]];

export class IslandSurface {
  readonly def: IslandDef;
  readonly shape: IslandShape;
  readonly n: number;
  readonly cx: number;
  readonly cz: number;
  readonly theta: Float64Array;
  readonly R: Float64Array;
  readonly beach: Float64Array;
  readonly H: Float64Array;
  readonly peak: Float64Array;
  readonly shoreR: Float64Array;
  readonly shoreY: Float64Array;
  readonly bankW: Float64Array;
  readonly rimR: Float64Array;
  readonly lipR: Float64Array;
  readonly lipY: Float64Array;
  readonly tierS: Float64Array;
  /** Band containing the rim height, per vertex. */
  readonly topBand: Int16Array;
  /** Outline θ increases with index (generated islands); false → reversed foreign outline. */
  readonly ccw: boolean;
  readonly uniform: boolean;

  constructor(def: IslandDef, shape: IslandShape = shapeOf(def)) {
    this.def = def;
    this.shape = shape;
    this.cx = def.x;
    this.cz = def.z;
    const n = (this.n = def.outline.length);
    this.theta = new Float64Array(n);
    this.R = new Float64Array(n);
    this.beach = new Float64Array(n);
    this.H = new Float64Array(n);
    this.peak = new Float64Array(n);
    this.shoreR = new Float64Array(n);
    this.shoreY = new Float64Array(n);
    this.bankW = new Float64Array(n);
    this.rimR = new Float64Array(n);
    this.lipR = new Float64Array(n);
    this.lipY = new Float64Array(n);
    this.tierS = new Float64Array(n);
    this.topBand = new Int16Array(n);
    let uniform = true;
    for (let i = 0; i < n; i++) {
      const p = def.outline[i]!;
      const dx = p.x - def.x, dz = p.z - def.z;
      let t = Math.atan2(dx, dz);
      if (t < 0) t += TAU;
      this.theta[i] = t;
      this.R[i] = Math.hypot(dx, dz);
      if (Math.abs(t - (i / n) * TAU) > 1e-6 && Math.abs(t - (i / n) * TAU + TAU) > 1e-6) uniform = false;
    }
    this.uniform = uniform;
    let turn = 0;
    for (let i = 0; i < n; i++) {
      let d = this.theta[(i + 1) % n]! - this.theta[i]!;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      turn += d;
    }
    this.ccw = turn > 0;

    const bands = shape.strata;
    for (let i = 0; i < n; i++) {
      const t = this.theta[i]!, R = this.R[i]!;
      const b = shape.beach(t);
      this.beach[i] = b;
      const H = Math.max(shape.rimHeight(t, b), 1.2);
      this.H[i] = H;
      this.peak[i] = Math.max(H, shape.peakHeight(t));
      const W = Math.min(shape.beachWidth(t), R * 0.32);
      this.shoreR[i] = R - lerp(0.3, W, b);
      this.shoreY[i] = Math.min(H, lerp(2.2, 2.35, b));
      this.bankW[i] = Math.min(shape.bankWidth(t), R * 0.18) * b;
      let k = 0;
      while (k < bands.length - 1 && bands[k]!.top < H) k++;
      this.topBand[i] = k;
      const rim = Math.max(R * 0.3, this.faceR(i, H, k));
      this.rimR[i] = rim;
      this.lipR[i] = rim + 0.85 * (1 - b) * (H > 4 ? 1 : 0.3);
      this.lipY[i] = H + 0.32 * (1 - b);
      this.tierS[i] = shape.tierAt(t);
    }
  }

  /** Cliff/slope face radius at height y for strata band k (exact coast at y ≤ 2 m). */
  faceR(i: number, y: number, k: number): number {
    const R = this.R[i]!, b = this.beach[i]!, t = this.theta[i]!;
    const shape = this.shape;
    const ramp = smoothstep(1.8, 6, y);
    let cliff = R - shape.lean * Math.max(0, y) - shape.bandInset(k, t) * ramp;
    cliff = Math.min(cliff, R + 0.9 * ramp);
    if (b <= 0) return cliff;
    const ys = this.shoreY[i]!, H = this.H[i]!;
    const f = H > ys + 0.01 ? clamp((y - ys) / (H - ys), 0, 1) : 1;
    const slope = this.shoreR[i]! - this.bankW[i]! * Math.pow(f, 0.8);
    return lerp(cliff, Math.min(slope, cliff), b);
  }

  /** Top surface height at vertex i and radius fraction s (0 = centre, 1 = rim). */
  topY(i: number, s: number): number {
    const shape = this.shape;
    const H = this.H[i]!, P = this.peak[i]!;
    const u = 1 - s;
    const t = this.theta[i]!;
    const r = this.rimR[i]! * s;
    let y = H + (P - H) * shape.topProfile(u) + shape.bumps(this.cx + Math.sin(t) * r, this.cz + Math.cos(t) * r, u);
    const st = this.tierS[i]!;
    if (st > 0 && s < st) y += shape.tierRise;
    return y;
  }

  /** Fractional vertex position for an angle: v = i + f. */
  locate(theta: number): { i0: number; i1: number; f: number } {
    let t = theta % TAU;
    if (t < 0) t += TAU;
    const n = this.n;
    if (this.uniform) {
      const v = (t / TAU) * n;
      const i0 = Math.floor(v) % n;
      return { i0, i1: (i0 + 1) % n, f: v - Math.floor(v) };
    }
    // Foreign outline: nearest bracketing pair by angle.
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(((t - this.theta[i]! + Math.PI * 3) % TAU) - Math.PI);
      if (d < bestD) { bestD = d; best = i; }
    }
    const next = this.ccw ? (best + 1) % n : (best - 1 + n) % n;
    const prev = this.ccw ? (best - 1 + n) % n : (best + 1) % n;
    const dn = ((this.theta[next]! - this.theta[best]! + TAU * 2) % TAU);
    const dt = ((t - this.theta[best]! + TAU * 2) % TAU);
    if (dt <= dn && dn > 0) return { i0: best, i1: next, f: dt / dn };
    const dp = ((this.theta[best]! - this.theta[prev]! + TAU * 2) % TAU);
    const dt2 = ((t - this.theta[prev]! + TAU * 2) % TAU);
    return { i0: prev, i1: best, f: dp > 0 ? clamp(dt2 / dp, 0, 1) : 0 };
  }

  private lerpAt(arr: Float64Array, l: { i0: number; i1: number; f: number }): number {
    return arr[l.i0]! + (arr[l.i1]! - arr[l.i0]!) * l.f;
  }

  /**
   * Height and zone at a world point (props placement). Top and beach zones are exact to the analytic profile;
   * cliff faces report the rim height and zone 'cliff'.
   */
  sample(x: number, z: number): SurfaceSample {
    const dx = x - this.cx, dz = z - this.cz;
    const r = Math.hypot(dx, dz);
    const l = this.locate(Math.atan2(dx, dz));
    const R = this.lerpAt(this.R, l), b = this.lerpAt(this.beach, l);
    if (r >= R) return { zone: 'water', y: 0, steep: 0, beach: b, s: r / Math.max(1, this.lerpAt(this.rimR, l)) };
    const rim = this.lerpAt(this.rimR, l);
    const shoreR = this.lerpAt(this.shoreR, l), shoreY = this.lerpAt(this.shoreY, l);
    if (r > shoreR && b > 0.3) {
      const f = (R - r) / Math.max(0.1, R - shoreR);
      return { zone: 'beach', y: shoreY * Math.pow(clamp(f, 0, 1), 0.85), steep: 0.1, beach: b, s: r / rim };
    }
    if (r > rim) {
      const H = this.lerpAt(this.H, l);
      const zone: SurfaceZone = b > 0.5 ? 'slope' : 'cliff';
      const f = clamp((shoreR - r) / Math.max(0.1, shoreR - rim), 0, 1);
      return { zone, y: lerp(shoreY, H, f), steep: zone === 'cliff' ? 1 : 0.4, beach: b, s: r / rim };
    }
    const s = r / Math.max(0.01, rim);
    const y0 = this.topY(l.i0, s), y1 = this.topY(l.i1, s);
    const y = y0 + (y1 - y0) * l.f;
    // Slope from the radial derivative (angular variation is small at island scale).
    const ds = 2 / Math.max(4, rim);
    const ya = this.topY(l.i0, Math.min(1, s + ds)) * (1 - l.f) + this.topY(l.i1, Math.min(1, s + ds)) * l.f;
    const yb = this.topY(l.i0, Math.max(0, s - ds)) * (1 - l.f) + this.topY(l.i1, Math.max(0, s - ds)) * l.f;
    const grad = Math.abs(ya - yb) / (4 * Math.max(0.001, Math.min(1, s + ds) - Math.max(0, s - ds)) / (2 * ds));
    const steep = clamp(grad / 1.4, 0, 1);
    return { zone: 'top', y, steep, beach: b, s };
  }

  /** World position of coast vertex i pushed to radius r. */
  point(i: number, r: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
    const t = this.theta[i]!;
    out.x = this.cx + Math.sin(t) * r;
    out.z = this.cz + Math.cos(t) * r;
    return out;
  }
}

// ─────────────────────────────── Ring model ───────────────────────────────

interface MergedBand { bottom: number; top: number; k: number }

function mergedBands(surface: IslandSurface, lod: number): MergedBand[] {
  const bands = surface.shape.strata;
  const step = lod === 0 ? 1 : lod === 1 ? 2 : 4;
  const out: MergedBand[] = [];
  for (let k = 0; k < bands.length; k += step) {
    const last = bands[Math.min(bands.length - 1, k + step - 1)]!;
    out.push({ bottom: bands[k]!.bottom, top: last.top, k });
  }
  return out;
}

/** Builds the ring stack for one LOD (0 = full detail, 1 = half, 2 = far silhouette). */
export function buildRingModel(surface: IslandSurface, lod: 0 | 1 | 2): RingModel {
  const stride = lod === 0 ? 1 : lod === 1 ? 2 : 4;
  const minN = surface.shape.spec.archetype === 'rock' ? 10 : 12;
  const n = Math.max(Math.min(surface.n, minN), Math.ceil(surface.n / stride));
  const index = new Int32Array(n);
  const sin = new Float32Array(n), cos = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const i = Math.min(surface.n - 1, Math.floor((j * surface.n) / n));
    index[j] = i;
    sin[j] = Math.sin(surface.theta[i]!);
    cos[j] = Math.cos(surface.theta[i]!);
  }
  const sections: RingSection[] = [];
  const ring = (role: RingRole, band: number, fn: (i: number, j: number) => [number, number]): RingData => {
    const r = new Float32Array(n), y = new Float32Array(n);
    for (let j = 0; j < n; j++) { const v = fn(index[j]!, j); r[j] = v[0]; y[j] = v[1]; }
    return { role, band, r, y };
  };
  const copy = (src: RingData, role: RingRole = src.role, band = src.band): RingData => ({ role, band, r: src.r.slice(), y: src.y.slice() });
  const R = surface.R, B = surface.beach, H = surface.H;
  const shape = surface.shape;

  // Section 0: skirt → waterline (exact collision polygon) → wet band → shore/crest.
  const shoreRing = ring('shore', -1, (i) => [surface.shoreR[i]!, surface.shoreY[i]!]);
  sections.push({ rings: [
    ring('skirt', -1, (i) => [R[i]! + 3 + 6 * B[i]!, -11]),
    ring('water', -1, (i) => [R[i]!, 0]),
    ring('wet', -1, (i) => [R[i]! - lerp(0.12, 3.6, B[i]!), lerp(1.6, 0.55, B[i]!)]),
    shoreRing,
  ] });

  // Strata bands: face sections separated by ledge sections.
  const bands = mergedBands(surface, lod);
  const bandRadius = (i: number, y: number, k: number): number => {
    const top = surface.topBand[i]!;
    if (y >= H[i]! - 1e-4) return surface.rimR[i]!;
    return surface.faceR(i, y, Math.min(k, top));
  };
  const clampY = (i: number, y: number): number => clamp(y, surface.shoreY[i]!, H[i]!);
  let prevTop: RingData = shoreRing;
  for (let m = 0; m < bands.length; m++) {
    const band = bands[m]!;
    const face: RingData[] = [];
    if (m === 0) {
      // The first band grows straight out of the shore ring (hard edge between wet rock / sand and the face).
      face.push(copy(shoreRing, 'face', band.k));
    } else {
      const bottom = ring('face', band.k, (i) => { const y = clampY(i, band.bottom); return [bandRadius(i, y, band.k), y]; });
      sections.push({ rings: [copy(prevTop, 'ledge'), copy(bottom, 'ledge')] });
      face.push(bottom);
    }
    if (lod === 0 && band.top - band.bottom > 3.2) {
      face.push(ring('face', band.k, (i) => {
        const y = clampY(i, (band.bottom + band.top) / 2);
        const bulge = 0.34 * (1 - B[i]!) * smoothstep(3, 6, y);
        return [bandRadius(i, y, band.k) + bulge, y];
      }));
    }
    const top = ring('face', band.k, (i) => { const y = clampY(i, band.top); return [bandRadius(i, y, band.k), y]; });
    face.push(top);
    sections.push({ rings: face });
    prevTop = top;
  }

  // Lip underside (grass overhang) then the top surface.
  const rimRing = ring('face', -1, (i) => [surface.rimR[i]!, H[i]!]);
  const lipRing = ring('lip', -1, (i) => [surface.lipR[i]!, surface.lipY[i]!]);
  if (lod < 2) sections.push({ rings: [copy(rimRing, 'lip'), lipRing] });
  const topRings: RingData[] = [lod < 2 ? copy(lipRing, 'top') : copy(rimRing, 'top')];
  const archetype = shape.spec.archetype;
  if (shape.tierRise > 0) {
    for (const f of TIER_OUTER[lod]!) {
      topRings.push(ring('top', -1, (i) => { const s = 1 - (1 - surface.tierS[i]!) * f; return [surface.rimR[i]! * s, surface.topY(i, s)]; }));
    }
    sections.push({ rings: topRings });
    // Second tier: its own strata between the two plateau heights.
    const lowY = (i: number) => surface.topY(i, surface.tierS[i]! + 1e-4);
    const tierTop = (i: number) => lowY(i) + shape.tierRise;
    const strata = shape.strata;
    const bandAt = (y: number) => { let k = 0; while (k < strata.length - 1 && strata[k]!.top < y) k++; return k; };
    const tierR = (i: number, y: number, k: number) => {
      const base = surface.rimR[i]! * surface.tierS[i]!;
      const low = lowY(i), high = tierTop(i);
      // Bands collapsed above the tier top reuse the band that holds the top (no flat slivers at the rim).
      const kk = y >= high - 1e-4 ? bandAt(high) : k;
      const ramp = smoothstep(low + 0.5, low + 3, y);
      return Math.max(2, base - shape.lean * (y - low) - shape.bandInset(kk, surface.theta[i]!) * ramp * 0.8);
    };
    let prev: RingData | null = null;
    let lastK = 0;
    for (const band of bands) {
      const yb = (i: number) => clamp(band.bottom, lowY(i), tierTop(i));
      const yt = (i: number) => clamp(band.top, lowY(i), tierTop(i));
      const bottom = ring('tier-face', band.k, (i) => [tierR(i, yb(i), band.k), yb(i)]);
      const top = ring('tier-face', band.k, (i) => [tierR(i, yt(i), band.k), yt(i)]);
      if (prev) sections.push({ rings: [copy(prev, 'tier-ledge'), copy(bottom, 'tier-ledge')] });
      sections.push({ rings: [bottom, top] });
      prev = top;
      lastK = band.k;
    }
    const tierRim = prev!;
    const tierLip = ring('tier-lip', -1, (i) => [tierR(i, tierTop(i), lastK) + 0.7, tierTop(i) + 0.3]);
    if (lod < 2) sections.push({ rings: [copy(tierRim, 'tier-lip'), tierLip] });
    const inner: RingData[] = [lod < 2 ? copy(tierLip, 'top') : copy(tierRim, 'top')];
    for (const g of TIER_INNER[lod]!) inner.push(ring('top', -1, (i) => { const s = surface.tierS[i]! * g; return [surface.rimR[i]! * s, surface.topY(i, s)]; }));
    sections.push({ rings: inner });
  } else {
    for (const s of TOP_RINGS[archetype][lod]!) topRings.push(ring('top', -1, (i) => [surface.rimR[i]! * s, surface.topY(i, s)]));
    sections.push({ rings: topRings });
  }
  let centerY = 0;
  for (let j = 0; j < n; j++) centerY += surface.topY(index[j]!, 0);
  centerY /= n;
  return { surface, lod, n, index, sin, cos, sections, centerY };
}
