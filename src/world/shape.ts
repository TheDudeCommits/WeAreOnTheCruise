/**
 * Island shape model (WORLD-owned, pure). Every terrain island is star-shaped around its centre: the coastline is a
 * polar function r(θ) sampled at uniform angles, so the collision polygon IS the waterline ring of the render mesh
 * and inner rings (cliff bands, rims, tops) can be derived by moving vertices radially without self-intersection.
 *
 * Everything here is deterministic from `ShapeSpec.seed`.
 */
import { createSeededRandom } from '../core/rng';
import type { IslandBiome, IslandDef, Vec2 } from '../game/types';
import { CircleNoise, TAU, angleDiff, clamp, fbm, hash01, smoothstep } from './noise';

export type Archetype = 'dome' | 'mesa' | 'stack' | 'rock' | 'cone' | 'reef' | 'pillar';

export interface ShapeSpec {
  seed: number;
  biome: IslandBiome;
  archetype: Archetype;
  /** Base coast radius (m); the coast wobbles around it. */
  radius: number;
  /** Cliff rim height for mesa/stack/pillar/reef, peak height for dome/cone/rock (m). */
  height: number;
  /** −1..1 shifts beach coverage (0 = biome default). */
  beachBias?: number;
  /** 0..0.6 elongation along `axis` (radians, same angle convention as the outline). */
  stretch?: number;
  axis?: number;
  /** Mesa second tier (stepped plateau). */
  tier?: boolean;
  /** Direction of a sheltered bay: the coast dips inward and becomes beach (harbours). */
  bay?: number;
  /** Direction and distance of a flat vertical face (arch pillars face each other). */
  face?: number;
  faceDistance?: number;
  /** Flat, bump-free top (fort parade ground). */
  flatTop?: boolean;
  /** Multiplier for coastline lobes (default 1). */
  lobes?: number;
}

export interface StrataBand {
  /** Absolute band bottom / top heights (m). */
  bottom: number;
  top: number;
  /** Radial inset of the band face (m, + = recessed soft layer, − = protruding hard layer). */
  inset: number;
  /** Palette tone index. */
  tone: number;
}

const LOBE: Record<Archetype, number> = { dome: 0.17, mesa: 0.15, stack: 0.12, rock: 0.2, cone: 0.1, reef: 0.24, pillar: 0.07 };
const ROUGH: Record<Archetype, number> = { dome: 0.022, mesa: 0.034, stack: 0.045, rock: 0.07, cone: 0.026, reef: 0.07, pillar: 0.03 };
const LEAN: Record<Archetype, number> = { dome: 0.16, mesa: 0.045, stack: 0.035, rock: 0.55, cone: 0.32, reef: 0.7, pillar: 0.02 };
const STRATA: Record<Archetype, number> = { dome: 0.65, mesa: 1, stack: 1, rock: 0.25, cone: 0.35, reef: 0, pillar: 1 };

/** Default share of the coastline that is beach. */
function beachCoverage(biome: IslandBiome, archetype: Archetype): number {
  if (archetype === 'stack' || archetype === 'pillar' || archetype === 'rock' || archetype === 'reef') return 0;
  switch (biome) {
    case 'tropical': return archetype === 'dome' ? 0.56 : 0.32;
    case 'harbor': return 0.42;
    case 'volcanic': return 0.24;
    case 'fort': return 0.1;
    case 'rocky': return 0.13;
    default: return 0.2;
  }
}

export class IslandShape {
  readonly spec: ShapeSpec;
  readonly vertexCount: number;
  readonly lean: number;
  readonly strata: StrataBand[];
  /** Highest terrain point (m), tier included. */
  readonly maxHeight: number;
  readonly tierRise: number;
  readonly hasBeach: boolean;
  /** 0..1 how strongly neighbouring strata tones differ (stacks read calmer, T6). */
  readonly strataContrast: number;
  private readonly lobeNoise: CircleNoise;
  private readonly roughNoise: CircleNoise;
  private readonly beachNoise: CircleNoise;
  private readonly rimNoise: CircleNoise;
  private readonly bandNoise: CircleNoise;
  private readonly widthNoise: CircleNoise;
  private readonly tierNoise: CircleNoise;
  private readonly beachOffset: number;
  private readonly lobeAmp: number;
  private readonly roughAmp: number;
  private readonly bumpAmp: number;
  private readonly beachWidthBase: number;
  private readonly grooveAmp: number;

