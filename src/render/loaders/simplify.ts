/**
 * Position-only mesh reduction for shadow casters (PERF-owned). Generators, so callers run them in idle slices
 * (loaders/idle.ts runSliced) instead of one long task.
 *
 * Vertex clustering on a fine grid: every vertex moves to the mean of the vertices sharing its cell and triangles
 * whose corners collapse are dropped. Large smooth surfaces (one vertex per cell) are left exactly as they were; dense
 * detail — cannon batteries, rope coils, carved rails — collapses. With a cell at or below the shadow-map texel size
 * the cast shadow is unchanged to the eye.
 */
import * as THREE from 'three';

export interface PositionMesh { pos: Float32Array; idx: Uint32Array }

const STEP = 8000;

/** Merges the positions of `meshes` into one indexed list in `root`'s space (root must be an ancestor of each mesh). */
export function* mergePositions(meshes: readonly THREE.Mesh[], root: THREE.Object3D): Generator<void, PositionMesh> {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  let vCount = 0, iCount = 0;
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    vCount += g.attributes.position!.count;
    iCount += g.index ? g.index.count : g.attributes.position!.count;
  }
  const pos = new Float32Array(vCount * 3), idx = new Uint32Array(iCount);
  const local = new THREE.Matrix4(), v = new THREE.Vector3();
  let vBase = 0, iOut = 0, work = 0;
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    const P = g.attributes.position!;
    local.multiplyMatrices(inverse, m.matrixWorld);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(local);
      pos[(vBase + i) * 3] = v.x; pos[(vBase + i) * 3 + 1] = v.y; pos[(vBase + i) * 3 + 2] = v.z;
      if (++work % STEP === 0) yield;
    }
    const index = g.index;
    const n = index ? index.count : P.count;
    for (let k = 0; k < n; k++) idx[iOut++] = vBase + (index ? index.getX(k) : k);
    vBase += P.count;
    yield;
  }
  return { pos, idx };
}

/** Vertex clustering to `cell` (same units as the positions). */
export function* clusterPositions(src: PositionMesh, cell: number): Generator<void, PositionMesh> {
  const { pos, idx } = src;
  const cellOf = new Map<number, number>();
  const sums: number[] = [], counts: number[] = [];
  const remap = new Int32Array(pos.length / 3);
  for (let v = 0; v < remap.length; v++) {
    const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
    const key = ((Math.floor(x / cell) + 4096) * 8192 + (Math.floor(y / cell) + 4096)) * 8192 + (Math.floor(z / cell) + 4096);
    let c = cellOf.get(key);
    if (c === undefined) { c = counts.length; cellOf.set(key, c); sums.push(0, 0, 0); counts.push(0); }
    sums[c * 3] += x; sums[c * 3 + 1] += y; sums[c * 3 + 2] += z; counts[c]!++;
    remap[v] = c;
    if (v % STEP === 0) yield;
  }
  const out: number[] = [];
  // Coincident duplicates (e.g. both windings of a shell collapsing onto one triangle) are kept once: proxies are
  // drawn double-sided. Numeric keys while the cluster count fits 17 bits per corner.
  const dedupe = counts.length < 131072;
  const seen = new Set<number>();
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]!]!, b = remap[idx[t + 1]!]!, c = remap[idx[t + 2]!]!;
    if (a === b || b === c || a === c) continue;
    if (dedupe) {
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
      const key = lo * 17179869184 + mid * 131072 + hi;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(a, b, c);
    if (t % (STEP * 3) === 0) yield;
  }
  const P = new Float32Array(counts.length * 3);
  for (let c = 0; c < counts.length; c++) {
    const k = counts[c]!;
    P[c * 3] = sums[c * 3]! / k; P[c * 3 + 1] = sums[c * 3 + 1]! / k; P[c * 3 + 2] = sums[c * 3 + 2]! / k;
  }
  return { pos: P, idx: Uint32Array.from(out) };
}

/** Geometry (position + index) for a clustered caster. */
export function casterGeometry(m: PositionMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setIndex(new THREE.BufferAttribute(m.idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
