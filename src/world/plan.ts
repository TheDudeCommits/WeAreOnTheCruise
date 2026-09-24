/**
 * Island dressing plans (WORLD-owned, pure): where forest canopy, palms, trees, bushes, rocks, kit pieces
 * (forts, towns, piers, lighthouses, ruins, wrecks, vents), waterfalls and Cliff Battery sites go.
 *
 * Deterministic from the island seed; every placement is checked against the island surface so props stand on
 * land (never in the water or floating off a cliff). The renderer turns plans into merged/instanced geometry.
 */
import { createSeededRandom, type SeededRandom } from '../core/rng';
import type { IslandDef } from '../game/types';
import { TAU, angleDiff, clamp, fbm, hash01, lerp } from './noise';
import { IslandSurface } from './surface';
import type { PaletteId } from './seas';

export type PropKind = 'palm' | 'broadleaf' | 'conifer' | 'dead-tree' | 'bush';

export interface PropPlacement {
  kind: PropKind;
  x: number; y: number; z: number;
  yaw: number;
  scale: number;
  /** Lean angle (radians) and its direction (outline angle convention). */
  lean: number;
  leanYaw: number;
  /** 0..1 colour variation. */
  tint: number;
  /** 0..1 variant pick. */
  variant: number;
}

/** A forest canopy blob merged into the island mesh (the dense "jungle" read from above). */
export interface CanopyBlob { x: number; y: number; z: number; r: number; squash: number; tint: number }

export interface RockPlacement { x: number; y: number; z: number; r: number; yaw: number; squash: number; tint: number }

export type KitKind =
  | 'house' | 'hut' | 'tower' | 'wall' | 'keep' | 'gate' | 'lighthouse' | 'cannon' | 'column' | 'column-broken'
  | 'ruin-wall' | 'ruin-arch' | 'wreck' | 'vent' | 'crater' | 'lantern' | 'crates' | 'giant-tree' | 'flag';

export interface KitPlacement {
  kind: KitKind;
  x: number; y: number; z: number;
  yaw: number;
  /** Size (m) — meaning depends on the kind (see src/render/world/kit.ts). */
  w: number; h: number; d: number;
  variant: number;
  /** Ground height under the piece's lowest corner (foundations reach down to it). */
  base: number;
}

export interface WaterfallPlan { points: { x: number; y: number; z: number }[]; width: number; nx: number; nz: number }

export interface VinePlan { points: { x: number; y: number; z: number }[]; width: number; nx: number; nz: number }

export interface BatterySite { islandId: string; x: number; y: number; z: number; facing: number }

export interface IslandPlan {
  canopy: CanopyBlob[];
  props: PropPlacement[];
  rocks: RockPlacement[];
  kit: KitPlacement[];
  waterfalls: WaterfallPlan[];
  vines: VinePlan[];
  battery: BatterySite[];
}

const plans = new WeakMap<IslandDef, Map<PaletteId, IslandPlan>>();
const surfaces = new WeakMap<IslandDef, IslandSurface>();

export function surfaceOf(def: IslandDef): IslandSurface {
  let s = surfaces.get(def);
  if (!s) { s = new IslandSurface(def); surfaces.set(def, s); }
  return s;
}

export function planIsland(def: IslandDef, palette: PaletteId = 'sunward'): IslandPlan {
  let byPalette = plans.get(def);
  if (!byPalette) { byPalette = new Map(); plans.set(def, byPalette); }
  let plan = byPalette.get(palette);
  if (!plan) { plan = buildPlan(def, palette); byPalette.set(palette, plan); }
  return plan;
}

/** Cliff Battery sites (fort tower tops). */
export function batterySites(def: IslandDef): BatterySite[] {
  return def.landmark === 'fort' ? planIsland(def).battery : [];
}

interface Footprint { x: number; z: number; r: number }

