/**
 * Boss visuals (SHIPS-owned). Uses the manifest GLB when present (dreadnought, sovereign, tidewyrm-head) and the
 * procedural fallbacks otherwise.
 *   Iron Warden  — armour plates hug the hull (measured on the model); phase 2 ("Plates Off") blows them off one by
 *                  one, they tumble and sink, and red-hot seams glow where they were.
 *   Sovereign    — phase 1 ("Judgment") lights gold rails and a sun halo over the stern castle; phase 2 ("Last
 *                  Stand") adds deck fires, a list and a darker, battle-scarred tint.
 *   Tidewyrm     — a 140 m procedural serpent whose coils follow its swim path and dive with boss.submerged; the head
 *                  is the manifest `tidewyrm-head` (rearing neck) or a procedural head; phase 2 ignites its fins.
 * Big hulls split in two while sinking (boss.sink). Hit flash via emissive. Phase changes push growth-style events.
 */
import * as THREE from 'three';
import { BOSSES } from '../../../game/content';
import type { BossId } from '../../../game/ids';
import type { BossState } from '../../../game/types';
import type { OceanServices, ShipAnchor } from '../../frame';
import { splitByZ, type FleetAssets, type FleetModel } from '../../loaders/FleetAssets';
import { markInk } from '../../materials/toon';
import { GeoBuilder } from '../geometry/GeoBuilder';
import { PALETTE } from '../geometry/parts';
import type { ShipGrowthEvent } from '../hero/HeroGrowth';
import { HullSampler } from '../hero/HullSampler';
import { FlashDriver, cloneMaterial, glowMaterial, partMaterial } from '../materials';
import { buildShip, shipSpec } from './procShips';
import { SerpentBody, TIDEWYRM_LOOK, serpentHead, type SerpentPose } from './Serpents';

type AnchorSet = Record<ShipAnchor, THREE.Vector3>;

interface Plate { mesh: THREE.Object3D; home: THREE.Matrix4; vel: THREE.Vector3; spin: THREE.Vector3; t: number; delay: number; side: number }

interface BossVisual {
  id: number;
  defId: BossId;
  root: THREE.Group;
  fore: THREE.Group;
  aft: THREE.Group;
  length: number;
  height: number;
  pivotY: number;
  anchors: AnchorSet;
  materials: THREE.Material[];
  flash: FlashDriver;
  heave: number; pitch: number; roll: number;
  phase: number;
  seen: number;
  plates: Plate[];
  platesOff: boolean;
  seams: THREE.Object3D | null;
  judgment: THREE.Object3D | null;
  fires: THREE.Object3D | null;
  serpent: SerpentBody | null;
  head: THREE.Object3D | null;
  headScale: number;
  source: 'manifest' | 'procedural';
  matrix: THREE.Matrix4;
  owned: THREE.BufferGeometry[];
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const up = new THREE.Vector3(0, 0, -1);
const dir = new THREE.Vector3();

export class Bosses {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<number, BossVisual>();
  private frame = 0;
  private readonly plateMaterial: THREE.Material;
  private readonly glow: THREE.Material;
  private readonly serpentMaterial: THREE.Material;
  private readonly events: ShipGrowthEvent[] = [];
  private readonly pose: SerpentPose = { id: 0, x: 0, z: 0, heading: 0, speed: 0, submerged: 0, rear: 0, sink: 0, flash: 0 };

  constructor(private readonly assets: FleetAssets | null, private readonly fleetMaterial: THREE.Material) {
    this.group.name = 'bosses';
    this.plateMaterial = partMaterial('ships:boss-plates');
    this.glow = glowMaterial('ships:boss-glow', 1.8);
    this.serpentMaterial = partMaterial('ships:tidewyrm', { side: THREE.DoubleSide, rim: 0.5 });
  }

  /** Warm the manifest models so a boss never pops in procedural first. */
  preload(): void {
    if (!this.assets) return;
    for (const def of Object.values(BOSSES)) void this.assets.request(def.modelKey);
    void this.assets.request('tidewyrm-head');
  }

