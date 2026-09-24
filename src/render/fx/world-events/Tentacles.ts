/**
 * Kraken tentacles (EVENTS): one BufferGeometry rebuilt on the CPU every frame from spines the caller writes
 * (`add(spine, …)`), drawn with the shared toon material (vertex colours, wet highlight) and marked for ink, so the
 * arms read like the ships: cel bands, rim light, navy outlines. Rings are framed against a "ventral" direction so
 * the pale sucker side always faces the curl. One draw call (+ the ink prepass); no per-frame allocations.
 */
import * as THREE from 'three';
import { createToonMaterial, markInk } from '../../materials/toon';

/** Spine points per tentacle (callers fill Float32Array(SPINE * 3)). */
export const SPINE = 18;
const SIDES = 10;
const VERTS = SPINE * SIDES + 1;
const TRIS = (SPINE - 1) * SIDES * 2 + SIDES;

const COS = new Float32Array(SIDES);
const SIN = new Float32Array(SIDES);
for (let j = 0; j < SIDES; j++) { COS[j] = Math.cos((j / SIDES) * Math.PI * 2); SIN[j] = Math.sin((j / SIDES) * Math.PI * 2); }

const tmp = new THREE.Color();
function lin(hex: number): [number, number, number] { tmp.setHex(hex); return [tmp.r, tmp.g, tmp.b]; }
const DORSAL_BASE = lin(0x2c0f45);
const DORSAL_TIP = lin(0x8d2b62);
const VENTRAL_A = lin(0xf4bccb);
const VENTRAL_B = lin(0xc97d98);

function touch(attr: THREE.BufferAttribute, floats: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, floats);
  attr.needsUpdate = true;
}

export interface TentacleLook {
  /** Radius at the base and at the tip (m). */
  base: number;
  tip: number;
  /** 0..1 white flash (hit). */
  flash: number;
  /** Radius pulse (squeeze) multiplier. */
  swell: number;
}

export class Tentacles {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly col: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly nrmAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private count = 0;
  // Per-ring frame scratch.
  private readonly T = new Float32Array(3);
  private readonly N = new Float32Array(3);
  private readonly B = new Float32Array(3);

