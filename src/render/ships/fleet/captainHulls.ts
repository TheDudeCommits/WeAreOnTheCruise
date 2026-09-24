/**
 * Captain hulls (CAPTAINS-owned): the six hero models, baked cheap for AI captains.
 *
 * Each hull loads the hero's low-detail GLB through the existing SketchfabShipAssets loader (toonified, Baratie/Moby
 * source paint baked), then bakes every mesh into ONE vertex-coloured geometry in gameplay space (ShipDef.length,
 * bow −Z, waterline y = 0): albedo maps are sampled per vertex (sRGB → linear, × material colour × vertex colour), so a
 * captain costs one draw call (plus its ink and shadow passes) whatever the source's material count (Sunlion has 36).
 * Hulls above TRI_CAP (the Seawarden's low file is 158k triangles) are simplified by vertex clustering (positions
 * shared per cell, so no cracks; normals/colours per cell and facing so hard edges stay). The loader instance is
 * disposed after the bake and the decoded images are closed: only the baked geometry stays in memory.
 */
import * as THREE from 'three';
import type { HeroModelKey } from '../../../game/ids';
import { HERO_SOURCE_LENGTH, SketchfabShipAssets } from '../../loaders/SketchfabShipAssets';
import { HERO_RIGS } from '../hero/heroRigs';
import { runSliced } from '../../loaders/idle';

/** Triangle budget per captain hull. */
export const TRI_CAP = 24000;

export interface CaptainHull {
  kind: HeroModelKey;
  length: number;
  geometry: THREE.BufferGeometry;
  /** Albedo levels the source materials used (delight tames baked light in mapped albedo). */
  delight: number;
  triangles: number;
  sourceTriangles: number;
  bakeMs: number;
  /** Local points (gameplay space). */
  mastTop: THREE.Vector3;
  gunY: number;
  gunX: number;
  deckY: number;
  bowZ: number;
  sternZ: number;
}

type Sampler = (u: number, v: number, out: THREE.Color) => void;

/** Reads a texture's pixels once (downscaled to ≤256², enough for per-vertex colour) and samples them. */
function textureSampler(tex: THREE.Texture | null | undefined, cache: Map<THREE.Texture, Sampler | null>): Sampler | null {
  if (!tex) return null;
  if (cache.has(tex)) return cache.get(tex)!;
  let sampler: Sampler | null = null;
  const img = tex.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (img && img.width && img.height && typeof document !== 'undefined') {
    const W = Math.min(256, img.width), H = Math.min(256, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data;
      tex.updateMatrix();
      const m = tex.matrix.elements;
      const flip = tex.flipY;
      const repeatS = tex.wrapS !== THREE.ClampToEdgeWrapping, repeatT = tex.wrapT !== THREE.ClampToEdgeWrapping;
      sampler = (u0, v0, out) => {
        let u = m[0]! * u0 + m[3]! * v0 + m[6]!, v = m[1]! * u0 + m[4]! * v0 + m[7]!;
        u = repeatS ? u - Math.floor(u) : Math.min(1, Math.max(0, u));
        v = repeatT ? v - Math.floor(v) : Math.min(1, Math.max(0, v));
        if (flip) v = 1 - v;
        const x = Math.min(W - 1, Math.floor(u * W)), y = Math.min(H - 1, Math.floor(v * H));
        const i = (y * W + x) * 4;
        out.setRGB(data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255, THREE.SRGBColorSpace);
      };
    }
  }
  cache.set(tex, sampler);
  return sampler;
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpC = new THREE.Color();
const tmpT = new THREE.Color();

interface Baked { pos: Float32Array; nrm: Float32Array; col: Float32Array; idx: Uint32Array }

/** Vertices processed between yields of the sliced bake (≈0.5–1 ms of work on an M-class laptop). */
const STEP_VERTICES = 6000;

/**
 * Merges every mesh of a (toonified) template into one vertex-coloured geometry in gameplay space. A generator: it
 * yields between chunks so the bake runs in idle slices (loaders/idle.ts runSliced) instead of one long task.
 */
function* mergeSteps(scene: THREE.Object3D, scale: number): Generator<void, Baked & { mapped: boolean }> {
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  let vCount = 0, iCount = 0;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    meshes.push(mesh);
    vCount += mesh.geometry.attributes.position.count;
    iCount += mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count;
  });
  const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3).fill(1);
  const idx = new Uint32Array(iCount);
  const cache = new Map<THREE.Texture, Sampler | null>();
  let vBase = 0, iOut = 0, mapped = false, work = 0;
  yield;
  for (const mesh of meshes) {
    const g = mesh.geometry as THREE.BufferGeometry;
    const P = g.attributes.position!, N = g.attributes.normal, UV = g.attributes.uv, C = g.attributes.color;
    const n = P.count;
    const world = mesh.matrixWorld;
    // Per mesh (not the shared scratch): two bakes may interleave between yields.
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
    for (let v = 0; v < n; v++) {
      tmpV.fromBufferAttribute(P, v).applyMatrix4(world).multiplyScalar(scale);
      pos[(vBase + v) * 3] = tmpV.x; pos[(vBase + v) * 3 + 1] = tmpV.y; pos[(vBase + v) * 3 + 2] = tmpV.z;
      if (N) { tmpN.fromBufferAttribute(N, v).applyMatrix3(normalMatrix).normalize(); nrm[(vBase + v) * 3] = tmpN.x; nrm[(vBase + v) * 3 + 1] = tmpN.y; nrm[(vBase + v) * 3 + 2] = tmpN.z; }
      if (++work % STEP_VERTICES === 0) yield;
    }
    // Colour per vertex from the material that draws it (groups map index ranges to materials).
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const index = g.index;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: index ? index.count : n, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0] as THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null; vertexColors?: boolean };
      if (!mat) continue;
      const fresh = !!mat.map && !cache.has(mat.map);
      const sampler = UV ? textureSampler(mat.map, cache) : null;
      if (fresh) yield; // reading a texture back (drawImage + getImageData) is the priciest single step
      if (sampler) mapped = true;
      const base = new THREE.Color(1, 1, 1);
      if (mat.color) base.copy(mat.color);
      const end = Math.min(grp.start + grp.count, index ? index.count : n);
      for (let k = grp.start; k < end; k++) {
        const v = index ? index.getX(k) : k;
        tmpC.copy(base);
        if (sampler && UV) { sampler(UV.getX(v), UV.getY(v), tmpT); tmpC.multiply(tmpT); }
        if (C && mat.vertexColors) tmpC.multiply(tmpT.setRGB(C.getX(v), C.getY(v), C.getZ(v)));
        const o = (vBase + v) * 3;
        col[o] = tmpC.r; col[o + 1] = tmpC.g; col[o + 2] = tmpC.b;
        idx[iOut++] = vBase + v;
        if (++work % STEP_VERTICES === 0) yield;
      }
    }
    vBase += n;
  }
  return { pos, nrm, col, idx: idx.subarray(0, iOut), mapped };
}

