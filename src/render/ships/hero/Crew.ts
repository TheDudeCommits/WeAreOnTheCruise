/**
 * The player's crew on deck (SHIPS-owned). Uses manifest crew GLBs (sailor-a/b/c: skinned + toon, idle clip) when the
 * fleet manifest lists them, otherwise original procedural sailors: chunky toon figures (striped shirts, bandanas,
 * tricorns in the ship's accent colour) instanced per look — 3 draw calls for the whole crew. They idle, look around,
 * haul lines, and cheer (hop, arms up) when the ship grows.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { FleetAssets, FleetModel } from '../../loaders/FleetAssets';
import { markInk } from '../../materials/toon';
import { GeoBuilder } from '../geometry/GeoBuilder';
import { partMaterial } from '../materials';

const SKIN = [0xe8b48a, 0xc98a5e, 0x8d5a3c];
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);

/** A sailor about 2.2 m tall (toon proportions), origin at the feet, facing −Z. */
function sailor(variant: number, accent: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const skin = SKIN[variant % SKIN.length]!;
  const pants = variant === 1 ? 0x3b2a1e : 0x2c3e62;
  // Legs + boots.
  for (const x of [-0.18, 0.18]) {
    b.box(0.26, 0.8, 0.28, { at: [x, 0.5, 0], color: pants });
    b.box(0.3, 0.22, 0.4, { at: [x, 0.11, -0.05], color: 0x1f1a17 });
  }
  // Torso: striped shirt (a), vest (b) or apron (c).
  if (variant === 0) {
    for (let i = 0; i < 4; i++) b.box(0.66, 0.18, 0.38, { at: [0, 1.0 + i * 0.18, 0], color: i % 2 ? 0x2c3e62 : 0xf2efe6 });
  } else if (variant === 1) {
    b.box(0.66, 0.72, 0.38, { at: [0, 1.27, 0], color: 0xf2efe6 });
    b.box(0.68, 0.6, 0.4, { at: [0, 1.3, 0.01], color: 0x7a2a1c, scale: [1, 1, 1] });
  } else {
    b.box(0.72, 0.74, 0.42, { at: [0, 1.28, 0], color: 0xf2efe6 });
    b.box(0.6, 0.7, 0.05, { at: [0, 1.15, -0.23], color: 0xffffff });
  }
  b.box(0.7, 0.12, 0.4, { at: [0, 0.94, 0], color: 0x5a3a20 });
  // Arms (hands at the sides).
  for (const x of [-0.43, 0.43]) {
    b.box(0.2, 0.62, 0.22, { at: [x, 1.3, 0], color: variant === 0 ? 0xf2efe6 : skin });
    b.sphere(0.12, 6, 5, { at: [x, 0.95, 0], color: skin });
  }
  // Head (big, toon) + face hints.
  b.sphere(0.36, 12, 10, { at: [0, 1.95, 0], color: skin });
  b.box(0.08, 0.08, 0.02, { at: [-0.12, 2.0, -0.35], color: 0x1b2340 });
  b.box(0.08, 0.08, 0.02, { at: [0.12, 2.0, -0.35], color: 0x1b2340 });
  // Headwear in the ship's accent colour.
  if (variant === 0) {
    b.sphere(0.38, 10, 6, { at: [0, 2.06, 0], scale: [1, 0.55, 1], color: accent });
    b.box(0.12, 0.3, 0.1, { at: [0.2, 1.95, 0.34], rot: [0.4, 0, 0.3], color: accent });
  } else if (variant === 1) {
    b.cylinder(0.52, 0.56, 0.12, 3, { at: [0, 2.22, 0], rot: [0, Math.PI, 0], color: 0x1f1a17 });
    b.cylinder(0.3, 0.36, 0.3, 10, { at: [0, 2.38, 0], color: 0x1f1a17 });
    b.box(0.5, 0.06, 0.06, { at: [0, 2.3, -0.3], color: accent });
  } else {
    b.cylinder(0.3, 0.26, 0.42, 10, { at: [0, 2.4, 0], color: 0xffffff });
    b.sphere(0.34, 10, 6, { at: [0, 2.62, 0], scale: [1, 0.6, 1], color: 0xffffff });
  }
  return b.build();
}

