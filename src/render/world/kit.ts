/**
 * Procedural kit pieces (WORLD-owned): Admiralty forts (white stone, navy trim, gold wave emblem), terraced town
 * houses, towers, lighthouses, piers with moored boats, ruins, a shipwreck, lava vents and a giant tree. Pieces are
 * appended into merged builders: `solid` (terrain material), `lamp` (warm emissive windows/lanterns, glows at
 * night) and `lava` (vents). Flags become instances of one waving flag mesh.
 */
import * as THREE from 'three';
import type { IslandDef } from '../../game/types';
import { hash01 } from '../../world/noise';
import type { KitPlacement } from '../../world/plan';
import type { IslandSurface } from '../../world/surface';
import { MeshBuilder, trs } from './meshBuilder';
import { KIT, type TerrainPalette } from './palette';
import { canopySphere } from './vegetation';

const m4 = new THREE.Matrix4();
const col = new THREE.Color();
const v3 = new THREE.Vector3();

export interface FlagInstance { x: number; y: number; z: number; scale: number }

export interface KitTargets {
  solid: MeshBuilder;
  lamp: MeshBuilder;
  lava: MeshBuilder;
  flags: FlagInstance[];
}

/** Local → world helper for pieces rotated by `yaw` about +Y (local +Z faces outward). */
class Frame {
  constructor(public x = 0, public y = 0, public z = 0, public yaw = 0) {}
  /** Matrix for a unit primitive centred at local (lx, ly, lz) scaled (sx, sy, sz), extra yaw/pitch/roll. */
  m(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0): THREE.Matrix4 {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return trs(m4, this.x + lx * c + lz * s, this.y + ly, this.z - lx * s + lz * c, this.yaw + yaw, sx, sy, sz, pitch, roll);
  }
}

const f = new Frame();

export function appendKit(t: KitTargets, pieces: readonly KitPlacement[], ox: number, oz: number, lod: number, surface: IslandSurface | null, pal: TerrainPalette): void {
  for (const k of pieces) {
    f.x = k.x - ox; f.y = k.y; f.z = k.z - oz; f.yaw = k.yaw;
    switch (k.kind) {
      case 'house': house(t, k, lod); break;
      case 'hut': hut(t, k); break;
      case 'tower': tower(t, k, lod); break;
      case 'wall': wall(t, k, lod, false); break;
      case 'gate': wall(t, k, lod, true); break;
      case 'keep': keep(t, k, lod); break;
      case 'lighthouse': lighthouse(t, k); break;
      case 'cannon': if (lod === 0) cannon(t); break;
      case 'column': case 'column-broken': column(t, k, pal); break;
      case 'ruin-wall': ruinWall(t, k, pal); break;
      case 'ruin-arch': ruinArch(t, k, pal); break;
      case 'wreck': wreck(t.solid, k, lod); break;
      case 'vent': if (surface) vent(t, k, ox, oz, surface); break;
      case 'crater': crater(t, k); break;
      case 'lantern': lantern(t, k); break;
      case 'crates': if (lod === 0) crates(t, k); break;
      case 'giant-tree': giantTree(t.solid, k, lod, pal); break;
      case 'flag': flagPole(t, k); break;
    }
  }
}

function foundation(t: KitTargets, k: KitPlacement, w: number, d: number, round = false): void {
  const h = k.y + 0.35 - k.base;
  if (h <= 0.05) return;
  if (round) t.solid.cylinder(f.m(0, (k.base - k.y + 0.35) / 2, 0, w / 2, h, w / 2), KIT.stone, 12);
  else t.solid.box(f.m(0, (k.base - k.y + 0.35) / 2, 0, w, h, d), KIT.stone);
}

function windowQuad(t: KitTargets, lx: number, ly: number, lz: number, w: number, h: number, yaw: number): void {
  t.lamp.box(f.m(lx, ly, lz, w, h, 0.12, yaw), KIT.glass);
}