class Planner {
  readonly plan: IslandPlan = { canopy: [], props: [], rocks: [], kit: [], waterfalls: [], vines: [], battery: [] };
  readonly rng: SeededRandom;
  readonly blocked: Footprint[] = [];
  readonly archetype: string;
  constructor(readonly def: IslandDef, readonly s: IslandSurface, readonly palette: PaletteId) {
    this.rng = createSeededRandom(def.seed ^ 0x6a09e667);
    this.archetype = s.shape.spec.archetype;
  }

  free(x: number, z: number, r: number): boolean {
    for (const b of this.blocked) if (Math.hypot(b.x - x, b.z - z) < b.r + r) return false;
    return true;
  }

  block(x: number, z: number, r: number): void { this.blocked.push({ x, z, r }); }

  /** Ground sample on the island top (not beach/cliff), flat enough, away from the rim. */
  top(x: number, z: number, maxSteep = 0.5, minInset = 0.04): { y: number; s: number } | null {
    const smp = this.s.sample(x, z);
    if (smp.zone !== 'top' || smp.steep > maxSteep || smp.s > 1 - minInset) return null;
    return { y: smp.y, s: smp.s };
  }

  kit(kind: KitKind, x: number, z: number, yaw: number, w: number, h: number, d: number, variant = 0, footprint = Math.max(w, d) * 0.6): KitPlacement | null {
    // Foundations reach the lowest ground under the footprint corners.
    let lo = Infinity, hi = -Infinity;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (const [ax, az] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]] as const) {
      const px = x + ax * cs + az * sn, pz = z - ax * sn + az * cs;
      const smp = this.s.sample(px, pz);
      if (smp.zone === 'water') return null;
      lo = Math.min(lo, smp.y); hi = Math.max(hi, smp.y);
    }
    // Houses sink into the uphill side so foundations read as terrace walls, not stilts.
    const y = kind === 'house' || kind === 'hut' ? lo + (hi - lo) * 0.55 : hi;
    const k: KitPlacement = { kind, x, y, z, yaw, w, h, d, variant, base: lo - 0.6 };
    this.plan.kit.push(k);
    if (footprint > 0) this.block(x, z, footprint);
    return k;
  }
}

function buildPlan(def: IslandDef, palette: PaletteId): IslandPlan {
  if (def.landmark === 'pier' || def.landmark === 'breakwater') return planStructure(def);
  const s = surfaceOf(def);
  const p = new Planner(def, s, palette);
  // Landmarks and kit claim ground first, vegetation fills around them.
  switch (def.landmark) {
    case 'fort': planFort(p); break;
    case 'harbor': planHarbor(p, false); break;
    case 'harbor-town': planHarbor(p, true); break;
    case 'lighthouse': planLighthouse(p); break;
    case 'ruins': planRuins(p); break;
    case 'shipwreck': planWreck(p); break;
    case 'volcano': planVolcano(p); break;
    case 'giant-tree': planGiantTree(p); break;
    default: break;
  }
  planWaterfalls(p);
  planVegetation(p);
  planRocks(p);
  planVines(p);
  return p.plan;
}

// ─────────────────────────────── Vegetation ───────────────────────────────

export function lushness(def: IslandDef, palette: PaletteId): number {
  switch (def.biome) {
    case 'tropical': return palette === 'sunward' ? 1 : 0.7;
    case 'harbor': return 0.6;
    case 'rocky': return palette === 'sunward' ? 0.45 : 0.35;
    case 'fort': return 0.35;
    case 'volcanic': return 0.08;
    default: return 0;
  }
}

