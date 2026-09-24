/**
 * Enemy fleet renderer (SHIPS-owned; FOES extends it for the round-1 classes and elite affixes). One visual per model
 * key (manifest GLB when present, procedural otherwise), plus one DRESSED visual per round-1 class (foeLooks.ts: base
 * hull + class tint + manifest props + procedural extras), rendered as InstancedMeshes per class and part (fore/aft +
 * glow): a few draw calls per class on screen.
 * Per instance: wave buoyancy (3 ocean samples, smoothed), sim heel, spawn rise, hit flash, elite gold tint + ring,
 * affix rings (one per affix, affix colours) and the Shielded bubble, status tints (burning, slowed, stunned), wraith
 * shimmer, smoke-screen dimming, the drowned galleon's rise, floating lantern wisps, and sinking — list, bow/stern dip,
 * and for big hulls a split in two with bow and stern rising — driven by EnemyState.life/sink. No per-frame allocations.
 *
 * Instanced hull parts use NON-tintable toon materials so the per-instance colour is a plain multiply (class tint, elite
 * gold, statuses, hit flash); the tintable materials' instanced ShipTint path never reaches the fragment shader.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AFFIXES, ENEMIES } from '../../../game/content/enemies';
import type { EnemyId } from '../../../game/ids';
import type { EnemyState } from '../../../game/types';
import type { OceanServices, ShipAnchor } from '../../frame';
import { splitByZ, type FleetAssets, type FleetModel } from '../../loaders/FleetAssets';
import { createToonMaterial, isCelMaterial, markInk, markNoInk } from '../../materials/toon';
import { fleetAtlas } from '../atlas';
import { GeoBuilder } from '../geometry/GeoBuilder';
import { PALETTE } from '../geometry/parts';
import { cloneMaterial, glowMaterial, partMaterial } from '../materials';
import { FOE_LOOKS, foeLookKeys, type FoeLook } from './foeLooks';
import { buildFort, buildShip, shipSpec, type BuiltShip, type ProcKey } from './procShips';

type AnchorSet = Record<ShipAnchor, THREE.Vector3>;

interface InstPart { mesh: THREE.InstancedMesh; half: 'fore' | 'aft' | 'glow' | 'whole'; }

interface ClassVisual {
  key: string;
  source: 'procedural' | 'manifest';
  length: number;
  split: boolean;
  splitZ: number;
  pivotY: number;
  height: number;
  draft: number;
  beam: number;
  anchors: AnchorSet;
  parts: InstPart[];
  count: number;
  capacity: number;
  flames: boolean;
  spectral: boolean;
  /** Class tint (round-1 looks); white for the base classes. */
  tint: THREE.Color;
  /** Lantern wisps: hover above the water instead of floating on it. */
  float: boolean;
  /** Drowned galleon: `hidden` means depth (rises from below, bow first). */
  rise: boolean;
}

interface EnemyVisualState {
  id: number;
  heave: number;
  pitch: number;
  roll: number;
  age: number;
  seen: number;
  matrix: THREE.Matrix4;
  visual: ClassVisual | null;
}

const CAPACITY = 96;
const BIG = 28;
const RINGS = 64;
const BUBBLES = 24;
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const mA = new THREE.Matrix4();
const mB = new THREE.Matrix4();
const mR = new THREE.Matrix4();
const mFore = new THREE.Matrix4();
const mAft = new THREE.Matrix4();
const mGlow = new THREE.Matrix4();
const tint = new THREE.Color();
const tmpC = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const AFFIX_COLOR = Object.fromEntries(Object.values(AFFIXES).map((a) => [a.id, new THREE.Color(a.color)])) as Record<string, THREE.Color>;

const PROC_KEYS: Record<string, ProcKey> = {
  skiff: 'skiff', sloop: 'sloop', brig: 'brig', fireship: 'fireship', 'mortar-barge': 'mortar-barge', frigate: 'frigate',
  'man-o-war': 'man-o-war', 'corsair-brig': 'corsair-brig', 'corsair-galleon': 'corsair-galleon', wraith: 'wraith', fort: 'fort',
};