  constructor(readonly capacity: number) {
    const verts = capacity * VERTS;
    this.pos = new Float32Array(verts * 3);
    this.nrm = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 3);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.nrmAttr);
    this.geometry.setAttribute('color', this.colAttr);
    const index = new Uint16Array(capacity * TRIS * 3);
    let o = 0;
    for (let k = 0; k < capacity; k++) {
      const v0 = k * VERTS;
      for (let i = 0; i < SPINE - 1; i++) {
        for (let j = 0; j < SIDES; j++) {
          const a = v0 + i * SIDES + j, b = v0 + i * SIDES + ((j + 1) % SIDES);
          const c = a + SIDES, d = b + SIDES;
          index[o++] = a; index[o++] = b; index[o++] = c;
          index[o++] = b; index[o++] = d; index[o++] = c;
        }
      }
      const tip = v0 + SPINE * SIDES;
      const last = v0 + (SPINE - 1) * SIDES;
      for (let j = 0; j < SIDES; j++) {
        index[o++] = last + j; index[o++] = last + ((j + 1) % SIDES); index[o++] = tip;
      }
    }
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setDrawRange(0, 0);
    const material = createToonMaterial({ vertexColors: true, rim: 0.5, specular: 0.55, name: 'fx:kraken-tentacle' });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = 'fx-kraken-tentacles';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    markInk(this.mesh, { width: 1.1, crease: 0.35 });
  }

  begin(): void { this.count = 0; }

  /**
   * Adds one tentacle along `spine` (SPINE points, base first). (vx, vy, vz) is the ventral reference: the pale
   * sucker side turns toward it (usually the direction the arm curls or strikes).
   */
  add(spine: Float32Array, vx: number, vy: number, vz: number, look: TentacleLook): void {
    if (this.count >= this.capacity) return;
    const k = this.count++;
    const pos = this.pos, nrm = this.nrm, col = this.col;
    const T = this.T, N = this.N, B = this.B;
    let v = k * VERTS * 3;
    let nPrevX = 0, nPrevY = 0, nPrevZ = 1;
    const flash = Math.min(1, Math.max(0, look.flash));
    for (let i = 0; i < SPINE; i++) {
      const s = i / (SPINE - 1);
      const i0 = Math.max(0, i - 1) * 3, i1 = Math.min(SPINE - 1, i + 1) * 3;
      T[0] = spine[i1]! - spine[i0]!; T[1] = spine[i1 + 1]! - spine[i0 + 1]!; T[2] = spine[i1 + 2]! - spine[i0 + 2]!;
      let tl = Math.hypot(T[0], T[1], T[2]) || 1;
      T[0] /= tl; T[1] /= tl; T[2] /= tl;
      // N: the ventral reference made perpendicular to the spine (falls back to the previous ring's N).
      const dot = vx * T[0] + vy * T[1] + vz * T[2];
      N[0] = vx - dot * T[0]; N[1] = vy - dot * T[1]; N[2] = vz - dot * T[2];
      tl = Math.hypot(N[0], N[1], N[2]);
      if (tl < 1e-3) { N[0] = nPrevX; N[1] = nPrevY; N[2] = nPrevZ; }
      else { N[0] /= tl; N[1] /= tl; N[2] /= tl; }
      nPrevX = N[0]; nPrevY = N[1]; nPrevZ = N[2];
      // B = T × N.
      B[0] = T[1] * N[2] - T[2] * N[1]; B[1] = T[2] * N[0] - T[0] * N[2]; B[2] = T[0] * N[1] - T[1] * N[0];
      const bulge = s < 0.12 ? 1.08 : 1;
      const r = (look.base * Math.pow(1 - s, 0.85) + look.tip) * bulge * look.swell;
      const px = spine[i * 3]!, py = spine[i * 3 + 1]!, pz = spine[i * 3 + 2]!;
      const dr = DORSAL_BASE[0] + (DORSAL_TIP[0] - DORSAL_BASE[0]) * s;
      const dg = DORSAL_BASE[1] + (DORSAL_TIP[1] - DORSAL_BASE[1]) * s;
      const db = DORSAL_BASE[2] + (DORSAL_TIP[2] - DORSAL_BASE[2]) * s;
      const ventral = i % 2 === 0 ? VENTRAL_A : VENTRAL_B;
      for (let j = 0; j < SIDES; j++) {
        const nx = N[0] * COS[j]! + B[0] * SIN[j]!, ny = N[1] * COS[j]! + B[1] * SIN[j]!, nz = N[2] * COS[j]! + B[2] * SIN[j]!;
        pos[v] = px + nx * r; pos[v + 1] = py + ny * r; pos[v + 2] = pz + nz * r;
        nrm[v] = nx; nrm[v + 1] = ny; nrm[v + 2] = nz;
        const c = COS[j]!;
        const w = c <= 0.3 ? 0 : c >= 0.75 ? 1 : (c - 0.3) / 0.45;
        const cr = dr + (ventral[0] - dr) * w, cg = dg + (ventral[1] - dg) * w, cb = db + (ventral[2] - db) * w;
        col[v] = cr + (1.6 - cr) * flash; col[v + 1] = cg + (1.6 - cg) * flash; col[v + 2] = cb + (1.6 - cb) * flash;
        v += 3;
      }
    }
    // Tip vertex, a little past the last ring.
    const l = (SPINE - 1) * 3;
    pos[v] = spine[l]! + T[0] * look.tip * 1.5; pos[v + 1] = spine[l + 1]! + T[1] * look.tip * 1.5; pos[v + 2] = spine[l + 2]! + T[2] * look.tip * 1.5;
    nrm[v] = T[0]; nrm[v + 1] = T[1]; nrm[v + 2] = T[2];
    col[v] = DORSAL_TIP[0]; col[v + 1] = DORSAL_TIP[1]; col[v + 2] = DORSAL_TIP[2];
  }

  end(): void {
    const n = this.count;
    this.geometry.setDrawRange(0, n * TRIS * 3);
    if (n === 0) return;
    const floats = n * VERTS * 3;
    touch(this.posAttr, floats); touch(this.nrmAttr, floats); touch(this.colAttr, floats);
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
