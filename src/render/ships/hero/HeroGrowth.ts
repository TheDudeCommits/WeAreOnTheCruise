/**
 * Visible growth for the hero ship (SHIPS-owned) — the mecha-style "your ship gets bigger and meaner" layer.
 *
 * Tiers (player.tier, cumulative):
 *   T1 bronze deck cannons along the main rails
 *   T2 iron plating bands on both hull sides + rail lanterns + a big stern lantern (glow at night)
 *   T3 the crew ensign (original sun-over-waves flag, waving cloth) + reinforced iron prow + cannons on the other decks
 *   T4 glowing sun halo on the figurehead, gold glow trim along the rails, rising embers, gold mast caps
 * Weapon mounts appear when a weapon is equipped and grow with its level (player.weapons); Overdrive adds a glow ring.
 *
 * Rendering: every attachment is an instance in one of two BatchedMeshes (opaque parts, glow parts) → 2 draw calls,
 * plus the flag cloth. Items pop in with an elastic scale bounce (staggered per feature) and report a growth event
 * (world position) for FX. No per-frame allocations.
 */
import * as THREE from 'three';
import type { WeaponId } from '../../../game/ids';
import { markInk } from '../../materials/toon';
import { paintHeroClothAtlas } from '../emblems';
import { GeoBuilder } from '../geometry/GeoBuilder';
import * as parts from '../geometry/parts';
import { glowMaterial, partMaterial } from '../materials';
import { ClothBatch, type ClothPatch } from './FlagCloth';
import type { HeroProfile, PlatingStation, RailStation } from './heroProfile';

export interface GrowthWeapon { id: WeaponId; level: number; branch?: 'A' | 'B'; overdrive: boolean }
export interface GrowthInput { tier: number; weapons: readonly GrowthWeapon[] }

/** Emitted (in world space) when a feature first appears or upgrades; FX turns these into sparkles/splashes. */
export interface ShipGrowthEvent { shipId: number; feature: string; kind: 'appear' | 'upgrade'; x: number; y: number; z: number; radius: number }

type GlowRole = 'lantern' | 'storm' | 'halo' | 'pearl' | 'ember' | 'trim' | 'overdrive';

interface Item {
  mesh: THREE.BatchedMesh;
  id: number;
  base: THREE.Matrix4;
  target: boolean;
  scale: number;
  /** Animation clock: > 0 while popping in / out; negative = stagger delay. */
  t: number;
  animating: boolean;
  glow?: GlowRole;
  glowBase: number;
  pulse: number;
  /** Weapon level growth multiplier applied on top of the pop scale. */
  levelScale: number;
}

interface Feature {
  key: string;
  items: Item[];
  /** Local anchor for growth events. */
  anchor: THREE.Vector3;
  radius: number;
  /** Current visible count and a variant signature (level/branch); a change triggers an upgrade bounce. */
  shown: number;
  variant: string;
}

const APPEAR = 0.62;
const HIDE = 0.22;
const STAGGER = 0.07;
const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpScale = new THREE.Vector3();

/** Elastic pop: 0 → overshoot 1.22 → settle 1. */
function popCurve(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3.2;
  return Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * c4) * 0.9 + 1;
}

const SWIVEL_ORDER = [2, 5, 0, 3, 1, 4];
const GUN_ORDER = [3, 1, 5, 0, 6, 2, 4];

export class HeroGrowth {
  readonly group = new THREE.Group();
  readonly opaqueMaterial: THREE.Material;
  readonly glowMaterial: THREE.Material;
  private readonly opaque: THREE.BatchedMesh;
  private readonly glow: THREE.BatchedMesh;
  private readonly geo = new Map<string, { mesh: 'opaque' | 'glow'; id: number }>();
  private readonly features = new Map<string, Feature>();
  private readonly allItems: Item[] = [];
  private readonly embers: { item: Item; x: number; z: number; speed: number; phase: number; height: number }[] = [];
  private readonly cloth: ClothBatch;
  private readonly clothTexture: THREE.CanvasTexture;
  /** Cloth patches: [0] = stern ensign (tier 3), then one pennant per mast (tier 3). */
  private readonly clothAnim: { target: boolean; t: number; delay: number }[] = [];
  private readonly pending: ShipGrowthEvent[] = [];
  private readonly ownGeometries: THREE.BufferGeometry[] = [];
  private tier = -1;
  private readonly weaponState = new Map<WeaponId, GrowthWeapon>();
  private glowNight = -1;

