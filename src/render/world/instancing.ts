/**
 * Global instanced vegetation and flags (WORLD-owned): one InstancedMesh per prop variant for every island in
 * range, rebuilt only when the streamed set changes. Flags share one waving geometry that points downwind.
 */
import * as THREE from 'three';
import type { PropPlacement } from '../../world/plan';
import type { FlagInstance } from './kit';
import { activeHost, makeShadowProxy } from '../app/RendererHost';
import { propLowGeometries, propVariants, variantFor } from './vegetation';

const q = new THREE.Quaternion();
const qYaw = new THREE.Quaternion();
const axis = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const mat = new THREE.Matrix4();
const tint = new THREE.Color();

/**
 * PERF: trees beyond this distance from the focus draw their low-detail geometry (about a third of the triangles);
 * the active quality tier's `propDetail` overrides it. Shadows come from one shadow-only low-detail proxy per variant;
 * detailed trees never cast.
 */
export const PROP_NEAR = 300;

/** Tree detail distance for the active quality tier. */
export function propDetailDistance(): number { return activeHost()?.quality.propDetail ?? PROP_NEAR; }

interface PropSlot {
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  /** Shadow-only caster (low geometry) for every instance of the variant; null for non-casting variants (bushes). */
  shadow: THREE.InstancedMesh | null;
}

export class PropInstancer {
  readonly group = new THREE.Group();
  private slots: PropSlot[] = [];
  /** Instances per tier after the last rebuild (QA). */
  readonly stats = { near: 0, far: 0 };

  constructor(private readonly material: THREE.Material, private readonly onCreate: (mesh: THREE.InstancedMesh) => void) {
    this.group.name = 'world-props';
    const lows = propLowGeometries();
    propVariants().forEach((v, i) => {
      const casts = v.kind !== 'bush';
      const near = this.make(v.geometry, 256, `${v.key}`);
      const far = this.make(lows[i]!, 256, `${v.key}:far`);
      this.slots.push({ near, far, shadow: casts ? this.proxy(lows[i]!, 512, v.key) : null });
    });
  }

