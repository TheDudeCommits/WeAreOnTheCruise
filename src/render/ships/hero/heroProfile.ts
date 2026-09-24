/**
 * Measures a downloaded hero model once at load (SHIPS-owned): deck heights, rail lines, the broadside gun line,
 * hull sides for plating, stern/bow pads, the prow tip and mast tops. Authored hints (heroRigs.ts) pick the regions;
 * HullSampler measures the real surfaces. The result is expressed in the hero root's gameplay space (model scaled
 * to ShipDef.length, bow −Z, waterline y = 0) so attachments keep real-world sizes on every model.
 */
import * as THREE from 'three';
import type { HeroModelKey } from '../../../game/ids';
import { HERO_SOURCE_LENGTH } from '../../loaders/SketchfabShipAssets';
import waterlines from '../data/heroWaterlines.json';
import { HullSampler } from './HullSampler';
import { HERO_RIGS, type PointHint, type RailBand } from './heroRigs';

export interface RailStation { z: number; /** Starboard rail edge x (mirror for port). */ x: number; railY: number; deckY: number }
export interface GunStation { z: number; x: number; y: number }
export interface PlatingStation { z: number; x0: number; y0: number; x1: number; y1: number }

export interface HeroProfile {
  readonly kind: HeroModelKey;
  /** Model scale (gameplay length / source length). */
  readonly scale: number;
  readonly length: number;
  /** Size multiplier for attachment parts (≈1 on a 40 m ship). */
  readonly partScale: number;
  readonly rails: RailStation[][];
  readonly guns: GunStation[];
  readonly plating: PlatingStation[][];
  readonly stern: THREE.Vector3;
  readonly sternSide: THREE.Vector3;
  readonly sternFlag: THREE.Vector3;
  readonly sternLantern: THREE.Vector3;
  readonly bow: THREE.Vector3;
  readonly prow: THREE.Vector3;
  readonly figurehead: THREE.Vector3;
  readonly figureheadRadius: number;
  /** Stern sun crest centre (on the transom, facing aft) and radius. */
  readonly crest: THREE.Vector3;
  readonly crestRadius: number;
  readonly mid: THREE.Vector3;
  readonly totem: THREE.Vector3;
  readonly masts: THREE.Vector3[];
  readonly deckY: number;
  /** Typical main-rail top height. */
  readonly railY: number;
  readonly bounds: THREE.Box3;
  readonly waterline: readonly [number, number][];
  /** Local anchor points for ShipServices. */
  readonly anchors: { bow: THREE.Vector3; stern: THREE.Vector3; port: THREE.Vector3; starboard: THREE.Vector3; mast: THREE.Vector3; deck: THREE.Vector3 };
  /** Low-HP smoke emitters (local). */
  readonly smoke: THREE.Vector3[];
  /** Standing spots for crew (local, on deck). */
  readonly crew: THREE.Vector3[];
  readonly probeMs: number;
}

const WATERLINES = waterlines as unknown as Record<HeroModelKey, [number, number][]>;