function planVegetation(p: Planner): void {
  const { def, s, rng, palette } = p;
  const lush = lushness(def, palette);
  if (lush <= 0) return;
  const seed = def.seed;
  const R = def.radius;
  const conifers = palette !== 'sunward';
  const treeKind: PropKind = def.biome === 'volcanic' ? 'dead-tree' : conifers ? (palette === 'gloam' && rng.chance(0.4) ? 'broadleaf' : 'conifer') : 'broadleaf';

  // Forest canopy blobs on a jittered grid; a noise mask forms clumps and clearings.
  const spacing = clamp(R * 0.075, 5.5, 10);
  const canopyThreshold = lerp(0.55, -0.35, lush);
  const forestAllowed = def.biome !== 'volcanic' && p.archetype !== 'reef' && p.archetype !== 'rock';
  for (let gx = -R; gx <= R; gx += spacing) {
    for (let gz = -R; gz <= R; gz += spacing) {
      const x = def.x + gx + (hash01(seed, (gx * 7) | 0, (gz * 7) | 0) - 0.5) * spacing * 0.9;
      const z = def.z + gz + (hash01(seed + 1, (gx * 7) | 0, (gz * 7) | 0) - 0.5) * spacing * 0.9;
      const t = p.top(x, z, 0.55, 0.0);
      if (!t) continue;
      const mask = fbm(seed + 21, x / 46, z / 46, 3) + (t.s > 0.9 ? 0.15 : 0);
      if (forestAllowed && mask > canopyThreshold && p.free(x, z, spacing * 0.5)) {
        const r = spacing * (0.62 + rng.next() * 0.42) * (t.s > 0.94 ? 0.85 : 1);
        p.plan.canopy.push({ x, y: t.y + r * 0.18, z, r, squash: 0.62 + rng.next() * 0.2, tint: rng.next() });
        // Emergent trees poke out of the canopy for a broken silhouette.
        if (!conifers && rng.chance(0.12 * lush)) addProp(p, treeKind, x, t.y - 0.5, z, 1.25 + rng.next() * 0.5, false);
      } else if (mask > canopyThreshold - 0.25 && rng.chance(0.55 * lush + 0.1) && p.free(x, z, 2.5)) {
        // Forest edge: single trees with visible trunks.
        addProp(p, treeKind, x, t.y - 0.4, z, 0.8 + rng.next() * 0.55);
      }
    }
  }

  // Bushes along the rim (breaks the plateau edge) and on the bank behind beaches.
  const n = s.n;
  const stepRim = Math.max(1, Math.round(n / ((TAU * R) / 6)));
  for (let i = 0; i < n; i += stepRim) {
    if (hash01(seed + 5, i) > 0.35 + lush * 0.5) continue;
    const t = s.theta[i]!;
    const r = s.rimR[i]! * (0.95 - rng.next() * 0.05) - 1.2;
    const x = def.x + Math.sin(t) * r, z = def.z + Math.cos(t) * r;
    const g = p.top(x, z, 0.65, 0);
    if (!g || !p.free(x, z, 1.5)) continue;
    addProp(p, 'bush', x, g.y - 0.3, z, 0.7 + rng.next() * 0.7);
  }

  // Palms on beaches (lean seaward, in clumps) — Sunward and tropical flavour.
  if (palette === 'sunward' || def.biome === 'tropical' || def.biome === 'harbor') {
    for (let i = 0; i < n; i++) {
      const b = s.beach[i]!;
      if (b < 0.55 || hash01(seed + 9, i) > 0.42 * (0.4 + lush)) continue;
      const t = s.theta[i]!;
      const clump = 1 + Math.floor(rng.next() * 3);
      for (let c = 0; c < clump; c++) {
        const inset = lerp(s.R[i]! - s.shoreR[i]! + 1.5, s.R[i]! - s.rimR[i]! + 4, rng.next());
        const r = s.R[i]! - inset;
        const tt = t + (rng.next() - 0.5) * 0.05;
        const x = def.x + Math.sin(tt) * r, z = def.z + Math.cos(tt) * r;
        const smp = s.sample(x, z);
        if (smp.zone === 'water' || smp.zone === 'cliff' || smp.y < 1.2 || !p.free(x, z, 1.8)) continue;
        const prop = addProp(p, 'palm', x, smp.y - 0.3, z, 0.8 + rng.next() * 0.45);
        prop.lean = 0.12 + rng.next() * 0.3;
        prop.leanYaw = tt + (rng.next() - 0.5) * 0.8;
      }
    }
    // A few palms on small tropical tops (stacks, pillars).
    if ((p.archetype === 'stack' || p.archetype === 'pillar') && def.biome === 'tropical') {
      const count = p.archetype === 'pillar' ? 5 : 2;
      for (let c = 0; c < count; c++) {
        const a = rng.range(0, TAU), rr = s.rimR[0]! * rng.range(0.2, 0.75);
        const x = def.x + Math.sin(a) * rr, z = def.z + Math.cos(a) * rr;
        const g = p.top(x, z, 0.7, 0.05);
        if (!g || !p.free(x, z, 2)) continue;
        const prop = addProp(p, 'palm', x, g.y - 0.3, z, 0.8 + rng.next() * 0.4);
        prop.lean = 0.1 + rng.next() * 0.25; prop.leanYaw = a;
      }
    }
  }
}