  constructor(spec: ShapeSpec) {
    this.spec = spec;
    const rng = createSeededRandom(spec.seed ^ 0x5bd1e995);
    const a = spec.archetype;
    const perimeter = TAU * spec.radius * (1 + (spec.stretch ?? 0) * 0.5);
    this.vertexCount = clamp(Math.round(perimeter / 4.4), 20, 208);
    const kMax = Math.max(8, Math.min(42, Math.floor(this.vertexCount / 2.6)));
    this.lobeNoise = new CircleNoise(rng, 1, 6, 1.15);
    this.roughNoise = new CircleNoise(rng, 7, kMax, 0.85);
    this.beachNoise = new CircleNoise(rng, 1, 3, 0.8);
    this.rimNoise = new CircleNoise(rng, 2, 9, 1);
    this.bandNoise = new CircleNoise(rng, 3, 14, 0.9);
    this.widthNoise = new CircleNoise(rng, 2, 7, 1);
    this.tierNoise = new CircleNoise(rng, 2, 6, 1.1);
    this.lobeAmp = LOBE[a] * (spec.lobes ?? 1);
    this.roughAmp = ROUGH[a];
    this.lean = LEAN[a] * (0.8 + rng.next() * 0.4);
    const coverage = clamp(beachCoverage(spec.biome, a) + (spec.beachBias ?? 0) * 0.35, 0, 0.9);
    this.hasBeach = coverage > 0.01 || spec.bay !== undefined;
    this.beachOffset = (coverage - 0.5) * 2.6;
    this.beachWidthBase = clamp(spec.radius * 0.14, 5, 19);
    this.bumpAmp = spec.flatTop ? 0
      : a === 'dome' ? spec.height * 0.07 : a === 'cone' ? spec.height * 0.035 : a === 'rock' ? spec.height * 0.08
      : a === 'reef' ? 1.1 : a === 'mesa' ? 1.6 : 0.55;
    this.strataContrast = a === 'stack' ? 0.5 : a === 'cone' ? 0.4 : a === 'dome' ? 0.8 : 1;
    this.grooveAmp = a === 'mesa' || a === 'pillar' ? 1.5 : a === 'stack' ? 1.1 : a === 'dome' ? 0.9 : a === 'cone' ? 0.8 : a === 'rock' ? 0.35 : 0;
    this.tierRise = spec.tier && a === 'mesa' ? spec.height * (0.28 + rng.next() * 0.16) : 0;

    // Strata: absolute-height bands so layers line up across a whole island (and across arch pillars + span).
    const top = spec.height * 1.2 + this.tierRise + 3;
    const base = clamp(spec.height / 5.2, 2.4, 9);
    const strength = STRATA[a];
    this.strata = [];
    let y = 2.2, k = 0;
    const toneStart = rng.integer(0, 5);
    while (y < top && k < 40) {
      const thick = base * (0.45 + rng.next() * 1.1);
      const hard = k % 2 === 0;
      const inset = (hard ? -0.38 : 0.95) * (0.55 + rng.next() * 0.9) * strength;
      this.strata.push({ bottom: y, top: y + thick, inset, tone: (toneStart + k) % 5 });
      y += thick;
      k++;
    }
    let peak = 0;
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * TAU;
      peak = Math.max(peak, this.peakHeight(t), this.cliffHeight(t));
    }
    this.maxHeight = peak + this.tierRise + this.bumpAmp;
  }

  /** Coast radius at angle θ (before any flat face). */
  coastRadius(theta: number): number {
    const s = this.spec;
    let r = s.radius * (1 + this.lobeAmp * this.lobeNoise.at(theta));
    if (s.stretch) r *= 1 + s.stretch * Math.cos(2 * (theta - (s.axis ?? 0)));
    const cliff = 1 - this.beach(theta);
    r *= 1 + this.roughAmp * (0.35 + 0.65 * cliff) * this.roughNoise.at(theta);
    if (s.bay !== undefined) {
      const d = angleDiff(theta, s.bay) / 0.55;
      r *= 1 - 0.2 * Math.exp(-d * d);
    }
    if (s.face !== undefined && s.faceDistance !== undefined) {
      const d = angleDiff(theta, s.face);
      if (Math.abs(d) < 1.3) r = Math.min(r, s.faceDistance / Math.cos(d));
    }
    return Math.max(r, s.radius * 0.42);
  }

  /** Beach weight 0 (cliff) .. 1 (sand beach) at θ. */
  beach(theta: number): number {
    if (!this.hasBeach) return 0;
    let b = smoothstep(-0.42, 0.42, this.beachNoise.at(theta) + this.beachOffset);
    if (this.spec.bay !== undefined) {
      const d = angleDiff(theta, this.spec.bay) / 0.75;
      b = Math.max(b, Math.exp(-d * d * 1.6));
    }
    if (this.spec.face !== undefined && Math.abs(angleDiff(theta, this.spec.face)) < 1.2) b = 0;
    return b;
  }

  /** Height of the cliff rim at θ (the plateau edge). */
  cliffHeight(theta: number): number {
    const s = this.spec, n = this.rimNoise.at(theta);
    switch (s.archetype) {
      case 'mesa': return s.height * (1 + 0.1 * n);
      case 'stack': case 'pillar': return s.height * (1 + 0.045 * n);
      case 'dome': return s.height * 0.44 * (1 + 0.22 * n);
      case 'cone': return s.height * 0.2 * (1 + 0.25 * n);
      case 'rock': return s.height * 0.55 * (1 + 0.15 * n);
      case 'reef': return Math.max(0.9, s.height * (1 + 0.3 * n));
    }
  }

  /** Rim height blended between cliff and low sandy bank by the beach weight. */
  rimHeight(theta: number, b = this.beach(theta)): number {
    const bank = 2.7 + 0.55 * (1 + this.rimNoise.at(theta + 1.7));
    return this.cliffHeight(theta) * (1 - b) + bank * b;
  }

  /** Height the top surface rises to at the centre (plateau height for flat archetypes). */
  peakHeight(theta: number): number {
    const s = this.spec;
    if (s.archetype === 'dome' || s.archetype === 'cone' || s.archetype === 'rock') return s.height;
    // Plateaus crown gently toward the middle (flat for fort parade grounds).
    return this.cliffHeight(theta) * (s.archetype === 'mesa' && !s.flatTop ? 1.1 : 1);
  }

  /** Sand width from the waterline to the beach crest (m). */
  beachWidth(theta: number): number { return this.beachWidthBase * (0.8 + 0.25 * this.widthNoise.at(theta)); }

  /** Horizontal run of the grassy bank behind the beach (m). */
  bankWidth(theta: number): number { return this.beachWidthBase * 0.55 * (0.85 + 0.2 * this.widthNoise.at(theta + 2.1)); }

  /** Radial inset of strata band `k` at θ: ledges come and go around the island instead of ringing it. */
  bandInset(k: number, theta: number): number {
    const band = this.strata[k];
    if (!band) return 0;
    const gate = Math.max(0, this.bandNoise.at(theta + k * 1.37) + 0.15);
    return band.inset * (0.12 + 1.15 * gate);
  }

  /** Vertical groove depth for a coast vertex (weathered fluting, constant with height). */
  groove(index: number, theta: number): number {
    if (this.grooveAmp === 0) return 0;
    const h = hash01(this.spec.seed ^ 0x3c6ef372, index, 7);
    const broad = 0.5 + 0.5 * this.widthNoise.at(theta * 3 + 0.7);
    return this.grooveAmp * (h * h * 0.85 + 0.15) * (0.4 + 0.6 * broad);
  }

  /** Normalized top profile: 0 at the rim, 1 at the peak/plateau (u = 1 − s, s = r / rimR). */
  topProfile(u: number): number {
    switch (this.spec.archetype) {
      case 'dome': return 1 - Math.pow(1 - clamp(u, 0, 1), this.spec.biome === 'harbor' ? 1.35 : 1.9);
      case 'rock': return Math.sqrt(clamp(u, 0, 1));
      case 'cone': {
        // Stratovolcano: concave flanks steepening toward a crater rim, then the crater bowl.
        if (u < 0.82) return Math.pow(u / 0.82, 1.55);
        return 1 - 0.26 * smoothstep(0.82, 0.93, u);
      }
      default: return smoothstep(0, 0.34, u);
    }
  }

  /** Radius fraction (of the rim radius) where the second mesa tier starts; 0 when there is no tier. */
  tierAt(theta: number): number { return this.tierRise > 0 ? 0.5 + 0.07 * this.tierNoise.at(theta) : 0; }

  /** Organic bumps on the top surface; fades to 0 at the rim. */
  bumps(x: number, z: number, u: number): number {
    if (this.bumpAmp === 0) return 0;
    return fbm(this.spec.seed, x / 24, z / 24, 3) * this.bumpAmp * smoothstep(0, 0.3, u);
  }
}