  update(dt: number, time: number, bosses: readonly BossState[], ocean: OceanServices): void {
    this.frame++;
    for (const b of bosses) {
      if (b.life === 'dead') continue;
      let v = this.visuals.get(b.id);
      if (!v) { v = this.create(b); this.visuals.set(b.id, v); }
      v.seen = this.frame;
      if (b.defId === 'tidewyrm') this.updateSerpent(v, b, dt, time, ocean);
      else this.updateShip(v, b, dt, time, ocean);
      if (b.phase !== v.phase) { this.onPhase(v, b.phase); v.phase = b.phase; }
      v.flash.set(b.hitFlash, 0xffffff);
    }
    for (const [id, v] of this.visuals) if (v.seen !== this.frame) { this.destroy(v); this.visuals.delete(id); }
  }

  drainEvents(out: ShipGrowthEvent[]): void { for (const e of this.events) out.push(e); this.events.length = 0; }

  private create(b: BossState): BossVisual {
    const def = BOSSES[b.defId];
    const root = new THREE.Group();
    root.name = `boss:${b.defId}`;
    root.rotation.order = 'YXZ';
    const fore = new THREE.Group(), aft = new THREE.Group();
    root.add(fore, aft);
    const v: BossVisual = {
      id: b.id, defId: b.defId, root, fore, aft, length: def.length, height: 30, pivotY: 4, anchors: defaultAnchors(def.length),
      materials: [], flash: new FlashDriver([]), heave: 0, pitch: 0, roll: 0, phase: b.phase, seen: this.frame, plates: [], platesOff: b.phase >= 1,
      seams: null, judgment: null, fires: null, serpent: null, head: null, headScale: 1, source: 'procedural', matrix: new THREE.Matrix4(), owned: [],
    };
    if (b.defId === 'tidewyrm') this.buildSerpent(v);
    else this.buildShipBoss(v, def.modelKey);
    this.group.add(root);
    markInk(root);
    return v;
  }

  private buildShipBoss(v: BossVisual, key: string): void {
    const model = this.assets?.get(key) ?? null;
    let sampler: HullSampler | null = null;
    let samplerScale = 1;
    if (model && !model.skinned && model.parts.length) {
      v.source = 'manifest';
      const L = model.entry.length ?? v.length;
      const scale = v.length / L;
      const holderF = new THREE.Group(), holderA = new THREE.Group();
      holderF.scale.setScalar(scale); holderA.scale.setScalar(scale);
      for (const part of model.parts) {
        const [f, a] = splitByZ(part.geometry, 0);
        v.owned.push(f, a);
        const mat = cloneMaterial(part.material);
        v.materials.push(mat);
        const mf = new THREE.Mesh(f, mat), ma = new THREE.Mesh(a, mat);
        for (const m of [mf, ma]) { m.castShadow = true; m.receiveShadow = true; }
        holderF.add(mf); holderA.add(ma);
      }
      v.fore.add(holderF); v.aft.add(holderA);
      const box = model.box.clone();
      box.min.multiplyScalar(scale); box.max.multiplyScalar(scale);
      v.height = box.max.y;
      v.pivotY = Math.max(3, box.max.y * 0.12);
      v.anchors = boxAnchors(box);
      sampler = new HullSampler(model.scene);
      if (!sampler.triangles) sampler = null;
      samplerScale = scale;
    } else {
      const spec = shipSpec(key === 'sovereign' ? 'sovereign' : 'dreadnought');
      const built = buildShip(spec!);
      v.owned.push(built.fore, built.aft);
      const mf = new THREE.Mesh(built.fore, this.fleetMaterial), ma = new THREE.Mesh(built.aft, this.fleetMaterial);
      for (const m of [mf, ma]) { m.castShadow = true; m.receiveShadow = true; }
      v.fore.add(mf); v.aft.add(ma);
      if (built.glow) { v.owned.push(built.glow); v.aft.add(new THREE.Mesh(built.glow, this.glow)); }
      v.height = built.mastTop;
      v.pivotY = built.deckY * 0.5;
      v.anchors = built.anchors as AnchorSet;
      // The procedural boss shares the fleet material; give it its own copy so hit flash stays local.
      const own = cloneMaterial(this.fleetMaterial);
      mf.material = own; ma.material = own;
      v.materials.push(own);
    }
    v.flash = new FlashDriver(v.materials);
    if (v.defId === 'iron-warden') this.buildPlates(v, sampler, samplerScale);
    if (v.defId === 'sovereign') this.buildSovereignFx(v);
  }