function addProp(p: Planner, kind: PropKind, x: number, y: number, z: number, scale: number, blocks = true): PropPlacement {
  const rng = p.rng;
  const prop: PropPlacement = { kind, x, y, z, yaw: rng.range(0, TAU), scale, lean: rng.range(0, 0.08), leanYaw: rng.range(0, TAU), tint: rng.next(), variant: rng.next() };
  p.plan.props.push(prop);
  if (blocks) p.block(x, z, kind === 'bush' ? 1.2 : 2.2 * scale);
  return prop;
}

// ─────────────────────────────── Rocks ───────────────────────────────

function planRocks(p: Planner): void {
  const { def, s, rng } = p;
  const n = s.n;
  const seed = def.seed;
  const perimeterStep = (TAU * def.radius) / n;
  const reef = p.archetype === 'reef';
  for (let i = 0; i < n; i++) {
    const b = s.beach[i]!;
    const t = s.theta[i]!;
    const R = s.R[i]!;
    const chance = b > 0.5 ? 0.08 : reef ? 0.35 : p.archetype === 'rock' ? 0.12 : 0.2;
    if (hash01(seed + 33, i) > (chance * perimeterStep) / 4.4) continue;
    // Size limited so the rock pokes out of the coast by ≤ 1 m (collision truth).
    const size = b > 0.5 ? rng.range(0.7, 1.9) : rng.range(1.2, reef ? 2.6 : 3.4);
    const inside = Math.max(size - 1, 0.3) + rng.range(0.1, b > 0.5 ? 2.5 : 0.8);
    const tt = t + (rng.next() - 0.5) * (TAU / n) * 0.8;
    const r = R - inside;
    const x = def.x + Math.sin(tt) * r, z = def.z + Math.cos(tt) * r;
    const y = b > 0.5 ? s.sample(x, z).y * 0.5 : rng.range(-0.4, 0.8);
    p.plan.rocks.push({ x, y, z, r: size, yaw: rng.range(0, TAU), squash: rng.range(0.55, 0.85), tint: rng.next() });
  }
  // A few boulders on tops (not on forest).
  const tops = reef ? 10 : p.archetype === 'rock' ? 0 : Math.round(def.radius / 22);
  for (let k = 0; k < tops; k++) {
    const a = rng.range(0, TAU), rr = rng.range(0.1, 0.85) * s.rimR[Math.floor(rng.next() * n)]!;
    const x = def.x + Math.sin(a) * rr, z = def.z + Math.cos(a) * rr;
    const g = p.top(x, z, 0.6, 0.02);
    if (!g || !p.free(x, z, 2)) continue;
    const size = rng.range(1, reef ? 2.2 : 3);
    p.plan.rocks.push({ x, y: g.y - size * 0.2, z, r: size, yaw: rng.range(0, TAU), squash: rng.range(0.5, 0.8), tint: rng.next() });
  }
}

// ─────────────────────────────── Waterfalls & vines ───────────────────────────────

function bandAt(s: IslandSurface, y: number): number {
  let band = 0;
  while (band < s.shape.strata.length - 1 && s.shape.strata[band]!.top < y) band++;
  return band;
}