  constructor(readonly profile: HeroProfile, accent: number) {
    this.group.name = 'hero-growth';
    this.opaqueMaterial = partMaterial('ships:growth');
    this.glowMaterial = glowMaterial('ships:growth-glow', 1.6);
    const geometries = this.buildGeometries();
    const count = (mesh: 'opaque' | 'glow') => {
      let v = 0, i = 0;
      for (const [key, g] of geometries) if (g.mesh === mesh) { v += g.geometry.attributes.position!.count; i += g.geometry.index!.count; void key; }
      return { v, i };
    };
    const o = count('opaque'), gl = count('glow');
    this.opaque = new THREE.BatchedMesh(260, o.v + 16, o.i + 16, this.opaqueMaterial);
    this.glow = new THREE.BatchedMesh(200, gl.v + 16, gl.i + 16, this.glowMaterial);
    this.opaque.name = 'hero-growth-opaque';
    this.glow.name = 'hero-growth-glow';
    this.opaque.castShadow = true;
    this.opaque.receiveShadow = true;
    for (const [key, g] of geometries) {
      const target = g.mesh === 'opaque' ? this.opaque : this.glow;
      this.geo.set(key, { mesh: g.mesh, id: target.addGeometry(g.geometry) });
      this.ownGeometries.push(g.geometry);
    }
    this.group.add(this.opaque, this.glow);
    markInk(this.opaque);

    // Crew cloth (tier 3): the original sun-over-waves ensign at the stern + accent pennants on every mast.
    const atlas = paintHeroClothAtlas(accent);
    this.clothTexture = new THREE.CanvasTexture(atlas.canvas);
    this.clothTexture.colorSpace = THREE.SRGBColorSpace;
    this.clothTexture.anisotropy = 4;
    const ps = profile.partScale;
    const patches: ClothPatch[] = [];
    const staffTop = 8 * ps;
    const ensignAnchor = new THREE.Matrix4().makeTranslation(profile.sternFlag.x, profile.sternFlag.y, profile.sternFlag.z)
      .multiply(new THREE.Matrix4().makeRotationX(0.38))
      .multiply(new THREE.Matrix4().makeTranslation(0, staffTop - 0.3 * ps, 0))
      .multiply(new THREE.Matrix4().makeRotationX(-0.38));
    patches.push({ width: 7.8 * ps, height: 4.9 * ps, uv: atlas.ensign, anchor: ensignAnchor, phase: 0.7, flutter: 1, scale: 0 });
    profile.masts.forEach((mast, i) => {
      const anchor = new THREE.Matrix4().makeTranslation(mast.x, mast.y - (i === 0 ? 1.4 : 0.6) * ps, mast.z);
      patches.push({ width: 11 * ps, height: 1.35 * ps, uv: atlas.pennant, anchor, phase: i * 1.7, flutter: 1.5, scale: 0 });
    });
    for (let i = 0; i < patches.length; i++) this.clothAnim.push({ target: false, t: 1, delay: i * 0.08 });
    this.cloth = new ClothBatch(this.clothTexture, patches);
    this.group.add(this.cloth.mesh);
    markInk(this.cloth.mesh);

    this.buildFeatures();
  }

  // ───────────────────────── Geometry library ─────────────────────────

  private buildGeometries(): Map<string, { mesh: 'opaque' | 'glow'; geometry: THREE.BufferGeometry }> {
    const m = new Map<string, { mesh: 'opaque' | 'glow'; geometry: THREE.BufferGeometry }>();
    const op = (key: string, geometry: THREE.BufferGeometry) => m.set(key, { mesh: 'opaque', geometry });
    const gl = (key: string, geometry: THREE.BufferGeometry) => m.set(key, { mesh: 'glow', geometry });
    op('deckCannon', parts.deckCannon());
    op('deckCannonIron', parts.deckCannon(parts.PALETTE.iron));
    op('sideGun', parts.sideGun());
    op('mortar', parts.mortar());
    for (let n = 3; n <= 8; n++) op(`rocketRack${n}`, parts.rocketRack(n));
    op('swivel', parts.swivelGun());
    op('harpoon', parts.harpoonGun());
    op('chaser', parts.bowChaser());
    op('stormRod', parts.stormRod());
    op('ram', parts.ironRam(false));
    op('ramSpiked', parts.ironRam(true));
    op('prowPlates', parts.prowPlates());
    op('totem', parts.coralTotem());
    for (let n = 1; n <= 3; n++) op(`barrels${n}`, parts.barrelStack(n * 2 - 1 + (n > 1 ? 1 : 0)));
    for (let n = 1; n <= 3; n++) op(`mines${n}`, parts.mineRack(n));
    op('lantern', parts.lanternBody());
    op('sternLantern', parts.sternLanternBody());
    op('flagstaff', parts.flagstaff(8));
    op('mastCap', parts.mastCap());
    op('trimBar', parts.trimBar());
    gl('lanternGlass', parts.lanternGlass());
    gl('sternLanternGlass', parts.sternLanternGlass());
    gl('stormOrb', parts.stormOrb());
    gl('pearl', parts.coralPearl());
    gl('halo', parts.figureheadHalo(1));
    gl('ember', parts.ember());
    gl('glowStrip', parts.glowStrip());
    gl('odRing', odRing());
    gl('crest', sunCrest());
    gl('aura', auraRing(Math.max(this.profile.bounds.max.x * 1.3, this.profile.length * 0.32), this.profile.length * 0.68, this.profile.partScale));
    op('crestFrame', crestFrame());
    // Plating chunks (model-specific): each chunk is its own geometry so it can pop independently.
    let k = 0;
    for (const run of this.profile.plating) {
      for (let start = 0; start < run.length - 1; start += 4) {
        const chunk = run.slice(start, Math.min(run.length, start + 5));
        if (chunk.length < 2) continue;
        for (const side of [1, -1] as const) op(`plate${k}:${side}`, platingChunk(chunk, side, this.profile.partScale));
        k++;
      }
    }
    return m;
  }

