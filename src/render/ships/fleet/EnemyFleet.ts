/**
 * Enemy fleet renderer (SHIPS-owned). One visual per model key (manifest GLB when present, procedural otherwise),
 * rendered as InstancedMeshes per class and hull half (fore/aft + glow): ~2–3 draw calls per class on screen.
 * Per instance: wave buoyancy (3 ocean samples, smoothed), sim heel, spawn rise, hit flash, elite gold tint + ring,
 * status tints (burning, slowed, stunned), wraith shimmer, and sinking — list, bow/stern dip, and for big hulls a
 * split in two with bow and stern rising — driven by EnemyState.life/sink. No per-frame allocations.
 */
import * as THREE from 'three';
import { ENEMIES } from '../../../game/content';
import type { EnemyId } from '../../../game/ids';
import type { EnemyState } from '../../../game/types';
import type { OceanServices, ShipAnchor } from '../../frame';
import { splitByZ, type FleetAssets, type FleetModel } from '../../loaders/FleetAssets';
import { createToonMaterial, markInk } from '../../materials/toon';
import { fleetAtlas } from '../atlas';
import { GeoBuilder } from '../geometry/GeoBuilder';
import { PALETTE } from '../geometry/parts';
import { glowMaterial, partMaterial } from '../materials';
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

const PROC_KEYS: Record<string, ProcKey> = {
  skiff: 'skiff', sloop: 'sloop', brig: 'brig', fireship: 'fireship', 'mortar-barge': 'mortar-barge', frigate: 'frigate',
  'man-o-war': 'man-o-war', 'corsair-brig': 'corsair-brig', 'corsair-galleon': 'corsair-galleon', wraith: 'wraith', fort: 'fort',
};

export class EnemyFleet {
  readonly group = new THREE.Group();
  readonly fleetMaterial: THREE.Material;
  readonly spectralMaterial: THREE.Material;
  readonly glowMaterial: THREE.Material;
  private readonly procedural = new Map<string, ClassVisual>();
  private readonly manifest = new Map<string, ClassVisual>();
  private readonly states = new Map<number, EnemyVisualState>();
  private readonly pool: EnemyVisualState[] = [];
  private readonly eliteRing: THREE.InstancedMesh;
  private eliteCount = 0;
  private frame = 0;
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  /** Keys whose manifest GLB is loading/ready (so we only request once). */
  private readonly requested = new Set<string>();

  constructor(private readonly assets: FleetAssets | null) {
    this.group.name = 'enemy-fleet';
    const atlas = fleetAtlas();
    this.fleetMaterial = partMaterial('ships:fleet', { map: atlas, side: THREE.DoubleSide });
    this.fleetMaterial.alphaTest = 0.5;
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
    this.eliteRing.frustumCulled = false;
    this.eliteRing.count = 0;
    this.eliteRing.visible = false;
    this.group.add(this.eliteRing);
  }

  /** Builds every procedural class up front (a few ms each) so first spawns never hitch; starts manifest loads. */
  prebuild(): void {
    for (const def of Object.values(ENEMIES)) {
      if (def.modelKey === 'wyrmling') continue;
      this.proceduralVisual(def.modelKey, def.length);
      this.requestManifest(def.modelKey, def.length);
    }
  }

