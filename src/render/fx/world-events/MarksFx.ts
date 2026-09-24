/**
 * Objective markers and outcome bursts (EVENTS):
 *  - the Sunken Treasure dig site: a gold circle filling with the dig, a beacon shaft seen from afar, wreck planks
 *    and bubbles, and gold glitter while the ship holds station;
 *  - the Admiralty Blockade's flagship: a gold ring on the water, a pennant shaft and a turning star over it;
 *  - Bounty Contract marks: a red ring under every ship of the posted class;
 *  - the Ghost Fleet surfacing and sinking back: teal glow, bubbles and mist on each ghost;
 *  - success / failure bursts at the event's anchor.
 */
import type { EnemyState, RunState, SimEvent } from '../../../game/types';
import { CelPal, GlowPal } from '../core/palette';
import { hash01, rand, spread } from '../core/rand';
import { Mode } from '../core/SpritePass';
import type { FxKit } from '../Kit';
import { Decal } from '../passes/Decals';
import { Glow } from '../passes/GlowSprites';
import type { Sakuga } from '../Sakuga';

const GOLD = 0xffd76a;
const GOLD_DEEP = 0x5a4210;
const WANTED = 0xff5a4a;

export class MarksFx {
  constructor(private readonly k: FxKit, private readonly fx: Sakuga) {}

  update(run: Readonly<RunState>, dt: number): void {
    const ev = run.worldEvent;
    if (ev) {
      if (ev.id === 'sunken-treasure') this.digSite(run, dt);
      else if (ev.id === 'admiralty-blockade') this.flagship(run);
      else if (ev.id === 'bounty-contract') this.wanted(run);
    }
    this.ghosts(run, dt);
  }

  /** One-shots for 'world-event' outcomes. */
  onEvent(e: SimEvent, run: Readonly<RunState>): void {
    if (e.type !== 'world-event' || (e.phase !== 'success' && e.phase !== 'fail')) return;
    const p = run.player;
    const x = e.x ?? p.x, z = e.z ?? p.z;
    const fx = this.fx;
    const wy = fx.wy(x, z);
    if (e.phase === 'success') {
      fx.shock(x, z, 46, 0.9, 0xffd84a, 1.4, 1.4);
      fx.ring(x, wy + 8, z, 12, 60, GlowPal.Gold, 0.7, 1.1);
      fx.sparkles(x, wy + 6, z, 30, 14, GlowPal.Gold, 1.5);
      const g = this.k.glow;
      g.spec.reset().at(x, wy - 1, z).look(Glow.Shaft, GlowPal.Gold, Mode.Upright, true).sized(10, 14, 3).stretched(7).lived(1.3).bright(0.8);
      g.emit();
    } else {
      fx.shock(x, z, 36, 0.7, 0x9fb4d8, 0.4, 1);
      fx.smoke(x, wy + 2, z, 4, 4, 11, CelPal.Steam, 1.8, 0, 4, 0, 3, 2, 5, 0, 0.4);
    }
  }

  private digSite(run: Readonly<RunState>, dt: number): void {
    const ev = run.worldEvent!;
    if (ev.x === undefined || ev.z === undefined) return;
    const k = this.k, fx = this.fx;
    const x = ev.x, z = ev.z, r = ev.radius ?? 30;
    const prog = ev.goal ? Math.min(1, (ev.progress ?? 0) / ev.goal) : 0;
    const p = run.player;
    const inside = Math.hypot(p.x - x, p.z - z) <= r;
    const wy = fx.wy(x, z);
    k.decals.imm(Decal.Circle, x, z, r, r, 0, prog, 0, GOLD, 1, GOLD_DEEP, 0, 0.5);
    k.decals.imm(Decal.Glow, x, z, r * 0.9, r * 0.9, 0, 6, 0, 0xffc93a, 0, 0xffc93a, 0.9 + 0.4 * prog, 0.5, 0.5);
    // Beacon: a gold shaft over the wreck, brighter as the chest comes up.
    const pulse = 0.55 + 0.2 * Math.sin(k.clock * 3) + 0.3 * prog;
    const g = k.glow.spec.reset();
    g.at(x, wy - 1, z).look(Glow.Shaft, GlowPal.Gold, Mode.Upright, true).sized(7, 7).stretched(10).lived(10).bright(pulse);
    k.glow.imm(5);
    const gl = k.glow.spec.reset();
    gl.at(x, wy + 2, z).look(Glow.Glint, GlowPal.Gold).sized(8, 8).lived(1000).rotate(k.clock * 0.8);
    k.glow.imm(k.clock % 100);
    // Wreck planks bobbing over the site.
    for (let j = 0; j < 6; j++) {
      const a = hash01(j, 71) * Math.PI * 2, rr = r * 0.25 * (0.3 + hash01(j, 72));
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      k.debris.imm(px, fx.wy(px, pz) + 0.15 + Math.sin(k.clock * 1.6 + j) * 0.1, pz, Math.sin(k.clock + j) * 0.08, a, 0.1, 2.5 + hash01(j, 73) * 3, 0.9, j % 2 ? 0x6b4226 : 0x8a5a33);
    }
    if (rand() < dt * 6) fx.bubbles(x + spread(r * 0.4), z + spread(r * 0.4), 2, 4, 1.4);
    if (inside && rand() < dt * 18) fx.sparkles(x + spread(r * 0.5), wy + 1, z + spread(r * 0.5), 1, 6, GlowPal.Gold, 1.2);
  }