  // ───────────────────────── Features ─────────────────────────

  private feature(key: string, anchor: THREE.Vector3, radius: number): Feature {
    const f: Feature = { key, items: [], anchor: anchor.clone(), radius, shown: 0, variant: '' };
    this.features.set(key, f);
    return f;
  }

  private item(f: Feature, geometry: string, at: THREE.Vector3, yaw = 0, scale = 1, pitch = 0, roll = 0, glow?: GlowRole, glowBase = 1): Item {
    const g = this.geo.get(geometry);
    if (!g) throw new Error(`missing growth geometry ${geometry}`);
    const mesh = g.mesh === 'opaque' ? this.opaque : this.glow;
    const id = mesh.addInstance(g.id);
    tmpQ.setFromEuler(tmpE.set(pitch, yaw, roll, 'YXZ'));
    const base = new THREE.Matrix4().compose(at, tmpQ, tmpV.set(scale, scale, scale));
    const item: Item = { mesh, id, base, target: false, scale: 0, t: 0, animating: false, glow, glowBase, pulse: Math.random() * 6.28, levelScale: 1 };
    mesh.setMatrixAt(id, tmpM.copy(base).multiply(tmpS.makeScale(0, 0, 0)));
    mesh.setVisibleAt(id, false);
    if (g.mesh === 'glow') mesh.setColorAt(id, tmpC.setScalar(glowBase));
    else mesh.setColorAt(id, tmpC.setScalar(1));
    f.items.push(item);
    this.allItems.push(item);
    return item;
  }

  private buildFeatures(): void {
    const p = this.profile;
    const ps = p.partScale;
    const main = p.rails[0] ?? [];
    const others = p.rails.slice(1);

    // T1 — bronze deck cannons along the main rails.
    const t1 = this.feature('tier1-cannons', new THREE.Vector3(0, p.deckY, 0), p.length * 0.4);
    for (const st of pickStations(main, clampInt(Math.round(spanOf(main) / (7.5 * ps)), 2, 4))) {
      for (const side of [1, -1]) this.item(t1, 'deckCannon', new THREE.Vector3((st.x - 1.25 * ps) * side, st.deckY, st.z), side > 0 ? 0 : Math.PI, ps);
    }

    // T2 — plating chunks and lanterns.
    const t2p = this.feature('tier2-plating', new THREE.Vector3(0, p.guns[3]?.y ?? 2, 0), p.length * 0.5);
    for (const [key, g] of this.geo) {
      if (!key.startsWith('plate') || g.mesh !== 'opaque') continue;
      this.item(t2p, key, new THREE.Vector3(), 0, 1);
    }
    t2p.items.sort((a, b) => a.id - b.id);
    const t2l = this.feature('tier2-lanterns', new THREE.Vector3(0, p.railY, 0), p.length * 0.45);
    for (const band of p.rails) {
      for (const st of pickStations(band, clampInt(Math.round(spanOf(band) / (9 * ps)) + 1, 2, 5))) {
        for (const side of [1, -1]) {
          const at = new THREE.Vector3((st.x - 0.35 * ps) * side, st.railY, st.z);
          this.item(t2l, 'lantern', at, 0, ps);
          this.item(t2l, 'lanternGlass', at, 0, ps, 0, 0, 'lantern', 1);
        }
      }
    }
    this.item(t2l, 'sternLantern', p.sternLantern, 0, ps * 1.15);
    this.item(t2l, 'sternLanternGlass', p.sternLantern, 0, ps * 1.15, 0, 0, 'lantern', 1.2);

    // T3 — ensign staff (cloth handled separately), reinforced prow, cannons on the other decks.
    const t3f = this.feature('tier3-flag', p.sternFlag, 6 * ps);
    this.item(t3f, 'flagstaff', p.sternFlag, 0, ps, 0.38);
    const t3p = this.feature('tier3-prow', p.prow, 4 * ps);
    this.item(t3p, 'prowPlates', p.prow, 0, ps * 1.1);
    const t3c = this.feature('tier3-cannons', new THREE.Vector3(0, p.deckY, 0), p.length * 0.4);
    for (const band of others) {
      for (const st of pickStations(band, clampInt(Math.round(spanOf(band) / (6 * ps)), 1, 2))) {
        for (const side of [1, -1]) this.item(t3c, 'deckCannonIron', new THREE.Vector3((st.x - 1.2 * ps) * side, st.deckY, st.z), side > 0 ? 0 : Math.PI, ps * 0.92);
      }
    }
    if (others.length === 0) {
      // Single-deck ships get extra main-deck guns instead.
      const extra = pickStations(main, 5).filter((_, i) => i % 2 === 1);
      for (const st of extra) for (const side of [1, -1]) this.item(t3c, 'deckCannonIron', new THREE.Vector3((st.x - 1.2 * ps) * side, st.deckY, st.z), side > 0 ? 0 : Math.PI, ps * 0.92);
    }

    // T4 — figurehead sun halo, glow trim, mast caps, embers.
    const t4 = this.feature('tier4-glory', p.figurehead, p.figureheadRadius * 1.6);
    this.item(t4, 'halo', p.figurehead, 0, p.figureheadRadius * 1.05, 0, 0, 'halo', 1.5);
    for (const band of p.rails.slice(0, 2)) {
      for (let i = 0; i < band.length - 1; i += 2) {
        const a = band[i]!, b = band[Math.min(band.length - 1, i + 2)]!;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.5) continue;
        for (const side of [1, -1]) {
          const cx = ((a.x + b.x) / 2) * side, cz = (a.z + b.z) / 2, cy = Math.max(a.railY, b.railY) + 0.12;
          const yaw = Math.atan2((b.x - a.x) * side, b.z - a.z);
          const it = this.item(t4, 'glowStrip', new THREE.Vector3(cx, cy, cz), yaw, 1, 0, 0, 'trim', 1.1);
          it.base.multiply(tmpS.makeScale(ps, ps, len + 0.1));
        }
      }
    }
    for (const mast of p.masts) this.item(t4, 'mastCap', mast, 0, ps * 1.1);
    const crest = this.feature('tier4-crest', p.crest, p.crestRadius * 1.6);
    this.item(crest, 'crestFrame', p.crest, 0, p.crestRadius);
    this.item(crest, 'crest', p.crest, 0, p.crestRadius, 0, 0, 'halo', 1.5);
    const aura = this.feature('tier4-aura', new THREE.Vector3(0, 0.4, 0), p.length * 0.6);
    this.item(aura, 'aura', new THREE.Vector3(0, 0.45, 0), 0, 1, 0, 0, 'trim', 1.2);
    const embers = this.feature('tier4-embers', p.figurehead, 2);
    const n = 40;
    for (let i = 0; i < n; i++) {
      const it = this.item(embers, 'ember', new THREE.Vector3(), 0, 1, 0, 0, 'ember', 1.8);
      const a = (i / n) * Math.PI * 2;
      const r = 0.55 + ((i * 7) % 5) * 0.12;
      this.embers.push({ item: it, x: Math.cos(a) * Math.max(p.bounds.max.x, p.length * 0.25) * r * 1.2, z: Math.sin(a) * p.length * 0.55 * r, speed: 2.5 + (i % 5) * 0.6, phase: (i * 0.618) % 1, height: 10 + (i % 4) * 4 });
    }

