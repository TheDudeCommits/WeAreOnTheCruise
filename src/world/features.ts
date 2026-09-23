/**
 * World features (WORLD-owned, pure). The endless field is split into 600 m cells; a cell holds at most one
 * feature (an island with satellites, a rock cluster, sea stacks or a landmark). Features never leave their cell
 * minus a 45 m margin, so there is always ≥ 90 m of open water between features in neighbouring cells, and the
 * area around the origin (run start) is kept clear.
 *
 * A feature can own several collision islands (arch = two pillars, harbour = island + pier footprints); the
 * renderer meshes a feature as one unit so draw calls stay per feature, not per island.
 */
import { createSeededRandom, hashCoordinates, type SeededRandom } from '../core/rng';
import type { IslandBiome, IslandDef } from '../game/types';
import { TAU, clamp } from './noise';
import { signedDistanceValue } from './polygon';
import { type ShapeSpec, makeIsland, makeRectIsland, shapeOf } from './shape';
import type { FeatureKind, PaletteId, SeaBias, SizeClass } from './seas';

export const CELL = 600;
/** Open water radius around the run start (the player spawns at the origin). */
export const START_CLEAR = 300;
const EDGE_MARGIN = 45;

export interface ArchSpan {
  /** Pillar centres (world XZ). */
  ax: number; az: number; bx: number; bz: number;
  /** Height of the walkable top at the middle of the span. */
  crown: number;
  /** Height of the underside at the middle (ships sail underneath). */
  clearance: number;
  /** Span width across the arch axis. */
  width: number;
}

export interface WorldFeature {
  id: string;
  kind: FeatureKind;
  /** Bounding circle of all islands (world XZ). */
  x: number;
  z: number;
  radius: number;
  seed: number;
  palette: PaletteId;
  islands: IslandDef[];
  arch?: ArchSpan;
}

export function pickWeighted<T extends string>(rng: SeededRandom, weights: Partial<Record<T, number>>): T {
  let total = 0;
  for (const k in weights) total += weights[k] ?? 0;
  let roll = rng.next() * total;
  let last: T | undefined;
  for (const k in weights) {
    last = k;
    roll -= weights[k] ?? 0;
    if (roll <= 0) return k;
  }
  return last!;
}

/** Accumulates the islands of one feature and keeps satellites from touching each other. */
export class FeatureBuilder {
  readonly islands: IslandDef[] = [];
  arch?: ArchSpan;
  private index = 0;

  constructor(readonly id: string, readonly seed: number, readonly rng: SeededRandom, readonly palette: PaletteId) {}

  add(x: number, z: number, spec: Omit<ShapeSpec, 'seed'>, landmark?: string): IslandDef {
    const seed = hashCoordinates(this.seed, this.index, 0x51, 0x2f);
    const def = makeIsland(`${this.id}:${this.index++}`, x, z, { ...spec, seed }, landmark);
    this.islands.push(def);
    return def;
  }

  addRect(x0: number, z0: number, dirX: number, dirZ: number, length: number, width: number, biome: IslandBiome, landmark: string, height = 3): IslandDef {
    const seed = hashCoordinates(this.seed, this.index, 0x77, 0x13);
    const def = makeRectIsland(`${this.id}:${this.index++}`, x0, z0, dirX, dirZ, length, width, biome, seed, landmark, height);
    this.islands.push(def);
    return def;
  }

  /** Clearance (m) between a candidate island and everything placed so far (negative = overlap). */
  clearance(candidate: IslandDef): number {
    let best = Infinity;
    for (const other of this.islands) {
      const centre = Math.hypot(other.x - candidate.x, other.z - candidate.z);
      if (centre - other.radius - candidate.radius > best) continue;
      for (const p of candidate.outline) best = Math.min(best, signedDistanceValue(other.outline, p.x, p.z));
      for (const p of other.outline) best = Math.min(best, signedDistanceValue(candidate.outline, p.x, p.z));
    }
    return best;
  }

  /** Adds an island only if it keeps `gap` metres of water to everything else. */
  tryAdd(x: number, z: number, spec: Omit<ShapeSpec, 'seed'>, gap: number, landmark?: string): IslandDef | null {
    const seed = hashCoordinates(this.seed, this.index, 0x51, 0x2f);
    const def = makeIsland(`${this.id}:${this.index++}`, x, z, { ...spec, seed }, landmark);
    if (this.clearance(def) < gap) return null;
    this.islands.push(def);
    return def;
  }