function house(t: KitTargets, k: KitPlacement, lod: number): void {
  const { w, h, d, variant } = k;
  foundation(t, k, w + 0.6, d + 0.6);
  const wallColor = KIT.walls[variant % KIT.walls.length]!;
  const roofColor = KIT.roofs[Math.floor(variant / 6) % KIT.roofs.length]!;
  t.solid.box(f.m(0, 0.35 + h / 2, 0, w, h, d), wallColor);
  // Trim band and gable roof (ridge runs along the house depth).
  t.solid.box(f.m(0, 0.35 + h - 0.15, 0, w + 0.12, 0.3, d + 0.12), KIT.whiteShade);
  const roofH = Math.min(w, d) * 0.42;
  t.solid.prism(f.m(0, 0.35 + h, 0, w + 1.1, roofH, d + 0.9), roofColor);
  if (lod > 0) {
    windowQuad(t, 0, 0.35 + h * 0.55, d / 2 + 0.04, w * 0.3, h * 0.2, 0);
    return;
  }
  t.solid.box(f.m(w * 0.22, 0.35 + h + roofH * 0.6, -d * 0.15, 0.8, roofH * 1.1, 0.8), KIT.stone);
  t.solid.box(f.m(-w * 0.18, 0.35 + 1.1, d / 2 + 0.06, 1.3, 2.2, 0.14), KIT.woodDark);
  const floors = h > 6.8 ? 2 : 1;
  for (let fl = 0; fl < floors; fl++) {
    const wy = 0.35 + (floors === 1 ? h * 0.55 : h * (0.32 + fl * 0.38));
    windowQuad(t, w * 0.2, wy, d / 2 + 0.05, 1, 1.2, 0);
    if (fl > 0 || floors === 1) windowQuad(t, -w * 0.2, wy + (fl === 0 ? 0.6 : 0), d / 2 + 0.05, 1, 1.2, 0);
    windowQuad(t, w / 2 + 0.05, wy, 0, 1, 1.2, Math.PI / 2);
    windowQuad(t, -w / 2 - 0.05, wy, 0, 1, 1.2, Math.PI / 2);
  }
  // Awning / shutters for colour accents.
  if (variant % 3 === 0) t.solid.box(f.m(0, 0.35 + 2.7, d / 2 + 0.55, w * 0.7, 0.18, 1.1, 0, -0.35), roofColor);
}

function hut(t: KitTargets, k: KitPlacement): void {
  const { w, h, d } = k;
  foundation(t, k, w + 0.4, d + 0.4);
  t.solid.box(f.m(0, 0.35 + h * 0.3, 0, w, h * 0.6, d), KIT.woodLight);
  t.solid.cone(f.m(0, 0.35 + h * 0.6 + h * 0.28, 0, w * 0.82, h * 0.56, d * 0.82, Math.PI / 4), KIT.thatch, 4);
  windowQuad(t, 0, 0.35 + h * 0.32, d / 2 + 0.05, 0.9, 0.9, 0);
}

function tower(t: KitTargets, k: KitPlacement, lod: number): void {
  const { w, h, variant } = k;
  const r = w / 2;
  foundation(t, k, w + 0.8, w + 0.8, true);
  t.solid.cylinder(f.m(0, 0.35 + h / 2, 0, r, h, r), KIT.whiteStone, 14);
  t.solid.cylinder(f.m(0, 0.35 + h * 0.18, 0, r + 0.25, 0.9, r + 0.25), KIT.whiteShade, 14);
  t.solid.cylinder(f.m(0, 0.35 + h - 0.7, 0, r + 0.2, 0.9, r + 0.2), KIT.navy, 14);
  if (variant === 0) {
    // Crenellated gun platform.
    t.solid.cylinder(f.m(0, 0.35 + h + 0.05, 0, r + 0.35, 0.3, r + 0.35), KIT.whiteShade, 14);
    const merlons = lod === 0 ? 8 : 0;
    for (let i = 0; i < merlons; i++) {
      const a = (i / merlons) * Math.PI * 2;
      t.solid.box(f.m(Math.sin(a) * (r + 0.05), 0.35 + h + 0.8, Math.cos(a) * (r + 0.05), 1.3, 1.3, 0.8, a), KIT.whiteStone);
    }
  } else {
    t.solid.cone(f.m(0, 0.35 + h + r * 0.55, 0, r + 0.7, r * 1.1, r + 0.7), KIT.navy, 12);
    t.solid.sphere(f.m(0, 0.35 + h + r * 1.15, 0, 0.45, 0.45, 0.45), KIT.gold, 0);
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + variant;
    windowQuad(t, Math.sin(a) * (r + 0.04), 0.35 + h * 0.62, Math.cos(a) * (r + 0.04), 0.6, 1.3, a);
  }
}