  /** Iron Warden armour: plates along both hull sides at the measured hull surface. */
  private buildPlates(v: BossVisual, sampler: HullSampler | null, scale: number): void {
    const plateGeo = (() => {
      const b = new GeoBuilder();
      b.box(0.5, 1, 1, { color: 0x4b5666 });
      for (const y of [-0.4, 0.4]) for (const z of [-0.4, 0, 0.4]) b.sphere(0.045, 5, 4, { at: [0.27, y, z], color: PALETTE.gold });
      b.box(0.55, 0.08, 1.02, { at: [0, 0.48, 0], color: PALETTE.iron });
      return b.build();
    })();
    v.owned.push(plateGeo);
    const seams = new GeoBuilder();
    const L = v.length;
    const count = 7;
    const hull = shipSpec('dreadnought')!.hull;
    for (const side of [1, -1] as const) {
      for (let i = 0; i < count; i++) {
        const z = (-0.36 + (0.7 * i) / (count - 1)) * L;
        const h = Math.max(3, hull.freeboard * 0.75);
        const y = hull.freeboard * 0.45;
        let x: number;
        if (sampler) {
          const sx = sampler.sideX(y / scale, z / scale, side);
          x = Number.isNaN(sx) ? (v.anchors.starboard.x * side) : sx * scale;
        } else {
          const t = THREE.MathUtils.clamp(z / L + 0.5, 0, 1);
          const bow = Math.pow(Math.sin(Math.min(1, t / hull.bowFullness) * Math.PI / 2), 0.8);
          x = side * (hull.beam / 2) * bow * 0.97;
        }
        const w = L / count * 0.92;
        const mesh = new THREE.Mesh(plateGeo, this.plateMaterial);
        mesh.castShadow = true;
        const yaw = side > 0 ? 0 : Math.PI;
        const home = new THREE.Matrix4().compose(new THREE.Vector3(x + side * 0.2, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1.2, h, w));
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(home);
        (z < 0 ? v.fore : v.aft).add(mesh);
        v.plates.push({ mesh, home, vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0, delay: i * 0.12 + (side > 0 ? 0 : 0.06), side });
        seams.box(0.3, h * 0.8, w * 0.8, { at: [x + side * 0.05, y, z], color: 0xff5a1e });
      }
    }
    const seamMesh = new THREE.Mesh(seams.build(), this.glow);
    v.owned.push(seamMesh.geometry);
    seamMesh.visible = v.platesOff;
    v.aft.add(seamMesh);
    v.seams = seamMesh;
    if (v.platesOff) for (const p of v.plates) { p.t = 99; p.mesh.visible = false; }
  }

