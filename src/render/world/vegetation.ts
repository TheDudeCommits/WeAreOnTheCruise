/**
 * Procedural vegetation and rocks (WORLD-owned). Palms, broadleaf trees, conifers, dead trees and bushes are unit
 * geometries drawn with InstancedMesh (one draw call per variant for the whole archipelago); forest canopy blobs,
 * shoreline rocks and vines are merged straight into each feature's terrain mesh. All vertex-coloured for the
 * shared toon material; shapes are silhouette-first (droopy fronds, cloud canopies, faceted boulders).
 */
import * as THREE from 'three';
import { fbm, hash01 } from '../../world/noise';
import type { CanopyBlob, PropKind, RockPlacement, VinePlan } from '../../world/plan';
import { MeshBuilder, trs } from './meshBuilder';
import type { TerrainPalette } from './palette';

const m4 = new THREE.Matrix4();
const col = new THREE.Color();
const c = (hex: number) => new THREE.Color(hex);

// ─────────────────────────────── Instanced prop geometries ───────────────────────────────

export interface PropVariant { key: string; kind: PropKind; geometry: THREE.BufferGeometry; /** Visual height at scale 1 (m). */ height: number }

function palm(bend: number, fronds: number, height: number): THREE.BufferGeometry {
  const b = new MeshBuilder(1024);
  const segs = 8;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push(new THREE.Vector3(bend * t * t * height * 0.22, t * height, 0));
  }
  const trunkA = c(0x8b6a46), trunkB = c(0x6c4f33);
  // Tapered ringed trunk (hexagonal rings so it reads as a palm, not a pipe).
  const sides = 6;
  const rings: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const p = pts[i]!;
    const r = 0.42 - 0.18 * (i / segs);
    const ring: number[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const nx = Math.cos(a), nz = Math.sin(a);
      const cc = i % 2 === 0 ? trunkA : trunkB;
      ring.push(b.vertex(p.x + nx * r, p.y, p.z + nz * r, nx, 0, nz, cc.r, cc.g, cc.b));
    }
    rings.push(ring);
  }
  for (let i = 0; i < segs; i++) for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    const a = rings[i]![k]!, bb = rings[i]![k1]!, d = rings[i + 1]![k]!, e = rings[i + 1]![k1]!;
    b.tri(a, d, bb); b.tri(bb, d, e);
  }
  const top = pts[segs]!;
  // Fronds: drooping V-section blades with an underside.
  const green = c(0x4f9c3a), tip = c(0x86c653), under = c(0x2f6a2e);
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + (f % 2) * 0.2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const len = height * (0.42 + 0.08 * ((f * 7) % 3));
    const steps = 5;
    let prevL = -1, prevC = -1, prevR = -1, prevLu = -1, prevCu = -1, prevRu = -1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const dist = len * t;
      const droop = -Math.pow(t, 1.8) * len * 0.55 + t * len * 0.25;
      const w = 0.95 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) + 0.05;
      const cx = top.x + dx * dist, cy = top.y + droop + 0.2, cz = top.z + dz * dist;
      const sx = -dz * w, sz = dx * w;
      col.copy(green).lerp(tip, t);
      const L = b.vertex(cx + sx, cy - 0.25 * w, cz + sz, 0, 1, 0, col.r, col.g, col.b);
      const C = b.vertex(cx, cy + 0.05, cz, 0, 1, 0, col.r * 1.08, col.g * 1.08, col.b * 1.08);
      const R = b.vertex(cx - sx, cy - 0.25 * w, cz - sz, 0, 1, 0, col.r, col.g, col.b);
      const Lu = b.vertex(cx + sx, cy - 0.25 * w - 0.02, cz + sz, 0, -1, 0, under.r, under.g, under.b);
      const Cu = b.vertex(cx, cy + 0.03, cz, 0, -1, 0, under.r, under.g, under.b);
      const Ru = b.vertex(cx - sx, cy - 0.25 * w - 0.02, cz - sz, 0, -1, 0, under.r, under.g, under.b);
      if (s > 0) {
        // Upper faces wind counter-clockwise seen from above; the dark underside the other way.
        b.tri(prevL, L, prevC); b.tri(L, C, prevC);
        b.tri(prevC, C, prevR); b.tri(C, R, prevR);
        b.tri(prevLu, prevCu, Lu); b.tri(Lu, prevCu, Cu);
        b.tri(prevCu, prevRu, Cu); b.tri(Cu, prevRu, Ru);
      }
      prevL = L; prevC = C; prevR = R; prevLu = Lu; prevCu = Cu; prevRu = Ru;
    }
  }
  // Coconuts.
  const nut = c(0x6b4a2a);
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1;
    b.sphere(trs(m4, top.x + Math.cos(a) * 0.45, top.y - 0.35, top.z + Math.sin(a) * 0.45, 0, 0.32, 0.32, 0.32), nut, 0);
  }
  const g = b.toGeometry();
  g.computeVertexNormals();
  return g;
}