function wall(t: KitTargets, k: KitPlacement, lod: number, gate: boolean): void {
  const { w, h, d } = k;
  const low = k.base - k.y;
  t.solid.box(f.m(0, (low + h) / 2, 0, w, h - low, d), KIT.whiteStone);
  t.solid.box(f.m(0, h - 1.1, 0, w + 0.14, 0.55, d), KIT.navy);
  t.solid.box(f.m(0, h + 0.05, 0, w + 0.3, 0.3, d), KIT.whiteShade);
  if (lod === 0) {
    const count = Math.max(2, Math.floor(d / 2.6));
    for (let i = 0; i < count; i++) {
      const z = -d / 2 + (i + 0.5) * (d / count);
      t.solid.box(f.m(w * 0.28, h + 0.8, z, w * 0.42, 1.2, 1.3), KIT.whiteStone);
    }
  }
  if (gate) {
    t.solid.box(f.m(0, 2.6, 0, w + 0.3, 5.2, 4.2), KIT.navyDark);
    t.solid.box(f.m(0, 5.6, 0, w + 0.4, 0.7, 5.2), KIT.gold);
    // Wave emblem medallion over the gate, both faces.
    for (const side of [1, -1]) t.solid.cylinder(f.m(side * (w / 2 + 0.2), h - 2.6, 0, 1.3, 0.25, 1.3, 0, 0, Math.PI / 2), KIT.gold, 12);
  }
}

function keep(t: KitTargets, k: KitPlacement, lod: number): void {
  const { w, h, d } = k;
  foundation(t, k, w + 1, d + 1);
  t.solid.box(f.m(0, 0.35 + h / 2, 0, w, h, d), KIT.whiteStone);
  t.solid.box(f.m(0, 0.35 + h - 0.8, 0, w + 0.2, 0.7, d + 0.2), KIT.navy);
  const roof = Math.hypot(w, d) / 2 + 0.6;
  t.solid.cone(f.m(0, 0.35 + h + h * 0.22, 0, roof, h * 0.44, roof * (d / w), Math.PI / 4), KIT.navy, 4);
  // Upper hall.
  const uw = w * 0.55, ud = d * 0.55, uh = h * 0.45;
  t.solid.box(f.m(0, 0.35 + h + uh / 2, 0, uw, uh, ud), KIT.whiteStone);
  const uroof = Math.hypot(uw, ud) / 2 + 0.5;
  t.solid.cone(f.m(0, 0.35 + h + uh + uh * 0.35, 0, uroof, uh * 0.7, uroof * (ud / uw), Math.PI / 4), KIT.navy, 4);
  // Emblem + banners on the front and back.
  for (const side of [1, -1]) {
    t.solid.cylinder(f.m(0, 0.35 + h * 0.66, side * (d / 2 + 0.15), 1.9, 0.3, 1.9, 0, Math.PI / 2), KIT.gold, 16);
    t.solid.cylinder(f.m(0, 0.35 + h * 0.66, side * (d / 2 + 0.3), 1.3, 0.2, 1.3, 0, Math.PI / 2), KIT.navy, 16);
    if (lod === 0) for (const bx of [-w * 0.32, w * 0.32]) {
      t.solid.box(f.m(bx, 0.35 + h * 0.55, side * (d / 2 + 0.12), 1.6, h * 0.42, 0.14), KIT.navy);
      t.solid.box(f.m(bx, 0.35 + h * 0.34, side * (d / 2 + 0.16), 1.6, 0.35, 0.12), KIT.gold);
    }
  }
  const cols = Math.max(2, Math.round(w / 4));
  for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
    const x = -w / 2 + (c + 0.5) * (w / cols);
    if (Math.abs(x) < 2.6) continue;
    windowQuad(t, x, 0.35 + h * (0.3 + r * 0.3), d / 2 + 0.05, 1, 1.6, 0);
    windowQuad(t, x, 0.35 + h * (0.3 + r * 0.3), -d / 2 - 0.05, 1, 1.6, 0);
  }
  t.solid.box(f.m(0, 0.35 + 2, d / 2 + 0.1, 3, 4, 0.2), KIT.woodDark);
}

