/**
 * Geometry probe for downloaded hero models (SHIPS-owned). Bins every triangle of a model (in its normalized source
 * space) into an XZ grid for vertical line queries and a YZ grid for lateral (along X) queries, so hundreds of probes
 * run in a few milliseconds even on the 254k-triangle Seawarden. Used once at load to derive deck heights, rail lines,
 * hull sides and mast tops.
 */
import * as THREE from 'three';

export interface VerticalHit { y: number; /** |normal.y| of the face (1 = flat deck). */ ny: number }

interface Grid { min0: number; min1: number; cell: number; n0: number; n1: number; offsets: Uint32Array; items: Uint32Array }

export class HullSampler {
  readonly box = new THREE.Box3();
  private readonly tris: Float32Array;
  private readonly count: number;
  private readonly xz: Grid;
  private readonly yz: Grid;
  private readonly hits: VerticalHit[] = [];

  constructor(root: THREE.Object3D, cell = 0.75) {
    root.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const local = new THREE.Matrix4();
    const chunks: Float32Array[] = [];
    let total = 0;
    const v = new THREE.Vector3();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const g = object.geometry as THREE.BufferGeometry;
      const pos = g.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
      local.multiplyMatrices(inverse, object.matrixWorld);
      const index = g.index;
      const n = index ? index.count : pos.count;
      const out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(local);
        out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
        this.box.expandByPoint(v);
      }
      chunks.push(out);
      total += n / 3;
    });
    this.count = Math.floor(total);
    this.tris = new Float32Array(this.count * 9);
    let o = 0;
    for (const c of chunks) { this.tris.set(c.subarray(0, Math.floor(c.length / 9) * 9), o); o += Math.floor(c.length / 9) * 9; }
    this.xz = this.buildGrid(0, 2, cell);
    this.yz = this.buildGrid(1, 2, cell);
  }

  get triangles(): number { return this.count; }

  private buildGrid(a0: number, a1: number, cell: number): Grid {
    const min = this.box.min, max = this.box.max;
    const lo0 = a0 === 0 ? min.x : min.y, hi0 = a0 === 0 ? max.x : max.y;
    const lo1 = min.z, hi1 = max.z;
    void a1;
    const n0 = Math.max(1, Math.ceil((hi0 - lo0) / cell) + 1);
    const n1 = Math.max(1, Math.ceil((hi1 - lo1) / cell) + 1);
    const counts = new Uint32Array(n0 * n1 + 1);
    const t = this.tris;
    const range = (i: number, out: Int32Array) => {
      const b = i * 9;
      const p0 = t[b + a0]!, p1 = t[b + 3 + a0]!, p2 = t[b + 6 + a0]!;
      const q0 = t[b + 2]!, q1 = t[b + 5]!, q2 = t[b + 8]!;
      out[0] = Math.max(0, Math.floor((Math.min(p0, p1, p2) - lo0) / cell));
      out[1] = Math.min(n0 - 1, Math.floor((Math.max(p0, p1, p2) - lo0) / cell));
      out[2] = Math.max(0, Math.floor((Math.min(q0, q1, q2) - lo1) / cell));
      out[3] = Math.min(n1 - 1, Math.floor((Math.max(q0, q1, q2) - lo1) / cell));
    };
    const r = new Int32Array(4);
    for (let i = 0; i < this.count; i++) {
      range(i, r);
      for (let c0 = r[0]!; c0 <= r[1]!; c0++) for (let c1 = r[2]!; c1 <= r[3]!; c1++) counts[c0 * n1 + c1]!++;
    }
    const offsets = new Uint32Array(n0 * n1 + 1);
    for (let i = 0; i < n0 * n1; i++) offsets[i + 1] = offsets[i]! + counts[i]!;
    const items = new Uint32Array(offsets[n0 * n1]!);
    const fill = offsets.slice(0, n0 * n1);
    for (let i = 0; i < this.count; i++) {
      range(i, r);
      for (let c0 = r[0]!; c0 <= r[1]!; c0++) for (let c1 = r[2]!; c1 <= r[3]!; c1++) items[fill[c0 * n1 + c1]!++] = i;
    }
    return { min0: lo0, min1: lo1, cell, n0, n1, offsets, items };
  }

  /** All surfaces crossed by the vertical line at (x, z), sorted top → bottom. The array is reused. */
  vertical(x: number, z: number): readonly VerticalHit[] {
    const hits = this.hits;
    hits.length = 0;
    const g = this.xz;
    const c0 = Math.floor((x - g.min0) / g.cell), c1 = Math.floor((z - g.min1) / g.cell);
    if (c0 < 0 || c1 < 0 || c0 >= g.n0 || c1 >= g.n1) return hits;
    const cellIndex = c0 * g.n1 + c1;
    const t = this.tris;
    for (let k = g.offsets[cellIndex]!; k < g.offsets[cellIndex + 1]!; k++) {
      const b = g.items[k]! * 9;
      const ax = t[b]!, ay = t[b + 1]!, az = t[b + 2]!;
      const bx = t[b + 3]!, by = t[b + 4]!, bz = t[b + 5]!;
      const cx = t[b + 6]!, cy = t[b + 7]!, cz = t[b + 8]!;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
      const y = w0 * ay + w1 * by + w2 * cy;
      // Face normal y component (unnormalized cross product).
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, nyv = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, nyv, nz) || 1;
      hits.push({ y, ny: Math.abs(nyv) / len });
    }
    hits.sort((p, q) => q.y - p.y);
    return hits;
  }

  /** X coordinates of every surface crossed by the line along X at (y, z), unsorted. */
  lateral(y: number, z: number, out: number[]): number[] {
    out.length = 0;
    const g = this.yz;
    const c0 = Math.floor((y - g.min0) / g.cell), c1 = Math.floor((z - g.min1) / g.cell);
    if (c0 < 0 || c1 < 0 || c0 >= g.n0 || c1 >= g.n1) return out;
    const cellIndex = c0 * g.n1 + c1;
    const t = this.tris;
    for (let k = g.offsets[cellIndex]!; k < g.offsets[cellIndex + 1]!; k++) {
      const b = g.items[k]! * 9;
      const ax = t[b]!, ay = t[b + 1]!, az = t[b + 2]!;
      const bx = t[b + 3]!, by = t[b + 4]!, bz = t[b + 5]!;
      const cx = t[b + 6]!, cy = t[b + 7]!, cz = t[b + 8]!;
      const d = (bz - cz) * (ay - cy) + (cy - by) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const w0 = ((bz - cz) * (y - cy) + (cy - by) * (z - cz)) / d;
      const w1 = ((cz - az) * (y - cy) + (ay - cy) * (z - cz)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
      out.push(w0 * ax + w1 * bx + w2 * cx);
    }
    return out;
  }

  /** Outermost hull surface on one side (+1 starboard / −1 port) at height y, or NaN. */
  sideX(y: number, z: number, side: 1 | -1, scratch: number[] = []): number {
    const xs = this.lateral(y, z, scratch);
    let best = Number.NaN;
    for (const x of xs) if (Math.sign(x) === side || Math.abs(x) < 0.05) { if (Number.isNaN(best) || x * side > best * side) best = x; }
    return best;
  }

  /** Highest surface below `fromY` at (x, z) whose face is flatter than `minNy`, or NaN. */
  surfaceBelow(x: number, z: number, fromY: number, minNy = 0.55, minY = -Infinity): number {
    for (const h of this.vertical(x, z)) if (h.y <= fromY && h.y >= minY && h.ny >= minNy) return h.y;
    return Number.NaN;
  }

  /** Highest point of any surface within `radius` of (x, z) (sparse ring probe). */
  topNear(x: number, z: number, radius: number): number {
    let top = -Infinity;
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i === 8 ? 0 : radius;
      const hits = this.vertical(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (hits.length && hits[0]!.y > top) top = hits[0]!.y;
    }
    return top;
  }
}