    // Weapons.
    const bow = p.bow;
    const w = (id: WeaponId, anchor: THREE.Vector3, radius: number) => this.feature(`w:${id}`, anchor, radius);

    const broadside = w('broadside', new THREE.Vector3(0, p.guns[3]?.y ?? 2, 0), p.length * 0.45);
    for (const order of GUN_ORDER) {
      const g = p.guns[order]!;
      for (const side of [1, -1]) this.item(broadside, 'sideGun', new THREE.Vector3(g.x * side, g.y, g.z), side > 0 ? 0 : Math.PI, ps * 0.95);
    }

    const chaser = w('bow-chaser', bow, 3 * ps);
    this.item(chaser, 'chaser', tmpV.set(-1.5 * ps, bow.y, bow.z).clone(), 0, ps);
    this.item(chaser, 'chaser', tmpV.set(-3.2 * ps, bow.y, bow.z + 1.2 * ps).clone(), 0.08, ps * 0.9);
    this.item(chaser, 'odRing', tmpV.set(-1.5 * ps, bow.y + 0.1, bow.z).clone(), 0, ps * 1.6, 0, 0, 'overdrive', 1.4);

    const harpoon = w('harpoon', bow, 3 * ps);
    this.item(harpoon, 'harpoon', tmpV.set(1.6 * ps, bow.y, bow.z + 0.6 * ps).clone(), 0, ps);
    this.item(harpoon, 'harpoon', tmpV.set(3.4 * ps, bow.y, bow.z + 2.2 * ps).clone(), -0.12, ps * 0.85);
    this.item(harpoon, 'odRing', tmpV.set(1.6 * ps, bow.y + 0.1, bow.z + 0.6 * ps).clone(), 0, ps * 1.8, 0, 0, 'overdrive', 1.4);

    const mortar = w('stern-mortar', p.stern, 4 * ps);
    for (const dx of [0, -2.7, 2.7]) this.item(mortar, 'mortar', tmpV.set(dx * ps, p.stern.y, p.stern.z).clone(), Math.PI, ps * (dx === 0 ? 1 : 0.82));
    this.item(mortar, 'odRing', tmpV.set(0, p.stern.y + 0.1, p.stern.z).clone(), 0, ps * 2.2, 0, 0, 'overdrive', 1.4);

    const barrels = w('fire-barrels', p.sternSide.clone().setX(-p.sternSide.x), 3 * ps);
    for (let n = 1; n <= 3; n++) this.item(barrels, `barrels${n}`, p.sternSide.clone().setX(-p.sternSide.x), 0.2, ps);
    this.item(barrels, 'odRing', p.sternSide.clone().setX(-p.sternSide.x), 0, ps * 1.8, 0, 0, 'overdrive', 1.4);

    const mines = w('tide-mines', p.sternSide, 3 * ps);
    for (let n = 1; n <= 3; n++) this.item(mines, `mines${n}`, p.sternSide, -0.2, ps);
    this.item(mines, 'odRing', p.sternSide, 0, ps * 1.8, 0, 0, 'overdrive', 1.4);