function lighthouse(t: KitTargets, k: KitPlacement): void {
  const { w, h } = k;
  const r0 = w / 2, r1 = r0 * 0.66;
  foundation(t, k, w * 1.6, w * 1.6);
  t.solid.box(f.m(0, 0.35 + 1.8, 0, w * 1.5, 3.6, w * 1.5), KIT.whiteStone);
  t.solid.prism(f.m(0, 0.35 + 3.6, 0, w * 1.6, 1.8, w * 1.6), KIT.lighthouseRed);
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const y0 = 0.35 + (h * i) / bands, y1 = 0.35 + (h * (i + 1)) / bands;
    const ra = r0 + (r1 - r0) * (i / bands), rb = r0 + (r1 - r0) * ((i + 1) / bands);
    t.solid.append(templatesCylinder(rb / ra), f.m(0, (y0 + y1) / 2, 0, ra, y1 - y0, ra), i % 2 === 0 ? KIT.whiteStone : KIT.lighthouseRed);
  }
  const top = 0.35 + h;
  t.solid.cylinder(f.m(0, top + 0.25, 0, r1 + 1, 0.5, r1 + 1), KIT.navy, 14);
  t.solid.cylinder(f.m(0, top + 1.1, 0, r1 + 0.95, 1.2, r1 + 0.95), KIT.iron, 14, 1, 1, true);
  t.lamp.cylinder(f.m(0, top + 1.9, 0, r1 * 0.72, 2.8, r1 * 0.72), KIT.lamp, 10);
  t.solid.cone(f.m(0, top + 4.2, 0, r1 * 0.95, 2.2, r1 * 0.95), KIT.lighthouseRed, 12);
  t.solid.sphere(f.m(0, top + 5.5, 0, 0.4, 0.4, 0.4), KIT.gold, 0);
  windowQuad(t, 0, h * 0.45, r0 * 0.85 + 0.05, 0.8, 1.4, 0);
}

const taperCache = new Map<number, THREE.BufferGeometry>();
function templatesCylinder(ratio: number): THREE.BufferGeometry {
  const key = Math.round(ratio * 100);
  let g = taperCache.get(key);
  if (!g) { g = new THREE.CylinderGeometry(key / 100, 1, 1, 14, 1, true); taperCache.set(key, g); }
  return g;
}

function cannon(t: KitTargets): void {
  t.solid.box(f.m(0, 0.4, 0, 1.3, 0.7, 2), KIT.woodDark);
  t.solid.cylinder(f.m(0, 0.9, 0.9, 0.32, 3, 0.32, 0, Math.PI / 2 - 0.08), KIT.iron, 8);
}

function column(t: KitTargets, k: KitPlacement, pal: TerrainPalette): void {
  const { w, h } = k;
  foundation(t, k, w * 1.4, w * 1.4);
  const moss = (_x: number, y: number, _z: number, _nx: number, ny: number, _nz: number, out: THREE.Color) => {
    out.copy(KIT.ruin).lerp(KIT.ruinDark, hash01(k.variant, Math.round(y)) * 0.4);
    if (ny > 0.5 || y < k.y + 1) out.lerp(pal.moss, 0.55);
  };
  t.solid.box(f.m(0, 0.65, 0, w * 1.35, 0.6, w * 1.35), moss);
  const shaft = k.kind === 'column' ? h - 1.4 : h;
  t.solid.cylinder(f.m(0, 0.95 + shaft / 2, 0, w / 2, shaft, w / 2), moss, 10);
  if (k.kind === 'column') t.solid.box(f.m(0, 1.25 + shaft, 0, w * 1.45, 0.6, w * 1.45), moss);
  else t.solid.cone(f.m(0.1, 0.95 + shaft + 0.4, 0, w / 2, 0.9, w / 2, 0, 0.3, 0.2), moss, 6);
  if (k.kind === 'column-broken' && k.variant % 2 === 0) {
    // A fallen drum lying beside it.
    t.solid.cylinder(f.m(w * 1.6, 0.8, 0.4, w / 2, 2.4, w / 2, 0.6, 0, Math.PI / 2), moss, 10);
  }
}

