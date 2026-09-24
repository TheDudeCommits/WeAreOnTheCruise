/**
 * The sakuga effect library: every composite effect is built here from the passes, following the Grand Line
 * Cel FX rules — designed silhouettes (starbursts, crown splashes, mushroom smoke, spiral whirls, plank
 * shards), inked cel smoke that erodes, additive HDR cores that last 2–4 frames, and anticipation → fast
 * ease-out burst → short hang → settle timing (strong drag toward a terminal drift does the burst/hang).
 *
 * Every function is allocation-free; `delay` staggers a component without a scheduler (ring particles with a
 * future spawn time stay hidden until then).
 */
import { CelPal, GlowPal } from './core/palette';
import { hash01, rand, range, spread } from './core/rand';
import { Mode } from './core/SpritePass';
import type { FxKit } from './Kit';
import { Cel } from './passes/CelSprites';
import { Decal } from './passes/Decals';
import { Glow } from './passes/GlowSprites';

export type ExplosionKind = 'small' | 'medium' | 'large' | 'fire' | 'powder' | 'mine' | 'mortar' | 'lightning' | 'water';

const TAU = Math.PI * 2;
const WOOD = [0x8a5a33, 0x6b4226, 0xa8763e, 0x5c3a22, 0x9b6a3c] as const;
const CHARRED = 0x3a2a24;
const WHITE = 0xffffff;
const FOAM_SHADOW = 0x8fc3d9;

/** Scratch polyline for lightning (max 65 points). */
const boltPts = new Float32Array(65 * 3);

export class Sakuga {
  constructor(private readonly k: FxKit) {}

  // ───────────────────────── helpers ─────────────────────────

  wy(x: number, z: number): number { return this.k.water.height(x, z); }

  private n(count: number, min = 1): number { return Math.max(min, Math.round(count * this.k.q)); }

  private distToFocus(x: number, z: number): number { return Math.hypot(x - this.k.focusX, z - this.k.focusZ); }

  private wood(): number { return WOOD[(rand() * WOOD.length) | 0]!; }

  // ───────────────────────── primitives ─────────────────────────

  burst(x: number, y: number, z: number, size: number, pal: number, life = 0.07, delay = 0, intensity = 1): void {
    const g = this.k.glow; const s = g.spec.reset();
    s.at(x, y, z).look(Glow.Burst, pal).sized(size, size * 1.18, 2).rotate(rand() * TAU).lived(life).after(delay).bright(intensity);
    g.emit();
  }

  dirFlash(x: number, y: number, z: number, dx: number, dy: number, dz: number, size: number, pal: number, life = 0.08, delay = 0): void {
    const g = this.k.glow; const s = g.spec.reset();
    s.at(x, y, z).vel(dx * 0.01, dy * 0.01, dz * 0.01).look(Glow.DirFlash, pal, Mode.Velocity, true)
      .sized(size, size * 1.15, 2).stretched(1.35).lived(life).after(delay);
    g.emit();
  }

  soft(x: number, y: number, z: number, size: number, pal: number, life: number, intensity: number, delay = 0): void {
    const g = this.k.glow; const s = g.spec.reset();
    s.at(x, y, z).look(Glow.Soft, pal).sized(size, size * 1.2, 2).lived(life).bright(intensity).after(delay);
    g.emit();
  }

  ring(x: number, y: number, z: number, size0: number, size1: number, pal: number, life: number, intensity = 1, delay = 0): void {
    const g = this.k.glow; const s = g.spec.reset();
    s.at(x, y, z).look(Glow.Ring, pal).sized(size0, size1, 3).lived(life).bright(intensity).after(delay);
    g.emit();
  }