/** Cloud-like canopy: a few squashed spheres, darker underneath. */
function broadleaf(variant: number): THREE.BufferGeometry {
  const b = new MeshBuilder(2048);
  const trunk = c(0x6e5037);
  const trunkH = variant === 1 ? 6.5 : variant === 2 ? 4.2 : 5;
  b.cylinder(trs(m4, 0, trunkH / 2, 0, 0, 0.42, trunkH, 0.42), trunk, 6, 0.7, 1);
  const blobs: [number, number, number, number][] = variant === 1
    ? [[0, trunkH + 3.2, 0, 2.6], [0.9, trunkH + 1.4, 0.5, 2.3], [-1, trunkH + 1.6, -0.4, 2.2], [0.1, trunkH + 5.2, 0.2, 1.9]]
    : variant === 2
      ? [[0, trunkH + 1.6, 0, 3.4], [2.3, trunkH + 0.9, 0.6, 2.4], [-2.2, trunkH + 1.0, -0.5, 2.5], [0.4, trunkH + 0.8, 2.2, 2.2], [-0.5, trunkH + 0.9, -2.1, 2.2]]
      : [[0, trunkH + 2.2, 0, 3], [1.6, trunkH + 1.1, 0.8, 2.3], [-1.5, trunkH + 1.3, -0.7, 2.3], [0.4, trunkH + 0.9, -1.7, 2.1]];
  const low = c(0x2f6e32), high = c(0x74b94b);
  for (const [x, y, z, r] of blobs) {
    b.append(canopySphere(1), trs(m4, x, y, z, hash01(variant, x * 10 | 0) * 6, r, r * 0.78, r), (_x, py, _z, _nx, ny, _nz, out) => {
      const h = (py - (trunkH - 0.5)) / 7;
      out.copy(low).lerp(high, Math.max(0, Math.min(1, h * 0.7 + ny * 0.35 + 0.15)));
    });
  }
  return b.toGeometry();
}

function conifer(): THREE.BufferGeometry {
  const b = new MeshBuilder(1024);
  b.cylinder(trs(m4, 0, 1.5, 0, 0, 0.35, 3, 0.35), c(0x5a3f2a), 5, 0.7, 1);
  const dark = c(0x24503b), light = c(0x3f7550);
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const y = 2.2 + t * 2.3;
    const r = 3.2 - t * 0.65;
    b.cylinder(trs(m4, 0, y + 1.6, 0, t * 0.7, r, 3.4, r), (_x, py, _z, _nx, ny, _nz, out) => {
      out.copy(dark).lerp(light, Math.max(0, ny) * 0.8 + (py - y) * 0.05);
    }, 7, 0, 1);
  }
  return b.toGeometry();
}