    const rockets = w('rocket-rack', p.mid, 3 * ps);
    for (let n = 3; n <= 8; n++) this.item(rockets, `rocketRack${n}`, p.mid, 0, ps);
    this.item(rockets, 'odRing', p.mid, 0, ps * 2.2, 0, 0, 'overdrive', 1.4);

    const swivels = w('swivel-guns', new THREE.Vector3(0, p.railY, 0), p.length * 0.4);
    const railStations = p.rails.flat().sort((a, b) => a.z - b.z);
    const swivelStations = pickStations(railStations, 6);
    for (const order of SWIVEL_ORDER) {
      const st = swivelStations[order] ?? swivelStations[0];
      if (!st) break;
      for (const side of [1, -1]) this.item(swivels, 'swivel', new THREE.Vector3((st.x - 0.2 * ps) * side, st.railY, st.z + 1.2 * ps), side > 0 ? 0 : Math.PI, ps);
    }

    const mast = p.masts[0] ?? new THREE.Vector3(0, p.bounds.max.y, 0);
    const storm = w('storm-rod', mast, 5 * ps);
    this.item(storm, 'stormRod', mast, 0, ps);
    this.item(storm, 'stormOrb', mast, 0, ps, 0, 0, 'storm', 1.8);

    const ram = w('iron-ram', p.prow, 4 * ps);
    this.item(ram, 'ram', p.prow, 0, ps * 1.15);
    this.item(ram, 'ramSpiked', p.prow, 0, ps * 1.15);
    this.item(ram, 'odRing', p.prow.clone().setZ(p.prow.z + 1), 0, ps * 1.9, Math.PI / 2, 0, 'overdrive', 1.4);