interface CrewMember { variant: number; index: number; spot: THREE.Vector3; yaw: number; phase: number; hop: number; hopV: number; job: number }

export class HeroCrew {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly material: THREE.Material;
  private readonly members: CrewMember[] = [];
  private readonly skinned: { root: THREE.Object3D; mixer: THREE.AnimationMixer; member: CrewMember }[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly scale: number;

  constructor(spots: readonly THREE.Vector3[], accent: number, scale: number, assets: FleetAssets | null) {
    this.group.name = 'hero-crew';
    this.material = partMaterial('ships:crew', { rim: 0.6 });
    const keys = ['sailor-a', 'sailor-b', 'sailor-c'];
    const models = keys.map((k) => assets?.get(k) ?? null);
    const counts = [0, 0, 0];
    this.scale = scale;
    spots.forEach((spot, i) => {
      const variant = i % 3;
      this.members.push({ variant, index: counts[variant]!++, spot: spot.clone(), yaw: spot.x > 0 ? -Math.PI / 2 + 0.3 : Math.PI / 2 - 0.3, phase: i * 1.37, hop: 0, hopV: 0, job: i % 4 });
    });
    for (let v = 0; v < 3; v++) {
      const model: FleetModel | null = models[v] ?? null;
      if (model && model.skinned) {
        for (const m of this.members.filter((x) => x.variant === v)) {
          const root = cloneSkinned(model.scene);
          const h = model.entry.height ?? 1.8;
          root.scale.setScalar((2.1 / h) * scale);
          const mixer = new THREE.AnimationMixer(root);
          const clip = model.animations.find((c) => /idle/i.test(c.name)) ?? model.animations[0];
          if (clip) mixer.clipAction(clip).setEffectiveTimeScale(0.9 + (m.phase % 0.3)).play();
          markInk(root);
          this.group.add(root);
          this.skinned.push({ root, mixer, member: m });
        }
        continue;
      }
      const g = sailor(v, accent);
      this.geometries.push(g);
      const mesh = new THREE.InstancedMesh(g, this.material, Math.max(1, counts[v]!));
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.count = counts[v]!;
      mesh.visible = counts[v]! > 0;
      markInk(mesh);
      this.group.add(mesh);
      this.meshes[v] = mesh;
    }
  }

  /** Everyone hops and throws their arms up (growth moments). */
  cheer(): void { for (const m of this.members) m.hopV = 5.5 + (m.phase % 1) * 2; }

  update(dt: number, time: number): void {
    for (const m of this.members) {
      m.hopV -= 22 * dt;
      m.hop = Math.max(0, m.hop + m.hopV * dt);
      if (m.hop === 0 && m.hopV < 0) m.hopV = 0;
      const t = time + m.phase;
      let yaw = m.yaw + Math.sin(t * 0.4) * 0.6;
      let lean = 0, bob = Math.abs(Math.sin(t * 2)) * 0.04;
      if (m.job === 1) { lean = Math.max(0, Math.sin(t * 2.2)) * 0.35; bob = 0; } // hauling a line
      if (m.job === 2) yaw += Math.sin(t * 1.3) * 0.9; // lookout
      tmpQ.setFromEuler(tmpE.set(lean, yaw, Math.sin(t * 1.1) * 0.05));
      tmpP.copy(m.spot).setY(m.spot.y + bob + m.hop);
      const s = this.scale;
      tmpM.compose(tmpP, tmpQ, tmpS.set(s, s * (1 + Math.min(0.12, m.hopV * 0.01)), s));
      const mesh = this.meshes[m.variant];
      if (mesh) mesh.setMatrixAt(m.index, tmpM);
    }
    for (const mesh of this.meshes) if (mesh) mesh.instanceMatrix.needsUpdate = true;
    for (const s of this.skinned) {
      s.mixer.update(dt);
      s.root.position.copy(s.member.spot).setY(s.member.spot.y + s.member.hop);
      s.root.rotation.set(0, s.member.yaw + Math.sin((time + s.member.phase) * 0.4) * 0.6, 0);
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    for (const s of this.skinned) s.mixer.stopAllAction();
  }
}
