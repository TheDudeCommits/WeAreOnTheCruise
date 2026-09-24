/**
 * Global instanced vegetation and flags (WORLD-owned): one InstancedMesh per prop variant for every island in
 * range, rebuilt only when the streamed set changes. Flags share one waving geometry that points downwind.
 */
import * as THREE from 'three';
import type { PropPlacement } from '../../world/plan';
import type { FlagInstance } from './kit';
import { propVariants, variantFor } from './vegetation';

const q = new THREE.Quaternion();
const qYaw = new THREE.Quaternion();
const axis = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const mat = new THREE.Matrix4();
const tint = new THREE.Color();

export class PropInstancer {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private capacity: number[] = [];

  constructor(private readonly material: THREE.Material, private readonly onCreate: (mesh: THREE.InstancedMesh) => void) {
    this.group.name = 'world-props';
    for (const v of propVariants()) {
      this.capacity.push(0);
      this.meshes.push(this.make(v.geometry, 256, v.key, v.kind !== 'bush'));
    }
  }

  private make(geometry: THREE.BufferGeometry, capacity: number, name: string, shadows: boolean): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    mesh.name = `props:${name}`;
    mesh.count = 0;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, tint.setRGB(1, 1, 1));
    this.group.add(mesh);
    this.onCreate(mesh);
    return mesh;
  }

  /** Rewrites every instance from the given placement lists. */
  rebuild(lists: readonly (readonly PropPlacement[])[]): number {
    const all = propVariants();
    const counts = new Array<number>(all.length).fill(0);
    for (const list of lists) for (const p of list) counts[variantFor(p.kind, p.variant)]!++;
    for (let v = 0; v < all.length; v++) {
      let mesh = this.meshes[v]!;
      if (counts[v]! > mesh.instanceMatrix.count) {
        // Grow: replace the mesh with a larger buffer.
        this.group.remove(mesh);
        mesh.dispose();
        const cap = Math.max(counts[v]!, mesh.instanceMatrix.count * 2);
        mesh = this.make(all[v]!.geometry, cap, all[v]!.key, all[v]!.kind !== 'bush');
        this.meshes[v] = mesh;
      }
      mesh.count = 0;
    }
    for (const list of lists) {
      for (const p of list) {
        const v = variantFor(p.kind, p.variant);
        const mesh = this.meshes[v]!;
        const i = mesh.count++;
        qYaw.setFromAxisAngle(up, p.yaw);
        axis.set(Math.cos(p.leanYaw), 0, -Math.sin(p.leanYaw));
        q.setFromAxisAngle(axis, p.lean).multiply(qYaw);
        mesh.setMatrixAt(i, mat.compose(pos.set(p.x, p.y, p.z), q, scl.setScalar(p.scale)));
        const k = 0.86 + p.tint * 0.26;
        mesh.setColorAt(i, tint.setRGB(k * (0.96 + p.variant * 0.08), k, k * (0.94 + (1 - p.tint) * 0.08)));
      }
    }
    let total = 0;
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.visible = mesh.count > 0;
      total += mesh.count;
    }
    return total;
  }

  dispose(): void { for (const m of this.meshes) m.dispose(); }
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