  private buildSovereignFx(v: BossVisual): void {
    const L = v.length;
    const j = new GeoBuilder();
    // Gold rails along both sides + a sun halo over the stern castle.
    for (const side of [1, -1]) j.box(0.5, 0.5, L * 0.7, { at: [side * (v.anchors.starboard.x - 0.4), v.anchors.deck.y + 1.2, 0], color: PALETTE.glowGold });
    j.torus(9, 0.6, 6, 40, { at: [0, v.height * 0.45, L * 0.44], color: PALETTE.glowGold });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      j.cone(0.9, 3.6, 4, { at: [Math.cos(a) * 11.5, v.height * 0.45 + Math.sin(a) * 11.5, L * 0.44], rot: [0, 0, a - Math.PI / 2], color: PALETTE.glowGold });
    }
    const judgment = new THREE.Mesh(j.build(), this.glow);
    v.owned.push(judgment.geometry);
    judgment.visible = v.phase >= 1;
    v.aft.add(judgment);
    v.judgment = judgment;
    const f = new GeoBuilder();
    for (const [x, z, s] of [[-6, -30, 2], [5, -12, 2.6], [-4, 8, 2.2], [7, 26, 2.8], [0, -44, 1.8]] as const) {
      f.cone(1.2 * s, 3.8 * s, 6, { at: [x, v.anchors.deck.y + 1.6 * s, z], color: PALETTE.glowRed });
      f.cone(0.7 * s, 2.6 * s, 6, { at: [x + 0.3, v.anchors.deck.y + 1.4 * s, z + 0.3], color: PALETTE.glowWarm });
    }
    const fires = new THREE.Mesh(f.build(), this.glow);
    v.owned.push(fires.geometry);
    fires.visible = v.phase >= 2;
    v.aft.add(fires);
    v.fires = fires;
  }

  private buildSerpent(v: BossVisual): void {
    v.serpent = new SerpentBody(TIDEWYRM_LOOK, this.serpentMaterial);
    v.materials.push(this.serpentMaterial);
    this.group.add(v.serpent.mesh);
    const headModel: FleetModel | null = this.assets?.get('tidewyrm-head') ?? null;
    if (headModel && headModel.parts.length) {
      v.source = 'manifest';
      const head = new THREE.Group();
      for (const part of headModel.parts) {
        const mat = cloneMaterial(part.material);
        v.materials.push(mat);
        const m = new THREE.Mesh(part.geometry, mat);
        m.castShadow = true;
        head.add(m);
      }
      // The GLB is an upright neck (y 0..18 m) whose cut is ~7 m wide; match the body radius.
      const beam = headModel.entry.beam ?? 7;
      v.headScale = (TIDEWYRM_LOOK.radius * 2.1) / beam;
      head.userData.upright = true;
      v.head = head;
    } else {
      const eyes = new GeoBuilder();
      const g = serpentHead(TIDEWYRM_LOOK, eyes);
      v.owned.push(g);
      const head = new THREE.Group();
      head.add(new THREE.Mesh(g, this.serpentMaterial));
      const eg = eyes.build();
      v.owned.push(eg);
      head.add(new THREE.Mesh(eg, this.glow));
      v.headScale = TIDEWYRM_LOOK.radius * 1.15;
      v.head = head;
    }
    this.group.add(v.head);
    markInk(v.head);
    v.height = 40;
    v.flash = new FlashDriver(v.materials);
  }