function planWaterfalls(p: Planner): void {
  const { def, s, rng } = p;
  if (def.biome === 'volcanic' || def.biome === 'reef' || p.archetype === 'rock' || p.archetype === 'stack' || def.radius < 32) return;
  let maxH = 0;
  for (let i = 0; i < s.n; i++) if (s.beach[i]! < 0.1) maxH = Math.max(maxH, s.H[i]!);
  if (maxH < 22) return;
  const count = def.radius > 90 || p.archetype === 'pillar' ? 2 : 1;
  const used: number[] = [];
  for (let attempt = 0; attempt < 40 && p.plan.waterfalls.length < count; attempt++) {
    const i = Math.floor(rng.next() * s.n);
    const t = s.theta[i]!;
    if (s.beach[i]! > 0.05 || s.H[i]! < maxH * 0.8) continue;
    if (used.some((u) => Math.abs(angleDiff(u, t)) < 1.2)) continue;
    if (s.shape.spec.face !== undefined && Math.abs(angleDiff(t, s.shape.spec.face)) < 0.5) continue;
    const pts: { x: number; y: number; z: number }[] = [];
    const H = s.H[i]!;
    const steps = Math.max(6, Math.round(H / 4));
    for (let k = 0; k <= steps; k++) {
      const y = H * (1 - k / steps);
      const band = Math.min(bandAt(s, y), s.topBand[i]!);
      // Hug the outermost face between here and 2 m above (clears protruding ledges).
      const r = Math.max(s.faceR(i, y, band), s.faceR(i, Math.min(H, y + 2), Math.min(bandAt(s, y + 2), s.topBand[i]!))) + 1.1;
      pts.push({ x: def.x + Math.sin(t) * r, y: y + (k === 0 ? 0.6 : 0), z: def.z + Math.cos(t) * r });
    }
    // Keep the falling water inside the coast (never beyond the collision polygon by more than a metre).
    if (pts.some((q) => Math.hypot(q.x - def.x, q.z - def.z) > s.R[i]! + 1.2)) continue;
    used.push(t);
    p.plan.waterfalls.push({ points: pts, width: rng.range(4, 8), nx: Math.sin(t), nz: Math.cos(t) });
    p.block(def.x + Math.sin(t) * (s.rimR[i]! - 6), def.z + Math.cos(t) * (s.rimR[i]! - 6), 8);
  }
}

function planVines(p: Planner): void {
  const { def, s, rng } = p;
  const lush = lushness(def, p.palette);
  if (lush < 0.4 || p.archetype === 'rock' || p.archetype === 'reef') return;
  const n = s.n;
  for (let i = 0; i < n; i++) {
    if (s.beach[i]! > 0.2 || s.H[i]! < 10 || hash01(def.seed + 44, i) > 0.22 * lush) continue;
    const t = s.theta[i]! + (rng.next() - 0.5) * (TAU / n);
    const H = s.H[i]!;
    const len = Math.min(H - 3, rng.range(5, 18));
    const pts: { x: number; y: number; z: number }[] = [];
    const steps = Math.max(3, Math.round(len / 2.5));
    for (let k = 0; k <= steps; k++) {
      const y = H + 0.3 - (len * k) / steps;
      const r = s.faceR(i, y, Math.min(bandAt(s, y), s.topBand[i]!)) + 0.35 + Math.sin(k * 1.3) * 0.15;
      pts.push({ x: def.x + Math.sin(t) * r, y, z: def.z + Math.cos(t) * r });
    }
    p.plan.vines.push({ points: pts, width: rng.range(0.35, 0.7), nx: Math.sin(t), nz: Math.cos(t) });
  }
}

// ─────────────────────────────── Landmark kit ───────────────────────────────

function rimAt(s: IslandSurface, theta: number): number {
  const l = s.locate(theta);
  return s.rimR[l.i0]! + (s.rimR[l.i1]! - s.rimR[l.i0]!) * l.f;
}