function ruinWall(t: KitTargets, k: KitPlacement, pal: TerrainPalette): void {
  const { w, h, d, variant } = k;
  const blocks = Math.max(3, Math.round(d / 2.6));
  for (let i = 0; i < blocks; i++) {
    const z = -d / 2 + (i + 0.5) * (d / blocks);
    const bh = h * (0.35 + 0.65 * hash01(variant + 3, i));
    const low = k.base - k.y;
    t.solid.box(f.m(0, (low + bh) / 2, z, w, bh - low, d / blocks - 0.08), (_x, y, _z, _nx, ny, _nz, out) => {
      out.copy(KIT.ruin).lerp(KIT.ruinDark, 0.3 * hash01(i, variant));
      if (ny > 0.5 || y < k.y + 0.8) out.lerp(pal.moss, 0.5);
    });
  }
}

function ruinArch(t: KitTargets, k: KitPlacement, pal: TerrainPalette): void {
  const { w, h, d } = k;
  const stone = (_x: number, y: number, _z: number, _nx: number, ny: number, _nz: number, out: THREE.Color) => {
    out.copy(KIT.ruin);
    if (ny > 0.5 || y < k.y + 1) out.lerp(pal.moss, 0.5);
  };
  const low = k.base - k.y;
  for (const side of [-1, 1]) t.solid.box(f.m(side * w / 2, (low + h) / 2, 0, 1.9, h - low, d), stone);
  // Voussoir ring approximated by blocks along a half circle.
  const n = 7;
  for (let i = 0; i < n; i++) {
    if (i === 5) continue; // a missing stone
    const a = Math.PI * (i + 0.5) / n;
    const x = Math.cos(a) * (w / 2), y = h - 1.5 + Math.sin(a) * (w * 0.32);
    t.solid.box(f.m(x, y, 0, 1.9, 1.4, d, 0, 0, a - Math.PI / 2), stone);
  }
}

// ─────────────────────────────── Hulls (wreck, rowboats) ───────────────────────────────

/** Lofted boat hull in local space: length along +Z, keel at y = 0, beam `beam`, depth `depth`. */
function hull(b: MeshBuilder, frame: Frame, length: number, beam: number, depth: number, color: THREE.Color, stripe: THREE.Color, cut = 1, roll = 0, pitch = 0): void {
  const stations = 9, around = 7;
  const rings: number[][] = [];
  const maxS = Math.max(2, Math.round(stations * cut));
  for (let s = 0; s <= maxS; s++) {
    const t = s / stations;
    const z = (t - 0.5) * length;
    const taper = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0.02, t))), 0.6);
    const ring: number[] = [];
    for (let a = 0; a <= around; a++) {
      const u = a / around; // 0 = port gunwale, 0.5 = keel, 1 = starboard gunwale
      const ang = Math.PI * u;
      const x = -Math.cos(ang) * beam * 0.5 * taper;
      const y = depth * (1 - Math.sin(ang) * (0.35 + 0.65 * taper));
      const c = u < 0.12 || u > 0.88 ? stripe : color;
      // Roll about the keel line, then pitch the bow up.
      const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const rx = x * cr - y * sr, ry = x * sr + y * cr;
      v3.set(rx, ry * cp + z * sp, -ry * sp + z * cp);
      const cs = Math.cos(frame.yaw), sn = Math.sin(frame.yaw);
      const wx = frame.x + v3.x * cs + v3.z * sn, wz = frame.z - v3.x * sn + v3.z * cs;
      ring.push(b.vertex(wx, frame.y + v3.y, wz, 0, 1, 0, c.r, c.g, c.b));
    }
    rings.push(ring);
  }
  const i0 = b.iCount, v0 = rings[0]![0]!;
  for (let s = 0; s < rings.length - 1; s++) for (let a = 0; a < around; a++) {
    const p = rings[s]![a]!, q = rings[s]![a + 1]!, r = rings[s + 1]![a]!, u = rings[s + 1]![a + 1]!;
    // Both windings: hull shell seen from outside and inside (wrecks are open).
    b.tri(p, r, q); b.tri(q, r, u);
    b.tri(p, q, r); b.tri(q, u, r);
  }
  b.computeNormals(v0, b.vCount, i0, b.iCount);
}

