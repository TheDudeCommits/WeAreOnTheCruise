/**
 * Landmark geometry that spans several collision islands (WORLD-owned): the sea-arch bridge lofted between its two
 * pillar islands (visual only — it is entirely above the sailable clearance), and waterfall strips.
 */
import * as THREE from 'three';
import type { ArchSpan } from '../../world/features';
import { fbm, hash01 } from '../../world/noise';
import type { WaterfallPlan } from '../../world/plan';
import type { IslandShape } from '../../world/shape';
import { MeshBuilder, trs } from './meshBuilder';
import type { TerrainPalette } from './palette';
import { canopySphere } from './vegetation';

const m4 = new THREE.Matrix4();
const col = new THREE.Color();

/**
 * Lofts the arch bridge: a superellipse section swept from pillar A to pillar B. The underside is a semi-ellipse
 * between the pillar faces that peaks at `span.clearance` above the water; the top carries jungle and vines.
 */
export function appendArchSpan(b: MeshBuilder, span: ArchSpan, faceDistance: number, shape: IslandShape, pal: TerrainPalette, ox: number, oz: number, lod: number): void {
  const dx = span.bx - span.ax, dz = span.bz - span.az;
  const D = Math.hypot(dx, dz);
  const ux = dx / D, uz = dz / D;
  const px = uz, pz = -ux; // across the span
  const tFa = faceDistance / D, tFb = 1 - tFa;
  const half = 0.5 - tFa;
  const spring = span.clearance * 0.66;
  const rings = lod === 0 ? 44 : lod === 1 ? 20 : 10;
  const around = lod === 0 ? 18 : lod === 1 ? 12 : 8;
  const t0 = tFa * 0.35, t1 = 1 - tFa * 0.35;
  const seed = shape.spec.seed;
  const v0 = b.vCount, i0 = b.iCount;
  const ringStart: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const t = t0 + ((t1 - t0) * r) / rings;
    const cxw = span.ax + dx * t, czw = span.az + dz * t;
    const inOpening = t > tFa && t < tFb;
    const e = Math.min(1, Math.abs(t - 0.5) / half);
    const yBot = inOpening ? spring + (span.clearance - spring) * Math.sqrt(Math.max(0, 1 - e * e)) : spring - (Math.abs(t - 0.5) - half) * D * 0.9;
    const yTop = span.crown + 1.5 * Math.sin(Math.PI * t) + fbm(seed, t * 6, 0.3, 2) * 1.2;
    const W = span.width * (1 + 0.2 * Math.pow(Math.abs(t - 0.5) * 2, 2));
    const cy = (yTop + yBot) / 2, hs = (yTop - yBot) / 2;
    ringStart.push(b.vCount);
    for (let a = 0; a < around; a++) {
      const phi = (a / around) * Math.PI * 2;
      const c = Math.cos(phi), s = Math.sin(phi);
      const sx = Math.sign(c) * Math.pow(Math.abs(c), 0.55), sy = Math.sign(s) * Math.pow(Math.abs(s), 0.5);
      const n = 1 + 0.06 * fbm(seed + 7, t * 14, a * 0.7, 2);
      const lx = sx * (W / 2) * n, ly = cy + sy * hs * (s < 0 ? 1 : 1.0) * (s > 0 ? 1 : n);
      b.vertex(cxw + px * lx - ox, ly, czw + pz * lx - oz, 0, 1, 0, 1, 1, 1);
    }
  }
  for (let r = 0; r < rings; r++) {
    const A = ringStart[r]!, B = ringStart[r + 1]!;
    for (let a = 0; a < around; a++) {
      const a1 = (a + 1) % around;
      b.tri(A + a, B + a, A + a1); b.tri(A + a1, B + a, B + a1);
    }
  }
  b.computeNormals(v0, b.vCount, i0, b.iCount);
  // Orientation check: flip if the first side vertex's normal points into the span.
  const o = (v0 + Math.round(around * 0.0)) * 3;
  const cx0 = (span.ax + dx * t0) - ox, cz0 = (span.az + dz * t0) - oz;
  const outward = (b.pos[o]! - cx0) * b.nor[o]! + (b.pos[o + 2]! - cz0) * b.nor[o + 2]!;
  if (outward < 0) {
    for (let i = i0; i < b.iCount; i += 3) { const tmp = b.idx[i + 1]!; b.idx[i + 1] = b.idx[i + 2]!; b.idx[i + 2] = tmp; }
    for (let v = v0 * 3; v < b.vCount * 3; v++) b.nor[v] = -b.nor[v]!;
  }
  // Paint: strata by absolute height (matches the pillars), grass on top, shadowed underside, moss drips.
  const strata = shape.strata;
  for (let v = v0; v < b.vCount; v++) {
    const k3 = v * 3;
    const y = b.pos[k3 + 1]!, ny = b.nor[k3 + 1]!;
    if (ny > 0.55) {
      col.copy(pal.grass).lerp(pal.grassLight, Math.max(0, fbm(seed + 3, b.pos[k3]! / 20, b.pos[k3 + 2]! / 20, 2)));
    } else {
      let k = 0;
      while (k < strata.length - 1 && strata[k]!.top < y) k++;
      col.copy(pal.strata[strata[k]!.tone % pal.strata.length]!);
      if (ny < -0.45) col.multiplyScalar(0.62);
      if (span.crown - y < 4 + 5 * hash01(seed, v % 97)) col.lerp(pal.moss, 0.6 * pal.lush);
    }
    b.col[k3] = col.r; b.col[k3 + 1] = col.g; b.col[k3 + 2] = col.b;
  }
  if (lod >= 2) return;
  // Jungle on the bridge and vines dangling into the opening.
  const steps = lod === 0 ? 14 : 7;
  for (let i = 0; i <= steps; i++) {
    const t = 0.18 + (0.64 * i) / steps;
    for (const side of [-1, 1]) {
      if (hash01(seed, i, side + 5) < 0.2) continue;
      const W = span.width * (1 + 0.45 * Math.pow(Math.abs(t - 0.5) * 2, 2));
      const off = side * W * (0.18 + 0.2 * hash01(seed + 1, i, side));
      const x = span.ax + dx * t + px * off - ox, z = span.az + dz * t + pz * off - oz;
      const y = span.crown + 1.5 * Math.sin(Math.PI * t);
      const r = 4.5 + 2.5 * hash01(seed + 2, i, side);
      b.append(canopySphere(lod === 0 ? 1 : 0), trs(m4, x, y + r * 0.2, z, i, r, r * 0.65, r), (_x, py, _z, _nx, nyy, _nz, out) => {
        const hgt = (py - (y - r * 0.45)) / (r * 1.3);
        out.copy(pal.grassDark).lerp(pal.grass, Math.min(1, hgt * 1.4)).lerp(pal.grassLight, Math.max(0, hgt - 0.55 + nyy * 0.2));
      });
    }
  }
  if (lod > 0) return;
  for (let i = 0; i < 12; i++) {
    const t = tFa + (tFb - tFa) * (0.12 + 0.76 * hash01(seed + 9, i));
    const e = Math.min(1, Math.abs(t - 0.5) / half);
    const yBot = spring + (span.clearance - spring) * Math.sqrt(Math.max(0, 1 - e * e));
    const side = hash01(seed + 10, i) < 0.5 ? -1 : 1;
    const W = span.width * (1 + 0.45 * Math.pow(Math.abs(t - 0.5) * 2, 2));
    const off = side * W * 0.42;
    const x = span.ax + dx * t + px * off - ox, z = span.az + dz * t + pz * off - oz;
    // Vines dangle into the opening but stop above the sailing clearance (masts pass under them).
    const len = Math.min(5 + 10 * hash01(seed + 11, i), yBot + 1 - span.clearance * 0.84);
    if (len < 2) continue;
    const w = 0.45;
    let pa = -1, pb = -1;
    for (let k = 0; k <= 5; k++) {
      const y = yBot + 1 - (len * k) / 5;
      const sway = Math.sin(k * 1.2 + i) * 0.4;
      col.copy(pal.grassDark).lerp(pal.moss, (k % 2) * 0.5);
      const A = b.vertex(x + ux * w + px * sway, y, z + uz * w + pz * sway, px * side, 0, pz * side, col.r, col.g, col.b);
      const B = b.vertex(x - ux * w + px * sway, y, z - uz * w + pz * sway, px * side, 0, pz * side, col.r, col.g, col.b);
      if (k > 0) { b.tri(pa, A, pb); b.tri(pb, A, B); b.tri(pa, pb, A); b.tri(pb, B, A); }
      pa = A; pb = B;
    }
  }
}