    const totem = w('maelstrom-charm', p.totem, 3 * ps);
    this.item(totem, 'totem', p.totem, 0, ps);
    this.item(totem, 'pearl', p.totem, 0, ps, 0, 0, 'pearl', 1.6);
    this.item(totem, 'odRing', p.totem, 0, ps * 1.8, 0, 0, 'overdrive', 1.4);
  }

  // ───────────────────────── State → targets ─────────────────────────

  /** Applies the player's tier and weapons. `instant` skips the pop animation (e.g. on first sight). */
  apply(input: GrowthInput, instant = false): void {
    const tier = input.tier;
    if (tier !== this.tier) {
      this.setFeature('tier1-cannons', tier >= 1 ? Infinity : 0, `t${tier >= 1}`, instant);
      this.setFeature('tier2-plating', tier >= 2 ? Infinity : 0, `t${tier >= 2}`, instant);
      this.setFeature('tier2-lanterns', tier >= 2 ? Infinity : 0, `t${tier >= 2}`, instant);
      this.setFeature('tier3-flag', tier >= 3 ? Infinity : 0, `t${tier >= 3}`, instant);
      this.setFeature('tier3-prow', tier >= 3 ? Infinity : 0, `t${tier >= 3}`, instant);
      this.setFeature('tier3-cannons', tier >= 3 ? Infinity : 0, `t${tier >= 3}`, instant);
      this.setFeature('tier4-glory', tier >= 4 ? Infinity : 0, `t${tier >= 4}`, instant);
      this.setFeature('tier4-embers', tier >= 4 ? Infinity : 0, `t${tier >= 4}`, instant);
      this.setFeature('tier4-crest', tier >= 4 ? Infinity : 0, `t${tier >= 4}`, instant);
      this.setFeature('tier4-aura', tier >= 4 ? Infinity : 0, `t${tier >= 4}`, instant);
      for (const c of this.clothAnim) {
        const want = tier >= 3;
        if (c.target === want) continue;
        c.target = want;
        c.t = instant ? 1 : -c.delay;
      }
      this.tier = tier;
    }
    // Weapons (only when something changed).
    let changed = input.weapons.length !== this.weaponState.size;
    if (!changed) for (const wp of input.weapons) {
      const prev = this.weaponState.get(wp.id);
      if (!prev || prev.level !== wp.level || prev.branch !== wp.branch || prev.overdrive !== wp.overdrive) { changed = true; break; }
    }
    if (!changed) return;
    this.weaponState.clear();
    for (const wp of input.weapons) this.weaponState.set(wp.id, { ...wp });
    const has = (id: WeaponId) => this.weaponState.get(id);
    const lvl = (id: WeaponId) => has(id)?.level ?? 0;
    const od = (id: WeaponId) => !!has(id)?.overdrive;
    const variant = (id: WeaponId) => { const x = has(id); return x ? `${x.level}${x.branch ?? ''}${x.overdrive ? '*' : ''}` : ''; };

    // Broadside: guns per side = level count (3..7), slots fill centre-out so existing guns never move.
    const bsCount = [0, 3, 4, 4, 5, 6, 7][Math.min(6, lvl('broadside'))] ?? 0;
    this.setFeature('w:broadside', bsCount * 2, variant('broadside'), instant, (i) => Math.floor(i / 2) < bsCount);
    const levelScale = (id: WeaponId) => 1 + Math.max(0, lvl(id) - 1) * 0.055 + (od(id) ? 0.12 : 0);

    this.setFeature('w:bow-chaser', has('bow-chaser') ? 3 : 0, variant('bow-chaser'), instant,
      (i) => i === 0 || (i === 1 && (has('bow-chaser')?.branch === 'A' || od('bow-chaser'))) || (i === 2 && od('bow-chaser')), levelScale('bow-chaser'));
    this.setFeature('w:harpoon', has('harpoon') ? 3 : 0, variant('harpoon'), instant,
      (i) => i === 0 || (i === 1 && lvl('harpoon') >= 4) || (i === 2 && od('harpoon')), levelScale('harpoon'));
    const mortarCount = [0, 1, 1, 2, 2, 3, 3][lvl('stern-mortar')] ?? 0;
    this.setFeature('w:stern-mortar', mortarCount ? 4 : 0, variant('stern-mortar'), instant,
      (i) => i < mortarCount || (i === 3 && od('stern-mortar')), levelScale('stern-mortar'));
    const barrelRows = lvl('fire-barrels') >= 5 ? 3 : lvl('fire-barrels') >= 3 ? 2 : lvl('fire-barrels') >= 1 ? 1 : 0;
    this.setFeature('w:fire-barrels', barrelRows ? 4 : 0, variant('fire-barrels'), instant,
      (i) => i === barrelRows - 1 || (i === 3 && od('fire-barrels')), levelScale('fire-barrels'));
    const mineRows = lvl('tide-mines') >= 5 ? 3 : lvl('tide-mines') >= 3 ? 2 : lvl('tide-mines') >= 1 ? 1 : 0;
    this.setFeature('w:tide-mines', mineRows ? 4 : 0, variant('tide-mines'), instant,
      (i) => i === mineRows - 1 || (i === 3 && od('tide-mines')), levelScale('tide-mines'));
    const rocketLevel = lvl('rocket-rack');
    const rocketCount = rocketLevel ? Math.min(8, ([0, 3, 4, 4, 5, 6, 7][rocketLevel] ?? 3) + (has('rocket-rack')?.branch === 'A' ? 1 : 0)) : 0;
    this.setFeature('w:rocket-rack', rocketCount ? 7 : 0, variant('rocket-rack'), instant,
      (i) => i === rocketCount - 3 || (i === 6 && od('rocket-rack')), levelScale('rocket-rack'));
    const swivelLevel = lvl('swivel-guns');
    const swivelPerSide = !swivelLevel ? 0 : od('swivel-guns') ? 4 : Math.min(6, ([0, 1, 1, 2, 2, 3, 3][swivelLevel] ?? 1) * (has('swivel-guns')?.branch === 'A' ? 2 : 1));
    this.setFeature('w:swivel-guns', swivelPerSide * 2, variant('swivel-guns'), instant, (i) => Math.floor(i / 2) < swivelPerSide, levelScale('swivel-guns'));
    this.setFeature('w:storm-rod', has('storm-rod') ? 2 : 0, variant('storm-rod'), instant, () => true, levelScale('storm-rod'));
    this.setFeature('w:iron-ram', has('iron-ram') ? 3 : 0, variant('iron-ram'), instant,
      (i) => (i === 0 && has('iron-ram')?.branch !== 'A') || (i === 1 && has('iron-ram')?.branch === 'A') || (i === 2 && od('iron-ram')), levelScale('iron-ram'));
    this.setFeature('w:maelstrom-charm', has('maelstrom-charm') ? 3 : 0, variant('maelstrom-charm'), instant,
      (i) => i < 2 || od('maelstrom-charm'), levelScale('maelstrom-charm'));
  }

  private setFeature(key: string, count: number, variant: string, instant: boolean, pick?: (index: number) => boolean, scale = 1): void {
    const f = this.features.get(key);
    if (!f) return;
    const n = Math.min(count, f.items.length);
    let appeared = 0;
    let order = 0;
    for (let i = 0; i < f.items.length; i++) {
      const item = f.items[i]!;
      const want = i < n && (!pick || pick(i));
      if (want !== item.target) {
        item.target = want;
        if (instant) { item.scale = want ? 1 : 0; item.t = 1; item.animating = true; }
        else { item.t = want ? -order * STAGGER : 0; item.animating = true; order++; if (want) appeared++; }
      }
    }
    // Weapon level growth: a changed multiplier re-bounces the visible items.
    for (const item of f.items) {
      if (Math.abs(item.levelScale - scale) <= 1e-4) continue;
      item.levelScale = scale;
      if (item.target) { item.animating = true; if (!instant && item.t >= 1) item.t = 0.55; }
    }
    const upgraded = f.variant !== '' && variant !== '' && f.variant !== variant && appeared === 0;
    if (!instant && (appeared > 0 || upgraded)) {
      if (upgraded) for (const item of f.items) if (item.target && item.t >= 1) { item.t = 0.45; item.animating = true; }
      this.pending.push({ shipId: 0, feature: key, kind: appeared > 0 ? 'appear' : 'upgrade', x: f.anchor.x, y: f.anchor.y, z: f.anchor.z, radius: f.radius });
    }
    f.variant = variant;
    f.shown = n;
  }

  // ───────────────────────── Per-frame ─────────────────────────

  /**
   * `windYaw`: fly direction of flags in ship space (0 = aft, +π/2 = starboard).
   * `waterFade`: 0..1 fades the on-water aura (hidden while airborne or diving).
   */
  update(dt: number, time: number, night: number, speed: number, windYaw = 0.7, waterFade = 1): void {
    const aura = this.features.get('tier4-aura');
    if (aura) for (const item of aura.items) {
      const target = Math.round(THREE.MathUtils.clamp(waterFade, 0, 1) * 20) / 20;
      if (Math.abs(item.levelScale - target) > 1e-3) { item.levelScale = target; if (item.target) item.animating = true; }
    }
    for (const item of this.allItems) {
      if (!item.animating) continue;
      item.t += dt / (item.target ? APPEAR : HIDE);
      const t = THREE.MathUtils.clamp(item.t, 0, 1);
      item.scale = item.target ? popCurve(t) : 1 - t * t;
      const done = item.t >= 1;
      if (done) { item.scale = item.target ? 1 : 0; item.animating = false; }
      const s = item.scale * item.levelScale;
      item.mesh.setVisibleAt(item.id, s > 0.001);
      item.mesh.setMatrixAt(item.id, tmpM.copy(item.base).multiply(tmpS.makeScale(s, s, s)));
    }
    // Glow intensities (lanterns brighten at night; storm/pearl pulse; overdrive rings breathe).
    const nightQ = Math.round(night * 50) / 50;
    const lanternLevel = 0.55 + nightQ * 1.9;
    for (const item of this.allItems) {
      if (!item.glow || !item.target) continue;
      let k = item.glowBase;
      switch (item.glow) {
        case 'lantern': k *= lanternLevel * (0.94 + Math.sin(time * 7 + item.pulse) * 0.06); break;
        case 'storm': k *= 1 + Math.max(0, Math.sin(time * 11 + item.pulse)) * 0.9 * (Math.sin(time * 2.3) > 0.3 ? 1 : 0.25); break;
        case 'pearl': k *= 0.9 + Math.sin(time * 2.4 + item.pulse) * 0.35; break;
        case 'halo': k *= (0.95 + Math.sin(time * 1.7) * 0.2) * (1 + nightQ * 0.6); break;
        case 'trim': k *= 0.85 + Math.sin(time * 1.7 + item.base.elements[14]! * 0.08) * 0.25 + nightQ * 0.5; break;
        case 'overdrive': k *= 0.8 + Math.sin(time * 4 + item.pulse) * 0.4; break;
        case 'ember': break;
      }
      item.mesh.setColorAt(item.id, tmpC.setScalar(k));
    }
    this.glowNight = nightQ;
    // Embers rise from the deck and loop.
    for (const e of this.embers) {
      const it = e.item;
      if (!it.target && !it.animating) continue;
      const cycle = (time * e.speed * 0.12 + e.phase) % 1;
      const s = it.scale * (1 - cycle) * this.profile.partScale;
      tmpV.set(e.x + Math.sin(time * 1.3 + e.phase * 9) * 1.5, this.profile.deckY + cycle * e.height, e.z + Math.cos(time * 0.9 + e.phase * 7) * 1.2);
      tmpQ.setFromEuler(tmpE.set(time * 2 + e.phase, time * 3, 0));
      it.mesh.setMatrixAt(it.id, tmpM.compose(tmpV, tmpQ, tmpScale.setScalar(Math.max(0.001, s))));
      it.mesh.setVisibleAt(it.id, s > 0.01);
    }
    // Cloth (ensign + pennants).
    const patches = this.cloth.patches;
    for (let i = 0; i < this.clothAnim.length; i++) {
      const c = this.clothAnim[i]!;
      if (c.t < 1) c.t = Math.min(1, c.t + dt / (c.target ? APPEAR * 1.3 : HIDE));
      const t = THREE.MathUtils.clamp(c.t, 0, 1);
      const patch = patches[i] as ClothPatch;
      patch.scale = c.target ? popCurve(t) : 1 - t;
      patch.yaw = windYaw + Math.sin(time * 0.7 + i) * 0.08;
    }
    this.cloth.update(time, speed);
  }

  /** Growth events since the last drain (local positions are converted by the caller). */
  drainEvents(out: ShipGrowthEvent[]): void {
    for (const e of this.pending) out.push(e);
    this.pending.length = 0;
  }

  /** Every visible item's local positions for tools (lab markers). */
  get glowLevel(): number { return this.glowNight; }

  get materials(): THREE.Material[] { return [this.opaqueMaterial, this.glowMaterial, this.cloth.material]; }

  dispose(): void {
    this.opaque.dispose(); this.glow.dispose();
    for (const g of this.ownGeometries) g.dispose();
    this.opaqueMaterial.dispose(); this.glowMaterial.dispose();
    this.cloth.dispose(); this.clothTexture.dispose();
  }
}

