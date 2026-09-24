/**
 * Points-of-interest visuals (EVENTS):
 *  - trade-wind patches: pale wind streaks racing along the current and foam lines laid in the water (stampWake);
 *  - lighthouse beacons: a slowly turning signal ring on the water, a light shaft and glints;
 *  - floating salvage: planks, barrels and a crate bobbing, a glint over them and bubbles;
 *  - one-shots when a beacon is sailed through or salvage is hauled ('hazard-triggered').
 */
import type { HazardState, SimEvent } from '../../../game/types';
import { GlowPal } from '../core/palette';
import { hash01, rand, range, spread } from '../core/rand';
import { Mode } from '../core/SpritePass';
import type { FxKit } from '../Kit';
import { Decal } from '../passes/Decals';
import { Glow } from '../passes/GlowSprites';
import { Prop } from '../passes/Props';
import type { Sakuga } from '../Sakuga';

const TAU = Math.PI * 2;

export class PoiFx {
  private wakeT = 0;

  constructor(private readonly k: FxKit, private readonly fx: Sakuga) {}

  beginFrame(dt: number): void { this.wakeT -= dt; }

  endFrame(): void { if (this.wakeT <= 0) this.wakeT = 0.12; }

  wind(h: Readonly<HazardState>, dt: number): void {
    const k = this.k;
    const env = Math.max(0, Math.min(1, h.age / 2, (h.ttl - h.age) / 3));
    if (env <= 0.02) return;
    const sp = Math.hypot(h.vx, h.vz) || 1;
    const dx = h.vx / sp, dz = h.vz / sp;
    // A pale band of fast water along the current.
    k.decals.imm(Decal.Blot, h.x, h.z, h.radius * 0.62, h.radius * 1.15, Math.atan2(dx, dz), 0, 0, 0xd8f7ff, 0.32 * env, 0x8fd3ea, 0, hash01(h.id, 7));
    const n = Math.round(dt * 26 * k.q * env + rand());
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, r = h.radius * Math.sqrt(rand());
      const x = h.x + Math.cos(a) * r - dx * h.radius * 0.5, z = h.z + Math.sin(a) * r - dz * h.radius * 0.5;
      const gs = k.glow.spec.reset();
      gs.at(x, this.fx.wy(x, z) + range(0.6, 2.5), z).vel(dx * sp * 2.6, 0, dz * sp * 2.6).look(Glow.Streak, GlowPal.Glint, Mode.Velocity)
        .sized(0.55, 0.55).stretched(18).lived(range(0.9, 1.4)).bright(0.85 * env);
      k.glow.emit();
    }
    if (this.wakeT <= 0) {
      const u = spread(h.radius * 0.8), v = spread(h.radius * 0.6);
      this.k.ocean?.stampWake(h.x + dx * u - dz * v, h.z + dz * u + dx * v, dx, dz, 3.5, 0.45 * env);
    }
  }

  beacon(h: Readonly<HazardState>): void {
    const k = this.k, fx = this.fx;
    const env = Math.max(0, Math.min(1, h.age / 1.5, (h.ttl - h.age) / 2));
    if (env <= 0.02) return;
    const wy = fx.wy(h.x, h.z);
    const pulse = 0.7 + 0.3 * Math.sin(k.clock * 3.2 + h.id);
    k.decals.imm(Decal.Ring, h.x, h.z, h.radius, h.radius, k.clock * 0.4, 0, 0.82, 0xfff2c2, pulse * env, 0x6a5020, 0.5, 0.5);
    k.decals.imm(Decal.Glow, h.x, h.z, h.radius * 0.9, h.radius * 0.9, 0, 4, 0, 0xffe7a0, 0, 0xffe7a0, 0.8 * env, 0.5, 0.5);
    const g = k.glow.spec.reset();
    g.at(h.x, wy - 1, h.z).look(Glow.Shaft, GlowPal.Glint, Mode.Upright, true).sized(5, 5).stretched(12).lived(10).bright(0.6 * pulse * env);
    k.glow.imm(5);
    if (rand() < 0.05) fx.sparkles(h.x + spread(h.radius * 0.6), wy + 2, h.z + spread(h.radius * 0.6), 1, 4, GlowPal.Glint, 1.2);
  }

  salvage(h: Readonly<HazardState>): void {
    const k = this.k, fx = this.fx;
    const clock = k.clock, id = h.id;
    const fade = Math.max(0, Math.min(1, (h.ttl - h.age) / 3));
    if (fade <= 0.02) return;
    k.decals.imm(Decal.Ring, h.x, h.z, h.radius * 1.25, h.radius * 1.25, -clock * 0.5, 0, 0.8, 0xffd76a, 0.7 * fade, 0x5a4210, 0.35, 0.5);
    for (let j = 0; j < 5; j++) {
      const a = hash01(id, j) * TAU, r = h.radius * 0.6 * hash01(id, j + 10);
      const px = h.x + Math.cos(a) * r, pz = h.z + Math.sin(a) * r;
      k.debris.imm(px, fx.wy(px, pz) + 0.15 + Math.sin(clock * 1.7 + j) * 0.1, pz, Math.sin(clock + j) * 0.1, a, Math.cos(clock * 1.2 + j) * 0.1,
        2.4 + hash01(id, j + 20) * 2.6, 0.9, j % 2 ? 0x6b4226 : 0x8a5a33);
    }
    for (let j = 0; j < 2; j++) {
      const a = hash01(id, j + 30) * TAU, r = h.radius * 0.45;
      const px = h.x + Math.cos(a) * r, pz = h.z + Math.sin(a) * r;
      k.props.add(Prop.Barrel, px, fx.wy(px, pz) + 0.5 + Math.sin(clock * 2 + j) * 0.2, pz, a, Math.PI / 2, Math.sin(clock * 1.6 + j) * 0.2, 1.6, 0xb07a44);
    }
    const wy = fx.wy(h.x, h.z);
    k.props.add(Prop.Crate, h.x, wy + 1 + Math.sin(clock * 1.4) * 0.2, h.z, hash01(id, 40) * TAU, Math.sin(clock) * 0.12, 0, 2, 0xd9b27a);
    const gl = k.glow.spec.reset();
    gl.at(h.x, wy + 6, h.z).look(Glow.Glint, GlowPal.Gold).sized(10, 10).lived(1000).rotate(clock * 0.6).bright(fade);
    k.glow.imm(clock % 100);
    if (rand() < 0.04) fx.bubbles(h.x + spread(h.radius * 0.5), h.z + spread(h.radius * 0.5), 1, 3, 1.2);
  }

  onEvent(e: SimEvent): void {
    if (e.type !== 'hazard-triggered') return;
    const fx = this.fx;
    const wy = fx.wy(e.x, e.z);
    if (e.kind === 'salvage') {
      fx.sparkles(e.x, wy + 3, e.z, 18, 10, GlowPal.Gold, 1.2);
      fx.plop(e.x, e.z, 2.5);
      fx.planks(e.x, wy + 1, e.z, 5, 5, 6, 1.2, 2.6);
    } else if (e.kind === 'beacon') {
      fx.shock(e.x, e.z, 40, 0.8, 0xfff2c2, 1.2, 1.3);
      fx.ring(e.x, wy + 6, e.z, 10, 52, GlowPal.Glint, 0.6, 1);
      fx.sparkles(e.x, wy + 5, e.z, 24, 12, GlowPal.Glint, 1.4);
      const g = this.k.glow;
      g.spec.reset().at(e.x, wy - 1, e.z).look(Glow.Shaft, GlowPal.Glint, Mode.Upright, true).sized(9, 12, 3).stretched(8).lived(1.2).bright(0.8);
      g.emit();
    }
  }
}