  private updateShip(v: BossVisual, b: BossState, dt: number, time: number, ocean: OceanServices): void {
    const L = v.length;
    const half = L * 0.38, beam = Math.max(6, Math.abs(v.anchors.starboard.x) * 0.8);
    const sin = Math.sin(b.heading), cos = Math.cos(b.heading);
    const hBow = ocean.heightAt(b.x - sin * half, b.z - cos * half);
    const hStern = ocean.heightAt(b.x + sin * half, b.z + cos * half);
    const hStar = ocean.heightAt(b.x + cos * beam, b.z - sin * beam);
    const hPort = ocean.heightAt(b.x - cos * beam, b.z + sin * beam);
    const k = 1 - Math.exp(-dt * 4);
    v.heave += ((hBow + hStern + hStar + hPort) / 4 - v.heave) * k;
    v.pitch += (Math.atan2(hBow - hStern, 2 * half) * 0.6 - v.pitch) * k;
    v.roll += (Math.atan2(hStar - hPort, 2 * beam) * 0.4 - v.roll) * k;
    const s = b.life === 'sinking' ? b.sink : 0;
    const ease = 1 - Math.pow(1 - Math.min(1, s * 1.5), 2);
    const lastStand = v.defId === 'sovereign' && b.phase >= 2 ? 0.07 : 0;
    const y = v.heave - Math.pow(s, 2) * (v.height + L * 0.3 + 8);
    v.root.position.set(b.x, y, b.z);
    v.root.rotation.set(v.pitch, b.heading, v.roll + b.roll + lastStand + ease * 0.18);
    // Split in two while sinking.
    const a = ease * 0.55, gap = ease * 4;
    setHalf(v.fore, v.pivotY, a, -gap);
    setHalf(v.aft, v.pivotY, -a, gap);
    v.root.updateMatrixWorld();
    v.matrix.copy(v.root.matrixWorld);
    // Plates off (Iron Warden phase 2).
    if (v.platesOff) {
      for (const p of v.plates) {
        if (p.t >= 99) continue;
        p.t += dt;
        const t = p.t - p.delay;
        if (t < 0) continue;
        if (p.vel.lengthSq() === 0) {
          p.vel.set(p.side * (6 + Math.random() * 4), 7 + Math.random() * 4, (Math.random() - 0.5) * 4);
          p.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, p.side * (2 + Math.random() * 3));
          this.events.push({ shipId: v.id, feature: 'boss:plate-off', kind: 'upgrade', x: 0, y: 0, z: 0, radius: 4 });
          tmpV.setFromMatrixPosition(p.home).applyMatrix4(p.mesh.parent!.matrixWorld);
          const e = this.events[this.events.length - 1]!;
          e.x = tmpV.x; e.y = tmpV.y; e.z = tmpV.z;
        }
        const g = 18;
        const px = p.vel.x * t, py = p.vel.y * t - 0.5 * g * t * t, pz = p.vel.z * t;
        tmpQ.setFromEuler(tmpE.set(p.spin.x * t, p.spin.y * t, p.spin.z * t));
        tmpM.makeRotationFromQuaternion(tmpQ);
        p.mesh.matrix.copy(p.home);
        p.mesh.matrix.premultiply(tmpM2.makeTranslation(px, py, pz));
        p.mesh.matrix.multiply(tmpM);
        if (t > 3.2) { p.t = 99; p.mesh.visible = false; }
      }
    }
    if (v.seams) (v.seams as THREE.Mesh).visible = v.platesOff;
    if (v.judgment) {
      v.judgment.visible = b.phase >= 1 && s === 0;
      v.judgment.rotation.z = 0;
    }
    if (v.fires) {
      v.fires.visible = b.phase >= 2 || s > 0;
      v.fires.scale.set(1, 1 + Math.sin(time * 10) * 0.08, 1);
    }
  }

  private updateSerpent(v: BossVisual, b: BossState, _dt: number, time: number, ocean: OceanServices): void {
    const p = this.pose;
    p.id = b.id; p.x = b.x; p.z = b.z; p.heading = b.heading; p.speed = b.speed;
    p.submerged = b.submerged;
    const lunge = b.attack.includes('lunge') ? Math.max(0, Math.sin(Math.min(1, b.attackTime / 2.2) * Math.PI)) : 0;
    p.rear = b.life === 'sinking' ? 0 : THREE.MathUtils.clamp(0.28 + lunge * 0.8 - b.submerged * 0.3, 0, 1);
    p.sink = b.life === 'sinking' ? b.sink : 0;
    p.flash = b.hitFlash;
    v.serpent!.update(time, p, ocean);
    const h = v.serpent!.lastHead;
    const head = v.head!;
    if (head.userData.upright) {
      // Upright GLB neck: stand it on the body's front ring, facing the swim direction.
      tmpQ.setFromEuler(tmpE.set(0, b.heading, 0));
      head.position.set(h.headX, h.headY - TIDEWYRM_LOOK.radius * 0.6, h.headZ);
      head.quaternion.copy(tmpQ);
      head.scale.setScalar(v.headScale * (0.8 + 0.3 * p.rear));
    } else {
      dir.set(h.dirX, h.dirY + p.rear * 0.8, h.dirZ).normalize();
      head.quaternion.setFromUnitVectors(up, dir);
      head.position.set(h.headX, h.headY, h.headZ);
      head.scale.setScalar(v.headScale);
    }
    head.visible = b.submerged < 0.95;
    // Phase 2: angry fins and eyes.
    const m = this.serpentMaterial as THREE.MeshToonMaterial;
    if (m.color) m.color.setRGB(1, b.phase >= 1 ? 0.82 : 1, b.phase >= 1 ? 0.8 : 1);
    v.root.position.set(h.headX, h.headY, h.headZ);
    v.root.updateMatrixWorld();
    v.matrix.makeRotationY(b.heading).setPosition(h.headX, h.headY, h.headZ);
    v.height = TIDEWYRM_LOOK.radius * 2;
  }

  private onPhase(v: BossVisual, phase: number): void {
    if (v.defId === 'iron-warden' && phase >= 1 && !v.platesOff) v.platesOff = true;
    tmpV.setFromMatrixPosition(v.matrix);
    this.events.push({ shipId: v.id, feature: `boss:${v.defId}:phase${phase}`, kind: 'upgrade', x: tmpV.x, y: tmpV.y + 10, z: tmpV.z, radius: v.length * 0.4 });
  }

  has(id: number): boolean { return this.visuals.has(id); }

  anchor(id: number, name: ShipAnchor, out: THREE.Vector3): boolean {
    const v = this.visuals.get(id);
    if (!v) return false;
    if (v.serpent) {
      const h = v.serpent.lastHead;
      if (name === 'bow' || name === 'mast') out.set(h.headX, h.headY + (name === 'mast' ? 12 : 3), h.headZ);
      else if (name === 'stern') v.serpent.pointAt(0.9, out);
      else v.serpent.pointAt(0.25, out);
      return true;
    }
    out.copy(v.anchors[name]).applyMatrix4(v.matrix);
    return true;
  }

  transform(id: number, out: THREE.Matrix4): boolean {
    const v = this.visuals.get(id);
    if (!v) return false;
    out.copy(v.matrix);
    return true;
  }

  sources(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const v of this.visuals.values()) out[v.defId] = v.source;
    return out;
  }

  private destroy(v: BossVisual): void {
    this.group.remove(v.root);
    if (v.serpent) { this.group.remove(v.serpent.mesh); v.serpent.dispose(); }
    if (v.head) this.group.remove(v.head);
    for (const g of v.owned) g.dispose();
    for (const m of v.materials) if (m !== this.serpentMaterial) m.dispose();
  }

  dispose(): void {
    for (const v of this.visuals.values()) this.destroy(v);
    this.visuals.clear();
    this.plateMaterial.dispose(); this.glow.dispose(); this.serpentMaterial.dispose();
  }
}