// ───────────────────────── Helpers ─────────────────────────

function spanOf(band: readonly RailStation[]): number { return band.length ? Math.abs(band[band.length - 1]!.z - band[0]!.z) : 0; }
function clampInt(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

/** Evenly spaced stations (inset from the band ends). */
function pickStations(band: readonly RailStation[], count: number): RailStation[] {
  if (!band.length || count <= 0) return [];
  const out: RailStation[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : 0.08 + (0.84 * i) / (count - 1);
    out.push(band[Math.min(band.length - 1, Math.round(t * (band.length - 1)))]!);
  }
  return out;
}

/** An overdrive glow ring lying flat (unit radius). */
function odRing(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.torus(1, 0.09, 5, 28, { rot: [Math.PI / 2, 0, 0], color: parts.PALETTE.glowGold });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.octa(0.16, { at: [Math.cos(a) * 1.15, 0.05, Math.sin(a) * 1.15], color: parts.PALETTE.glowWhite });
  }
  return b.build();
}

/** Stern sun crest (glow): a sun disc with rays facing +Z (aft), unit radius. */
function sunCrest(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(0.72, 0.72, 0.12, 24, { rot: [Math.PI / 2, 0, 0], at: [0, 0, 0.1], color: parts.PALETTE.glowGold });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const len = i % 2 === 0 ? 0.55 : 0.35;
    b.cone(0.13, len, 4, { at: [Math.cos(a) * (0.8 + len / 2), Math.sin(a) * (0.8 + len / 2), 0.08], rot: [0, 0, a - Math.PI / 2], color: parts.PALETTE.glowGold });
  }
  return b.build();
}

