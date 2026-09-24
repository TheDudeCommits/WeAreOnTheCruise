/**
 * Polygon queries shared by collision (sim) and meshing (render). WORLD-owned, pure TypeScript.
 *
 * Winding: coastlines follow the contract's "counter-clockwise viewed from above" (+Y looking down, −Z up on
 * screen), which is a NEGATIVE shoelace sum in raw (x, z) — the same winding the v2 skeleton used
 * (x = cx + sin θ·r, z = cz + cos θ·r with θ increasing).
 */
import type { Vec2 } from '../game/types';

/** Shoelace sum ½Σ(x_i z_{i+1} − x_{i+1} z_i); negative for contract winding. */
export function shoelace(outline: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j]!, b = outline[i]!;
    sum += a.x * b.z - b.x * a.z;
  }
  return sum * 0.5;
}

export function polygonAreaAbs(outline: readonly Vec2[]): number { return Math.abs(shoelace(outline)); }

/** Returns the outline in contract winding (reverses a copy if needed). */
export function ensureContractWinding(outline: Vec2[]): Vec2[] {
  return shoelace(outline) > 0 ? outline.slice().reverse() : outline;
}

export function pointInPolygon(outline: readonly Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j]!, b = outline[i]!;
    if ((b.z > z) !== (a.z > z) && x < ((a.x - b.x) * (z - b.z)) / (a.z - b.z) + b.x) inside = !inside;
  }
  return inside;
}

/** Signed distance only (negative inside); no allocation. */
export function signedDistanceValue(outline: readonly Vec2[], x: number, z: number): number {
  let minSq = Infinity, inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j]!, b = outline[i]!;
    if ((b.z > z) !== (a.z > z) && x < ((a.x - b.x) * (z - b.z)) / (a.z - b.z) + b.x) inside = !inside;
    const ex = b.x - a.x, ez = b.z - a.z;
    let t = ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (a.x + ex * t), dz = z - (a.z + ez * t);
    const sq = dx * dx + dz * dz;
    if (sq < minSq) minSq = sq;
  }
  const d = Math.sqrt(minSq);
  return inside ? -d : d;
}

export interface SignedDistance { distance: number; nx: number; nz: number }

/** Signed distance from (x,z) to a closed polygon (negative inside) and the outward normal at the closest point. */
export function signedDistance(outline: readonly Vec2[], x: number, z: number, out: SignedDistance = { distance: 0, nx: 0, nz: 0 }): SignedDistance {
  let minSq = Infinity, nx = 0, nz = 0, inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j]!, b = outline[i]!;
    if ((b.z > z) !== (a.z > z) && x < ((a.x - b.x) * (z - b.z)) / (a.z - b.z) + b.x) inside = !inside;
    const ex = b.x - a.x, ez = b.z - a.z;
    let t = ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (a.x + ex * t), dz = z - (a.z + ez * t);
    const sq = dx * dx + dz * dz;
    if (sq < minSq) { minSq = sq; nx = dx; nz = dz; }
  }
  const d = Math.sqrt(minSq) || 1e-6;
  const sign = inside ? -1 : 1;
  out.distance = sign * d;
  out.nx = (nx / d) * sign;
  out.nz = (nz / d) * sign;
  return out;
}

/** True if the polygon has no self-intersections (O(n²); tests and authoring only). */
export function isSimplePolygon(outline: readonly Vec2[]): boolean {
  const n = outline.length;
  const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  for (let i = 0; i < n; i++) {
    const a = outline[i]!, b = outline[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const c = outline[j]!, d = outline[(j + 1) % n]!;
      const d1 = cross(a.x, a.z, b.x, b.z, c.x, c.z), d2 = cross(a.x, a.z, b.x, b.z, d.x, d.z);
      const d3 = cross(c.x, c.z, d.x, d.z, a.x, a.z), d4 = cross(c.x, c.z, d.x, d.z, b.x, b.z);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return false;
    }
  }
  return true;
}