  private make(geometry: THREE.BufferGeometry, capacity: number, name: string): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    mesh.name = `props:${name}`;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, tint.setRGB(1, 1, 1));
    this.group.add(mesh);
    this.onCreate(mesh);
    return mesh;
  }

  /** Shadow-only low-detail caster for every instance of a variant (one draw call in the shadow pass). */
  private proxy(geometry: THREE.BufferGeometry, capacity: number, key: string): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    mesh.name = `props:${key}:shadow`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    makeShadowProxy(mesh);
    this.group.add(mesh);
    return mesh;
  }

  /** Replaces a tier mesh (or the shadow proxy) with a larger buffer. */
  private grow(slot: PropSlot, tier: 'near' | 'far' | 'shadow', needed: number, v: number): void {
    const old = slot[tier];
    if (!old) return;
    const cap = Math.max(needed, old.instanceMatrix.count * 2);
    this.group.remove(old);
    old.dispose();
    const variant = propVariants()[v]!;
    if (tier === 'shadow') slot.shadow = this.proxy(propLowGeometries()[v]!, cap, variant.key);
    else slot[tier] = this.make(tier === 'near' ? variant.geometry : propLowGeometries()[v]!, cap, tier === 'near' ? variant.key : `${variant.key}:far`);
  }

  /** Rewrites every instance from the given placement lists; trees within PROP_NEAR of (fx, fz) get full detail. */
  rebuild(lists: readonly (readonly PropPlacement[])[], fx = 0, fz = 0): number {
    const all = propVariants();
    const nearCounts = new Array<number>(all.length).fill(0), farCounts = new Array<number>(all.length).fill(0);
    const nearDistance = propDetailDistance();
    const near2 = nearDistance * nearDistance;
    const isNear = (p: PropPlacement) => (p.x - fx) * (p.x - fx) + (p.z - fz) * (p.z - fz) < near2;
    for (const list of lists) for (const p of list) (isNear(p) ? nearCounts : farCounts)[variantFor(p.kind, p.variant)]!++;
    for (let v = 0; v < all.length; v++) {
      const slot = this.slots[v]!;
      if (nearCounts[v]! > slot.near.instanceMatrix.count) this.grow(slot, 'near', nearCounts[v]!, v);
      if (farCounts[v]! > slot.far.instanceMatrix.count) this.grow(slot, 'far', farCounts[v]!, v);
      if (slot.shadow && nearCounts[v]! + farCounts[v]! > slot.shadow.instanceMatrix.count) this.grow(slot, 'shadow', nearCounts[v]! + farCounts[v]!, v);
      slot.near.count = 0; slot.far.count = 0;
      if (slot.shadow) slot.shadow.count = 0;
    }
    for (const list of lists) {
      for (const p of list) {
        const v = variantFor(p.kind, p.variant);
        const slot = this.slots[v]!;
        const mesh = isNear(p) ? slot.near : slot.far;
        const i = mesh.count++;
        qYaw.setFromAxisAngle(up, p.yaw);
        axis.set(Math.cos(p.leanYaw), 0, -Math.sin(p.leanYaw));
        q.setFromAxisAngle(axis, p.lean).multiply(qYaw);
        mesh.setMatrixAt(i, mat.compose(pos.set(p.x, p.y, p.z), q, scl.setScalar(p.scale)));
        if (slot.shadow) slot.shadow.setMatrixAt(slot.shadow.count++, mat);
        const k = 0.86 + p.tint * 0.26;
        mesh.setColorAt(i, tint.setRGB(k * (0.96 + p.variant * 0.08), k, k * (0.94 + (1 - p.tint) * 0.08)));
      }
    }
    let total = 0;
    this.stats.near = 0; this.stats.far = 0;
    for (const slot of this.slots) {
      for (const tier of ['near', 'far'] as const) {
        const mesh = slot[tier];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.visible = mesh.count > 0;
        total += mesh.count;
        this.stats[tier] += mesh.count;
      }
      const shadow = slot.shadow;
      if (shadow) {
        shadow.instanceMatrix.needsUpdate = true;
        shadow.visible = shadow.count > 0;
        if (shadow.count > 0) shadow.computeBoundingSphere();
      }
    }
    return total;
  }

  dispose(): void {
    for (const slot of this.slots) for (const m of [slot.near, slot.far, slot.shadow]) m?.dispose();
  }
}

/** Instanced waving flags that stream downwind. */
export class FlagInstancer {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly base: Float32Array;
  private flags: FlagInstance[] = [];
  private windDir = NaN;

  constructor(material: THREE.Material, capacity = 256) {
    this.geometry = new THREE.PlaneGeometry(2, 1.25, 8, 3);
    this.geometry.translate(1, 0, 0);
    this.base = (this.geometry.getAttribute('position') as THREE.BufferAttribute).array.slice() as Float32Array;
    this.mesh = new THREE.InstancedMesh(this.geometry, material, capacity);
    this.mesh.name = 'world-flags';
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  rebuild(lists: readonly (readonly FlagInstance[])[]): void {
    this.flags = [];
    for (const l of lists) for (const f of l) if (this.flags.length < this.mesh.instanceMatrix.count) this.flags.push(f);
    this.windDir = NaN;
  }

  update(time: number, windDir: number): void {
    // Wave the shared cloth.
    const attr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    for (let i = 0; i < attr.count; i++) {
      const x = this.base[i * 3]!, y = this.base[i * 3 + 1]!;
      a[i * 3 + 2] = Math.sin(x * 2.6 - time * 6.5 + y * 0.8) * 0.16 * x;
      a[i * 3 + 1] = y - x * x * 0.03;
    }
    attr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    if (windDir === this.windDir) return;
    this.windDir = windDir;
    // Fly points downwind: wind blows toward (sin w, cos w) in the outline convention.
    const yaw = Math.atan2(-Math.cos(windDir), Math.sin(windDir));
    qYaw.setFromAxisAngle(up, yaw);
    for (let i = 0; i < this.flags.length; i++) {
      const f = this.flags[i]!;
      this.mesh.setMatrixAt(i, mat.compose(pos.set(f.x, f.y - 0.62 * f.scale, f.z), qYaw, scl.setScalar(f.scale)));
    }
    this.mesh.count = this.flags.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void { this.geometry.dispose(); this.mesh.dispose(); }
}