/** Bronze frame behind the crest (opaque), unit radius. */
function crestFrame(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(0.95, 0.95, 0.1, 24, { rot: [Math.PI / 2, 0, 0], color: parts.PALETTE.iron });
  b.torus(0.82, 0.09, 6, 28, { at: [0, 0, 0.06], color: parts.PALETTE.gold });
  return b.build();
}

/** Tier-4 aura: a flat sun ring on the water around the hull (ellipse rx × rz, constant band width). */
function auraRing(rx: number, rz: number, partScale: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const segs = 96;
  const band = 0.75 * partScale;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(c * rx, 0, s * rz, c * (rx + band), 0, s * (rz + band));
  }
  for (let i = 0; i < segs; i++) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  b.raw(pos, idx, parts.PALETTE.glowGold, undefined, pos.map((_, i) => (i % 3 === 1 ? 1 : 0)));
  // Sun rays around the ring.
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const len = (i % 2 ? 1.2 : 2.2) * partScale;
    const x0 = c * (rx + band * 1.6), z0 = s * (rz + band * 1.6);
    const nx = c / rx, nz = s / rz, nl = Math.hypot(nx, nz) || 1;
    const tx = -nz / nl, tz = nx / nl;
    const w = 0.45 * partScale;
    b.raw([x0 + tx * w, 0, z0 + tz * w, x0 - tx * w, 0, z0 - tz * w, x0 + (nx / nl) * len, 0, z0 + (nz / nl) * len], [0, 2, 1], parts.PALETTE.glowGold, undefined, [0, 1, 0, 0, 1, 0, 0, 1, 0]);
  }
  return b.build();
}

/** One plating chunk (iron band with gold rivets) hugging the hull between two probe heights, starboard (+1) or port (−1). */
function platingChunk(stations: readonly PlatingStation[], side: 1 | -1, partScale: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const off = 0.16;
  const positions: number[] = [];
  const indices: number[] = [];
  const iron = new THREE.Color(parts.PALETTE.ironBlue);
  // Two rows (bottom, top) per station, pushed slightly outboard.
  for (const st of stations) {
    positions.push((st.x0 + off) * side, st.y0, st.z, (st.x1 + off) * side, st.y1, st.z);
  }
  // Outer skin.
  for (let i = 0; i < stations.length - 1; i++) {
    const a = i * 2, c = (i + 1) * 2;
    if (side > 0) indices.push(a, a + 1, c, a + 1, c + 1, c); else indices.push(a, c, a + 1, a + 1, c, c + 1);
  }
  b.raw(positions, indices, iron);
  // Rivet studs + edge bars.
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i]!;
    for (const [x, y] of [[st.x0, st.y0 + 0.18 * partScale], [st.x1, st.y1 - 0.18 * partScale]] as const) {
      b.sphere(0.13 * partScale, 6, 4, { at: [(x + off + 0.05) * side, y, st.z], color: parts.PALETTE.gold });
    }
    if (i === 0 || i === stations.length - 1) {
      b.box(0.14, Math.abs(st.y1 - st.y0) + 0.2, 0.3 * partScale, { at: [((st.x0 + st.x1) / 2 + off + 0.05) * side, (st.y0 + st.y1) / 2, st.z], color: parts.PALETTE.iron });
    }
  }
  // Top and bottom lips.
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i]!, c = stations[i + 1]!;
    for (const [xa, ya, xc, yc] of [[a.x0, a.y0, c.x0, c.y0], [a.x1, a.y1, c.x1, c.y1]] as const) {
      const len = Math.hypot(xc - xa, yc - ya, c.z - a.z);
      const yaw = Math.atan2((xc - xa) * side, c.z - a.z);
      b.box(0.2, 0.2, len + 0.05, { at: [((xa + xc) / 2 + off + 0.04) * side, (ya + yc) / 2, (a.z + c.z) / 2], rot: [0, yaw, 0], color: parts.PALETTE.iron });
    }
  }
  return b.build();
}