function planFort(p: Planner): void {
  const { def, s, rng } = p;
  const corners = 5 + Math.floor(rng.next() * 3);
  const phase = rng.range(0, TAU);
  const pts: { x: number; z: number; t: number }[] = [];
  for (let c = 0; c < corners; c++) {
    const t = phase + (c / corners) * TAU + rng.range(-0.12, 0.12);
    // The wall ring stays inside the narrowest nearby rim.
    let rim = Infinity;
    for (let d = -0.35; d <= 0.35; d += 0.07) rim = Math.min(rim, rimAt(s, t + d));
    const r = rim * 0.74;
    pts.push({ x: def.x + Math.sin(t) * r, z: def.z + Math.cos(t) * r, t });
  }
  let towerIndex = 0;
  for (let c = 0; c < corners; c++) {
    const a = pts[c]!, b = pts[(c + 1) % corners]!;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    p.kit(c === 0 ? 'gate' : 'wall', (a.x + b.x) / 2, (a.z + b.z) / 2, yaw, 2.8, 8, len, 0, 0);
    const tower = p.kit('tower', a.x, a.z, 0, 9, 14 + rng.range(-1, 2), 9, towerIndex++ % 3, 7);
    if (tower) {
      // Contract heading: forward = (−sin h, −cos h); face outward from the fort centre.
      const out = Math.atan2(a.x - def.x, a.z - def.z);
      p.plan.battery.push({ islandId: def.id, x: a.x, y: tower.y + tower.h, z: a.z, facing: out + Math.PI });
      p.kit('flag', a.x, a.z, 0, 1, tower.h + 6, 1, 0, 0);
    }
  }
  // Keep and barracks inside.
  const keep = p.kit('keep', def.x, def.z, rng.range(0, TAU), 18, 16, 14, 0, 12);
  if (keep) p.kit('flag', def.x, def.z, 0, 1.4, keep.h + 12, 1, 1, 0);
  const off = rng.range(0, TAU);
  p.kit('house', def.x + Math.sin(off) * 20, def.z + Math.cos(off) * 20, off, 12, 7, 8, 1, 7);
  // Cannons on the walls pointing out.
  for (let c = 0; c < corners; c++) {
    const a = pts[c]!, b = pts[(c + 1) % corners]!;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const out = Math.atan2(mx - def.x, mz - def.z);
    const g = s.sample(mx, mz);
    p.plan.kit.push({ kind: 'cannon', x: mx, y: g.y + 8, z: mz, yaw: out, w: 1, h: 1, d: 3, variant: 0, base: g.y + 8 });
  }
}