  finish(kind: FeatureKind): WorldFeature {
    let cx = 0, cz = 0;
    for (const i of this.islands) { cx += i.x; cz += i.z; }
    cx /= this.islands.length; cz /= this.islands.length;
    let radius = 0;
    for (const i of this.islands) radius = Math.max(radius, Math.hypot(i.x - cx, i.z - cz) + i.radius);
    const f: WorldFeature = { id: this.id, kind, x: cx, z: cz, radius, seed: this.seed, palette: this.palette, islands: this.islands };
    if (this.arch) f.arch = this.arch;
    return f;
  }
}

export function translateFeature(f: WorldFeature, dx: number, dz: number): void {
  f.x += dx; f.z += dz;
  for (const i of f.islands) {
    i.x += dx; i.z += dz;
    for (const p of i.outline as { x: number; z: number }[]) { p.x += dx; p.z += dz; }
  }
  if (f.arch) { f.arch.ax += dx; f.arch.az += dz; f.arch.bx += dx; f.arch.bz += dz; }
}

// ─────────────────────────────── Feature recipes ───────────────────────────────

const sizeRadius = (rng: SeededRandom, size: SizeClass): number =>
  size === 'small' ? rng.range(22, 42) : size === 'medium' ? rng.range(45, 84) : rng.range(88, 136);

function rockBiome(b: FeatureBuilder): IslandBiome {
  return b.palette === 'stormwrack' && b.rng.chance(0.3) ? 'volcanic' : 'rocky';
}

/** Small rocks / stacks scattered around a main island (cover for skirmishes). */
function addSatellites(b: FeatureBuilder, main: IslandDef, count: number, stackChance: number): void {
  const rng = b.rng;
  for (let s = 0, tries = 0; s < count && tries < count * 6; tries++) {
    const a = rng.range(0, TAU);
    const stack = rng.chance(stackChance);
    const r = stack ? rng.range(7, 15) : rng.range(3, 9);
    const dist = main.radius * rng.range(0.9, 1.2) + r + rng.range(14, 50);
    const spec: Omit<ShapeSpec, 'seed'> = stack
      ? { biome: main.biome === 'tropical' ? 'tropical' : rockBiome(b), archetype: 'stack', radius: r, height: rng.range(16, 38) }
      : { biome: rockBiome(b), archetype: 'rock', radius: r, height: clamp(r * rng.range(0.9, 1.6) + 1.5, 3, 12) };
    if (b.tryAdd(main.x + Math.sin(a) * dist, main.z + Math.cos(a) * dist, spec, 12)) s++;
  }
}

function addPiers(b: FeatureBuilder, main: IslandDef, bay: number): void {
  const shape = shapeOf(main);
  const count = b.rng.integer(2, 4);
  for (let j = 0; j < count; j++) {
    const t = bay + (j - (count - 1) / 2) * 0.2 + b.rng.range(-0.03, 0.03);
    const r = shape.coastRadius(t);
    const dx = Math.sin(t), dz = Math.cos(t);
    const len = b.rng.range(26, 38);
    b.addRect(main.x + dx * (r - 8), main.z + dz * (r - 8), dx, dz, len + 8, 6.5, 'harbor', 'pier', 2.6);
  }
}

