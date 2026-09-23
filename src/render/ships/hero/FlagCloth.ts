/**
 * Waving cloth batch (SHIPS-owned): several flags/pennants in ONE mesh (one draw call), animated on the CPU
 * (a few hundred vertices), so it works with any toon shader without injection. Each patch is pinned at its hoist
 * (local origin, +Y up) and flies along +Z (aft); a per-patch scale pops it in. No per-frame allocations.
 */
import * as THREE from 'three';
import { createToonMaterial } from '../../materials/toon';

export interface ClothPatch {
  width: number;
  height: number;
  /** UV rectangle in the cloth texture: [u0, v0, u1, v1]. */
  uv: [number, number, number, number];
  /** Hoist transform (local to the batch mesh). */
  anchor: THREE.Matrix4;
  phase: number;
  /** Flutter amount multiplier (pennants whip more). */
  flutter: number;
  scale: number;
  /** Fly direction around the hoist's vertical axis (0 = aft/+Z, +π/2 = starboard). */
  yaw?: number;
}

interface PatchRange { patch: ClothPatch; start: number; cols: number; rows: number; base: Float32Array }

const tmpV = new THREE.Vector3();

export class ClothBatch {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.Material;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly ranges: PatchRange[] = [];
  private position!: THREE.BufferAttribute;
  private normal!: THREE.BufferAttribute;
  private local!: Float32Array;
  private readonly patchList: ClothPatch[];

  constructor(texture: THREE.Texture, patches: ClothPatch[], segX = 14, segY = 7) {
    this.patchList = patches;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const patch of patches) {
      const cols = segX + 1, rows = segY + 1;
      const start = pos.length / 3;
      const base = new Float32Array(cols * rows * 3);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const u = c / segX, v = r / segY;
          // Local cloth space: hoist at z = 0, fly toward +Z, top at y = 0 hanging down to −height.
          const k = (r * cols + c) * 3;
          base[k] = 0; base[k + 1] = -v * patch.height; base[k + 2] = u * patch.width;
          pos.push(0, 0, 0);
          uv.push(patch.uv[0] + (patch.uv[2] - patch.uv[0]) * u, patch.uv[3] - (patch.uv[3] - patch.uv[1]) * v);
        }
      }
      for (let r = 0; r < segY; r++) for (let c = 0; c < segX; c++) {
        const a = start + r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
      this.ranges.push({ patch, start, cols, rows, base });
    }
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.geometry.setIndex(idx);
    this.position = this.geometry.attributes.position as THREE.BufferAttribute;
    this.normal = this.geometry.attributes.normal as THREE.BufferAttribute;
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.normal.setUsage(THREE.DynamicDrawUsage);
    this.local = new Float32Array(pos.length);
    this.material = createToonMaterial({ map: texture, side: THREE.DoubleSide, rim: 0.2, name: 'ships:cloth' });
    this.material.alphaTest = 0.5;
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  get patches(): readonly ClothPatch[] { return this.patchList; }

  /** `speed` (m/s) makes the cloth stream and snap harder. */
  update(time: number, speed: number): void {
    const out = this.position.array as Float32Array;
    const local = this.local;
    const n = this.normal.array as Float32Array;
    const stream = THREE.MathUtils.clamp(0.35 + speed / 28, 0.35, 1.15);
    let visible = false;
    for (const range of this.ranges) {
      const { patch, start, cols, rows, base } = range;
      const s = patch.scale;
      if (s > 0.001) visible = true;
      const t = time * (3.2 + stream * 2.4) + patch.phase;
      const w = patch.width;
      const cy = Math.cos(patch.yaw ?? 0), sy = Math.sin(patch.yaw ?? 0);
      for (let i = 0; i < cols * rows; i++) {
        const by = base[i * 3 + 1]!, bz = base[i * 3 + 2]!;
        const u = bz / w;
        const wave = Math.sin(u * 7.5 - t) * 0.55 + Math.sin(u * 13 - t * 1.7 + by * 0.8) * 0.22;
        const amp = w * 0.085 * u * (1.25 - stream * 0.35) * patch.flutter;
        const droop = (1 - stream) * u * u * patch.height * 0.35;
        const k = (start + i) * 3;
        const lx = wave * amp * s, lz = bz * (0.96 + 0.04 * Math.cos(u * 6 - t)) * s;
        local[k] = lx * cy + lz * sy;
        local[k + 1] = (by - droop) * s;
        local[k + 2] = -lx * sy + lz * cy;
        tmpV.set(local[k]!, local[k + 1]!, local[k + 2]!).applyMatrix4(patch.anchor);
        out[k] = tmpV.x; out[k + 1] = tmpV.y; out[k + 2] = tmpV.z;
      }
      // Grid normals from neighbour differences.
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = start + r * cols + c;
        const iL = start + r * cols + Math.max(0, c - 1), iR = start + r * cols + Math.min(cols - 1, c + 1);
        const iU = start + Math.max(0, r - 1) * cols + c, iD = start + Math.min(rows - 1, r + 1) * cols + c;
        const ax = out[iR * 3]! - out[iL * 3]!, ay = out[iR * 3 + 1]! - out[iL * 3 + 1]!, az = out[iR * 3 + 2]! - out[iL * 3 + 2]!;
        const bx = out[iU * 3]! - out[iD * 3]!, by2 = out[iU * 3 + 1]! - out[iD * 3 + 1]!, bz2 = out[iU * 3 + 2]! - out[iD * 3 + 2]!;
        let nx = ay * bz2 - az * by2, ny = az * bx - ax * bz2, nz = ax * by2 - ay * bx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        n[i * 3] = nx; n[i * 3 + 1] = ny; n[i * 3 + 2] = nz;
      }
    }
    this.mesh.visible = visible;
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
  }

  dispose(): void { this.geometry.dispose(); this.material.dispose(); }
}