function planHarbor(p: Planner, grand: boolean): void {
  const { def, s, rng } = p;
  const bay = s.shape.spec.bay ?? 0;
  if (grand) {
    // Hilltop keep with a ring of towers and walls (the castle above the town, T8).
    const back = bay + Math.PI;
    const kx = def.x + Math.sin(back) * rimAt(s, back) * 0.12, kz = def.z + Math.cos(back) * rimAt(s, back) * 0.12;
    const keep = p.kit('keep', kx, kz, bay, 18, 15, 13, 0, 13);
    if (keep) p.kit('flag', kx, kz, 0, 1.4, keep.h + 11, 1, 1, 0);
    const ring = 21, towers = 5;
    const pts: { x: number; z: number }[] = [];
    for (let c = 0; c < towers; c++) {
      const t = bay + Math.PI / towers + (c / towers) * Math.PI * 2;
      pts.push({ x: kx + Math.sin(t) * ring, z: kz + Math.cos(t) * ring });
    }
    for (let c = 0; c < towers; c++) {
      const a = pts[c]!, b = pts[(c + 1) % towers]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      p.kit(c === towers - 1 ? 'gate' : 'wall', (a.x + b.x) / 2, (a.z + b.z) / 2, Math.atan2(dx, dz), 2.6, 7, Math.hypot(dx, dz), 0, 0);
      const tower = p.kit('tower', a.x, a.z, 0, 7.5, 12 + rng.range(0, 3), 7.5, c % 2 === 0 ? 1 : 0, 6);
      if (tower && c % 2 === 0) p.kit('flag', a.x, a.z, 0, 1, tower.h + 6, 1, 0, 0);
    }
    p.block(kx, kz, ring + 5);
  }
  // Terraced town rows climbing the slope behind the bay beach.
  const rows = grand ? [0.93, 0.84, 0.75, 0.66, 0.57, 0.48, 0.4] : [0.9, 0.78, 0.66, 0.54, 0.43];
  for (let ri = 0; ri < rows.length; ri++) {
    const frac = rows[ri]!;
    const spread = (grand ? 0.95 : 0.75) - ri * (grand ? 0.07 : 0.08);
    for (let a = -spread; a <= spread; a += 0.1 + rng.next() * 0.06) {
      const t = bay + a;
      const r = rimAt(s, t) * frac;
      const x = def.x + Math.sin(t) * r, z = def.z + Math.cos(t) * r;
      const g = p.top(x, z, 0.55, 0.03);
      if (!g || !p.free(x, z, 4)) continue;
      const w = rng.range(6.5, 10), d = rng.range(6, 8.5), h = rng.range(5, 8.5);
      p.kit('house', x, z, t + rng.range(-0.15, 0.15), w, h, d, Math.floor(rng.next() * 36), Math.max(w, d) * 0.62);
    }
  }
  // Watch tower at the top of town.
  const topT = bay + rng.range(-0.3, 0.3), topR = rimAt(s, topT) * 0.3;
  const tx = def.x + Math.sin(topT) * topR, tz = def.z + Math.cos(topT) * topR;
  if (!grand && p.top(tx, tz, 0.8, 0) && p.free(tx, tz, 5)) {
    const tower = p.kit('tower', tx, tz, 0, 8, 18, 8, 1, 6);
    if (tower) p.kit('flag', tx, tz, 0, 1, tower.h + 7, 1, 0, 0);
  }
  // Lighthouse on the headland beside the bay.
  for (const side of [1, -1]) {
    let bestT = bay + side * 1.1, bestR = 0;
    for (let a = 0.8; a <= 1.6; a += 0.05) {
      const t = bay + side * a, r = rimAt(s, t);
      if (s.beach[s.locate(t).i0]! < 0.25 && r > bestR) { bestR = r; bestT = t; }
    }
    const r = bestR - 7;
    const x = def.x + Math.sin(bestT) * r, z = def.z + Math.cos(bestT) * r;
    if (bestR > 0 && p.top(x, z, 0.8, 0) && p.free(x, z, 5)) { p.kit('lighthouse', x, z, rng.range(0, TAU), 7, rng.range(20, 26), 7, 0, 6); break; }
  }
  // Quay lanterns and crates along the beach crest.
  for (let a = -0.6; a <= 0.6; a += 0.2) {
    const t = bay + a;
    const l = s.locate(t);
    const r = s.shoreR[l.i0]! - 1.5;
    const x = def.x + Math.sin(t) * r, z = def.z + Math.cos(t) * r;
    const smp = s.sample(x, z);
    if (smp.zone === 'water') continue;
    p.plan.kit.push({ kind: 'lantern', x, y: smp.y, z, yaw: t, w: 1, h: 3.4, d: 1, variant: 0, base: smp.y - 0.5 });
    if (rng.chance(0.5)) p.kit('crates', x + Math.cos(t) * 3, z - Math.sin(t) * 3, t, 2.4, 1.6, 2.4, Math.floor(rng.next() * 4), 1.5);
  }
}

function planLighthouse(p: Planner): void {
  const { def, s, rng } = p;
  p.kit('lighthouse', def.x, def.z, rng.range(0, TAU), 7.5, rng.range(22, 30), 7.5, 0, 6);
  const t = rng.range(0, TAU), r = rimAt(s, t) * 0.5;
  p.kit('hut', def.x + Math.sin(t) * r, def.z + Math.cos(t) * r, t, 6, 4.5, 5, 0, 4);
}