// ─────────────────────────────── Registry ───────────────────────────────

const shapes = new WeakMap<IslandDef, IslandShape>();

export function registerShape(def: IslandDef, shape: IslandShape): void { shapes.set(def, shape); }

/** The shape an island was generated from, or a generic reconstruction for foreign IslandDefs. */
export function shapeOf(def: IslandDef): IslandShape {
  let shape = shapes.get(def);
  if (!shape) {
    let sum = 0;
    for (const p of def.outline) sum += Math.hypot(p.x - def.x, p.z - def.z);
    const radius = sum / Math.max(1, def.outline.length);
    const archetype: Archetype = def.biome === 'reef' ? 'reef' : def.biome === 'volcanic' ? 'cone' : radius < 14 ? 'rock' : def.biome === 'tropical' || def.biome === 'harbor' ? 'dome' : 'mesa';
    shape = new IslandShape({ seed: def.seed, biome: def.biome, archetype, radius, height: Math.max(2, def.height) });
    shapes.set(def, shape);
  }
  return shape;
}

/** Builds an IslandDef whose outline samples the shape's coast at uniform angles (contract winding). */
export function makeIsland(id: string, x: number, z: number, spec: ShapeSpec, landmark?: string): IslandDef {
  const shape = new IslandShape(spec);
  const n = shape.vertexCount;
  const outline: Vec2[] = [];
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const r = shape.coastRadius(t);
    if (r > maxR) maxR = r;
    outline.push({ x: x + Math.sin(t) * r, z: z + Math.cos(t) * r });
  }
  const def: IslandDef = { id, x, z, radius: maxR, outline, height: shape.maxHeight, biome: spec.biome, seed: spec.seed };
  if (landmark) def.landmark = landmark;
  registerShape(def, shape);
  return def;
}

