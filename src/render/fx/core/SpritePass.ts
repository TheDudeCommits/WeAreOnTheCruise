/**
 * Instanced billboard pass (one draw call) over an InstancePool. Used by the cel sprites (smoke, fire, water,
 * dust), the additive sprites (flashes, sparks, glints) and the projectile heads — they differ only in their
 * fragment shader and render state.
 */
import * as THREE from 'three';
import { InstancePool } from './InstancePool';
import { rand } from './rand';

export const SPRITE_STRIDE = 28;
export const SPRITE_LIFE_OFFSET = 7;

/** Billboard orientation. */
export const Mode = { Screen: 0, Upright: 1, Velocity: 2 } as const;

/** Mutable spawn description; filled with chainable setters, then written by SpritePass.emit/imm. */
export class SpriteSpec {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  life = 1;
  ax = 0; ay = 0; az = 0;
  drag = 0;
  size0 = 1; size1 = 1;
  rot = 0; spin = 0;
  shape = 0; pal = 0; seed = 0; mode = 0; pivot = false;
  stretch = 1; speedStretch = 0; grow = 1; erode = 0.55;
  r = 1; g = 1; b = 1; intensity = 1;
  delay = 0;

  reset(): this {
    this.x = this.y = this.z = 0; this.vx = this.vy = this.vz = 0; this.life = 1;
    this.ax = this.ay = this.az = 0; this.drag = 0; this.size0 = this.size1 = 1; this.rot = 0; this.spin = 0;
    this.shape = 0; this.pal = 0; this.seed = rand(); this.mode = 0; this.pivot = false;
    this.stretch = 1; this.speedStretch = 0; this.grow = 1; this.erode = 0.55;
    this.r = this.g = this.b = 1; this.intensity = 1; this.delay = 0;
    return this;
  }
  at(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  vel(x: number, y: number, z: number): this { this.vx = x; this.vy = y; this.vz = z; return this; }
  /** Constant acceleration (gravity); clears drag. */
  accel(x: number, y: number, z: number): this { this.ax = x; this.ay = y; this.az = z; this.drag = 0; return this; }
  /** Linear drag toward a terminal velocity (wind drift / buoyant rise). */
  dragTo(k: number, tx: number, ty: number, tz: number): this { this.drag = k; this.ax = tx; this.ay = ty; this.az = tz; return this; }
  sized(s0: number, s1: number, grow = 1): this { this.size0 = s0; this.size1 = s1; this.grow = grow; return this; }
  rotate(r: number, spin = 0): this { this.rot = r; this.spin = spin; return this; }
  look(shape: number, pal: number, mode = 0, pivot = false): this { this.shape = shape; this.pal = pal; this.mode = mode; this.pivot = pivot; return this; }
  stretched(s: number, perSpeed = 0): this { this.stretch = s; this.speedStretch = perSpeed; return this; }
  tint(r: number, g: number, b: number): this { this.r = r; this.g = g; this.b = b; return this; }
  bright(i: number): this { this.intensity = i; return this; }
  lived(life: number, erode = this.erode): this { this.life = life; this.erode = erode; return this; }
  after(delay: number): this { this.delay = delay; return this; }
}

export class SpritePass {
  readonly mesh: THREE.Mesh;
  readonly pool: InstancePool;
  readonly spec = new SpriteSpec();
  readonly geometry: THREE.InstancedBufferGeometry;
  /** FX clock (seconds) used as spawn time. */
  clock = 0;
  budgetScale = 1;

  constructor(name: string, readonly material: THREE.ShaderMaterial, ringCap: number, immCap: number) {
    this.pool = new InstancePool(SPRITE_STRIDE, ringCap, immCap);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const names = ['iA', 'iB', 'iC', 'iD', 'iE', 'iF', 'iG'];
    for (let i = 0; i < names.length; i++) this.pool.attach(g, names[i]!, 4, i * 4);
    g.instanceCount = 0;
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Writes the current spec into the ring. */
  emit(): void {
    const o = this.pool.allocRing();
    if (o >= 0) this.write(o, this.clock + this.spec.delay);
  }

  /** Writes the current spec as an immediate instance of age `age` seconds. */
  imm(age = 0): boolean {
    const o = this.pool.allocImm();
    if (o < 0) return false;
    this.write(o, this.clock - age);
    return true;
  }

  private write(o: number, t0: number): void {
    const d = this.pool.data;
    const s = this.spec;
    d[o] = s.x; d[o + 1] = s.y; d[o + 2] = s.z; d[o + 3] = t0;
    d[o + 4] = s.vx; d[o + 5] = s.vy; d[o + 6] = s.vz; d[o + 7] = s.life;
    d[o + 8] = s.ax; d[o + 9] = s.ay; d[o + 10] = s.az; d[o + 11] = s.drag;
    d[o + 12] = s.size0; d[o + 13] = s.size1; d[o + 14] = s.rot; d[o + 15] = s.spin;
    d[o + 16] = s.shape; d[o + 17] = s.pal; d[o + 18] = s.seed; d[o + 19] = s.mode + (s.pivot ? 4 : 0);
    d[o + 20] = s.stretch; d[o + 21] = s.speedStretch; d[o + 22] = s.grow; d[o + 23] = s.erode;
    d[o + 24] = s.r; d[o + 25] = s.g; d[o + 26] = s.b; d[o + 27] = s.intensity;
  }

  beginFrame(clock: number): void { this.clock = clock; this.pool.beginFrame(); }

  endFrame(): void { this.geometry.instanceCount = this.pool.flush(); }

  clear(): void { this.pool.clearRing(SPRITE_LIFE_OFFSET); }

  dispose(): void { this.geometry.dispose(); this.material.dispose(); }
}
