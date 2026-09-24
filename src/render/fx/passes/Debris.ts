/**
 * Chunky, countable debris: inked toon planks and splinters (instanced, one draw call). CPU-simulated so they
 * can land on the real water surface (OceanServices.heightAt), splash, float, drift and finally sink.
 * An immediate region renders static floating wreckage (burning wrecks) from hazard state.
 */
import * as THREE from 'three';
import { createToonMaterial, markInk } from '../../materials/toon';
import { rand, spread } from '../core/rand';
import { uploadRange } from '../core/ranges';

export type WaterHeight = (x: number, z: number) => number;
export type SplashHook = (x: number, z: number, size: number) => void;

const GRAVITY = 22;

function plankGeometry(): THREE.BufferGeometry {
  // A chunky plank with one splintered (pointed) end: 1 m long on X, reads at a distance.
  const g = new THREE.BoxGeometry(1, 0.2, 0.34, 3, 1, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (x > 0.49) { pos.setX(i, 0.5 + (pos.getZ(i) > 0 ? 0.08 : -0.02)); pos.setZ(i, pos.getZ(i) * 0.35); }
    if (x > 0.1 && x < 0.2) pos.setY(i, pos.getY(i) * 1.05);
  }
  g.computeVertexNormals();
  return g;
}

export class DebrisPass {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private n = 0;
  private immCount = 0;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly rx: Float32Array; private readonly ry: Float32Array; private readonly rz: Float32Array;
  private readonly wx: Float32Array; private readonly wy: Float32Array; private readonly wz: Float32Array;
  private readonly sx: Float32Array; private readonly sy: Float32Array; private readonly sz: Float32Array;
  private readonly age: Float32Array; private readonly life: Float32Array; private readonly floating: Uint8Array;
  private readonly cr: Float32Array; private readonly cg: Float32Array; private readonly cb: Float32Array;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly imms: Float32Array;
  splash: SplashHook | null = null;