function planRuins(p: Planner): void {
  const { def, rng } = p;
  const cx = def.x + rng.range(-0.15, 0.15) * def.radius, cz = def.z + rng.range(-0.15, 0.15) * def.radius;
  const ringR = Math.min(def.radius * 0.28, 22);
  const cols = 8 + Math.floor(rng.next() * 5);
  for (let c = 0; c < cols; c++) {
    const t = (c / cols) * TAU;
    const x = cx + Math.sin(t) * ringR, z = cz + Math.cos(t) * ringR;
    if (!p.top(x, z, 0.8, 0)) continue;
    const broken = rng.chance(0.55);
    p.kit(broken ? 'column-broken' : 'column', x, z, rng.range(0, TAU), 1.8, broken ? rng.range(3, 8) : rng.range(9, 12), 1.8, c, 1.5);
  }
  const t = rng.range(0, TAU);
  p.kit('ruin-arch', cx + Math.sin(t) * ringR * 0.3, cz + Math.cos(t) * ringR * 0.3, t, 10, 11, 2.2, 0, 6);
  for (let k = 0; k < 4; k++) {
    const a = rng.range(0, TAU), r = rng.range(ringR * 1.3, ringR * 2.2);
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    if (!p.top(x, z, 0.6, 0.05) || !p.free(x, z, 5)) continue;
    p.kit('ruin-wall', x, z, a + Math.PI / 2, 2, rng.range(2.5, 5), rng.range(8, 16), k, 5);
  }
  p.block(cx, cz, ringR + 3);
}

function planWreck(p: Planner): void {
  const { def, s, rng } = p;
  // Rest the hull across the reef edge.
  const t = rng.range(0, TAU);
  const l = s.locate(t);
  const r = s.R[l.i0]! - 10;
  const x = def.x + Math.sin(t) * r, z = def.z + Math.cos(t) * r;
  const g = s.sample(x, z);
  p.plan.kit.push({ kind: 'wreck', x, y: Math.max(0, g.y) - 0.5, z, yaw: t + Math.PI / 2 + rng.range(-0.5, 0.5), w: 9, h: 7, d: 30, variant: 0, base: -2 });
  p.block(x, z, 16);
}

function planVolcano(p: Planner): void {
  const { def, s, rng } = p;
  // Crater lava pool and glowing cracks running down the cone.
  const crater = s.sample(def.x, def.z);
  const rim0 = rimAt(s, 0);
  p.plan.kit.push({ kind: 'crater', x: def.x, y: crater.y + 0.4, z: def.z, yaw: 0, w: rim0 * 0.21, h: 1, d: rim0 * 0.21, variant: 0, base: crater.y });
  const cracks = 4 + Math.floor(rng.next() * 4);
  for (let c = 0; c < cracks; c++) {
    const t = rng.range(0, TAU);
    const rim = rimAt(s, t);
    const r0 = rim * rng.range(0.25, 0.4), r1 = rim * rng.range(0.55, 0.85);
    p.plan.kit.push({ kind: 'vent', x: def.x + Math.sin(t) * r0, y: 0, z: def.z + Math.cos(t) * r0, yaw: t, w: rng.range(1.2, 2.4), h: 0, d: r1 - r0, variant: c, base: 0 });
  }
  p.block(def.x, def.z, rim0 * 0.3);
}

function planGiantTree(p: Planner): void {
  const { def, s, rng } = p;
  const x = def.x + rng.range(-0.1, 0.1) * def.radius, z = def.z + rng.range(-0.1, 0.1) * def.radius;
  const g = s.sample(x, z);
  const height = rng.range(52, 72);
  p.plan.kit.push({ kind: 'giant-tree', x, y: g.y - 1, z, yaw: rng.range(0, TAU), w: rng.range(6, 8), h: height, d: rng.range(20, 26), variant: Math.floor(rng.next() * 3), base: g.y - 4 });
  p.block(x, z, 16);
}

/** Piers and breakwaters: the renderer builds deck, piles, lantern and moored boats from the footprint itself. */
function planStructure(_def: IslandDef): IslandPlan {
  return { canopy: [], props: [], rocks: [], kit: [], waterfalls: [], vines: [], battery: [] };
}
