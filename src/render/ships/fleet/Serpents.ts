/**
 * Sea serpents (SHIPS-owned): procedural segmented bodies that follow the path their head has swum (a trail ring
 * buffer), undulating in vertical coils that break the surface; heads are procedural (or the manifest
 * `tidewyrm-head`). Wyrmlings share ONE dynamic mesh (+ one instanced head mesh) → 2 draw calls for the whole brood.
 * CPU-deformed tubes with analytic normals; no per-frame allocations after warm-up.
 */
import * as THREE from 'three';
import type { OceanServices } from '../../frame';
import { markInk } from '../../materials/toon';
import { GeoBuilder } from '../geometry/GeoBuilder';
import { glowMaterial, partMaterial } from '../materials';

export interface SerpentLook {
  length: number;
  radius: number;
  rings: number;
  sides: number;
  back: number;
  belly: number;
  fin: number;
  /** Coil wavelength (m) and height (m). */
  wavelength: number;
  amplitude: number;
}

export const WYRMLING_LOOK: SerpentLook = { length: 16, radius: 1.15, rings: 18, sides: 10, back: 0x2f8f86, belly: 0xece2c2, fin: 0x1f5f73, wavelength: 9, amplitude: 1.3 };
export const TIDEWYRM_LOOK: SerpentLook = { length: 140, radius: 4.6, rings: 48, sides: 14, back: 0x1f6f8a, belly: 0xf0e6c6, fin: 0x6fd8e8, wavelength: 42, amplitude: 9.5 };

/** Pose input for one serpent (from EnemyState/BossState). */
export interface SerpentPose {
  id: number; x: number; z: number; heading: number; speed: number;
  /** 0 surfaced … 1 fully under. */
  submerged: number;
  /** 0..1 head rearing (lunge). */
  rear: number;
  sink: number;
  flash: number;
}

const VERTS_PER_RING = (look: SerpentLook) => look.sides + 3; // + dorsal fin triple (base L, tip, base R)

/** A trail of head positions, resampled to fixed spacing. */
class Trail {
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  head = 0;
  count = 0;
  constructor(readonly capacity: number, readonly spacing: number) { this.xs = new Float32Array(capacity); this.zs = new Float32Array(capacity); }
  reset(x: number, z: number, heading: number): void {
    const bx = Math.sin(heading) * this.spacing, bz = Math.cos(heading) * this.spacing; // behind = +forward reversed
    this.count = this.capacity;
    this.head = 0;
    for (let i = 0; i < this.capacity; i++) { this.xs[i] = x + bx * i; this.zs[i] = z + bz * i; }
  }
  push(x: number, z: number): void {
    const hx = this.xs[this.head]!, hz = this.zs[this.head]!;
    let d = Math.hypot(x - hx, z - hz);
    let px = hx, pz = hz;
    while (d >= this.spacing) {
      const t = this.spacing / d;
      px += (x - px) * t; pz += (z - pz) * t;
      this.head = (this.head - 1 + this.capacity) % this.capacity;
      this.xs[this.head] = px; this.zs[this.head] = pz;
      d = Math.hypot(x - px, z - pz);
    }
  }
  /** Point `k` samples behind the head (k may be fractional); index 0 is the current head. */
  at(k: number, x: number, z: number, out: { x: number; z: number }): void {
    if (k <= 0) { out.x = x; out.z = z; return; }
    const i0 = Math.min(this.capacity - 2, Math.floor(k)), f = k - i0;
    const a = (this.head + i0) % this.capacity, b = (this.head + i0 + 1) % this.capacity;
    const ax = i0 === 0 ? x : this.xs[a]!, az = i0 === 0 ? z : this.zs[a]!;
    out.x = ax + (this.xs[b]! - ax) * f; out.z = az + (this.zs[b]! - az) * f;
  }
}

export interface HeadPose { headX: number; headY: number; headZ: number; dirX: number; dirY: number; dirZ: number }

const P = { x: 0, z: 0 };
const Q = { x: 0, z: 0 };
const col = new THREE.Color();