  sparks(x: number, y: number, z: number, count: number, speed: number, pal: number, bx = 0, by = 0.4, bz = 0, bias = 0.5, life = 0.4, delay = 0, size = 0.45): void {
    const g = this.k.glow;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      let dx = spread(1), dy = spread(1), dz = spread(1);
      dx = dx * (1 - bias) + bx * bias; dy = dy * (1 - bias) + by * bias + 0.2; dz = dz * (1 - bias) + bz * bias;
      const l = Math.hypot(dx, dy, dz) || 1;
      const v = speed * range(0.55, 1.15);
      const s = g.spec.reset();
      s.at(x, y, z).vel(dx / l * v, dy / l * v, dz / l * v).accel(0, -22, 0).look(Glow.Spark, pal, Mode.Velocity)
        .sized(size, size * 0.8).stretched(1, 0.09).lived(life * range(0.7, 1.2)).after(delay);
      g.emit();
    }
    this.k.spawned += n;
  }

  embers(x: number, y: number, z: number, count: number, spreadR: number, delay = 0): void {
    const g = this.k.glow;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const s = g.spec.reset();
      s.at(x + spread(spreadR), y + spread(spreadR * 0.5), z + spread(spreadR)).vel(spread(6), range(4, 12), spread(6))
        .dragTo(1.6, this.k.windX, range(2, 4), this.k.windZ).look(Glow.Ember, GlowPal.Ember).sized(0.55, 0.3)
        .lived(range(1, 2)).after(delay + rand() * 0.15);
      g.emit();
    }
  }

  /** Cel smoke puffs bursting along (vx,vy,vz), hanging, then drifting with the wind and rising. */
  smoke(x: number, y: number, z: number, count: number, size0: number, size1: number, pal: number, life: number,
    vx: number, vy: number, vz: number, spreadV: number, rise: number, radius: number, delay = 0, erode = 0.35): void {
    const c = this.k.cel;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const s = c.spec.reset();
      s.at(x + spread(radius), y + spread(radius * 0.5), z + spread(radius))
        .vel(vx + spread(spreadV), vy + spread(spreadV * 0.5), vz + spread(spreadV))
        .dragTo(2.8, this.k.windX, rise * range(0.7, 1.3), this.k.windZ)
        .look(Cel.Puff, pal).sized(size0 * range(0.8, 1.2), size1 * range(0.75, 1.25), 3)
        .rotate(rand() * TAU, spread(0.25)).lived(life * range(0.8, 1.25), erode).after(delay + rand() * 0.05);
      c.emit();
    }
    this.k.spawned += n;
  }

  fireballs(x: number, y: number, z: number, count: number, size: number, radius: number, speed: number, life: number, delay = 0, pal: number = CelPal.Fire): void {
    const c = this.k.cel;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      let dx = spread(1), dy = rand() * 0.9 + 0.1, dz = spread(1);
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      const v = speed * range(0.5, 1.1);
      const s = c.spec.reset();
      s.at(x + dx * radius * rand(), y + dy * radius * rand() * 0.6, z + dz * radius * rand())
        .vel(dx * v, dy * v, dz * v).dragTo(5, this.k.windX * 0.5, 3.2, this.k.windZ * 0.5)
        .look(Cel.Fireball, pal).sized(size * 0.45, size * range(0.8, 1.25), 4).rotate(rand() * TAU, spread(0.8))
        .lived(life * range(0.8, 1.2), 0.42).after(delay + rand() * 0.06);
      c.emit();
    }
    this.k.spawned += n;
  }

  flames(x: number, y: number, z: number, count: number, size: number, radius: number, life: number, delay = 0, pal: number = CelPal.Fire): void {
    const c = this.k.cel;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const s = c.spec.reset();
      s.at(x + spread(radius), y, z + spread(radius)).vel(spread(1), range(2, 5), spread(1)).dragTo(3, this.k.windX * 0.3, 2.5, this.k.windZ * 0.3)
        .look(Cel.Flame, pal, Mode.Upright, true).sized(size * 0.5, size * range(0.8, 1.2), 3).stretched(1.35)
        .lived(life * range(0.75, 1.25), 0.55).after(delay + rand() * life * 0.5);
      c.emit();
    }
    this.k.spawned += n;
  }

  chunks(x: number, y: number, z: number, count: number, speed: number, pal: number, size = 0.7, delay = 0): void {
    const c = this.k.cel;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const s = c.spec.reset();
      s.at(x, y, z).vel(spread(speed), range(0.5, 1.2) * speed, spread(speed)).accel(0, -24, 0)
        .look(Cel.Chunk, pal).sized(size * range(0.6, 1.3), size * 0.8).rotate(rand() * TAU, spread(12))
        .lived(range(0.6, 1.1), 0.75).after(delay);
      c.emit();
    }
  }

  droplets(x: number, y: number, z: number, count: number, speed: number, up: number, size: number, delay = 0, life = 1.0): void {
    const c = this.k.cel;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const s = c.spec.reset();
      s.at(x + spread(1), y, z + spread(1)).vel(spread(speed), up * range(0.55, 1.15), spread(speed)).accel(0, -24, 0)
        .look(Cel.Droplet, CelPal.Water, Mode.Velocity).sized(size * range(0.6, 1.3), size * 0.8).stretched(1, 0.05)
        .lived(life * range(0.75, 1.3), 0.78).after(delay + rand() * 0.04);
      c.emit();
    }
    this.k.spawned += n;
  }

  crown(x: number, z: number, radius: number, count: number, speed: number, size: number, delay = 0): void {
    const c = this.k.cel;
    const wy = this.wy(x, z);
    const n = this.n(count, 4);
    const a0 = rand() * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU + spread(0.25);
      const ca = Math.cos(a), sa = Math.sin(a);
      const s = c.spec.reset();
      s.at(x + ca * radius, wy - 0.2, z + sa * radius).vel(ca * speed * 0.45, speed * range(0.85, 1.2), sa * speed * 0.45).accel(0, -28, 0)
        .look(Cel.Spike, CelPal.Water, Mode.Velocity, true).sized(size * 0.8, size * range(0.9, 1.2), 3).stretched(2.3)
        .lived(range(0.5, 0.68), 0.5).after(delay);
      c.emit();
    }
  }

  column(x: number, z: number, width: number, stretch: number, life: number, delay = 0, pal: number = CelPal.Water): void {
    const c = this.k.cel;
    const s = c.spec.reset();
    s.at(x, this.wy(x, z) - 0.5, z).look(Cel.Column, pal, Mode.Upright, true).sized(width * 0.45, width, 5).stretched(stretch)
      .lived(life, 0.52).after(delay);
    c.emit();
  }

  sheet(x: number, y: number, z: number, width: number, stretch: number, life: number, vx = 0, vz = 0, delay = 0): void {
    const c = this.k.cel;
    const s = c.spec.reset();
    s.at(x, y, z).vel(vx, 0, vz).dragTo(4, 0, 0, 0).look(Cel.Sheet, CelPal.Water, Mode.Upright, true).sized(width * 0.55, width, 4)
      .stretched(stretch).lived(life, 0.45).after(delay);
    c.emit();
  }

  bubbles(x: number, z: number, count: number, radius: number, size: number, delay = 0): void {
    const c = this.k.cel;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const bx = x + spread(radius), bz = z + spread(radius);
      const s = c.spec.reset();
      s.at(bx, this.wy(bx, bz) + 0.15, bz).vel(0, range(0.3, 0.9), 0).dragTo(1.5, 0, 0.2, 0).look(Cel.Bubble, CelPal.Foam)
        .sized(size * 0.5, size * range(0.7, 1.3), 2).lived(range(0.5, 1.0), 0.5).after(delay + rand() * 0.3);
      c.emit();
    }
  }

  foam(x: number, z: number, radius: number, life: number, delay = 0, thickness = 1): void {
    this.k.decals.emit(Decal.Foam, x, z, radius, life, WHITE, 0.95, FOAM_SHADOW, 0, thickness, 0, delay);
  }

  shock(x: number, z: number, radius: number, life: number, hex = WHITE, add = 0.8, thickness = 1, delay = 0): void {
    this.k.decals.emit(Decal.Shock, x, z, radius, life, hex, 0.5, hex, add, thickness, 0, delay);
  }

  planks(x: number, y: number, z: number, count: number, speed: number, up: number, lenMin: number, lenMax: number, charred = 0, bx = 0, bz = 0): void {
    const d = this.k.debris;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      d.spawn(x + spread(1), y + rand(), z + spread(1), spread(speed) + bx, up * range(0.6, 1.2), spread(speed) + bz,
        range(lenMin, lenMax), rand() < charred ? CHARRED : this.wood(), range(5, 8));
    }
  }

  /** Jagged lightning between two points (midpoint displacement), with optional forks. Additive beams. */
  bolt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, pal: number, life = 0.22,
    delay = 0, forks = 1, depth = 4): void {
    const segs = 1 << depth;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    boltPts[0] = ax; boltPts[1] = ay; boltPts[2] = az;
    boltPts[segs * 3] = bx; boltPts[segs * 3 + 1] = by; boltPts[segs * 3 + 2] = bz;
    let step = segs;
    let amp = len * 0.2;
    while (step > 1) {
      const half = step >> 1;
      for (let i = half; i < segs; i += step) {
        const a = (i - half) * 3, b = (i + half) * 3, m = i * 3;
        boltPts[m] = (boltPts[a]! + boltPts[b]!) * 0.5 + spread(amp);
        boltPts[m + 1] = (boltPts[a + 1]! + boltPts[b + 1]!) * 0.5 + spread(amp * 0.6);
        boltPts[m + 2] = (boltPts[a + 2]! + boltPts[b + 2]!) * 0.5 + spread(amp);
      }
      step = half;
      amp *= 0.55;
    }
    const beams = this.k.beams;
    const seed = rand();
    for (let i = 0; i < segs; i++) {
      const a = i * 3, b = a + 3;
      const w = width * (1 - (i / segs) * 0.35);
      beams.emit(boltPts[a]!, boltPts[a + 1]!, boltPts[a + 2]!, boltPts[b]!, boltPts[b + 1]!, boltPts[b + 2]!, life, w, pal, 0, 1, delay, seed);
    }
    for (let f = 0; f < forks; f++) {
      const i = 1 + ((rand() * (segs - 2)) | 0);
      const px = boltPts[i * 3]!, py = boltPts[i * 3 + 1]!, pz = boltPts[i * 3 + 2]!;
      const fl = len * range(0.15, 0.3);
      const fx = px + spread(fl), fy = py - fl * range(0.2, 0.8), fz = pz + spread(fl);
      const mx = (px + fx) * 0.5 + spread(fl * 0.25), my = (py + fy) * 0.5, mz = (pz + fz) * 0.5 + spread(fl * 0.25);
      beams.emit(px, py, pz, mx, my, mz, life * 0.8, width * 0.55, pal, 0, 0.9, delay, seed);
      beams.emit(mx, my, mz, fx, fy, fz, life * 0.8, width * 0.45, pal, 0, 0.8, delay, seed);
    }
    const g = this.k.glow;
    g.spec.reset().at(bx, by, bz).look(Glow.Bolt, pal).sized(width * 7, width * 9, 2).lived(life * 1.2).after(delay);
    g.emit();
    g.spec.reset().at(ax, ay, az).look(Glow.Bolt, pal).sized(width * 5, width * 6, 2).lived(life).after(delay);
    g.emit();
  }

  // ───────────────────────── composites ─────────────────────────

  /** Cannon muzzle blast: directional starburst (4–5 frames), core pop, bloom halo, sparks, inked smoke bank, water blast. */
  muzzle(x: number, y: number, z: number, dx: number, dz: number, scale: number, delay: number, smokePuffs: number, water: boolean, pal: number = GlowPal.Muzzle): void {
    const s = scale;
    this.dirFlash(x, y, z, dx, 0.06, dz, 10.5 * s, pal, 0.09, delay);
    this.burst(x + dx * 1.2 * s, y, z + dz * 1.2 * s, 4.6 * s, pal, 0.06, delay);
    this.soft(x + dx * 2.5 * s, y, z + dz * 2.5 * s, 8 * s, pal, 0.12, 0.35, delay);
    this.sparks(x + dx * s, y, z + dz * s, 3, 45 * s, GlowPal.Spark, dx, 0.25, dz, 0.75, 0.3, delay, 0.35 * s);
    const c = this.k.cel;
    const n = this.n(smokePuffs, 1);
    for (let i = 0; i < n; i++) {
      const along = (2.6 + i * 1.8) * s;
      const v = range(8, 20) * s;
      const sp = c.spec.reset();
      sp.at(x + dx * along, y + spread(0.5 * s), z + dz * along)
        .vel(dx * v + spread(2.5), range(0.5, 2.5), dz * v + spread(2.5))
        .dragTo(3.2, this.k.windX, range(0.9, 1.9), this.k.windZ)
        .look(Cel.Puff, CelPal.Gunsmoke).sized(1.4 * s, range(3.8, 6.2) * s, 3).rotate(rand() * TAU, spread(0.3))
        .lived(range(1.5, 2.5), 0.34).after(delay + i * 0.014);
      c.emit();
    }
    this.k.spawned += n + 6;
    if (water) {
      const wx = x + dx * 3.5 * s, wz = z + dz * 3.5 * s;
      this.sheet(wx, this.wy(wx, wz) - 0.3, wz, 4.5 * s, 0.75, 0.5, dx * 3, dz * 3, delay);
      this.k.decals.emit(Decal.Blot, wx + dx * s, wz + dz * s, 3.2 * s, 1.4, WHITE, 0.9, FOAM_SHADOW, 0, 1, 0, delay);
    }
  }

  /** Cannonball miss: crown splash column + spikes + droplets + mist + foam ring + ocean stamps. */
  waterSplash(x: number, z: number, scale: number, delay = 0): void {
    const s = scale;
    const rs = Math.sqrt(s);
    const wy = this.wy(x, z);
    this.column(x, z, 4.6 * s, 2.3, 0.95, delay);
    this.column(x + spread(0.8 * s), z + spread(0.8 * s), 2.6 * s, 3.1, 0.8, delay + 0.03);
    this.crown(x, z, 1.3 * s, 7, 12 * rs, 1.6 * s, delay);
    this.droplets(x, wy + 1, z, 12, 7 * rs, 17 * rs, 0.7 * rs, delay);
    this.smoke(x, wy + 1.5 * s, z, 2, 2.2 * s, 5 * s, CelPal.Steam, 0.9, 0, 3 * s, 0, 2, 1.2, 1.5 * s, delay + 0.05, 0.3);
    this.foam(x, z, 5.5 * s, 1.9, delay, 1);
    this.shock(x, z, 7.5 * s, 0.42, 0xe8f8ff, 0.4, 0.7, delay);
    const o = this.k.ocean;
    if (o) { o.stampRing(x, z, 3 * s, 0.8); o.stampFoam(x, z, 2.5 * s, 0.9); }
    this.k.spawned += 24;
  }

  /** Small splash (debris landing, droplets hitting the water). */
  plop(x: number, z: number, size: number): void {
    const wy = this.wy(x, z);
    this.crown(x, z, 0.4 * size, 4, 6 * size, 0.7 * size);
    this.foam(x, z, 1.8 * size, 1.0, 0, 0.8);
    this.droplets(x, wy + 0.3, z, 3, 3 * size, 6 * size, 0.4 * size);
  }

  /** Cannonball into a hull: starburst, fire puff, sparks toward the shooter, inked splinters, chunks, smoke. */
  hullHit(x: number, y: number, z: number, dx: number, dz: number, scale: number, crit: boolean, enemyShot: boolean): void {
    const s = scale * (crit ? 1.45 : 1);
    this.burst(x, y, z, 6 * s, crit ? GlowPal.Gold : GlowPal.Explosion, 0.07);
    this.soft(x, y, z, 9 * s, GlowPal.Explosion, 0.16, 0.4);
    this.fireballs(x, y, z, 3, 3.6 * s, 0.8 * s, 5 * s, 0.5);
    this.sparks(x, y, z, crit ? 14 : 8, 32 * s, enemyShot ? GlowPal.Enemy : GlowPal.Spark, -dx, 0.5, -dz, 0.45, 0.45);
    this.planks(x, y, z, crit ? 6 : 4, 7 * s, 12 * s, 0.7 * s, 1.9 * s, 0.25, -dx * 5, -dz * 5);
    this.chunks(x, y, z, 4, 9 * s, CelPal.WreckSmoke, 0.75 * s);
    this.smoke(x, y + 1, z, 2, 2 * s, 5.5 * s, CelPal.DarkSmoke, 1.6, 0, 2, 0, 2, 2.4, 1, 0.08);
    if (crit) this.ring(x, y, z, 4, 16 * s, GlowPal.Gold, 0.3, 1.2);
    this.k.spawned += 12;
  }

  /** Shot into rock/sand: dust burst, rock chips, sparks. */
  islandHit(x: number, y: number, z: number, scale: number): void {
    const s = scale;
    this.burst(x, y, z, 4 * s, GlowPal.Spark, 0.06);
    this.smoke(x, y, z, 5, 2 * s, 6 * s, CelPal.Dust, 1.3, 0, 4 * s, 0, 7 * s, 1.2, 1.2 * s, 0, 0.3);
    this.chunks(x, y, z, 6, 10 * s, CelPal.Rock, 0.9 * s);
    this.sparks(x, y, z, 4, 25 * s, GlowPal.Spark, 0, 1, 0, 0.3, 0.35);
  }

  /** Every explosion kind, scaled by radius. */
  explosion(kind: ExplosionKind, x: number, z: number, radius: number, onWater: boolean, nearShip: boolean, team: 'player' | 'enemy'): void {
    const wy = this.wy(x, z);
    let s = Math.max(0.5, radius / 8);
    const o = this.k.ocean;
    const dist = this.distToFocus(x, z);
    if (kind === 'small') s *= 0.75;
    if (kind === 'large') s *= 1.35;
    if (kind === 'powder') s *= 1.25;
    const y = wy + 1.5 * s;

    if (kind === 'water' || kind === 'mine') {
      const big = kind === 'mine' ? 1.35 : 1;
      this.column(x, z, 7 * s * big, 2.8, 1.25);
      this.column(x + spread(2 * s), z + spread(2 * s), 4 * s, 3.4, 1.0, 0.05);
      this.crown(x, z, 2.5 * s, 10, 16 * Math.sqrt(s), 2.4 * s);
      this.droplets(x, wy + 2, z, 22, 10 * Math.sqrt(s), 22 * Math.sqrt(s), 1.0 * Math.sqrt(s));
      this.smoke(x, wy + 3 * s, z, 3, 4 * s, 9 * s, CelPal.Steam, 1.2, 0, 4, 0, 3, 1.5, 3 * s, 0.1, 0.3);
      if (kind === 'mine') { this.burst(x, wy + 2, z, 12 * s, GlowPal.Explosion, 0.08); this.fireballs(x, wy + 1, z, 4, 5 * s, 2 * s, 7, 0.5); }
      this.foam(x, z, 12 * s, 2.6, 0, 1.2);
      this.shock(x, z, 20 * s, 0.55, 0xeaf8ff, 0.8, 1);
      if (o) { o.stampRing(x, z, 8 * s, 1); o.stampFoam(x, z, 7 * s, 1); o.stampDisplace(x, z, 6 * s, -1.2 * s); }
      this.k.juice.shakeAt(0.28 * s, dist, 0.35);
      return;
    }

    if (kind === 'lightning') {
      this.bolt(x + spread(6), wy + 120, z + spread(6), x, wy + 0.5, z, 1.6, GlowPal.Lightning, 0.26, 0, 2, 5);
      this.bolt(x + spread(8), wy + 110, z + spread(8), x, wy + 0.5, z, 1.2, GlowPal.Lightning, 0.14, 0.09, 1, 5);
      this.burst(x, wy + 1.5, z, 10 * s, GlowPal.Lightning, 0.08);
      this.soft(x, wy + 2, z, 18 * s, GlowPal.Lightning, 0.22, 0.55);
      this.sparks(x, wy + 1, z, 14, 30, GlowPal.Lightning, 0, 1, 0, 0.35, 0.4);
      this.smoke(x, wy + 1, z, 4, 3 * s, 8 * s, CelPal.Steam, 1.1, 0, 3, 0, 4, 2, 2 * s, 0.05, 0.3);
      this.shock(x, z, 16 * s, 0.4, 0xbfeaff, 1.2, 1);
      this.k.decals.emit(Decal.Glow, x, z, 12 * s, 0.35, 0x9fe2ff, 0, 0x9fe2ff, 0.8, 30);
      if (onWater) { this.column(x, z, 3.5 * s, 2.2, 0.7, 0.02); if (o) o.stampRing(x, z, 6 * s, 1); }
      this.k.juice.shakeAt(0.35, dist, 0.3);
      if (dist < 260) this.k.juice.flash(0xdff4ff, 0.22 * (1 - dist / 260), 0.1);
      return;
    }

    // Fire-based: small / medium / large / fire / powder / mortar
    const flashPal = kind === 'powder' ? GlowPal.Gold : team === 'enemy' && kind === 'mortar' ? GlowPal.Enemy : GlowPal.Explosion;
    this.burst(x, y + s, z, (kind === 'powder' ? 22 : 15) * s, flashPal, 0.09);
    this.burst(x, y + s, z, 10 * s, GlowPal.Explosion, 0.07, 0.04);
    this.soft(x, y + s, z, 24 * s, GlowPal.Explosion, 0.22, kind === 'powder' ? 0.7 : 0.45);
    this.fireballs(x, y, z, 7 + 4 * s, 9.5 * s, 2.4 * s, 12 * s, kind === 'fire' ? 1.2 : kind === 'large' || kind === 'powder' ? 1.15 : 0.95, 0, CelPal.Fire);
    this.sparks(x, y, z, 10 + 5 * s, 34 * Math.sqrt(s), GlowPal.Spark, 0, 1, 0, 0.3, 0.55);
    const smokePal = kind === 'powder' || kind === 'large' ? CelPal.WreckSmoke : CelPal.DarkSmoke;
    const smokeN = kind === 'small' ? 2 : kind === 'large' || kind === 'powder' ? 7 : 4;
    this.smoke(x, y + 2 * s, z, smokeN, 4 * s, 11 * s, smokePal, 2.6, 0, 9 * s, 0, 4 * s, 4, 2.2 * s, 0.14, 0.4);
    if (kind === 'large' || kind === 'powder') {
      // mushroom cap: a ring of puffs riding the column
      const c = this.k.cel;
      const n = this.n(8);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const sp = c.spec.reset();
        sp.at(x + Math.cos(a) * 2 * s, y + 4 * s, z + Math.sin(a) * 2 * s).vel(Math.cos(a) * 9 * s, 14 * s, Math.sin(a) * 9 * s)
          .dragTo(2.2, this.k.windX, 3.5, this.k.windZ).look(Cel.Puff, smokePal).sized(4 * s, 9 * s, 3).rotate(rand() * TAU)
          .lived(range(2.4, 3.2), 0.42).after(0.12 + rand() * 0.08);
        c.emit();
      }
      this.embers(x, y + 2 * s, z, 10, 4 * s, 0.1);
    }
    if (kind === 'fire') this.flames(x, wy, z, 6, 6 * s, 3 * s, 1.4, 0.1);
    if (nearShip) {
      this.planks(x, y, z, kind === 'small' ? 4 : 8 + 4 * s, 10 * Math.sqrt(s), 16 * Math.sqrt(s), 0.8, 2.4, 0.35);
      this.chunks(x, y, z, 6, 12 * Math.sqrt(s), CelPal.WreckSmoke, 0.9 * s);
    }
    if (onWater) {
      if (!nearShip) { this.column(x, z, 5.5 * s, 2.2, 1.05, 0.03); this.crown(x, z, 2 * s, 8, 14 * Math.sqrt(s), 2 * s, 0.03); }
      this.foam(x, z, 9 * s, 2.2, 0.05, 1.1);
      if (o) { o.stampRing(x, z, 7 * s, 1); o.stampFoam(x, z, 6 * s, 0.9); o.stampDisplace(x, z, 5 * s, -0.9 * s); }
    }
    this.shock(x, z, 18 * s, 0.5, kind === 'powder' ? 0xfff0b0 : 0xfff6e0, 0.9, 1);
    this.k.decals.emit(Decal.Glow, x, z, 12 * s, 0.6, 0xff9a3a, 0, 0xff9a3a, 1.2, 20);
    const base = kind === 'small' ? 0.16 : kind === 'medium' || kind === 'mortar' ? 0.3 : kind === 'fire' ? 0.3 : 0.55;
    this.k.juice.shakeAt(base * (0.8 + 0.2 * s), dist, 0.4);
    if (kind === 'powder' && dist < 200) this.k.juice.flash(0xfff2c0, 0.25, 0.1);
  }

  /** A ship destroyed: big starburst, fireballs along the hull, towering inked smoke, plank storm, shock ring. */
  kill(x: number, z: number, length: number, heading: number, elite: boolean, big: boolean): void {
    const s = Math.max(0.6, length / 22) * (big ? 1.4 : 1);
    const wy = this.wy(x, z);
    const y = wy + 3 + length * 0.08;
    const fx = -Math.sin(heading), fz = -Math.cos(heading);
    const dist = this.distToFocus(x, z);
    this.burst(x, y + 2, z, 20 * s, elite ? GlowPal.Gold : GlowPal.Explosion, 0.11);
    this.burst(x + spread(3), y + 3, z + spread(3), 14 * s, GlowPal.Explosion, 0.08, 0.06);
    this.soft(x, y + 2, z, 32 * s, GlowPal.Explosion, 0.26, 0.5);
    const n = this.n(8 + 3 * s);
    for (let i = 0; i < n; i++) {
      const along = spread(length * 0.38);
      this.fireballs(x + fx * along, y + rand() * 3 * s, z + fz * along, 1, 10 * s, 1.5 * s, 11 * s, 1.25, rand() * 0.14);
    }
    this.smoke(x, y + 4 * s, z, 6, 5 * s, 13 * s, CelPal.WreckSmoke, 3.4, 0, 14 * s, 0, 3 * s, 4.5, 3 * s, 0.12, 0.45);
    this.planks(x, y, z, 12 + 6 * s, 11 * Math.sqrt(s), 20 * Math.sqrt(s), 1.0, 3.0 * Math.sqrt(s), 0.3);
    this.chunks(x, y, z, 8, 14, CelPal.WreckSmoke, 1.1 * s);
    this.embers(x, y + 3, z, 12, 5 * s, 0.1);
    this.sparks(x, y, z, 14, 40, GlowPal.Spark, 0, 1, 0, 0.35, 0.6);
    this.shock(x, z, 26 * s, 0.6, 0xfff6e0, 1.1, 1.2);
    this.foam(x, z, 14 * s, 3.2, 0.1, 1.3);
    this.k.decals.emit(Decal.Glow, x, z, 18 * s, 0.9, 0xff8a2a, 0, 0xff8a2a, 1.4, 18);
    this.column(x + fz * length * 0.3, z - fx * length * 0.3, 4 * s, 2.4, 1.0, 0.08);
    const o = this.k.ocean;
    if (o) { o.stampRing(x, z, length * 0.6, 1); o.stampFoam(x, z, length * 0.5, 1); o.stampDisplace(x, z, length * 0.4, -1.4); }
    if (elite) {
      this.ring(x, y + 4, z, 6, 42 * s, GlowPal.Gold, 0.55, 1.4);
      this.sparkles(x, y + 4, z, 16, 14, GlowPal.Gold, 1.4);
    }
    this.k.juice.shakeAt(0.3 + 0.12 * s, dist, 0.45);
  }

  sparkles(x: number, y: number, z: number, count: number, speed: number, pal: number, life = 1.1, delay = 0): void {
    const g = this.k.glow;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const s = g.spec.reset();
      s.at(x + spread(2), y + spread(2), z + spread(2)).vel(spread(speed), range(0.2, 1) * speed, spread(speed))
        .dragTo(2.4, 0, 1.5, 0).look(Glow.Sparkle, pal).sized(range(1.2, 2.4), 0.6).rotate(rand() * TAU, spread(3))
        .lived(life * range(0.7, 1.3)).after(delay + rand() * 0.1);
      g.emit();
    }
  }

  /** Last gasp of a sunk ship: foam burst, bubbles, a few planks. */
  sunk(x: number, z: number, length: number): void {
    const s = Math.max(0.6, length / 22);
    this.foam(x, z, length * 0.6, 3.0, 0, 1.4);
    this.bubbles(x, z, 14, length * 0.3, 1.8 * s);
    this.planks(x, this.wy(x, z) + 0.5, z, 3, 3, 3, 1, 2.4);
    const o = this.k.ocean;
    if (o) { o.stampFoam(x, z, length * 0.5, 1); o.stampRing(x, z, length * 0.5, 0.8); }
  }

  /** Storm lightning strike from the sky. */
  lightningStrike(x: number, z: number): void {
    this.explosion('lightning', x, z, 10, true, false, 'enemy');
  }

  /** Chain lightning through world points (y given per point). */
  chain(pts: Float32Array, count: number, pal: number): void {
    for (let i = 0; i + 1 < count; i++) {
      const a = i * 3, b = a + 3;
      this.bolt(pts[a]!, pts[a + 1]!, pts[a + 2]!, pts[b]!, pts[b + 1]!, pts[b + 2]!, 1.1, pal, 0.24, i * 0.03, 1, 4);
      this.burst(pts[b]!, pts[b + 1]!, pts[b + 2]!, 6, pal, 0.07, i * 0.03);
      this.sparks(pts[b]!, pts[b + 1]!, pts[b + 2]!, 6, 22, pal, 0, 0.5, 0, 0.2, 0.35, i * 0.03);
    }
  }

  /** Level-up: golden shock ring, halo, pillar, rising sparkles. */
  levelUp(x: number, z: number, big: boolean): void {
    const wy = this.wy(x, z);
    const s = big ? 1.5 : 1;
    this.shock(x, z, 38 * s, 0.8, 0xffd84a, 1.5, 1.4);
    this.k.decals.emit(Decal.Shock, x, z, 24 * s, 0.6, 0xffffff, 0.4, 0xfff0b0, 1.0, 1, 0, 0.1);
    this.ring(x, wy + 8, z, 10, 46 * s, GlowPal.Gold, 0.6, 1.0);
    const g = this.k.glow;
    g.spec.reset().at(x, wy - 1, z).look(Glow.Shaft, GlowPal.Gold, Mode.Upright, true).sized(9 * s, 13 * s, 3).stretched(big ? 7 : 5).lived(big ? 1.4 : 1.0).bright(0.75);
    g.emit();
    this.sparkles(x, wy + 4, z, big ? 40 : 22, 12, GlowPal.Gold, 1.4);
    if (big) {
      this.burst(x, wy + 10, z, 26, GlowPal.Gold, 0.12);
      this.ring(x, wy + 10, z, 20, 90, GlowPal.Gold, 0.9, 1.0, 0.1);
      this.k.juice.flash(0xffe7a0, 0.3, 0.2);
      this.k.juice.shake(0.2, 0.3);
    }
  }

  /** Treasure pickup: a small glint pop and sparkles streaking toward the ship. */
  pickup(x: number, z: number, tx: number, tz: number, pal: number, count: number): void {
    const wy = this.wy(x, z);
    const g = this.k.glow;
    g.spec.reset().at(x, wy + 2.5, z).look(Glow.Glint, pal).sized(5, 1.5, 2).rotate(rand()).lived(0.3);
    g.emit();
    const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz) || 1;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const v = range(18, 34);
      const s = g.spec.reset();
      s.at(x + spread(1.5), wy + 2 + rand() * 2, z + spread(1.5)).vel(dx / d * v + spread(5), range(3, 8), dz / d * v + spread(5))
        .dragTo(2.5, dx / d * 10, 1, dz / d * 10).look(Glow.Sparkle, pal).sized(range(1.1, 1.8), 0.4).rotate(rand() * TAU, spread(4))
        .lived(range(0.35, 0.6));
      g.emit();
    }
  }

  /** Brace parry: bright ring + white-cyan starburst around the hull. */
  parry(x: number, z: number, radius: number): void {
    const wy = this.wy(x, z);
    this.k.decals.emit(Decal.Shock, x, z, radius * 1.6, 0.4, 0xffffff, 0.8, 0xbfeaff, 2.0, 1.6);
    this.ring(x, wy + 5, z, radius * 0.8, radius * 2.4, GlowPal.Shield, 0.35, 1.0);
    this.burst(x, wy + 5, z, radius * 0.9, GlowPal.Shield, 0.08);
    this.sparks(x, wy + 4, z, 16, 40, GlowPal.Shield, 0, 0.3, 0, 0.1, 0.4);
    this.k.juice.flash(0xdff6ff, 0.28, 0.1);
    this.k.juice.shake(0.3, 0.25);
  }

  /** Brace (no parry yet): a quick blue-white shield pop. */
  brace(x: number, z: number, radius: number): void {
    const wy = this.wy(x, z);
    this.k.decals.emit(Decal.Shock, x, z, radius * 1.2, 0.35, 0xdff4ff, 0.6, 0x9fd8ff, 0.8, 1);
    this.ring(x, wy + 5, z, radius, radius * 1.5, GlowPal.Shield, 0.3, 0.9);
  }

  /** T10 cloud ring: a vertical ring of inked cloud puffs blasting outward behind a launching ship. */
  cloudRing(x: number, y: number, z: number, nx: number, nz: number, radius: number, count: number): void {
    const c = this.k.cel;
    const n = this.n(count, 8);
    // basis: ring plane perpendicular to (nx, 0, nz)
    const ux = -nz, uz = nx;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = ux * ca * radius, py = sa * radius, pz = uz * ca * radius;
      const v = 16;
      const s = c.spec.reset();
      s.at(x + px * 0.3, Math.max(this.wy(x, z) + 0.5, y + py * 0.3), z + pz * 0.3)
        .vel(px / radius * v - nx * 8, py / radius * v, pz / radius * v - nz * 8).dragTo(4.5, this.k.windX, 1, this.k.windZ)
        .look(Cel.Puff, CelPal.Steam).sized(3, radius * 0.55, 4).rotate(rand() * TAU, spread(0.5)).lived(range(1.0, 1.4), 0.4);
      c.emit();
    }
    this.k.spawned += n;
  }

  /** Hash-stable pseudo random in [0,1) for per-object decorations. */
  h(id: number, salt: number): number { return hash01(id, salt); }
}