export class EnemyFleet {
  readonly group = new THREE.Group();
  /** Tintable fleet material shared with bosses and escort skiffs (per-object ShipTint). */
  readonly fleetMaterial: THREE.Material;
  /** Same atlas, non-tintable: instanced enemy parts multiply by their per-instance colour. */
  readonly enemyMaterial: THREE.Material;
  readonly spectralMaterial: THREE.Material;
  readonly glowMaterial: THREE.Material;
  private readonly procedural = new Map<string, ClassVisual>();
  private readonly manifest = new Map<string, ClassVisual>();
  /** Round-1 dressed classes: manifest-based (when base + props loaded) and procedural fallbacks. */
  private readonly looks = new Map<EnemyId, ClassVisual>();
  private readonly lookProc = new Map<EnemyId, ClassVisual>();
  private readonly states = new Map<number, EnemyVisualState>();
  private readonly pool: EnemyVisualState[] = [];
  private readonly eliteRing: THREE.InstancedMesh;
  private readonly affixRing: THREE.InstancedMesh;
  private readonly bubble: THREE.InstancedMesh;
  private readonly bubbleMaterial: THREE.ShaderMaterial;
  private eliteCount = 0;
  private affixCount = 0;
  private bubbleCount = 0;
  private frame = 0;
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  /** Non-tintable (and spectral) clones of manifest materials. */
  private readonly plain = new Map<THREE.Material, THREE.Material>();
  private readonly ghost = new Map<THREE.Material, THREE.Material>();
  /** Keys whose manifest GLB is loading/ready (so we only request once). */
  private readonly requested = new Set<string>();
  /** Manifest loads and dressed-look builds in flight (PERF warm-up waits for them before compiling). */
  private readonly pendingLoads: Promise<unknown>[] = [];