/** Rectangular structure footprint (piers, breakwaters) from a start point along a direction; contract winding. */
export function makeRectIsland(
  id: string, x0: number, z0: number, dirX: number, dirZ: number, length: number, width: number,
  biome: IslandBiome, seed: number, landmark: string, height = 3,
): IslandDef {
  const len = Math.hypot(dirX, dirZ) || 1;
  const fx = dirX / len, fz = dirZ / len;
  const sx = fz, sz = -fx; // side vector
  const hw = width / 2;
  const pts: Vec2[] = [
    { x: x0 - sx * hw, z: z0 - sz * hw },
    { x: x0 + sx * hw, z: z0 + sz * hw },
    { x: x0 + sx * hw + fx * length, z: z0 + sz * hw + fz * length },
    { x: x0 - sx * hw + fx * length, z: z0 - sz * hw + fz * length },
  ];
  // Contract winding: negative shoelace.
  let sum = 0;
  for (let i = 0, j = 3; i < 4; j = i++) sum += pts[j]!.x * pts[i]!.z - pts[i]!.x * pts[j]!.z;
  const outline = sum > 0 ? pts.reverse() : pts;
  const cx = x0 + fx * length / 2, cz = z0 + fz * length / 2;
  const radius = Math.hypot(length / 2, hw);
  return { id, x: cx, z: cz, radius, outline, height, biome, seed, landmark };
}