function deadTree(): THREE.BufferGeometry {
  const b = new MeshBuilder(512);
  const bark = c(0x5d534c), barkLight = c(0x7d7168);
  b.cylinder(trs(m4, 0, 3, 0, 0, 0.38, 6, 0.38, 0.08, 0.05), bark, 5, 0.6, 1);
  const branches: [number, number, number, number][] = [[0.9, 4.8, 0.6, 3], [2.6, 4, -0.7, 2.6], [4.2, 5.2, 0.5, 2.2], [5.4, 3.6, -0.9, 1.8]];
  for (const [yaw, y, pitch, len] of branches) {
    const dx = Math.sin(yaw) * Math.sin(Math.abs(pitch) + 0.6), dz = Math.cos(yaw) * Math.sin(Math.abs(pitch) + 0.6);
    b.cylinder(trs(m4, dx * len * 0.5, y + len * 0.35, dz * len * 0.5, yaw, 0.12, len, 0.12, 0.9, 0), barkLight, 4, 0.4, 1);
  }
  return b.toGeometry();
}

function bush(variant: number): THREE.BufferGeometry {
  const b = new MeshBuilder(512);
  const low = c(0x2f6b30), high = c(0x6bb146);
  const blobs: [number, number, number, number][] = variant === 0
    ? [[0, 0.7, 0, 1.3], [0.9, 0.5, 0.3, 0.95], [-0.8, 0.55, -0.2, 1]]
    : [[0, 0.6, 0, 1.1], [0.6, 0.45, -0.7, 0.85]];
  for (const [x, y, z, r] of blobs) {
    b.append(canopySphere(0), trs(m4, x, y, z, 0, r, r * 0.8, r), (_x, py, _z, _nx, ny, _nz, out) => {
      out.copy(low).lerp(high, Math.max(0, Math.min(1, py * 0.45 + ny * 0.3 + 0.1)));
    });
  }
  return b.toGeometry();
}

let variants: PropVariant[] | null = null;

export function propVariants(): PropVariant[] {
  if (variants) return variants;
  variants = [
    { key: 'palm-a', kind: 'palm', geometry: palm(0.8, 8, 11), height: 11 },
    { key: 'palm-b', kind: 'palm', geometry: palm(1.8, 9, 12.5), height: 12.5 },
    { key: 'broadleaf-a', kind: 'broadleaf', geometry: broadleaf(0), height: 10 },
    { key: 'broadleaf-b', kind: 'broadleaf', geometry: broadleaf(1), height: 12 },
    { key: 'broadleaf-c', kind: 'broadleaf', geometry: broadleaf(2), height: 8 },
    { key: 'conifer', kind: 'conifer', geometry: conifer(), height: 11 },
    { key: 'dead-tree', kind: 'dead-tree', geometry: deadTree(), height: 7 },
    { key: 'bush-a', kind: 'bush', geometry: bush(0), height: 1.6 },
    { key: 'bush-b', kind: 'bush', geometry: bush(1), height: 1.3 },
  ];
  return variants;
}

/** Variant index for a placement (stable per prop). */
export function variantFor(kind: PropKind, pick: number): number {
  const all = propVariants();
  let first = -1, count = 0;
  for (let i = 0; i < all.length; i++) if (all[i]!.kind === kind) { if (first < 0) first = i; count++; }
  return first + Math.min(count - 1, Math.floor(pick * count));
}

// ─────────────────────────────── Merged pieces ───────────────────────────────

const sphereCache = new Map<number, THREE.BufferGeometry>();
/** Indexed low-poly sphere with gentle noise (smooth shading). */
export function canopySphere(detail: 0 | 1 | 2): THREE.BufferGeometry {
  let g = sphereCache.get(detail);
  if (!g) {
    const seg = detail === 2 ? [10, 7] : detail === 1 ? [8, 6] : [6, 4];
    g = new THREE.SphereGeometry(1, seg[0], seg[1]);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = 1 + 0.12 * fbm(17, x * 1.7 + 3, z * 1.7 + y * 1.3, 2);
      pos.setXYZ(i, x * n, y * n, z * n);
    }
    g.computeVertexNormals();
    sphereCache.set(detail, g);
  }
  return g;
}