/**
 * Vertex clustering to a cell size: positions shared per cell (crack-free), normals/colours per cell and facing.
 * A generator (see mergeSteps).
 */
function* clusterSteps(src: Baked, cell: number): Generator<void, Baked> {
  const { pos, nrm, col, idx } = src;
  const cellOf = new Map<number, number>();
  const vertOf = new Map<number, number>();
  const cPos: number[] = [], cCount: number[] = [];
  const vCell: number[] = [], vN: number[] = [], vC: number[] = [], vCount: number[] = [];
  const remap = new Int32Array(pos.length / 3);
  for (let v = 0; v < remap.length; v++) {
    const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
    const ck = ((Math.floor(x / cell) + 1024) * 2048 + (Math.floor(y / cell) + 1024)) * 2048 + (Math.floor(z / cell) + 1024);
    let ci = cellOf.get(ck);
    if (ci === undefined) { ci = cCount.length; cellOf.set(ck, ci); cPos.push(0, 0, 0); cCount.push(0); }
    cPos[ci * 3] += x; cPos[ci * 3 + 1] += y; cPos[ci * 3 + 2] += z; cCount[ci]!++;
    const nx = nrm[v * 3]!, ny = nrm[v * 3 + 1]!, nz = nrm[v * 3 + 2]!;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const facing = ax >= ay && ax >= az ? (nx >= 0 ? 0 : 1) : ay >= az ? (ny >= 0 ? 2 : 3) : (nz >= 0 ? 4 : 5);
    const vk = ci * 6 + facing;
    let vi = vertOf.get(vk);
    if (vi === undefined) { vi = vCount.length; vertOf.set(vk, vi); vCell.push(ci); vN.push(0, 0, 0); vC.push(0, 0, 0); vCount.push(0); }
    vN[vi * 3] += nx; vN[vi * 3 + 1] += ny; vN[vi * 3 + 2] += nz;
    vC[vi * 3] += col[v * 3]!; vC[vi * 3 + 1] += col[v * 3 + 1]!; vC[vi * 3 + 2] += col[v * 3 + 2]!;
    vCount[vi]!++;
    remap[v] = vi;
    if (v % (STEP_VERTICES * 2) === 0) yield;
  }
  const out: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]!]!, b = remap[idx[t + 1]!]!, c = remap[idx[t + 2]!]!;
    if (vCell[a] === vCell[b] || vCell[b] === vCell[c] || vCell[a] === vCell[c]) continue;
    out.push(a, b, c);
    if (t % (STEP_VERTICES * 6) === 0) yield;
  }
  const n = vCount.length;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ci = vCell[i]!, k = cCount[ci]!, w = vCount[i]!;
    P[i * 3] = cPos[ci * 3]! / k; P[i * 3 + 1] = cPos[ci * 3 + 1]! / k; P[i * 3 + 2] = cPos[ci * 3 + 2]! / k;
    const l = Math.hypot(vN[i * 3]!, vN[i * 3 + 1]!, vN[i * 3 + 2]!) || 1;
    N[i * 3] = vN[i * 3]! / l; N[i * 3 + 1] = vN[i * 3 + 1]! / l; N[i * 3 + 2] = vN[i * 3 + 2]! / l;
    C[i * 3] = vC[i * 3]! / w; C[i * 3 + 1] = vC[i * 3 + 1]! / w; C[i * 3 + 2] = vC[i * 3 + 2]! / w;
  }
  return { pos: P, nrm: N, col: C, idx: Uint32Array.from(out) };
}