  private requestManifest(key: string, length: number): void {
    if (!this.assets || this.requested.has(key)) return;
    this.requested.add(key);
    void this.assets.request(key).then((model) => { if (model) this.manifestVisual(model, length); });
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
    const hullMat = spectral ? this.spectralMaterial : this.fleetMaterial;
    const parts: InstPart[] = [];
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, half: InstPart['half']) => {
      this.ownedGeometries.push(geometry);
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = `enemy:${key}:${half}`;
      if (half !== 'glow') markInk(mesh);
      this.group.add(mesh);
      parts.push({ mesh, half });
    };
    add(built.fore, hullMat, split ? 'fore' : 'whole');
    add(built.aft, hullMat, split ? 'aft' : 'whole');
    if (built.glow) add(built.glow, this.glowMaterial, 'glow');
    const visual: ClassVisual = {
      key, source: 'procedural', length: built.length, split, splitZ: built.splitZ, pivotY: built.deckY * 0.5, height: built.mastTop,
      draft: Math.max(1, built.length * 0.08), beam: Math.abs(built.anchors.starboard.x) * 2, anchors: built.anchors as AnchorSet,
      parts, count: 0, capacity: CAPACITY, flames: key === 'fireship', spectral,
    };
    this.procedural.set(key, visual);
    return visual;
  }

  private manifestVisual(model: FleetModel, length: number): void {
    if (this.manifest.has(model.key) || model.skinned || !model.parts.length) return;
    const entryLength = model.entry.length ?? length;
    const split = entryLength >= BIG && model.parts.length <= 2 && model.key !== 'fort';
    const parts: InstPart[] = [];
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, half: InstPart['half']) => {
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.receiveShadow = true;
      mesh.name = `enemy:${model.key}:${half}:glb`;
      markInk(mesh);
      this.group.add(mesh);
      parts.push({ mesh, half });
    };
    for (const part of model.parts) {
      if (split) {
        const [fore, aft] = splitByZ(part.geometry, 0);
        this.ownedGeometries.push(fore, aft);
        add(fore, part.material, 'fore');
        add(aft, part.material, 'aft');
      } else add(part.geometry, part.material, 'whole');
    }
    const box = model.box;
    const deckY = Math.max(1.5, box.max.y * 0.22);
    const anchors: AnchorSet = {
      bow: new THREE.Vector3(0, deckY + 1, box.min.z + 1), stern: new THREE.Vector3(0, deckY + 1, box.max.z - 1),
      port: new THREE.Vector3(box.min.x * 0.95, deckY * 0.75, 0), starboard: new THREE.Vector3(box.max.x * 0.95, deckY * 0.75, 0),
      mast: new THREE.Vector3(0, box.max.y, 0), deck: new THREE.Vector3(0, deckY + 1, 0),
    };
    this.manifest.set(model.key, {
      key: model.key, source: 'manifest', length: entryLength, split, splitZ: 0, pivotY: deckY * 0.5, height: box.max.y,
      draft: model.entry.draft ?? Math.max(1, -box.min.y), beam: box.max.x - box.min.x, anchors, parts, count: 0, capacity: CAPACITY,
      flames: false, spectral: false,
    });
  }

  private visualFor(defId: EnemyId): ClassVisual | null {
    const def = ENEMIES[defId];
    if (def.modelKey === 'wyrmling') return null;
    return this.manifest.get(def.modelKey) ?? this.proceduralVisual(def.modelKey, def.length);
  }

  /** Which source renders each key right now (lab/QA). */
  sources(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const def of Object.values(ENEMIES)) {
      if (def.modelKey === 'wyrmling') { out[def.id] = 'serpent'; continue; }
      out[def.id] = this.manifest.has(def.modelKey) ? `manifest:${def.modelKey}` : `procedural:${def.modelKey}`;
    }
    return out;
  }

  update(dt: number, time: number, enemies: readonly EnemyState[], ocean: OceanServices): void {
    this.frame++;
    for (const v of this.procedural.values()) v.count = 0;
    for (const v of this.manifest.values()) v.count = 0;
    this.eliteCount = 0;
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
      if (visual.count >= visual.capacity || e.hidden >= 0.999) continue;
      const def = ENEMIES[e.defId];
      const stationary = def.speed <= 0;
      const scale = e.length / visual.length;

      // Buoyancy (3 samples).
      if (!stationary) {
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
      // Phasing (wraith blink): the hull sinks into its own mist and thins out before it vanishes.
      const hid = e.hidden;
      y -= hid * hid * 3 * scale;
      const riseScale = scale * (0.55 + 0.45 * riseEase) * (1 - hid * 0.3);
      tmpQ.setFromEuler(tmpE.set(pitch, e.heading, roll, 'YXZ'));
      st.matrix.compose(tmpP.set(e.x, y, e.z), tmpQ, tmpS.set(riseScale, riseScale, riseScale));

      // Tint: elite gold, statuses, hit flash, sinking darken, wraith shimmer.
      tint.setRGB(1, 1, 1);
      if (e.elite) tint.setRGB(1.12, 1.0, 0.72);
      for (const status of e.statuses) {
        if (status.time <= 0) continue;
        if (status.kind === 'burning') tint.multiply(tmpC.setRGB(0.78 + Math.sin(time * 17 + e.id) * 0.08, 0.5, 0.36));
        else if (status.kind === 'slowed') tint.multiply(tmpC.setRGB(0.72, 0.88, 1.2));
        else if (status.kind === 'stunned' && Math.sin(time * 24) > 0) tint.multiply(tmpC.setRGB(1.35, 1.25, 0.6));
        else if (status.kind === 'hooked') tint.multiply(tmpC.setRGB(1.05, 0.95, 0.9));
      }
      if (visual.spectral) tint.multiplyScalar(0.85 + Math.sin(time * 2.3 + e.id * 1.7) * 0.25 + hid * 1.2);
      if (s > 0) tint.multiplyScalar(1 - s * 0.45);
      const flash = e.hitFlash;
      if (flash > 0) { tint.r += flash * 1.9; tint.g += flash * 1.9; tint.b += flash * 1.8; }

      const i = visual.count++;
      if (visual.split) {
        const pz = visual.splitZ, py = visual.pivotY;
        mFore.copy(st.matrix).multiply(mA.makeTranslation(0, py, pz)).multiply(mR.makeRotationX(splitAngle)).multiply(mB.makeTranslation(0, -py, -pz - gap));
        mAft.copy(st.matrix).multiply(mA.makeTranslation(0, py, pz)).multiply(mR.makeRotationX(-splitAngle)).multiply(mB.makeTranslation(0, -py, -pz + gap));
      }
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
        if (part.half === 'glow') part.mesh.setColorAt(i, tmpC.setRGB(1, 1, 1).multiplyScalar(visual.flames ? 1.4 : 1.1 + flash));
        else part.mesh.setColorAt(i, tint);
      }
      if (e.elite && e.life === 'alive' && this.eliteCount < 48) {
        const r = e.length * 0.5;
        tmpQ.setFromEuler(tmpE.set(0, time * 0.6 + e.id, 0));
        mGlow.compose(tmpP.set(e.x, st.heave + 0.5, e.z), tmpQ, tmpS.set(r, 1, r));
        if (this.eliteCount < 48) {
          this.eliteRing.setMatrixAt(this.eliteCount, mGlow);
          this.eliteRing.setColorAt(this.eliteCount, tmpC.setRGB(1, 1, 1).multiplyScalar(1.1 + Math.sin(time * 3 + e.id) * 0.35));
          this.eliteCount++;
        }
      }
    }
    // Flush instance buffers; hide empty classes (no draw call).
    for (const v of this.procedural.values()) flushVisual(v);
    for (const v of this.manifest.values()) flushVisual(v);
    this.eliteRing.count = this.eliteCount;
    this.eliteRing.visible = this.eliteCount > 0;
    if (this.eliteCount) { this.eliteRing.instanceMatrix.needsUpdate = true; if (this.eliteRing.instanceColor) this.eliteRing.instanceColor.needsUpdate = true; }
    // Recycle states of removed enemies.
    for (const [id, st] of this.states) if (st.seen !== this.frame) { this.states.delete(id); st.visual = null; this.pool.push(st); }
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
    let n = this.eliteRing.visible ? 1 : 0;
    for (const v of this.procedural.values()) for (const p of v.parts) if (p.mesh.visible) n++;
    for (const v of this.manifest.values()) for (const p of v.parts) if (p.mesh.visible) n++;
    return n;
  }

  dispose(): void {
    for (const g of this.ownedGeometries) g.dispose();
    this.fleetMaterial.dispose(); this.spectralMaterial.dispose(); this.glowMaterial.dispose();
    this.group.clear();
  }
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