const rockCache = new Map<number, THREE.BufferGeometry>();
/** Faceted boulder (flat shaded). */
function rockGeometry(variant: number, detail: 0 | 1): THREE.BufferGeometry {
  const key = variant * 2 + detail;
  let g = rockCache.get(key);
  if (!g) {
    const base = new THREE.IcosahedronGeometry(1, detail);
    const pos = base.getAttribute('position') as THREE.BufferAttribute;
    // Displace per unique position so faces stay closed.
    const seen = new Map<string, [number, number, number]>();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      let d = seen.get(k);
      if (!d) {
        const n = 1 + 0.28 * (hash01(variant * 97 + 3, Math.round(x * 50), Math.round(y * 50 + z * 17)) - 0.5);
        d = [x * n, y * n * (y < 0 ? 0.6 : 1), z * n];
        seen.set(k, d);
      }
      pos.setXYZ(i, d[0], d[1], d[2]);
    }
    base.computeVertexNormals();
    g = base;
    rockCache.set(key, g);
  }
  return g;
}

export function appendCanopy(b: MeshBuilder, blobs: readonly CanopyBlob[], pal: TerrainPalette, ox: number, oz: number, lod: number): void {
  if (lod >= 2) return;
  const detail = lod === 0 ? 1 : 0;
  const low = pal.grassDark, mid = pal.grass, high = pal.grassLight;
  for (const blob of blobs) {
    if (lod === 1 && blob.r < 5.2 && blob.tint > 0.5) continue;
    const r = blob.r;
    const tint = blob.tint;
    b.append(canopySphere(detail), trs(m4, blob.x - ox, blob.y, blob.z - oz, tint * 6.28, r, r * blob.squash, r), (_x, py, _z, _nx, ny, _nz, out) => {
      const h = (py - (blob.y - r * blob.squash)) / (2 * r * blob.squash);
      out.copy(low).lerp(mid, Math.min(1, h * 1.4)).lerp(high, Math.max(0, (h - 0.55) * 1.6 + ny * 0.2) * (0.6 + tint * 0.4));
    });
  }
}

export function appendRocks(b: MeshBuilder, rocks: readonly RockPlacement[], pal: TerrainPalette, ox: number, oz: number, lod: number): void {
  if (lod >= 2) return;
  for (const rock of rocks) {
    if (lod === 1 && rock.r < 1.6) continue;
    const base = pal.strata[Math.floor(rock.tint * pal.strata.length) % pal.strata.length]!;
    const geo = rockGeometry(Math.floor(rock.tint * 3), rock.r > 2 && lod === 0 ? 1 : 0);
    b.append(geo, trs(m4, rock.x - ox, rock.y, rock.z - oz, rock.yaw, rock.r, rock.r * rock.squash, rock.r * (0.8 + rock.tint * 0.4)), (_x, py, _z, _nx, ny, _nz, out) => {
      out.copy(base).multiplyScalar(0.82 + 0.18 * ny);
      if (py < rock.y - rock.r * 0.1) out.lerp(pal.wet, 0.55);
      else if (ny > 0.6 && pal.lush > 0.3) out.lerp(pal.moss, 0.45);
    });
  }
}

export function appendVines(b: MeshBuilder, vines: readonly VinePlan[], pal: TerrainPalette, ox: number, oz: number, lod: number): void {
  if (lod >= 1) return;
  const dark = pal.grassDark, leaf = pal.moss;
  for (const vine of vines) {
    const pts = vine.points;
    // Strip across the cliff face: width along the coast tangent, facing outward (both windings: seen from any side).
    const sx = vine.nz, sz = -vine.nx;
    let prevA = -1, prevB = -1;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]!;
      const w = vine.width * (1 - (k / pts.length) * 0.6);
      col.copy(dark).lerp(leaf, (k % 3) / 3);
      const A = b.vertex(p.x - ox + sx * w, p.y, p.z - oz + sz * w, vine.nx, 0, vine.nz, col.r, col.g, col.b);
      const B = b.vertex(p.x - ox - sx * w, p.y, p.z - oz - sz * w, vine.nx, 0, vine.nz, col.r, col.g, col.b);
      if (k > 0) { b.tri(prevA, A, prevB); b.tri(prevB, A, B); b.tri(prevA, prevB, A); b.tri(prevB, B, A); }
      prevA = A; prevB = B;
    }
  }
}