function wreck(b: MeshBuilder, k: KitPlacement, lod: number): void {
  const frame = new Frame(f.x, k.y - 1.2, f.z, k.yaw);
  // Tilted, broken hull: build in a rolled frame by offsetting stations.
  hull(b, frame, k.d, k.w, k.h * 0.8, KIT.woodDark, KIT.wood, 0.72, 0.38, -0.12);
  if (lod > 0) return;
  const fr = new Frame(f.x, k.y, f.z, k.yaw);
  const old = { ...f };
  f.x = fr.x; f.y = fr.y; f.z = fr.z; f.yaw = fr.yaw;
  // Broken mast leaning out, a stump, and loose ribs at the break.
  t_cyl(b, f.m(0.6, 6, -2, 0.45, 13, 0.45, 0, 0.1, 0.55), KIT.woodDark);
  t_cyl(b, f.m(0, 2.2, 6, 0.4, 3, 0.4, 0, 0, 0.1), KIT.woodDark);
  for (let i = 0; i < 4; i++) b.box(f.m((i % 2 ? 1 : -1) * k.w * 0.35, k.h * 0.45, k.d * 0.2 + i * 1.3, 0.35, k.h * 0.8, 0.35, 0, 0.2 * i, (i % 2 ? -1 : 1) * 0.35), KIT.woodLight);
  b.box(f.m(-1.2, 1.4, 3, 3.6, 0.3, 1.2, 0.4, 0.2, 0.1), KIT.woodLight);
  f.x = old.x; f.y = old.y; f.z = old.z; f.yaw = old.yaw;
}

function t_cyl(b: MeshBuilder, m: THREE.Matrix4, color: THREE.Color): void { b.cylinder(m, color, 6); }

export function rowboat(b: MeshBuilder, x: number, y: number, z: number, yaw: number, variant: number): void {
  const frame = new Frame(x, y, z, yaw);
  hull(b, frame, 6.2, 1.9, 1, KIT.walls[variant % KIT.walls.length]!, KIT.roofs[variant % KIT.roofs.length]!, 1);
}

// ─────────────────────────────── Volcanic ───────────────────────────────

function vent(t: KitTargets, k: KitPlacement, ox: number, oz: number, s: IslandSurface): void {
  const steps = Math.max(4, Math.round(k.d / 3));
  const dx = Math.sin(k.yaw), dz = Math.cos(k.yaw);
  const sx = dz, sz = -dx;
  let pa = -1, pb = -1;
  for (let i = 0; i <= steps; i++) {
    const tt = i / steps;
    const wobble = Math.sin(tt * 9 + k.variant) * 1.2;
    const wx = k.x + dx * k.d * tt + sx * wobble, wz = k.z + dz * k.d * tt + sz * wobble;
    const y = s.sample(wx, wz).y + 0.25;
    const w = k.w * (0.4 + 0.6 * Math.sin(Math.PI * tt));
    col.copy(KIT.lava).lerp(new THREE.Color(0xff7a2a), 0.5 + 0.5 * Math.sin(Math.PI * tt));
    const a = t.lava.vertex(wx - ox + sx * w, y, wz - oz + sz * w, 0, 1, 0, col.r, col.g, col.b);
    const b2 = t.lava.vertex(wx - ox - sx * w, y, wz - oz - sz * w, 0, 1, 0, col.r, col.g, col.b);
    if (i > 0) { t.lava.tri(pa, a, pb); t.lava.tri(pb, a, b2); t.lava.tri(pa, pb, a); t.lava.tri(pb, b2, a); }
    pa = a; pb = b2;
  }
}

function crater(t: KitTargets, k: KitPlacement): void {
  t.lava.cylinder(f.m(0, 0, 0, k.w, 0.6, k.d), new THREE.Color(0xff6a20), 16);
}