/** Writes one serpent body into position/normal/color arrays at `vertexOffset`. */
function writeBody(look: SerpentLook, trail: Trail, pose: SerpentPose, time: number, ocean: OceanServices, pos: Float32Array, nor: Float32Array, vo: number, scale: number, out: HeadPose): HeadPose {
  const R = look.rings, S = look.sides;
  const L = look.length * scale;
  const seg = L / (R - 1);
  const spacing = trail.spacing;
  let headX = 0, headY = 0, headZ = 0, dirX = 0, dirY = 0, dirZ = -1;
  const sink = pose.sink;
  for (let r = 0; r < R; r++) {
    const s = r / (R - 1); // 0 head → 1 tail
    const k = (s * L) / spacing;
    trail.at(k, pose.x, pose.z, P);
    trail.at(k + 0.5, pose.x, pose.z, Q);
    let tx = P.x - Q.x, tz = P.z - Q.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const water = ocean.heightAt(P.x, P.z);
    const phase = (s * L) / (look.wavelength * scale) * Math.PI * 2 - time * 2.2 * (0.6 + Math.min(1, pose.speed / 15));
    const coil = Math.sin(phase) * look.amplitude * scale * (0.35 + 0.65 * Math.min(1, s * 4));
    const rear = pose.rear * Math.pow(Math.max(0, 1 - s * 3.2), 1.6) * look.length * scale * 0.32;
    const under = pose.submerged * (look.amplitude + look.radius * 3) * scale;
    const cy = water + coil - look.radius * scale * 0.35 + rear - under - sink * sink * 12 * scale;
    const taper = Math.pow(1 - s, 0.55) * (s < 0.06 ? 0.75 + s * 4 : 1);
    const rad = Math.max(0.12, look.radius * scale * taper);
    // Ring frame: tangent (tx, 0, tz), side (−tz, 0, tx)... roll the belly up while sinking.
    const sx = tz, sz = -tx;
    const rollA = sink * Math.PI * (pose.id % 2 ? 1 : -1);
    for (let j = 0; j < S; j++) {
      const a = (j / S) * Math.PI * 2 + rollA;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = sx * ca, ny = sa, nz = sz * ca;
      const i = (vo + r * VERTS_PER_RING(look) + j) * 3;
      pos[i] = P.x + nx * rad; pos[i + 1] = cy + ny * rad * 0.9; pos[i + 2] = P.z + nz * rad;
      nor[i] = nx; nor[i + 1] = ny; nor[i + 2] = nz;
    }
    // Dorsal fin: saw-tooth ridge along the back.
    const finH = rad * (0.9 + 0.8 * Math.max(0, Math.sin(s * 38))) * (s > 0.08 && s < 0.9 ? 1 : 0.2);
    const upX = -Math.sin(rollA) * 0, upY = Math.cos(rollA), upSide = Math.sin(rollA);
    const bi = (vo + r * VERTS_PER_RING(look) + S) * 3;
    const topY = cy + rad * 0.85 * upY;
    pos[bi] = P.x - tx * rad * 0.3 + sx * upSide * rad; pos[bi + 1] = topY; pos[bi + 2] = P.z - tz * rad * 0.3 + sz * upSide * rad;
    pos[bi + 3] = P.x + tx * rad * 0.6 + sx * upSide * (rad + finH); pos[bi + 4] = topY + finH * upY; pos[bi + 5] = P.z + tz * rad * 0.6 + sz * upSide * (rad + finH);
    pos[bi + 6] = P.x + tx * rad * 0.9 + sx * upSide * rad; pos[bi + 7] = topY; pos[bi + 8] = P.z + tz * rad * 0.9 + sz * upSide * rad;
    for (let q = 0; q < 3; q++) { nor[bi + q * 3] = sx; nor[bi + q * 3 + 1] = upX; nor[bi + q * 3 + 2] = sz; }
    if (r === 0) { headX = P.x; headY = cy; headZ = P.z; }
    if (r === 1) { dirX = headX - P.x; dirY = headY - cy; dirZ = headZ - P.z; }
  }
  const dl = Math.hypot(dirX, dirY, dirZ) || 1;
  void seg;
  out.headX = headX; out.headY = headY; out.headZ = headZ;
  out.dirX = dirX / dl; out.dirY = dirY / dl; out.dirZ = dirZ / dl;
  return out;
}