  constructor(capacity: number, private readonly immCap: number) {
    this.cap = capacity;
    const total = capacity + immCap;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.rx = f(); this.ry = f(); this.rz = f(); this.wx = f(); this.wy = f(); this.wz = f();
    this.sx = f(); this.sy = f(); this.sz = f(); this.age = f(); this.life = f(); this.floating = new Uint8Array(capacity);
    this.cr = f(); this.cg = f(); this.cb = f();
    this.imms = new Float32Array(immCap * 9);
    const material = createToonMaterial({ color: 0xffffff, name: 'fx-debris', rim: 0.2 });
    this.mesh = new THREE.InstancedMesh(plankGeometry(), material, total);
    this.mesh.name = 'fx-debris';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.c.setRGB(1, 1, 1)); // create instanceColor up front (no recompile later)
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    markInk(this.mesh);
  }

  get active(): number { return this.n; }

  /** Spawns one plank (length metres). Colour is sRGB hex. */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, length: number, hex: number, life = 6): void {
    let i = this.n;
    if (i >= this.cap) {
      // Recycle the oldest-ish slot (the first) — keeps bursts visible under stress.
      i = (rand() * this.cap) | 0;
    } else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.rx[i] = rand() * 6.283; this.ry[i] = rand() * 6.283; this.rz[i] = rand() * 6.283;
    this.wx[i] = spread(14); this.wy[i] = spread(10); this.wz[i] = spread(14);
    const thick = 0.7 + rand() * 0.8;
    this.sx[i] = length; this.sy[i] = thick * Math.min(1.4, 0.55 + length * 0.35); this.sz[i] = thick * Math.min(1.5, 0.6 + length * 0.4);
    this.age[i] = 0; this.life[i] = life * (0.75 + rand() * 0.5); this.floating[i] = 0;
    this.c.setHex(hex);
    const shade = 0.82 + rand() * 0.3;
    this.cr[i] = this.c.r * shade; this.cg[i] = this.c.g * shade; this.cb[i] = this.c.b * shade;
  }

  /** Simulates and writes instance matrices for the simulated debris; then call imm() for static pieces. */
  update(dt: number, water: WaterHeight, time: number): void {
    const im = this.mesh;
    let i = 0;
    while (i < this.n) {
      this.age[i]! += dt;
      const age = this.age[i]!;
      const life = this.life[i]!;
      if (age >= life) { this.kill(i); continue; }
      const wy = water(this.px[i]!, this.pz[i]!);
      if (!this.floating[i]) {
        this.vy[i]! -= GRAVITY * dt;
        const drag = Math.exp(-0.35 * dt);
        this.vx[i]! *= drag; this.vz[i]! *= drag;
        this.px[i]! += this.vx[i]! * dt; this.py[i]! += this.vy[i]! * dt; this.pz[i]! += this.vz[i]! * dt;
        this.rx[i]! += this.wx[i]! * dt; this.ry[i]! += this.wy[i]! * dt; this.rz[i]! += this.wz[i]! * dt;
        if (this.py[i]! <= wy && this.vy[i]! < 0) {
          if (this.vy[i]! < -7 && this.splash) this.splash(this.px[i]!, this.pz[i]!, Math.min(1.4, 0.4 + this.sx[i]! * 0.3));
          this.floating[i] = 1;
          this.vx[i]! *= 0.3; this.vz[i]! *= 0.3; this.vy[i] = 0;
          this.wx[i]! *= 0.1; this.wy[i]! *= 0.3; this.wz[i]! *= 0.1;
        }
      } else {
        const drag = Math.exp(-1.2 * dt);
        this.vx[i]! *= drag; this.vz[i]! *= drag;
        this.px[i]! += this.vx[i]! * dt; this.pz[i]! += this.vz[i]! * dt;
        const sinkT = Math.max(0, age - (life - 1.4)) / 1.4;
        this.py[i] = wy + 0.05 + Math.sin(time * 2.1 + i) * 0.06 - sinkT * sinkT * 1.8;
        // settle flat (planks lie on the water)
        const settle = 1 - Math.exp(-3 * dt);
        this.rx[i]! += (Math.round(this.rx[i]! / Math.PI) * Math.PI - this.rx[i]!) * settle;
        this.rz[i]! += (Math.round(this.rz[i]! / Math.PI) * Math.PI - this.rz[i]!) * settle;
        this.ry[i]! += this.wy[i]! * dt;
      }
      this.e.set(this.rx[i]!, this.ry[i]!, this.rz[i]!);
      this.q.setFromEuler(this.e);
      const pop = Math.min(1, age * 12);
      this.s.set(this.sx[i]! * pop, this.sy[i]! * pop, this.sz[i]! * pop);
      this.p.set(this.px[i]!, this.py[i]!, this.pz[i]!);
      this.m.compose(this.p, this.q, this.s);
      im.setMatrixAt(i, this.m);
      im.setColorAt(i, this.c.setRGB(this.cr[i]!, this.cg[i]!, this.cb[i]!));
      i++;
    }
  }

  beginFrame(): void { this.immCount = 0; }

  /** Static piece (wreckage) for this frame. */
  imm(x: number, y: number, z: number, rx: number, ry: number, rz: number, length: number, thick: number, hex: number): void {
    if (this.immCount >= this.immCap) return;
    const o = this.immCount++ * 9;
    const d = this.imms;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = rx; d[o + 4] = ry; d[o + 5] = rz; d[o + 6] = length; d[o + 7] = thick; d[o + 8] = hex;
  }

  endFrame(): void {
    const im = this.mesh;
    const d = this.imms;
    for (let j = 0; j < this.immCount; j++) {
      const o = j * 9;
      this.e.set(d[o + 3]!, d[o + 4]!, d[o + 5]!);
      this.q.setFromEuler(this.e);
      this.p.set(d[o]!, d[o + 1]!, d[o + 2]!);
      this.s.set(d[o + 6]!, d[o + 7]!, d[o + 7]! * 1.4);
      this.m.compose(this.p, this.q, this.s);
      im.setMatrixAt(this.n + j, this.m);
      im.setColorAt(this.n + j, this.c.setHex(d[o + 8]!));
    }
    im.count = this.n + this.immCount;
    uploadRange(im.instanceMatrix, 0, im.count * 16);
    if (im.instanceColor) uploadRange(im.instanceColor, 0, im.count * 3);
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i === last) return;
    this.px[i] = this.px[last]!; this.py[i] = this.py[last]!; this.pz[i] = this.pz[last]!;
    this.vx[i] = this.vx[last]!; this.vy[i] = this.vy[last]!; this.vz[i] = this.vz[last]!;
    this.rx[i] = this.rx[last]!; this.ry[i] = this.ry[last]!; this.rz[i] = this.rz[last]!;
    this.wx[i] = this.wx[last]!; this.wy[i] = this.wy[last]!; this.wz[i] = this.wz[last]!;
    this.sx[i] = this.sx[last]!; this.sy[i] = this.sy[last]!; this.sz[i] = this.sz[last]!;
    this.age[i] = this.age[last]!; this.life[i] = this.life[last]!; this.floating[i] = this.floating[last]!;
    this.cr[i] = this.cr[last]!; this.cg[i] = this.cg[last]!; this.cb[i] = this.cb[last]!;
  }

  clear(): void { this.n = 0; this.immCount = 0; this.mesh.count = 0; }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