/** Wraps a generator so the CPU time spent inside its steps is summed into `clock.ms`. */
function* timed<T>(steps: Generator<void, T>, clock: { ms: number }): Generator<void, T> {
  for (;;) {
    const t0 = performance.now();
    const r = steps.next();
    clock.ms += performance.now() - t0;
    if (r.done) return r.value;
    yield;
  }
}

/**
 * Bakes one hero model into a captain hull. The merge and the clustering run in idle slices (PERF: a bake used to be
 * one 100–150 ms task in the first seconds of a run); `bakeMs` is the CPU time of those slices.
 */
export async function bakeCaptainHull(kind: HeroModelKey, length: number): Promise<CaptainHull> {
  const assets = new SketchfabShipAssets({ notify: false });
  try {
    const template = await assets.load(kind, 'low');
    const clock = { ms: 0 };
    const scale = length / HERO_SOURCE_LENGTH[kind];
    const merged = await runSliced(timed(mergeSteps(template.scene, scale), clock));
    const sourceTriangles = merged.idx.length / 3;
    let baked: Baked = merged;
    if (sourceTriangles > TRI_CAP) {
      let cell = length / 200;
      for (let i = 0; i < 10; i++) {
        baked = await runSliced(timed(clusterSteps(merged, cell), clock));
        if (baked.idx.length / 3 <= TRI_CAP) break;
        cell *= 1.3;
      }
    }
    const t0 = performance.now();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(baked.pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(baked.nrm, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(baked.col, 3));
    geometry.setIndex(new THREE.BufferAttribute(baked.idx, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    // Close the decoded images now (ImageBitmaps are not collected on their own); only the bake is kept.
    for (const m of template.materials) {
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture) (value.image as { close?: () => void } | undefined)?.close?.();
      }
    }
    const shape = profile(kind, baked.pos, geometry.boundingBox!, scale);
    clock.ms += performance.now() - t0;
    return { kind, length, geometry, delight: merged.mapped ? 0.3 : 0, triangles: baked.idx.length / 3, sourceTriangles, bakeMs: clock.ms, ...shape };
  } finally {
    assets.dispose();
  }
}

/** Mast top, gun line and deck height from the authored rig hints, measured on the baked vertices. */
function profile(kind: HeroModelKey, pos: Float32Array, box: THREE.Box3, scale: number): Pick<CaptainHull, 'mastTop' | 'gunY' | 'gunX' | 'deckY' | 'bowZ' | 'sternZ'> {
  const rig = HERO_RIGS[kind];
  const mast = rig.masts[0] ?? { x: 0, z: 0 };
  const mx = mast.x * scale, mz = mast.z * scale;
  const gunY = rig.guns.y * scale, gz0 = rig.guns.z0 * scale, gz1 = rig.guns.z1 * scale;
  let top = -Infinity, gunX = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
    if (Math.abs(x - mx) < 1.5 && Math.abs(z - mz) < 1.5 && y > top) top = y;
    if (Math.abs(y - gunY) < 1.2 && z > gz0 && z < gz1 && Math.abs(x) > gunX) gunX = Math.abs(x);
  }
  const band = rig.rails[0];
  const deckY = band ? ((band.yMin + band.yMax) / 2) * scale : gunY + 1;
  return {
    mastTop: new THREE.Vector3(mx, Number.isFinite(top) ? top : box.max.y, mz),
    gunY, gunX: gunX || (box.max.x - box.min.x) * 0.4, deckY, bowZ: box.min.z, sternZ: box.max.z,
  };
}