  constructor(private readonly assets: FleetAssets | null) {
    this.group.name = 'enemy-fleet';
    const atlas = fleetAtlas();
    this.fleetMaterial = partMaterial('ships:fleet', { map: atlas, side: THREE.DoubleSide });
    this.fleetMaterial.alphaTest = 0.5;
    this.enemyMaterial = partMaterial('ships:fleet-enemy', { map: atlas, side: THREE.DoubleSide, tintable: false });
    this.enemyMaterial.alphaTest = 0.5;
    this.spectralMaterial = createToonMaterial({ map: atlas, vertexColors: true, transparent: true, opacity: 0.62, emissive: 0x3fd8c2, emissiveIntensity: 0.55, side: THREE.DoubleSide, name: 'ships:spectral', rim: 0.6 });
    this.spectralMaterial.alphaTest = 0.3;
    this.glowMaterial = glowMaterial('ships:fleet-glow', 1.8);
    const ring = new GeoBuilder();
    ring.torus(1, 0.035, 4, 48, { rot: [Math.PI / 2, 0, 0], color: PALETTE.glowGold });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ring.cone(0.06, 0.2, 3, { at: [Math.cos(a) * 1.12, 0, Math.sin(a) * 1.12], rot: [Math.PI / 2, Math.PI / 2 - a, 0], scale: [1, 1, 0.3], color: PALETTE.glowGold });
    }
    const ringGeo = ring.build();
    this.ownedGeometries.push(ringGeo);
    this.eliteRing = new THREE.InstancedMesh(ringGeo, this.glowMaterial, 48);
    withInstanceColor(this.eliteRing);
    this.eliteRing.frustumCulled = false;
    this.eliteRing.count = 0;
    this.eliteRing.visible = false;
    this.group.add(this.eliteRing);
    // Affix rings: white (the instance colour carries the affix colour), dashed so two rings read apart.
    const aff = new GeoBuilder();
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      aff.torus(1, 0.05, 4, 8, { rot: [Math.PI / 2, 0, a0], color: 0xffffff }, ((Math.PI * 2) / 16) * 0.7);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      aff.octa(0.09, { at: [Math.cos(a) * 1.0, 0.05, Math.sin(a) * 1.0], scale: [1, 0.5, 1], color: 0xffffff });
    }
    const affGeo = aff.build();
    this.ownedGeometries.push(affGeo);
    this.affixRing = new THREE.InstancedMesh(affGeo, this.glowMaterial, RINGS);
    withInstanceColor(this.affixRing);
    this.affixRing.frustumCulled = false;
    this.affixRing.count = 0;
    this.affixRing.visible = false;
    this.group.add(this.affixRing);
    // Shielded bubble: additive fresnel shell, instance colour = colour × strength.
    this.bubbleMaterial = new THREE.ShaderMaterial({
      name: 'ships:affix-bubble',
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vC; varying float vY;
        void main() {
          mat4 m = modelMatrix;
          #ifdef USE_INSTANCING
            m = m * instanceMatrix;
          #endif
          vec4 wp = m * vec4(position, 1.0);
          vN = normalize(mat3(m) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vC = vec3(1.0);
          #ifdef USE_INSTANCING_COLOR
            vC = instanceColor;
          #endif
          vY = position.y;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vN; varying vec3 vV; varying vec3 vC; varying float vY;
        void main() {
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float rim = pow(f, 2.4);
          float hex = step(0.82, fract(vY * 7.0 + uTime * 0.6)) * 0.35;
          float fadeLow = smoothstep(-0.05, 0.25, vY);
          vec3 col = vC * (0.05 + rim * 1.5 + hex * rim) * fadeLow;
          gl_FragColor = vec4(col, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    });
    const bubbleGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.ownedGeometries.push(bubbleGeo);
    this.bubble = new THREE.InstancedMesh(bubbleGeo, this.bubbleMaterial, BUBBLES);
    withInstanceColor(this.bubble);
    this.bubble.frustumCulled = false;
    this.bubble.count = 0;
    this.bubble.visible = false;
    this.bubble.renderOrder = 5;
    markNoInk(this.bubble);
    this.group.add(this.bubble);
  }

  /** Builds every procedural class up front (a few ms each) so first spawns never hitch; starts manifest loads. */
  prebuild(): void {
    for (const def of Object.values(ENEMIES)) {
      if (def.modelKey === 'wyrmling') continue;
      if (FOE_LOOKS[def.id]) { this.lookProcedural(def.id); continue; }
      this.proceduralVisual(def.modelKey, def.length);
      this.requestManifest(def.modelKey, def.length);
    }
    this.requestLooks();
  }

  private requestManifest(key: string, length: number): void {
    if (!this.assets || this.requested.has(key)) return;
    this.requested.add(key);
    this.pendingLoads.push(this.assets.request(key).then((model) => { if (model) this.manifestVisual(model, length); }));
  }

  /** Resolves when every manifest model and dressed look requested so far is built (PERF warm-up). */
  async ready(): Promise<void> {
    let n = -1;
    while (n !== this.pendingLoads.length) { n = this.pendingLoads.length; await Promise.allSettled(this.pendingLoads); }
  }

  /** Loads every base hull and prop the round-1 looks need, then builds their dressed manifest visuals. */
  private requestLooks(): void {
    const assets = this.assets;
    if (!assets) return;
    const keys = foeLookKeys();
    this.pendingLoads.push(Promise.all(keys.map((k) => assets.request(k))).then((models) => {
      const byKey = new Map<string, FleetModel>();
      models.forEach((m, i) => { if (m) byKey.set(keys[i]!, m); });
      for (const [id, look] of Object.entries(FOE_LOOKS) as [EnemyId, FoeLook][]) {
        if (look.procedural) continue;
        const base = byKey.get(look.base);
        if (base && !base.skinned && base.parts.length) this.lookManifest(id, look, base, byKey);
      }
    }));
  }

  private addPart(parts: InstPart[], key: string, geometry: THREE.BufferGeometry, material: THREE.Material, half: InstPart['half'], owned: boolean): void {
    if (owned) this.ownedGeometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = `enemy:${key}:${half}`;
    // PERF: the per-instance colour exists from the start, so the boot precompile builds the program variant the
    // fleet actually draws with (three keys programs on instanceColor; setColorAt used to add it mid-run).
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (half !== 'glow') markInk(mesh);
    this.group.add(mesh);
    parts.push({ mesh, half });
  }

  /** Non-tintable clone of a manifest material (per-instance multiply tint), optionally spectral. */
  private plainOf(src: THREE.Material, spectral = false): THREE.Material {
    const cache = spectral ? this.ghost : this.plain;
    const hit = cache.get(src);
    if (hit) return hit;
    const m = cloneMaterial(src);
    if (isCelMaterial(m)) {
      m.tintable = false;
      if (spectral) {
        m.setTint(0, 0, 0.72);
        m.transparent = true;
        m.opacity = 0.82;
      }
    }
    this.ownedMaterials.push(m);
    cache.set(src, m);
    return m;
  }

  private proceduralVisual(key: string, length: number): ClassVisual | null {
    const existing = this.procedural.get(key);
    if (existing) return existing;
    const procKey = PROC_KEYS[key];
    if (!procKey) return null;
    let built: BuiltShip;
    if (procKey === 'fort') built = buildFort();
    else {
      const spec = shipSpec(procKey);
      if (!spec) return null;
      built = buildShip(spec);
    }
    const spectral = key === 'wraith';
    const split = length >= BIG && key !== 'fort';
    const hullMat = spectral ? this.spectralMaterial : this.enemyMaterial;
    const parts: InstPart[] = [];
    this.addPart(parts, key, built.fore, hullMat, split ? 'fore' : 'whole', true);
    this.addPart(parts, key, built.aft, hullMat, split ? 'aft' : 'whole', true);
    if (built.glow) this.addPart(parts, key, built.glow, this.glowMaterial, 'glow', true);
    const visual: ClassVisual = {
      key, source: 'procedural', length: built.length, split, splitZ: built.splitZ, pivotY: built.deckY * 0.5, height: built.mastTop,
      draft: Math.max(1, built.length * 0.08), beam: Math.abs(built.anchors.starboard.x) * 2, anchors: built.anchors as AnchorSet,
      parts, count: 0, capacity: CAPACITY, flames: key === 'fireship', spectral, tint: WHITE.clone(), float: false, rise: false,
    };
    this.procedural.set(key, visual);
    return visual;
  }

  private manifestVisual(model: FleetModel, length: number): void {
    if (this.manifest.has(model.key) || model.skinned || !model.parts.length) return;
    const entryLength = model.entry.length ?? length;
    const split = entryLength >= BIG && model.parts.length <= 2 && model.key !== 'fort';
    const parts: InstPart[] = [];
    for (const part of model.parts) {
      const mat = this.plainOf(part.material);
      if (split) {
        const [fore, aft] = splitByZ(part.geometry, 0);
        this.addPart(parts, `${model.key}:glb`, fore, mat, 'fore', true);
        this.addPart(parts, `${model.key}:glb`, aft, mat, 'aft', true);
      } else this.addPart(parts, `${model.key}:glb`, part.geometry, mat, 'whole', false);
    }
    this.manifest.set(model.key, { ...this.manifestFrame(model, entryLength, split), parts, tint: WHITE.clone() });
  }

  private manifestFrame(model: FleetModel, entryLength: number, split: boolean): Omit<ClassVisual, 'parts' | 'tint'> {
    const box = model.box;
    const deckY = Math.max(1.5, box.max.y * 0.22);
    const anchors: AnchorSet = {
      bow: new THREE.Vector3(0, deckY + 1, box.min.z + 1), stern: new THREE.Vector3(0, deckY + 1, box.max.z - 1),
      port: new THREE.Vector3(box.min.x * 0.95, deckY * 0.75, 0), starboard: new THREE.Vector3(box.max.x * 0.95, deckY * 0.75, 0),
      mast: new THREE.Vector3(0, box.max.y, 0), deck: new THREE.Vector3(0, deckY + 1, 0),
    };
    return {
      key: model.key, source: 'manifest', length: entryLength, split, splitZ: 0, pivotY: deckY * 0.5, height: box.max.y,
      draft: model.entry.draft ?? Math.max(1, -box.min.y), beam: box.max.x - box.min.x, anchors, count: 0, capacity: CAPACITY,
      flames: false, spectral: false, float: false, rise: false,
    };
  }

  // ───────────────────────── Round-1 dressed classes ─────────────────────────

  /** Procedural extras (+ glow) of a look, split fore/aft for big hulls. */
  private addExtras(parts: InstPart[], id: EnemyId, look: FoeLook, split: boolean): void {
    if (!look.extras) return;
    const b = new GeoBuilder(), g = new GeoBuilder();
    look.extras(b, g, look.deck);
    if (b.vertexCount) {
      const geo = b.build();
      if (split) {
        const [fore, aft] = splitByZ(geo, 0);
        this.ownedGeometries.push(geo);
        this.addPart(parts, `${id}:extras`, fore, this.enemyMaterial, 'fore', true);
        this.addPart(parts, `${id}:extras`, aft, this.enemyMaterial, 'aft', true);
      } else this.addPart(parts, `${id}:extras`, geo, this.enemyMaterial, 'whole', true);
    }
    if (g.vertexCount) this.addPart(parts, `${id}:glow`, g.build(), this.glowMaterial, 'glow', true);
  }

  /** Manifest props of a look: every placement of a prop part merged into one instanced geometry. */
  private addProps(parts: InstPart[], id: EnemyId, look: FoeLook, models: Map<string, FleetModel>, split: boolean): void {
    const keys = [...new Set(look.props.map((p) => p.key))];
    for (const key of keys) {
      const model = models.get(key);
      if (!model || model.skinned) continue;
      const placements = look.props.filter((p) => p.key === key);
      const size = model.entry.length ?? Math.max(0.5, model.box.max.z - model.box.min.z);
      for (const part of model.parts) {
        const pieces: THREE.BufferGeometry[] = [];
        for (const pl of placements) {
          const s = pl.size / size;
          const g = part.geometry.clone();
          g.applyMatrix4(mA.compose(tmpP.set(pl.at[0], pl.at[1], pl.at[2]), tmpQ.setFromEuler(tmpE.set(pl.pitch ?? 0, pl.yaw ?? 0, 0, 'YXZ')), tmpS.set(s, s, s)));
          pieces.push(g);
        }
        const merged = pieces.length === 1 ? pieces[0]! : mergeGeometries(pieces, false);
        if (pieces.length > 1) for (const g of pieces) g.dispose();
        if (!merged) continue;
        const mat = this.plainOf(part.material, false);
        if (split) {
          const [fore, aft] = splitByZ(merged, 0);
          this.ownedGeometries.push(merged);
          this.addPart(parts, `${id}:${key}`, fore, mat, 'fore', true);
          this.addPart(parts, `${id}:${key}`, aft, mat, 'aft', true);
        } else this.addPart(parts, `${id}:${key}`, merged, mat, 'whole', true);
      }
    }
  }

  private lookManifest(id: EnemyId, look: FoeLook, base: FleetModel, models: Map<string, FleetModel>): void {
    if (this.looks.has(id)) return;
    const entryLength = base.entry.length ?? ENEMIES[id].length;
    const split = entryLength >= BIG && base.parts.length <= 2;
    const parts: InstPart[] = [];
    for (const part of base.parts) {
      const mat = this.plainOf(part.material, !!look.spectral);
      if (split) {
        const [fore, aft] = splitByZ(part.geometry, 0);
        this.addPart(parts, `${id}:hull`, fore, mat, 'fore', true);
        this.addPart(parts, `${id}:hull`, aft, mat, 'aft', true);
      } else this.addPart(parts, `${id}:hull`, part.geometry, mat, 'whole', false);
    }
    this.addProps(parts, id, look, models, split);
    this.addExtras(parts, id, look, split);
    const frame = this.manifestFrame(base, entryLength, split);
    this.looks.set(id, {
      ...frame, key: id, parts, tint: new THREE.Color(look.tint[0], look.tint[1], look.tint[2]),
      spectral: !!look.spectral, rise: id === 'drowned-galleon',
    });
    // The procedural stand-in is no longer drawn: hide its meshes for good.
    const proc = this.lookProc.get(id);
    if (proc) for (const p of proc.parts) { p.mesh.count = 0; p.mesh.visible = false; }
  }

  /** Procedural stand-in for a dressed class (base procedural hull or the wisp) while/if the GLBs are missing. */
  private lookProcedural(id: EnemyId): ClassVisual | null {
    const existing = this.lookProc.get(id);
    if (existing) return existing;
    const look = FOE_LOOKS[id];
    if (!look) return null;
    const def = ENEMIES[id];
    const parts: InstPart[] = [];
    let length = def.length, split = false, splitZ = 0, deckY = look.deck, mastTop = 4, beam = def.radius * 2;
    let anchors: AnchorSet;
    if (look.procedural === 'wisp') {
      anchors = {
        bow: new THREE.Vector3(0, 1.2, -0.8), stern: new THREE.Vector3(0, 1.2, 0.8), port: new THREE.Vector3(-0.8, 1.2, 0),
        starboard: new THREE.Vector3(0.8, 1.2, 0), mast: new THREE.Vector3(0, 3, 0), deck: new THREE.Vector3(0, 1.2, 0),
      };
      length = 6; beam = 1.8; mastTop = 3;
    } else {
      const spec = shipSpec(PROC_KEYS[look.base] ?? 'brig');
      if (!spec) return null;
      const built = buildShip(spec);
      length = built.length; split = length >= BIG; splitZ = built.splitZ; deckY = built.deckY; mastTop = built.mastTop;
      beam = Math.abs(built.anchors.starboard.x) * 2;
      anchors = built.anchors as AnchorSet;
      const hull = look.spectral ? this.spectralMaterial : this.enemyMaterial;
      this.addPart(parts, `${id}:proc`, built.fore, hull, split ? 'fore' : 'whole', true);
      this.addPart(parts, `${id}:proc`, built.aft, hull, split ? 'aft' : 'whole', true);
      if (built.glow) this.addPart(parts, `${id}:proc`, built.glow, this.glowMaterial, 'glow', true);
    }
    this.addExtras(parts, id, look, split);
    const visual: ClassVisual = {
      key: id, source: 'procedural', length, split, splitZ, pivotY: deckY * 0.5, height: mastTop, draft: Math.max(0.5, length * 0.08),
      beam, anchors, parts, count: 0, capacity: CAPACITY, flames: false, spectral: !!look.spectral,
      tint: new THREE.Color(look.tint[0], look.tint[1], look.tint[2]), float: look.procedural === 'wisp', rise: id === 'drowned-galleon',
    };
    this.lookProc.set(id, visual);
    return visual;
  }

  private visualFor(defId: EnemyId): ClassVisual | null {
    const def = ENEMIES[defId];
    if (def.modelKey === 'wyrmling') return null;
    if (FOE_LOOKS[defId]) return this.looks.get(defId) ?? this.lookProcedural(defId);
    return this.manifest.get(def.modelKey) ?? this.proceduralVisual(def.modelKey, def.length);
  }

  /** Which source renders each key right now (lab/QA). */
  sources(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const def of Object.values(ENEMIES)) {
      if (def.modelKey === 'wyrmling') { out[def.id] = 'serpent'; continue; }
      const look = FOE_LOOKS[def.id];
      if (look) { out[def.id] = this.looks.has(def.id) ? `manifest-look:${look.base}` : `procedural-look:${look.base}`; continue; }
      out[def.id] = this.manifest.has(def.modelKey) ? `manifest:${def.modelKey}` : `procedural:${def.modelKey}`;
    }
    return out;
  }

  update(dt: number, time: number, enemies: readonly EnemyState[], ocean: OceanServices): void {
    this.frame++;
    for (const v of this.procedural.values()) v.count = 0;
    for (const v of this.manifest.values()) v.count = 0;
    for (const v of this.looks.values()) v.count = 0;
    for (const v of this.lookProc.values()) v.count = 0;
    this.eliteCount = 0;
    this.affixCount = 0;
    this.bubbleCount = 0;
    (this.bubbleMaterial.uniforms.uTime as { value: number }).value = time;
    const k = 1 - Math.exp(-dt * 5);
    for (const e of enemies) {
      if (e.life === 'dead') continue;
      const visual = this.visualFor(e.defId);
      if (!visual) continue;
      let st = this.states.get(e.id);
      if (!st) {
        st = this.pool.pop() ?? { id: 0, heave: 0, pitch: 0, roll: 0, age: 0, seen: 0, matrix: new THREE.Matrix4(), visual: null };
        st.id = e.id; st.age = 0; st.heave = ocean.heightAt(e.x, e.z); st.pitch = 0; st.roll = 0;
        this.states.set(e.id, st);
      }
      st.seen = this.frame;
      st.visual = visual;
      st.age += dt;
      // Ships hidden only by a smoke screen stay drawn (dimmed) under the smoke.
      const smoked = e.ai.smoke === 1 && e.ai.limbo !== 1 && e.life === 'alive';
      const hid = smoked ? Math.max(e.ai.fade ?? 0, e.ai.sub ?? 0) : e.hidden;
      if (visual.count >= visual.capacity || hid >= 0.999) continue;
      const def = ENEMIES[e.defId];
      const stationary = def.speed <= 0;
      const scale = e.length / visual.length;

      // Buoyancy (3 samples).
      if (visual.float) {
        st.heave = ocean.heightAt(e.x, e.z) + 2.2 + Math.sin(time * 2.1 + e.id * 1.3) * 0.45;
        st.pitch = Math.sin(time * 1.7 + e.id) * 0.12;
        st.roll = Math.cos(time * 1.3 + e.id * 0.7) * 0.14;
      } else if (!stationary) {
        const half = e.length * 0.38;
        const beam = Math.max(2, visual.beam * scale * 0.45);
        const sin = Math.sin(e.heading), cos = Math.cos(e.heading);
        const hBow = ocean.heightAt(e.x - sin * half, e.z - cos * half);
        const hStern = ocean.heightAt(e.x + sin * half, e.z + cos * half);
        const hSide = ocean.heightAt(e.x + cos * beam, e.z - sin * beam);
        const heave = (hBow + hStern) * 0.5;
        st.heave += (heave - st.heave) * k;
        st.pitch += (Math.atan2(hBow - hStern, 2 * half) * 0.8 - st.pitch) * k;
        st.roll += (Math.atan2(hSide - heave, beam) * 0.55 - st.roll) * k;
      } else { st.heave = 0; st.pitch = 0; st.roll = 0; }

      // Spawn rise + sinking choreography.
      const rise = Math.min(1, st.age / 0.6);
      const riseEase = 1 - Math.pow(1 - rise, 3);
      let y = st.heave - (1 - riseEase) * 4;
      let pitch = st.pitch, roll = st.roll + e.roll;
      let splitAngle = 0, gap = 0;
      const s = e.life === 'sinking' ? e.sink : 0;
      if (s > 0) {
        const list = e.id % 2 === 0 ? 1 : -1;
        const ease = 1 - Math.pow(1 - Math.min(1, s * 1.6), 2);
        // Two-phase descent: the hull settles to its deck while listing (and breaking in two) so the wreck stays
        // readable, then everything — masts last — goes under before the sim removes it at sink = 1.
        const hullDepth = visual.pivotY * 2 * scale + 2;
        const fullDepth = (visual.height + 6) * scale + (visual.split ? e.length * 0.36 : 0);
        const settle = THREE.MathUtils.smoothstep(s, 0.2, 0.72) * hullDepth * 0.75;
        const plunge = Math.pow(THREE.MathUtils.smoothstep(s, 0.58, 1), 1.3) * Math.max(0, fullDepth - hullDepth * 0.75);
        y -= settle + plunge;
        if (stationary) roll += list * ease * 0.18;
        else if (visual.split) {
          splitAngle = ease * 0.62;
          gap = ease * 2.2;
          roll += list * ease * 0.22;
        } else {
          roll += list * ease * 0.62;
          pitch += (e.id % 3 === 0 ? 1 : -1) * ease * 0.32;
        }
      }
      let riseScale: number;
      if (visual.rise) {
        // Drowned galleon: `hid` is depth. It comes up from below bow-first, streaming water (FX), at full size.
        const d = hid * hid * (3 - 2 * hid);
        y -= d * (visual.height * 0.95 + 4) * scale;
        pitch -= d * 0.32;
        riseScale = scale * (0.55 + 0.45 * riseEase);
      } else {
        // Phasing (wraith blink): the hull sinks into its own mist and thins out before it vanishes.
        y -= hid * hid * 3 * scale;
        riseScale = scale * (0.55 + 0.45 * riseEase) * (1 - hid * 0.3);
      }
      tmpQ.setFromEuler(tmpE.set(pitch, e.heading, roll, 'YXZ'));
      st.matrix.compose(tmpP.set(e.x, y, e.z), tmpQ, tmpS.set(riseScale, riseScale, riseScale));

      // Tint: class, elite gold, statuses, hit flash, sinking darken, wraith shimmer, smoke dimming.
      tint.copy(visual.tint);
      if (e.elite) tint.multiply(tmpC.setRGB(1.12, 1.0, 0.72));
      for (const status of e.statuses) {
        if (status.time <= 0) continue;
        if (status.kind === 'burning') tint.multiply(tmpC.setRGB(0.78 + Math.sin(time * 17 + e.id) * 0.08, 0.5, 0.36));
        else if (status.kind === 'slowed') tint.multiply(tmpC.setRGB(0.72, 0.88, 1.2));
        else if (status.kind === 'stunned' && Math.sin(time * 24) > 0) tint.multiply(tmpC.setRGB(1.35, 1.25, 0.6));
        else if (status.kind === 'hooked') tint.multiply(tmpC.setRGB(1.05, 0.95, 0.9));
      }
      if (visual.spectral) tint.multiplyScalar(0.85 + Math.sin(time * 2.3 + e.id * 1.7) * 0.25 + hid * 1.2);
      if (smoked) tint.multiplyScalar(0.55);
      if ((e.ai.vampT ?? 0) > 0) tint.lerp(tmpC.setRGB(1.6, 0.35, 0.45), Math.min(1, e.ai.vampT! * 1.2));
      if (s > 0) tint.multiplyScalar(1 - s * 0.45);
      const flash = e.hitFlash;
      if (flash > 0) { tint.r += flash * 1.9; tint.g += flash * 1.9; tint.b += flash * 1.8; }

      const i = visual.count++;
      if (visual.split) {
        const pz = visual.splitZ, py = visual.pivotY;
        mFore.copy(st.matrix).multiply(mA.makeTranslation(0, py, pz)).multiply(mR.makeRotationX(splitAngle)).multiply(mB.makeTranslation(0, -py, -pz - gap));
        mAft.copy(st.matrix).multiply(mA.makeTranslation(0, py, pz)).multiply(mR.makeRotationX(-splitAngle)).multiply(mB.makeTranslation(0, -py, -pz + gap));
      }
      const glowPulse = e.defId === 'signal-cutter' && (e.ai.markT ?? 0) > 0 ? 1.6 + Math.sin(time * 14) * 0.6
        : e.defId === 'lantern-wisp' ? 1.2 + Math.sin(time * 9 + e.id * 2.1) * 0.25 + (e.ai.wl === 1 ? 0.8 : 0) : 1;
      for (const part of visual.parts) {
        let m = st.matrix;
        if (part.half === 'fore' && visual.split) m = mFore;
        else if (part.half === 'aft' && visual.split) m = mAft;
        else if (part.half === 'glow') {
          if (visual.flames) {
            const f = 1 + Math.sin(time * 11 + e.id * 3.1) * 0.12 + Math.sin(time * 23 + e.id) * 0.06;
            m = mGlow.copy(st.matrix).multiply(mA.makeScale(1, f * (1 - s), 1));
          } else if (visual.split) m = mAft;
        }
        part.mesh.setMatrixAt(i, m);
        if (part.half === 'glow') part.mesh.setColorAt(i, tmpC.setRGB(1, 1, 1).multiplyScalar((visual.flames ? 1.4 : 1.1 + flash) * glowPulse * (1 - s)));
        else part.mesh.setColorAt(i, tint);
      }
      if (e.elite && e.life === 'alive') this.eliteDecor(e, st, time, smoked);
    }
    // Flush instance buffers; hide empty classes (no draw call).
    for (const v of this.procedural.values()) flushVisual(v);
    for (const v of this.manifest.values()) flushVisual(v);
    for (const v of this.looks.values()) flushVisual(v);
    for (const [id, v] of this.lookProc) if (!this.looks.has(id)) flushVisual(v);
    flushMesh(this.eliteRing, this.eliteCount);
    flushMesh(this.affixRing, this.affixCount);
    flushMesh(this.bubble, this.bubbleCount);
    // Recycle states of removed enemies.
    for (const [id, st] of this.states) if (st.seen !== this.frame) { this.states.delete(id); st.visual = null; this.pool.push(st); }
  }

  /** Elite ring, affix rings (one per affix, coloured) and the Shielded bubble. */
  private eliteDecor(e: EnemyState, st: EnemyVisualState, time: number, smoked: boolean): void {
    const r = e.length * 0.5;
    const y = st.heave + 0.5;
    const dim = smoked ? 0.4 : 1;
    const named = e.title !== null;
    if (this.eliteCount < 48 && (e.affixes.length === 0 || named)) {
      tmpQ.setFromEuler(tmpE.set(0, time * 0.6 + e.id, 0));
      const rr = r * (named ? 1.42 : 1);
      mGlow.compose(tmpP.set(e.x, y, e.z), tmpQ, tmpS.set(rr, 1, rr));
      this.eliteRing.setMatrixAt(this.eliteCount, mGlow);
      this.eliteRing.setColorAt(this.eliteCount, tmpC.setRGB(1, 1, 1).multiplyScalar((1.1 + Math.sin(time * 3 + e.id) * 0.35) * dim * (named ? 1.4 : 1)));
      this.eliteCount++;
    }
    for (let a = 0; a < e.affixes.length && this.affixCount < RINGS; a++) {
      const col = AFFIX_COLOR[e.affixes[a]!] ?? WHITE;
      const rr = r * (1 + a * 0.2);
      tmpQ.setFromEuler(tmpE.set(0, (a % 2 ? -1 : 1) * time * (0.5 + a * 0.2) + e.id, 0));
      mGlow.compose(tmpP.set(e.x, y + a * 0.15, e.z), tmpQ, tmpS.set(rr, 1, rr));
      this.affixRing.setMatrixAt(this.affixCount, mGlow);
      this.affixRing.setColorAt(this.affixCount, tmpC.copy(col).multiplyScalar((1.5 + Math.sin(time * 3.4 + e.id + a) * 0.4) * dim));
      this.affixCount++;
    }
    const max = e.ai.shieldMax ?? 0;
    if (max > 0 && this.bubbleCount < BUBBLES) {
      const f = Math.max(0, Math.min(1, (e.ai.shield ?? 0) / max));
      const hit = Math.max(0, e.ai.shieldHit ?? 0) / 0.3;
      if (f > 0.02 || hit > 0) {
        const rx = e.length * 0.62, ry = Math.max(8, e.length * 0.5);
        mGlow.compose(tmpP.set(e.x, st.heave - 0.5, e.z), tmpQ.setFromEuler(tmpE.set(0, e.heading, 0)), tmpS.set(rx * 0.72, ry, rx));
        this.bubble.setMatrixAt(this.bubbleCount, mGlow);
        const strength = (0.35 + 0.65 * f) * (1 + hit * 1.5) * dim;
        this.bubble.setColorAt(this.bubbleCount, tmpC.setRGB(0.31 + hit * 0.5, 0.7 + hit * 0.25, 1).multiplyScalar(strength));
        this.bubbleCount++;
      }
    }
  }

  has(id: number): boolean { return this.states.has(id); }

  anchor(id: number, name: ShipAnchor, out: THREE.Vector3): boolean {
    const st = this.states.get(id);
    if (!st?.visual) return false;
    out.copy(st.visual.anchors[name]).applyMatrix4(st.matrix);
    return true;
  }

  transform(id: number, out: THREE.Matrix4): boolean {
    const st = this.states.get(id);
    if (!st) return false;
    out.copy(st.matrix);
    return true;
  }

  get drawCalls(): number {
    let n = (this.eliteRing.visible ? 1 : 0) + (this.affixRing.visible ? 1 : 0) + (this.bubble.visible ? 1 : 0);
    for (const v of this.procedural.values()) for (const p of v.parts) if (p.mesh.visible) n++;
    for (const v of this.manifest.values()) for (const p of v.parts) if (p.mesh.visible) n++;
    for (const v of this.looks.values()) for (const p of v.parts) if (p.mesh.visible) n++;
    for (const v of this.lookProc.values()) for (const p of v.parts) if (p.mesh.visible) n++;
    return n;
  }

  dispose(): void {
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    this.fleetMaterial.dispose(); this.enemyMaterial.dispose(); this.spectralMaterial.dispose(); this.glowMaterial.dispose();
    this.bubbleMaterial.dispose();
    this.group.clear();
  }
}

/** Creates the per-instance colour buffer up front (PERF: fixes the program variant before the boot precompile). */
function withInstanceColor(mesh: THREE.InstancedMesh): void {
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3).fill(1), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
}

function flushVisual(v: ClassVisual): void {
  for (const part of v.parts) {
    part.mesh.count = v.count;
    part.mesh.visible = v.count > 0;
    if (v.count > 0) {
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
    }
  }
}

function flushMesh(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.visible = count > 0;
  if (count) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
}