// ─────────────────────────────── Small pieces ───────────────────────────────

function lantern(t: KitTargets, k: KitPlacement): void {
  t.solid.cylinder(f.m(0, k.h / 2, 0, 0.13, k.h + (k.y - k.base), 0.13), KIT.iron, 5);
  t.lamp.box(f.m(0, k.h + 0.35, 0, 0.55, 0.75, 0.55), KIT.lamp);
  t.solid.cone(f.m(0, k.h + 0.95, 0, 0.5, 0.45, 0.5, Math.PI / 4), KIT.iron, 4);
}

function crates(t: KitTargets, k: KitPlacement): void {
  const n = 2 + (k.variant % 2);
  for (let i = 0; i < n; i++) {
    const s = 1 + 0.3 * hash01(k.variant, i);
    t.solid.box(f.m((i - n / 2) * 1.2, s / 2 + (i === 2 ? 1.1 : 0), (i % 2) * 0.5, s, s, s, i * 0.4), i % 2 ? KIT.woodLight : KIT.wood);
  }
  t.solid.cylinder(f.m(1.6, 0.6, -0.8, 0.5, 1.2, 0.5), KIT.woodDark, 8);
}

function flagPole(t: KitTargets, k: KitPlacement): void {
  const h = k.h;
  t.solid.cylinder(f.m(0, h / 2, 0, 0.12 * k.w, h, 0.12 * k.w), KIT.whiteShade, 5);
  t.solid.sphere(f.m(0, h + 0.2, 0, 0.25 * k.w, 0.25 * k.w, 0.25 * k.w), KIT.gold, 0);
  t.flags.push({ x: f.x, y: f.y + h - 0.3, z: f.z, scale: 1.6 * k.w });
}

// ─────────────────────────────── Giant tree ───────────────────────────────

function giantTree(b: MeshBuilder, k: KitPlacement, lod: number, pal: TerrainPalette): void {
  const trunkR = k.w, height = k.h, spread = k.d;
  const bark = new THREE.Color(0x6b5a4a), barkLight = new THREE.Color(0x8f7a64);
  const barkFn = (_x: number, y: number, _z: number, nx: number, _ny: number, nz: number, out: THREE.Color) => {
    out.copy(bark).lerp(barkLight, 0.5 + 0.5 * Math.sin(y * 0.35 + Math.atan2(nx, nz) * 3));
  };
  /** Tapered limb from (x0,y0,z0) along yaw/pitch (pitch from vertical); returns the far end. */
  const limb = (x0: number, y0: number, z0: number, yaw: number, pitch: number, len: number, r: number, taper: number, segs: number): [number, number, number] => {
    const dx = Math.sin(yaw) * Math.sin(pitch), dy = Math.cos(pitch), dz = Math.cos(yaw) * Math.sin(pitch);
    b.cylinder(f.m(x0 + dx * len / 2, y0 + dy * len / 2, z0 + dz * len / 2, r, len * 1.04, r, yaw, pitch, 0), barkFn, segs, taper, 1);
    return [x0 + dx * len, y0 + dy * len, z0 + dz * len];
  };
  // Buttress roots flaring out and down into the ground.
  const roots = lod === 0 ? 7 : 4;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + k.variant;
    limb(0, 2.2, 0, a, 1.95, trunkR * 3.4, trunkR * 0.5, 0.25, 6);
  }
  // Trunk: three leaning, tapering segments.
  let x = 0, y = 0, z = 0;
  const trunkH = height * 0.5;
  for (let s = 0; s < 3; s++) {
    const r = trunkR * (1 - s * 0.16);
    const lean = 0.07 * Math.sin(s * 1.7 + k.variant);
    [x, y, z] = limb(x, y, z, s * 0.9 + k.variant, lean, trunkH / 3, r, 0.84, 10);
  }
  // Main limbs, each ending in an umbrella canopy (T6 silhouette), plus a crown over the trunk.
  const low = pal.grassDark, mid = pal.grass, high = pal.grassLight;
  const canopy = (cx: number, cy: number, cz: number, r: number, squash: number, yaw: number) => {
    b.append(canopySphere(lod === 0 ? 2 : 1), f.m(cx, cy, cz, r, r * squash, r, yaw), (_x, py, _z, _nx, ny, _nz, out) => {
      const hgt = (py - (f.y + cy - r * squash)) / (2 * r * squash);
      out.copy(low).lerp(mid, Math.min(1, hgt * 1.5)).lerp(high, Math.max(0, hgt - 0.5 + ny * 0.3));
    });
  };
  const limbs = 5;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + k.variant * 0.7;
    const len = spread * (0.8 + 0.35 * hash01(k.variant, i));
    const pitch = 0.75 + 0.3 * hash01(i, k.variant);
    const [ex, ey, ez] = limb(x, y - trunkH * 0.08, z, a, pitch, len, trunkR * 0.42, 0.55, 8);
    const cr = spread * (0.5 + 0.2 * hash01(i + 5, k.variant));
    canopy(ex, ey + cr * 0.12, ez, cr, 0.4, a);
    if (lod === 0) {
      canopy(ex + Math.sin(a + 1.2) * cr * 0.55, ey - cr * 0.05, ez + Math.cos(a + 1.2) * cr * 0.55, cr * 0.62, 0.45, a + 1);
      canopy(ex + Math.sin(a - 1.1) * cr * 0.5, ey + cr * 0.02, ez + Math.cos(a - 1.1) * cr * 0.5, cr * 0.55, 0.45, a - 1);
    }
  }
  canopy(x, y + spread * 0.42, z, spread * 0.85, 0.36, k.variant);
}