/** Waterfall ribbons (own transparent material) + white splash puffs merged into the solid mesh. */
export function appendWaterfall(water: MeshBuilder, solid: MeshBuilder, fall: WaterfallPlan, ox: number, oz: number, lod: number): void {
  const pts = fall.points;
  const sx = fall.nz, sz = -fall.nx;
  const w = fall.width / 2;
  let dist = 0;
  let pa = -1, pb = -1;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]!;
    if (k > 0) dist += Math.hypot(p.x - pts[k - 1]!.x, p.y - pts[k - 1]!.y, p.z - pts[k - 1]!.z);
    const spread = 1 + (k / pts.length) * 0.35;
    // UVs: u across, v down the fall (texture scrolls in V).
    const A = water.vertex(p.x - ox + sx * w * spread, p.y, p.z - oz + sz * w * spread, fall.nx, 0, fall.nz, 1, 1, 1);
    const B = water.vertex(p.x - ox - sx * w * spread, p.y, p.z - oz - sz * w * spread, fall.nx, 0, fall.nz, 1, 1, 1);
    setUv(water, A, 0, dist / 12);
    setUv(water, B, 1, dist / 12);
    if (k > 0) { water.tri(pa, A, pb); water.tri(pb, A, B); }
    pa = A; pb = B;
  }
  if (lod > 1) return;
  const base = pts[pts.length - 1]!;
  const white = new THREE.Color(0xf4fbff), shade = new THREE.Color(0xc8e6f2);
  // Splash puffs hug the cliff foot (≤ ~3 m out); the ocean foam stamp spreads the rest.
  for (let i = 0; i < (lod === 0 ? 5 : 2); i++) {
    const a = (i / 5) * Math.PI * 2;
    const r = Math.min(2.2, fall.width * (0.22 + 0.08 * (i % 2)));
    const x = base.x + fall.nx * 0.4 + Math.cos(a) * fall.width * 0.3 - ox, z = base.z + fall.nz * 0.4 + Math.sin(a) * fall.width * 0.3 - oz;
    solid.append(canopySphere(0), trs(m4, x, 0.3, z, a, r, r * 0.55, r), (_x, _py, _z, _nx, ny, _nz, out) => { out.copy(shade).lerp(white, Math.max(0, ny)); });
  }
}

/** UV channel stored beside the builder (only waterfall builders use UVs). */
const uvStore = new WeakMap<MeshBuilder, number[]>();
function setUv(b: MeshBuilder, v: number, u: number, vv: number): void {
  let arr = uvStore.get(b);
  if (!arr) { arr = []; uvStore.set(b, arr); }
  arr[v * 2] = u; arr[v * 2 + 1] = vv;
}

/** Converts a waterfall builder to geometry with its UVs. */
export function waterfallGeometry(b: MeshBuilder): THREE.BufferGeometry {
  const g = b.toGeometry();
  const arr = uvStore.get(b) ?? [];
  const uv = new Float32Array(b.vCount * 2);
  for (let i = 0; i < uv.length; i++) uv[i] = arr[i] ?? 0;
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