/** Static index + colour buffers for `count` bodies. */
function buildBodyBuffers(look: SerpentLook, count: number): { geometry: THREE.BufferGeometry; pos: Float32Array; nor: Float32Array } {
  const R = look.rings, S = look.sides, V = VERTS_PER_RING(look);
  const vertsPer = R * V;
  const pos = new Float32Array(vertsPer * count * 3);
  const nor = new Float32Array(vertsPer * count * 3);
  const colors = new Float32Array(vertsPer * count * 3);
  const idx: number[] = [];
  const back = new THREE.Color(look.back), belly = new THREE.Color(look.belly), fin = new THREE.Color(look.fin), band = new THREE.Color(look.back).multiplyScalar(0.72);
  for (let n = 0; n < count; n++) {
    const base = n * vertsPer;
    for (let r = 0; r < R; r++) {
      for (let j = 0; j < S; j++) {
        const a = (j / S) * Math.PI * 2;
        const up = Math.sin(a);
        col.copy(up > -0.15 ? (r % 3 === 0 ? band : back) : belly);
        if (up > -0.35 && up < -0.1) col.copy(back).lerp(belly, 0.5);
        const i = (base + r * V + j) * 3;
        colors[i] = col.r; colors[i + 1] = col.g; colors[i + 2] = col.b;
      }
      for (let q = 0; q < 3; q++) { const i = (base + r * V + S + q) * 3; colors[i] = fin.r; colors[i + 1] = fin.g; colors[i + 2] = fin.b; }
      if (r < R - 1) {
        for (let j = 0; j < S; j++) {
          const a = base + r * V + j, b = base + r * V + ((j + 1) % S), c = base + (r + 1) * V + j, d = base + (r + 1) * V + ((j + 1) % S);
          idx.push(a, c, b, b, c, d);
        }
        const f0 = base + r * V + S, f1 = base + (r + 1) * V + S;
        idx.push(f0, f0 + 1, f1, f0 + 1, f1 + 1, f1, f0 + 1, f0 + 2, f1 + 1, f0 + 2, f1 + 2, f1 + 1);
      }
    }
    // Cap the tail.
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const uv = new Float32Array(vertsPer * count * 2).fill(0.995);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(vertsPer * count > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  return { geometry, pos, nor };
}

/** Procedural serpent head (unit scale ≈ body radius 1), facing −Z, origin at the neck. */
export function serpentHead(look: SerpentLook, glow: GeoBuilder | null): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const back = look.back, belly = look.belly;
  b.sphere(1.25, 12, 9, { at: [0, 0.35, -0.9], scale: [1, 0.85, 1.35], color: back });
  b.cone(0.95, 2.6, 10, { at: [0, 0.15, -2.9], rot: [-Math.PI / 2, 0, 0], scale: [1, 0.62, 1], color: back });
  b.cone(0.8, 2.3, 10, { at: [0, -0.45, -2.6], rot: [-Math.PI / 2 - 0.18, 0, 0], scale: [0.95, 0.42, 1], color: belly });
  for (const s of [1, -1]) {
    b.cone(0.28, 2.4, 6, { at: [s * 0.62, 1.35, -0.3], rot: [0.95, 0, s * -0.35], color: 0xd9c9a0 });
    b.cone(0.22, 1.5, 5, { at: [s * 1.1, 0.4, -0.2], rot: [0.4, 0, s * -1.2], color: look.fin });
    for (let t = 0; t < 4; t++) b.cone(0.09, 0.42, 4, { at: [s * (0.42 - t * 0.04), -0.2, -3.2 + t * 0.55], rot: [Math.PI, 0, 0], color: 0xfffaf0 });
    if (glow) glow.sphere(0.24, 8, 6, { at: [s * 0.72, 0.72, -1.55], color: 0xff3b2f });
    else b.sphere(0.24, 8, 6, { at: [s * 0.72, 0.72, -1.55], color: 0xffd35e });
  }
  b.cone(0.5, 1.6, 4, { at: [0, 1.05, 0.3], rot: [-0.4, Math.PI / 4, 0], color: look.fin });
  return b.build();
}

interface WyrmSlot { id: number; trail: Trail; seen: number; }

export class Serpents {
  readonly group = new THREE.Group();
  readonly material: THREE.Material;
  readonly glow: THREE.Material;
  private readonly wyrmBody: THREE.Mesh;
  private readonly wyrmPos: Float32Array;
  private readonly wyrmNor: Float32Array;
  private readonly wyrmHeads: THREE.InstancedMesh;
  private readonly wyrmEyes: THREE.InstancedMesh;
  private readonly slots: (WyrmSlot | null)[];
  private readonly byId = new Map<number, WyrmSlot>();
  private frame = 0;
  private readonly heads = new Map<number, THREE.Matrix4>();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 0, -1);
  private readonly headPose: HeadPose = { headX: 0, headY: 0, headZ: 0, dirX: 0, dirY: 0, dirZ: -1 };

  constructor(readonly capacity = 24) {
    this.group.name = 'serpents';
    this.material = partMaterial('ships:serpent', { side: THREE.DoubleSide, rim: 0.5 });
    this.glow = glowMaterial('ships:serpent-eyes', 2);
    const { geometry, pos, nor } = buildBodyBuffers(WYRMLING_LOOK, capacity);
    this.wyrmPos = pos; this.wyrmNor = nor;
    this.wyrmBody = new THREE.Mesh(geometry, this.material);
    this.wyrmBody.frustumCulled = false;
    this.wyrmBody.name = 'wyrmling-bodies';
    geometry.setDrawRange(0, 0);
    const eyes = new GeoBuilder();
    const head = serpentHead(WYRMLING_LOOK, eyes);
    this.wyrmHeads = new THREE.InstancedMesh(head, this.material, capacity);
    this.wyrmEyes = new THREE.InstancedMesh(eyes.build(), this.glow, capacity);
    for (const m of [this.wyrmHeads, this.wyrmEyes]) { m.frustumCulled = false; m.count = 0; }
    this.slots = new Array(capacity).fill(null);
    this.group.add(this.wyrmBody, this.wyrmHeads, this.wyrmEyes);
    markInk(this.wyrmBody); markInk(this.wyrmHeads);
  }

  /** Renders all wyrmlings (poses from EnemyState). */
  updateWyrmlings(time: number, poses: readonly SerpentPose[], count: number, ocean: OceanServices): void {
    this.frame++;
    let n = 0;
    const V = WYRMLING_LOOK.rings * VERTS_PER_RING(WYRMLING_LOOK);
    const ringsIdx = (WYRMLING_LOOK.rings - 1) * (WYRMLING_LOOK.sides * 6 + 12);
    for (let pi = 0; pi < count; pi++) {
      const pose = poses[pi]!;
      let slot = this.byId.get(pose.id);
      if (!slot) {
        const free = this.slots.findIndex((s) => !s || s.id === 0);
        if (free < 0) continue;
        slot = this.slots[free] ?? { id: 0, trail: new Trail(64, 0.5), seen: 0 };
        slot.id = pose.id;
        slot.trail.reset(pose.x, pose.z, pose.heading);
        this.slots[free] = slot;
        this.byId.set(pose.id, slot);
      }
      slot.seen = this.frame;
      slot.trail.push(pose.x, pose.z);
    }
    // Compact visible serpents into the front of the buffer.
    for (let pi = 0; pi < count; pi++) {
      const pose = poses[pi]!;
      const slot = this.byId.get(pose.id);
      if (!slot || slot.seen !== this.frame || n >= this.capacity) continue;
      const h = writeBody(WYRMLING_LOOK, slot.trail, pose, time + pose.id * 0.37, ocean, this.wyrmPos, this.wyrmNor, n * V, 1, this.headPose);
      this.headMatrix(h, WYRMLING_LOOK.radius * 1.05, this.tmpM);
      this.wyrmHeads.setMatrixAt(n, this.tmpM);
      this.wyrmEyes.setMatrixAt(n, this.tmpM);
      col.setRGB(1 + pose.flash * 2, 1 + pose.flash * 2, 1 + pose.flash * 2);
      this.wyrmHeads.setColorAt(n, col);
      let heads = this.heads.get(pose.id);
      if (!heads) { heads = new THREE.Matrix4(); this.heads.set(pose.id, heads); }
      heads.copy(this.tmpM);
      if (n % 2 === this.frame % 2 && pose.submerged < 0.8) ocean.stampFoam(h.headX, h.headZ, 3, 0.25);
      n++;
    }
    for (const [id] of this.heads) if (!this.byId.has(id) || this.byId.get(id)!.seen !== this.frame) this.heads.delete(id);
    for (const [id, slot] of this.byId) if (slot.seen !== this.frame) { this.byId.delete(id); slot.id = 0; }
    const g = this.wyrmBody.geometry;
    g.setDrawRange(0, n * ringsIdx);
    this.wyrmBody.visible = n > 0;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = n > 0;
    (g.attributes.normal as THREE.BufferAttribute).needsUpdate = n > 0;
    for (const m of [this.wyrmHeads, this.wyrmEyes]) {
      m.count = n; m.visible = n > 0;
      if (n) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
  }

  /** Head transform: origin at the neck, −Z along the swim direction. */
  headMatrix(h: HeadPose, scale: number, out: THREE.Matrix4): THREE.Matrix4 {
    this.tmpDir.set(h.dirX, h.dirY, h.dirZ);
    this.tmpQ.setFromUnitVectors(this.up, this.tmpDir);
    return out.compose(this.tmpV.set(h.headX, h.headY, h.headZ), this.tmpQ, this.tmpS.setScalar(scale));
  }

  /** World transform of a rendered wyrmling head (for anchors). */
  headOf(id: number): THREE.Matrix4 | null { return this.heads.get(id) ?? null; }

  dispose(): void {
    this.wyrmBody.geometry.dispose(); this.wyrmHeads.geometry.dispose(); this.wyrmEyes.geometry.dispose();
    this.material.dispose(); this.glow.dispose();
  }
}

/** A single big serpent (the Tidewyrm boss body). */
export class SerpentBody {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  private readonly trail: Trail;
  private primed = false;
  readonly lastHead: HeadPose = { headX: 0, headY: 0, headZ: 0, dirX: 0, dirY: 0, dirZ: -1 };

  constructor(readonly look: SerpentLook, material: THREE.Material) {
    const { geometry, pos, nor } = buildBodyBuffers(look, 1);
    this.pos = pos; this.nor = nor;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.trail = new Trail(Math.ceil(look.length / 1.5) + 8, 1.5);
    markInk(this.mesh);
  }

  update(time: number, pose: SerpentPose, ocean: OceanServices): void {
    if (!this.primed) { this.trail.reset(pose.x, pose.z, pose.heading); this.primed = true; }
    this.trail.push(pose.x, pose.z);
    writeBody(this.look, this.trail, pose, time, ocean, this.pos, this.nor, 0, 1, this.lastHead);
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    // Foam where coils break the surface.
    if (pose.submerged < 0.9) {
      const V = VERTS_PER_RING(this.look);
      for (let r = 4; r < this.look.rings; r += 6) {
        const i = (r * V) * 3;
        const x = this.pos[i]!, y = this.pos[i + 1]!, z = this.pos[i + 2]!;
        if (Math.abs(y - ocean.heightAt(x, z)) < this.look.radius * 1.2) ocean.stampFoam(x, z, this.look.radius * 2.2, 0.4);
      }
    }
  }

  /** World point `s` (0 head … 1 tail) along the body centre line (approximate: ring vertex average). */
  pointAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    const r = Math.round(THREE.MathUtils.clamp(s, 0, 1) * (this.look.rings - 1));
    const V = VERTS_PER_RING(this.look);
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < this.look.sides; j++) { const i = (r * V + j) * 3; x += this.pos[i]!; y += this.pos[i + 1]!; z += this.pos[i + 2]!; }
    return out.set(x / this.look.sides, y / this.look.sides, z / this.look.sides);
  }

  dispose(): void { this.mesh.geometry.dispose(); }
}