// ─────────────────────────────── Piers ───────────────────────────────

/** Wooden pier on piles over the pier footprint, lantern at the seaward end, rowboats moored alongside. */
export function appendPier(t: KitTargets, pier: IslandDef, landX: number, landZ: number, ox: number, oz: number, lod: number): void {
  const o = pier.outline;
  // Long axis from the longest edge; seaward end = the one farther from land.
  let best = 0, ax = 0, az = 0;
  for (let i = 0; i < o.length; i++) {
    const a = o[i]!, b = o[(i + 1) % o.length]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > best) { best = len; ax = (b.x - a.x) / len; az = (b.z - a.z) / len; }
  }
  const toSea = (pier.x - landX) * ax + (pier.z - landZ) * az;
  if (toSea < 0) { ax = -ax; az = -az; }
  const yaw = Math.atan2(ax, az);
  const L = best;
  f.x = pier.x - ox; f.y = 0; f.z = pier.z - oz; f.yaw = yaw;
  const deckY = 2.3;
  t.solid.box(f.m(0, deckY, 0, 4.6, 0.45, L), KIT.woodLight);
  if (lod === 0) {
    for (let zz = -L / 2 + 1; zz <= L / 2; zz += 3.5) {
      for (const side of [-1, 1]) t.solid.cylinder(f.m(side * 2.1, (deckY - 5) / 2, zz, 0.28, deckY + 5, 0.28), KIT.woodDark, 5);
      t.solid.box(f.m(0, deckY + 0.25, zz, 4.6, 0.08, 0.25), KIT.wood);
    }
    for (const side of [-1, 1]) t.solid.cylinder(f.m(side * 1.9, deckY + 0.55, L / 2 - 2, 0.25, 0.7, 0.25), KIT.iron, 6);
    rowboat(t.solid, f.x + Math.cos(yaw) * 3.6, -0.45, f.z - Math.sin(yaw) * 3.6, yaw + 0.05, (pier.seed >>> 3) % 6);
    if (L > 30) rowboat(t.solid, f.x - Math.cos(yaw) * 3.6 + ax * 8, -0.45, f.z + Math.sin(yaw) * 3.6 + az * 8, yaw - 0.08, (pier.seed >>> 7) % 6);
  }
  f.y = deckY + 0.2;
  t.solid.cylinder(f.m(1.9, 1.7, L / 2 - 1, 0.13, 3.4, 0.13), KIT.iron, 5);
  t.lamp.box(f.m(1.9, 3.7, L / 2 - 1, 0.55, 0.75, 0.55), KIT.lamp);
}