function buildIsland(b: FeatureBuilder, x: number, z: number, bias: SeaBias, size: SizeClass): void {
  const rng = b.rng;
  const biome = pickWeighted(rng, bias.biomes);
  let radius = sizeRadius(rng, size);
  const spec: Omit<ShapeSpec, 'seed'> = { biome, archetype: 'dome', radius, height: 20, stretch: rng.range(0, 0.32), axis: rng.range(0, TAU) };
  let landmark: string | undefined;
  switch (biome) {
    case 'tropical':
      spec.archetype = rng.chance(0.7) ? 'dome' : 'mesa';
      spec.height = radius * (spec.archetype === 'dome' ? rng.range(0.34, 0.55) : rng.range(0.28, 0.44));
      break;
    case 'rocky':
      spec.archetype = rng.chance(0.75) ? 'mesa' : 'dome';
      spec.height = radius * rng.range(0.3, 0.5);
      spec.tier = spec.archetype === 'mesa' && radius > 55 && rng.chance(0.55);
      break;
    case 'volcanic':
      spec.archetype = rng.chance(0.8) ? 'cone' : 'mesa';
      spec.height = radius * (spec.archetype === 'cone' ? rng.range(0.5, 0.75) : rng.range(0.3, 0.44));
      if (spec.archetype === 'cone') landmark = 'volcano';
      break;
    case 'fort':
      radius = spec.radius = Math.max(radius, 46);
      spec.archetype = 'mesa';
      spec.height = radius * rng.range(0.34, 0.46);
      spec.flatTop = true;
      spec.stretch = rng.range(0, 0.2);
      landmark = 'fort';
      break;
    case 'harbor':
      radius = spec.radius = Math.max(radius, 62);
      spec.archetype = 'dome';
      spec.height = radius * rng.range(0.3, 0.4);
      spec.bay = rng.range(0, TAU);
      spec.stretch = rng.range(0, 0.15);
      landmark = 'harbor';
      break;
    case 'reef':
      radius = spec.radius = Math.min(radius, 58);
      spec.archetype = 'reef';
      spec.height = rng.range(1.2, 2.3);
      break;
  }
  if (biome !== 'reef') spec.height = clamp(spec.height, 9, 70);
  if (!landmark && biome !== 'reef' && rng.chance(bias.ruinsChance)) landmark = 'ruins';
  const main = b.add(x, z, spec, landmark);
  if (biome === 'harbor' && spec.bay !== undefined) addPiers(b, main, spec.bay);
  const satellites = size === 'small' ? rng.integer(0, 2) : size === 'medium' ? rng.integer(0, 4) : rng.integer(1, 5);
  addSatellites(b, main, satellites, biome === 'rocky' || biome === 'tropical' ? 0.35 : 0.15);
}

function buildRocks(b: FeatureBuilder, x: number, z: number): void {
  const rng = b.rng;
  const n = rng.integer(3, 8);
  const spread = rng.range(30, 90);
  for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
    const a = rng.range(0, TAU), d = i === 0 ? 0 : rng.range(10, spread);
    const r = i === 0 ? rng.range(6, 11) : rng.range(3, 8.5);
    const spec: Omit<ShapeSpec, 'seed'> = { biome: rockBiome(b), archetype: 'rock', radius: r, height: clamp(r * rng.range(0.9, 1.7) + 1.5, 3, 14) };
    if (b.tryAdd(x + Math.sin(a) * d, z + Math.cos(a) * d, spec, 10)) i++;
  }
}

function buildStacks(b: FeatureBuilder, x: number, z: number): void {
  const rng = b.rng;
  const n = rng.integer(2, 6);
  const spread = rng.range(40, 110);
  const green = b.palette === 'sunward' ? 'tropical' : 'rocky';
  for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
    const a = rng.range(0, TAU), d = i === 0 ? 0 : rng.range(20, spread);
    const r = rng.range(7, 18);
    const spec: Omit<ShapeSpec, 'seed'> = { biome: rng.chance(0.5) ? green : rockBiome(b), archetype: 'stack', radius: r, height: rng.range(18, 48), stretch: rng.range(0, 0.35), axis: rng.range(0, TAU) };
    if (b.tryAdd(x + Math.sin(a) * d, z + Math.cos(a) * d, spec, 12)) i++;
  }
  const rocks = rng.integer(1, 4);
  for (let i = 0, tries = 0; i < rocks && tries < 12; tries++) {
    const a = rng.range(0, TAU), d = rng.range(20, spread + 30);
    const r = rng.range(3, 7);
    if (b.tryAdd(x + Math.sin(a) * d, z + Math.cos(a) * d, { biome: rockBiome(b), archetype: 'rock', radius: r, height: r * 1.3 + 1.5 }, 10)) i++;
  }
}

function buildArch(b: FeatureBuilder, x: number, z: number): void {
  const rng = b.rng;
  const axis = rng.range(0, TAU);
  const gap = rng.range(62, 82);
  const radius = rng.range(30, 42);
  const height = rng.range(62, 82);
  const faceDistance = radius * 0.7;
  const dx = Math.sin(axis), dz = Math.cos(axis);
  const off = gap / 2 + faceDistance;
  const biome: IslandBiome = b.palette === 'sunward' ? 'tropical' : 'rocky';
  const common = { biome, archetype: 'pillar' as const, radius, height, faceDistance, stretch: 0.22, axis: axis + Math.PI / 2 };
  const a = b.add(x - dx * off, z - dz * off, { ...common, face: axis }, 'arch');
  const c = b.add(x + dx * off, z + dz * off, { ...common, face: axis + Math.PI }, 'arch');
  b.arch = { ax: a.x, az: a.z, bx: c.x, bz: c.z, crown: height * 1.03, clearance: Math.max(46, height * 0.66), width: radius * 1.05 };
  const rocks = rng.integer(1, 4);
  for (let i = 0, tries = 0; i < rocks && tries < 12; tries++) {
    const t = rng.range(0, TAU), d = rng.range(off + radius + 25, off + radius + 70);
    const r = rng.range(3, 8);
    if (b.tryAdd(x + Math.sin(t) * d, z + Math.cos(t) * d, { biome: rockBiome(b), archetype: 'rock', radius: r, height: r * 1.3 + 2 }, 12)) i++;
  }
}