export function measureHero(kind: HeroModelKey, model: THREE.Object3D, length: number): HeroProfile {
  const started = performance.now();
  const rig = HERO_RIGS[kind];
  const s = length / HERO_SOURCE_LENGTH[kind];
  const sampler = new HullSampler(model);
  const scratch: number[] = [];

  const snap = (hint: PointHint): THREE.Vector3 => {
    if (hint.fixed) return new THREE.Vector3(hint.x, hint.y, hint.z);
    let y = sampler.surfaceBelow(hint.x, hint.z, hint.y, 0.55);
    if (Number.isNaN(y)) y = sampler.surfaceBelow(hint.x, hint.z, hint.y, 0.2);
    return new THREE.Vector3(hint.x, Number.isNaN(y) ? hint.y : y, hint.z);
  };

  // Rails: outermost structure within the band's height range, then the deck just inboard of it, then the
  // bulwark top just above that deck (bounded, so shrouds and stairs never count as the rail).
  const railBand = (band: RailBand): RailStation[] => {
    const raw: { z: number; x: number; railY: number; deckY: number }[] = [];
    const span = band.z1 - band.z0;
    const count = Math.max(2, Math.round(span / 1.0) + 1);
    const maxX = sampler.box.max.x;
    for (let i = 0; i < count; i++) {
      const z = band.z0 + (span * i) / (count - 1);
      let edge = Number.NaN;
      for (let x = maxX; x > 0.5 && Number.isNaN(edge); x -= 0.2) {
        for (const h of sampler.vertical(x, z)) if (h.y >= band.yMin && h.y <= band.yMax + 1.2) { edge = x; break; }
      }
      if (Number.isNaN(edge)) continue;
      let deck = Number.NaN;
      for (let k = 1; k <= 4 && Number.isNaN(deck); k++) deck = sampler.surfaceBelow(edge - band.inset * k, z, band.yMax, 0.6, band.yMin);
      if (Number.isNaN(deck)) continue;
      let top = deck + 0.6;
      for (let dx = 0; dx <= 0.9; dx += 0.15) for (const h of sampler.vertical(edge - dx, z)) if (h.y >= deck && h.y <= deck + 2.1) top = Math.max(top, h.y);
      raw.push({ z, x: edge, railY: top, deckY: deck });
    }
    // Median-of-3 smoothing kills single-station spikes (stairs, shroud chains, cleats).
    const med = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    return raw.map((r, i) => {
      const a = raw[Math.max(0, i - 1)]!, c = raw[Math.min(raw.length - 1, i + 1)]!;
      return { z: r.z * s, x: med(a.x, r.x, c.x) * s, railY: med(a.railY, r.railY, c.railY) * s, deckY: med(a.deckY, r.deckY, c.deckY) * s };
    });
  };
  const rails = rig.rails.map(railBand).filter((r) => r.length >= 2);

  // Broadside gun line: hull side at the gun height.
  const guns: GunStation[] = [];
  const gunSlots = 7;
  for (let i = 0; i < gunSlots; i++) {
    const z = rig.guns.z0 + ((rig.guns.z1 - rig.guns.z0) * i) / (gunSlots - 1);
    let x = sampler.sideX(rig.guns.y, z, 1, scratch);
    if (Number.isNaN(x)) x = waterlineHalfWidth(kind, z);
    guns.push({ z: z * s, x: x * s, y: rig.guns.y * s });
  }

  // Plating ribbons (starboard; mirrored at build time). Breaks where the probe misses.
  const plating: PlatingStation[][] = [];
  let run: PlatingStation[] = [];
  for (let z = rig.plating.z0; z <= rig.plating.z1 + 1e-6; z += 0.8) {
    const x0 = sampler.sideX(rig.plating.y0, z, 1, scratch);
    const x1 = sampler.sideX(rig.plating.y1, z, 1, scratch);
    if (Number.isNaN(x0) || Number.isNaN(x1) || Math.abs(x0 - x1) > 3.5) { if (run.length > 1) plating.push(run); run = []; continue; }
    run.push({ z: z * s, x0: x0 * s, y0: rig.plating.y0 * s, x1: x1 * s, y1: rig.plating.y1 * s });
  }
  if (run.length > 1) plating.push(run);

  // Prow tip: first station from the bow where the stem exists at prowY.
  let prowZ = sampler.box.min.z;
  for (let z = sampler.box.min.z; z < 0; z += 0.2) {
    const xs = sampler.lateral(rig.prowY, z, scratch);
    if (xs.some((x) => Math.abs(x) < 2.5)) { prowZ = z; break; }
  }
  const prow = new THREE.Vector3(0, rig.prowY, prowZ);

  // Stern transom at the crest height: last station (from aft) that is inside the hull at that height.
  let sternZ = sampler.box.max.z;
  for (let z = sampler.box.max.z; z > 0; z -= 0.2) {
    const hits = sampler.vertical(0, z);
    if (hits.some((h) => h.y > rig.crest.y + 0.3) && hits.some((h) => h.y < rig.crest.y - 0.3)) { sternZ = z; break; }
  }
  const crest = new THREE.Vector3(0, rig.crest.y, sternZ + 0.35);

  const masts = rig.masts.map((m) => new THREE.Vector3(m.x, sampler.topNear(m.x, m.z, 0.5), m.z));
  const bounds = sampler.box.clone();
  const scaleV = (v: THREE.Vector3) => v.multiplyScalar(s);

  const mainRail = rails[0];
  const deckY = mainRail ? mainRail.reduce((a, r) => a + r.deckY, 0) / mainRail.length : bounds.max.y * 0.2 * s;
  const railY = mainRail ? mainRail.reduce((a, r) => a + r.railY, 0) / mainRail.length : deckY + 1;
  const mid = scaleV(snap(rig.mid));
  const stern = scaleV(snap(rig.stern));
  const bow = scaleV(snap(rig.bow));
  const mastsL = masts.map(scaleV);
  const gunMid = guns[Math.floor(guns.length / 2)]!;
  const anchors = {
    bow: new THREE.Vector3(0, Math.max(bow.y, deckY) + 1.2, prowZ * s + 1.5),
    stern: new THREE.Vector3(0, stern.y + 1.5, stern.z + 2),
    port: new THREE.Vector3(-gunMid.x - 1.2, gunMid.y, gunMid.z),
    starboard: new THREE.Vector3(gunMid.x + 1.2, gunMid.y, gunMid.z),
    mast: mastsL[0]?.clone() ?? new THREE.Vector3(0, bounds.max.y * s, 0),
    deck: new THREE.Vector3(0, deckY + 1, mid.z),
  };
  const smoke = [mid.clone().setY(deckY + 1), stern.clone().add(new THREE.Vector3(0, 1, -2)), bow.clone().add(new THREE.Vector3(0, 1, 2))];
  const crew: THREE.Vector3[] = [];
  for (const band of rails) for (let i = 1; i < band.length - 1; i += 2) {
    const r = band[i]!;
    crew.push(new THREE.Vector3(Math.max(0.8, r.x - 2.4) * (i % 4 === 1 ? 1 : -1), r.deckY, r.z));
  }
  bounds.min.multiplyScalar(s); bounds.max.multiplyScalar(s);
  return {
    kind, scale: s, length, partScale: THREE.MathUtils.clamp(length / 42, 0.85, 1.6) * rig.partScale * 1.2,
    rails, guns, plating,
    stern, sternSide: scaleV(snap(rig.sternSide)), sternFlag: scaleV(snap(rig.sternFlag)), sternLantern: scaleV(snap(rig.sternLantern)),
    bow, prow: scaleV(prow),
    figurehead: new THREE.Vector3(rig.figurehead.x, rig.figurehead.y, rig.figurehead.z).multiplyScalar(s), figureheadRadius: rig.figurehead.r * s,
    crest: scaleV(crest), crestRadius: rig.crest.r * s,
    mid, totem: scaleV(snap(rig.totem)), masts: mastsL, deckY: Math.max(deckY, 0.5), railY, bounds,
    waterline: WATERLINES[kind].map(([x, z]) => [x * s, z * s] as [number, number]),
    anchors, smoke, crew: crew.slice(0, 8), probeMs: performance.now() - started,
  };
}

/** Half-width of the waterline outline at z (source space). */
function waterlineHalfWidth(kind: HeroModelKey, z: number): number {
  const pts = WATERLINES[kind];
  let best = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    if ((a[1] - z) * (b[1] - z) > 0) continue;
    const t = Math.abs(b[1] - a[1]) < 1e-6 ? 0 : (z - a[1]) / (b[1] - a[1]);
    best = Math.max(best, Math.abs(a[0] + (b[0] - a[0]) * t));
  }
  return best;
}