/** Rotates a hull half about the midship break (0, pivotY, 0) and slides it `gap` metres along Z. */
function setHalf(g: THREE.Group, pivotY: number, angle: number, gap: number): void {
  // p' = R(p − c) + c + gap  ⇒  position = c − R·c + gap, with R·c = (0, pivotY·cos a, pivotY·sin a).
  g.rotation.set(angle, 0, 0);
  g.position.set(0, pivotY * (1 - Math.cos(angle)), gap - pivotY * Math.sin(angle));
}

function defaultAnchors(length: number): AnchorSet {
  return {
    bow: new THREE.Vector3(0, 6, -length / 2), stern: new THREE.Vector3(0, 8, length / 2), port: new THREE.Vector3(-length * 0.17, 5, 0),
    starboard: new THREE.Vector3(length * 0.17, 5, 0), mast: new THREE.Vector3(0, length * 0.5, 0), deck: new THREE.Vector3(0, 7, 0),
  };
}

function boxAnchors(box: THREE.Box3): AnchorSet {
  const deck = Math.max(3, box.max.y * 0.2);
  return {
    bow: new THREE.Vector3(0, deck + 1, box.min.z + 2), stern: new THREE.Vector3(0, deck + 2, box.max.z - 2),
    port: new THREE.Vector3(box.min.x * 0.92, deck * 0.7, 0), starboard: new THREE.Vector3(box.max.x * 0.92, deck * 0.7, 0),
    mast: new THREE.Vector3(0, box.max.y, 0), deck: new THREE.Vector3(0, deck + 1, 0),
  };
}