function buildLandmarkIsland(b: FeatureBuilder, x: number, z: number, kind: FeatureKind): void {
  const rng = b.rng;
  switch (kind) {
    case 'lighthouse': {
      const main = b.add(x, z, { biome: 'rocky', archetype: rng.chance(0.5) ? 'stack' : 'mesa', radius: rng.range(15, 24), height: rng.range(12, 22) }, 'lighthouse');
      addSatellites(b, main, rng.integer(1, 4), 0.2);
      break;
    }
    case 'giant-tree': {
      const main = b.add(x, z, {
        biome: b.palette === 'gloam' ? 'rocky' : 'tropical', archetype: rng.chance(0.6) ? 'mesa' : 'dome',
        radius: rng.range(52, 76), height: rng.range(18, 30), stretch: rng.range(0, 0.2), axis: rng.range(0, TAU),
      }, 'giant-tree');
      addSatellites(b, main, rng.integer(1, 4), 0.5);
      break;
    }
    case 'shipwreck': {
      const main = b.add(x, z, { biome: 'reef', archetype: 'reef', radius: rng.range(26, 44), height: rng.range(1.3, 2.1), stretch: rng.range(0.15, 0.45), axis: rng.range(0, TAU) }, 'shipwreck');
      addSatellites(b, main, rng.integer(2, 5), 0);
      break;
    }
    default: {
      const main = b.add(x, z, {
        biome: b.palette === 'sunward' ? 'tropical' : 'rocky', archetype: rng.chance(0.5) ? 'mesa' : 'dome',
        radius: rng.range(44, 72), height: rng.range(16, 30), stretch: rng.range(0, 0.25), axis: rng.range(0, TAU),
      }, 'ruins');
      addSatellites(b, main, rng.integer(0, 3), 0.3);
    }
  }
}

/**
 * Deterministic feature for one cell, or null for open water. Pure function of (fieldSeed, cx, cz, bias).
 */
export function generateCellFeature(fieldSeed: number, cx: number, cz: number, bias: SeaBias): WorldFeature | null {
  const seed = hashCoordinates(fieldSeed, cx, cz, 17);
  const rng = createSeededRandom(seed);
  if (!rng.chance(bias.density)) return null;
  const kind = pickWeighted(rng, bias.kinds);
  const centreX = (cx + 0.5) * CELL, centreZ = (cz + 0.5) * CELL;
  const b = new FeatureBuilder(`isl:${cx}:${cz}`, seed, rng, bias.palette);
  switch (kind) {
    case 'island': buildIsland(b, centreX, centreZ, bias, pickWeighted(rng, bias.sizes)); break;
    case 'rocks': buildRocks(b, centreX, centreZ); break;
    case 'stacks': buildStacks(b, centreX, centreZ); break;
    case 'arch': buildArch(b, centreX, centreZ); break;
    default: buildLandmarkIsland(b, centreX, centreZ, kind);
  }
  if (b.islands.length === 0) return null;
  const f = b.finish(kind);
  // Keep the feature inside its cell (minus the margin), jittered for an irregular layout.
  const room = CELL / 2 - EDGE_MARGIN - f.radius;
  if (room < 0) return null;
  let jx = rng.range(-room, room), jz = rng.range(-room, room);
  if (Math.hypot(centreX + jx, centreZ + jz) - f.radius < START_CLEAR) {
    // Near the run start: push the feature to the far corner of its cell, else drop it.
    jx = Math.sign(centreX) * room; jz = Math.sign(centreZ) * room;
    if (Math.hypot(centreX + jx, centreZ + jz) - f.radius < START_CLEAR) return null;
  }
  translateFeature(f, centreX + jx - f.x, centreZ + jz - f.z);
  return f;
}