  private flagship(run: Readonly<RunState>): void {
    const ev = run.worldEvent!;
    let flag: EnemyState | null = null, best = Infinity;
    for (const e of run.enemies) {
      if (e.defId !== 'man-o-war' || e.life !== 'alive' || !e.title) continue;
      const d = Math.hypot(e.x - (ev.x ?? e.x), e.z - (ev.z ?? e.z));
      if (d < best) { best = d; flag = e; }
    }
    if (!flag) return;
    const k = this.k, fx = this.fx;
    const wy = fx.wy(flag.x, flag.z);
    const r = flag.length * 0.75;
    const pulse = 0.75 + 0.25 * Math.sin(k.clock * 4);
    k.decals.imm(Decal.Ring, flag.x, flag.z, r, r, k.clock * 0.3, 0, 0.84, GOLD, pulse, GOLD_DEEP, 0.4, 0.5);
    const top = wy + flag.length * 0.62;
    const g = k.glow.spec.reset();
    g.at(flag.x, top, flag.z).look(Glow.Shaft, GlowPal.Gold, Mode.Upright, true).sized(3.2, 3.2).stretched(9).lived(10).bright(0.7 * pulse);
    k.glow.imm(5);
    const st = k.glow.spec.reset();
    st.at(flag.x, top + 30, flag.z).look(Glow.Sparkle, GlowPal.Gold).sized(9, 9).lived(1000).rotate(k.clock * 1.4).bright(1.1);
    k.glow.imm(k.clock % 100);
  }

  private wanted(run: Readonly<RunState>): void {
    const k = this.k;
    let n = 0;
    for (const e of run.enemies) {
      if (e.life !== 'alive' || e.ai.bmk !== 1 || e.hidden >= 0.9) continue;
      const r = e.radius * 1.9 + 3;
      k.decals.imm(Decal.Ring, e.x, e.z, r, r, -k.clock * 0.8, 0, 0.78, WANTED, 0.85, 0x5a0f14, 0.3, hash01(e.id, 5));
      if (++n >= 28) break;
    }
  }

  private ghosts(run: Readonly<RunState>, dt: number): void {
    const k = this.k, fx = this.fx;
    for (const e of run.enemies) {
      if (e.life !== 'alive' || (e.ai.gRise !== 1 && e.ai.gSink !== 1)) continue;
      const wy = fx.wy(e.x, e.z);
      const sub = Math.min(1, Math.max(0, e.ai.sub ?? 0));
      const L = e.length;
      k.decals.imm(Decal.Glow, e.x, e.z, L * 0.9, L * 0.9, 0, 5, 0, 0x3fe0c8, 0, 0x3fe0c8, 1.2 * (0.4 + sub), hash01(e.id, 6), 0.5);
      const g = k.glow.spec.reset();
      g.at(e.x, wy - 1, e.z).look(Glow.Shaft, GlowPal.Teal, Mode.Upright, true).sized(L * 0.25, L * 0.25).stretched(5).lived(10).bright(0.55 * sub + 0.15);
      k.glow.imm(5);
      if (rand() < dt * 14) fx.bubbles(e.x + spread(L * 0.3), e.z + spread(L * 0.3), 2, 4, 1.8);
      if (rand() < dt * 4) fx.smoke(e.x + spread(L * 0.3), wy + 2, e.z + spread(L * 0.3), 1, 4, 12, CelPal.TealFire, 2, 0, 3, 0, 2, 2, 3, 0, 0.45);
    }
  }
}
