/**
 * Round-1 foe effects (FOES, additive to the FX system): harpoon lines (in flight and tethered), tumbling powder kegs,
 * smoke screens, lantern-wisp glow and drain, signal flares and the red mark over their target, the drowned galleon's
 * bubbles and breach, iron-bow spark hits, and elite affix dressing (burning embers, swift wind, vampiric siphon,
 * volatile fuse, commander aura, shield-break burst). Driven by RunState (documented `e.ai` visual keys, see
 * src/game/sim/ai-foes.ts and affixes.ts) and SimEvents. Allocation-free per frame apart from per-enemy slot entries.
 */
import { AFFIXES, FOES } from '../../game/content/enemies';
import type { EnemyState, RunState } from '../../game/types';
import type { FrameContext } from '../frame';
import { CelPal, GlowPal } from './core/palette';
import { hash01, rand, range, spread } from './core/rand';
import { Mode } from './core/SpritePass';
import type { FxKit } from './Kit';
import { Cel } from './passes/CelSprites';
import { Decal } from './passes/Decals';
import { Glow } from './passes/GlowSprites';
import { Prop } from './passes/Props';
import type { Sakuga } from './Sakuga';
import { ShipFrame, findShip, shipFrame } from './ShipFrames';

const TAU = Math.PI * 2;
const AURA_RADIUS = 110;

/** Per-enemy memory for transitions (flare burst, shield break, galleon breach, tether snap). */
interface Memo { seen: number; mark: number; shield: number; dg: number; tether: number; wl: number }

export class FoeFx {
  private readonly frame = new ShipFrame();
  private readonly frame2 = new ShipFrame();
  private readonly memo = new Map<number, Memo>();
  private readonly memoPool: Memo[] = [];
  private tick = 0;
  private readonly waterY = (x: number, z: number): number => this.fx.wy(x, z);

  constructor(private readonly k: FxKit, private readonly fx: Sakuga) {}

  reset(): void { for (const m of this.memo.values()) this.memoPool.push(m); this.memo.clear(); }

  update(ctx: FrameContext, run: Readonly<RunState>, dt: number): void {
    this.tick++;
    this.events(ctx, run);
    this.projectiles(run);
    this.smoke(run, dt);
    let markPlayer = 0;
    for (const e of run.enemies) {
      if (e.life !== 'alive') continue;
      const m = this.memoOf(e);
      switch (e.defId) {
        case 'signal-cutter': markPlayer = Math.max(markPlayer, this.signal(e, m, run)); break;
        case 'harpooner': this.harpooner(e, m, run); break;
        case 'lantern-wisp': this.wisp(e, m, run, dt); break;
        case 'drowned-galleon': this.galleon(e, m, dt); break;
        case 'smoke-runner': if (e.hidden < 1 && e.speed > 6 && rand() < dt * 5 * this.k.q) this.fx.smoke(e.x - Math.sin(e.heading) * -5, this.fx.wy(e.x, e.z) + 2, e.z - Math.cos(e.heading) * -5, 1, 1, 2.6, CelPal.DarkSmoke, 1.2, 0, 1.5, 0, 0.6, 1.2, 0.5, 0, 0.4); break;
        default: break;
      }
      if (e.elite) this.affixes(e, m, run, dt);
    }
    if (markPlayer > 0) this.markOnPlayer(run, markPlayer);
    // Forget enemies that left the run.
    for (const [id, m] of this.memo) if (m.seen !== this.tick) { this.memo.delete(id); this.memoPool.push(m); }
  }

  private memoOf(e: EnemyState): Memo {
    let m = this.memo.get(e.id);
    if (!m) {
      m = this.memoPool.pop() ?? { seen: 0, mark: 0, shield: 0, dg: -1, tether: 0, wl: 0 };
      m.mark = e.ai.markT ?? 0; m.shield = e.ai.shield ?? 0; m.dg = e.ai.dg ?? -1; m.tether = e.ai.tether ?? 0; m.wl = e.ai.wl ?? 0;
      this.memo.set(e.id, m);
    }
    m.seen = this.tick;
    return m;
  }

  // ───────────── events: iron-bow clangs ─────────────

  private events(ctx: FrameContext, run: Readonly<RunState>): void {
    const fx = this.fx;
    for (const e of ctx.events) {
      if (e.type !== 'projectile-hit' || e.team !== 'player' || e.target !== 'ship' || e.targetId === undefined) continue;
      const s = findShip(run, e.targetId);
      if (!s || 'phase' in s || s.defId !== 'ironclad' || s.ai.bow !== 1) continue;
      const wy = fx.wy(e.x, e.z) + 3;
      fx.sparks(e.x, wy, e.z, 7, 20, GlowPal.Spark, 0, 0.8, 0, 0.35, 0.3, 0, 0.55);
      fx.burst(e.x, wy, e.z, 3.2, GlowPal.Glint, 0.05);
    }
  }

  // ───────────── projectiles: kegs and harpoons ─────────────

  private projectiles(run: Readonly<RunState>): void {
    const k = this.k;
    const clock = k.clock;
    for (const pr of run.projectiles) {
      if (!pr.alive) continue;
      if (pr.kind === 'enemy-bomb') {
        const spin = pr.age * 7 + pr.id;
        k.props.add(Prop.Barrel, pr.x, pr.y, pr.z, spin * 0.6, spin, spin * 0.3, 0.95, 0x4d3a36);
        const gs = k.glow.spec.reset();
        gs.at(pr.x, pr.y + 1.1, pr.z).look(Glow.Sparkle, GlowPal.Ember).sized(2.2, 2.2).lived(1000).rotate(clock * 9 + pr.id);
        k.glow.imm(clock % 100);
      } else if (pr.kind === 'enemy-harpoon') {
        // Rope from the harpooner that threw it.
        for (const e of run.enemies) {
          if (e.defId !== 'harpooner' || e.ai.hpId !== pr.id || e.life !== 'alive') continue;
          if (!shipFrame(run, k.ships, e.id, this.frame, this.waterY)) break;
          const f = this.frame;
          const bx = f.x + f.fx * f.length * 0.46, bz = f.z + f.fz * f.length * 0.46;
          k.ropes.add(bx, f.gunY + 0.8, bz, pr.x, Math.max(pr.y, this.fx.wy(pr.x, pr.z) + 1.2), pr.z, 0.8, 0.2, 0.42, 0.3, 0.2, 0);
          break;
        }
      }
    }
  }

  // ───────────── smoke screens ─────────────

  /**
   * Round 3 (owner: smoke should never wall off the ships): a screen is a soft, light-grey translucent haze
   * (Glow.Haze, no ink) — 7 overlapping puffs that read as a bank, densest while it is thick (when it hides ships
   * from auto-targeting) and thinning away after — plus a faint shadow on the water. It used to be 14 opaque inked
   * cel puffs of 13–22 m (a quarter of them dark) with more gunsmoke rising out of it.
   */
  private smoke(run: Readonly<RunState>, _dt: number): void {
    const k = this.k;
    const fx = this.fx;
    for (const h of run.hazards) {
      if (!h.alive || h.kind !== 'smoke-screen') continue;
      const id = h.id;
      const life = h.age / Math.max(0.1, h.ttl);
      const thick = life < FOES.smoke.thick ? 1 : 1 - (life - FOES.smoke.thick) / (1 - FOES.smoke.thick);
      const grow = Math.min(1, h.age / 0.8);
      const wy = fx.wy(h.x, h.z);
      const n = 7;
      for (let j = 0; j < n; j++) {
        const a = hash01(id, j) * TAU + k.clock * 0.05 * (j % 2 ? 1 : -1);
        const rr = h.radius * 0.7 * Math.sqrt(hash01(id, j + 30)) * (0.6 + 0.4 * grow);
        const px = h.x + Math.cos(a) * rr + k.windX * h.age * 0.25, pz = h.z + Math.sin(a) * rr + k.windZ * h.age * 0.25;
        const size = h.radius * (0.8 + 0.4 * hash01(id, j + 60)) * grow * (0.6 + 0.4 * thick);
        if (size < 0.5) continue;
        const g = k.glow.spec.reset();
        g.at(px, wy + 3 + hash01(id, j + 90) * 4 + h.age * 0.4, pz).look(Glow.Haze, GlowPal.Haze)
          .sized(size, size).rotate(hash01(id, j + 120) * TAU).lived(10).bright(0.08 + 0.14 * thick);
        g.seed = hash01(id, j + 150);
        k.glow.imm(5);
      }
      k.decals.imm(Decal.Shadow, h.x, h.z, h.radius * 1.1, h.radius * 1.1, 0, 0, 0, 0x1a1c24, 0.1 * thick * grow, 0x1a1c24, 0, 0.5);
    }
  }

  // ───────────── signal cutter ─────────────

  /** Flare in flight + burst; returns the mark seconds this cutter holds on the player. */
  private signal(e: EnemyState, m: Memo, _run: Readonly<RunState>): number {
    const k = this.k;
    const fx = this.fx;
    const ai = e.ai;
    const flight = FOES.signal.flight;
    const t = ai.flT ?? -1;
    if (t >= 0 && ai.flX !== undefined) {
      const u = Math.min(1, t / flight);
      const sx = ai.flSX ?? e.x, sz = ai.flSZ ?? e.z;
      const x = sx + (ai.flX! - sx) * u, z = sz + (ai.flZ! - sz) * u;
      const y = fx.wy(x, z) + 6 + 26 * u + 24 * u * (1 - u);
      const gs = k.glow.spec.reset();
      gs.at(x, y, z).look(Glow.Soft, GlowPal.FlareRed).sized(5, 5).lived(10).bright(1.4);
      k.glow.imm(0.02);
      if (rand() < 0.6 * k.q) {
        const c = k.cel.spec.reset();
        c.at(x, y, z).vel(spread(1), -1, spread(1)).dragTo(2, k.windX, 0.8, k.windZ).look(Cel.Puff, CelPal.FlareSmoke).sized(0.8, 2.6, 3).lived(1.4, 0.4);
        k.cel.emit();
      }
    }
    const mark = ai.markT ?? 0;
    if (mark > m.mark + 0.5 && ai.flX !== undefined) {
      // Burst over the target.
      const y = fx.wy(ai.flX!, ai.flZ!) + 32;
      fx.burst(ai.flX!, y, ai.flZ!, 14, GlowPal.FlareRed, 0.1);
      fx.sparkles(ai.flX!, y, ai.flZ!, 18, 14, GlowPal.FlareRed, 1.4);
      fx.ring(ai.flX!, y, ai.flZ!, 4, 26, GlowPal.FlareRed, 0.5, 1.2);
    }
    m.mark = mark;
    return (ai.markRef ?? 0) === 0 ? mark : 0;
  }

  /** The player is marked: a red reticle on the water and a flare hanging overhead. */
  private markOnPlayer(run: Readonly<RunState>, seconds: number): void {
    const k = this.k;
    const p = run.player;
    if (!p.alive) return;
    const fade = Math.min(1, seconds / 0.8);
    const L = p.length;
    k.decals.imm(Decal.Reticle, p.x, p.z, L * 0.62, L * 0.62, k.clock * -0.9, 1, 0, 0xff3b30, 0.6 * fade, 0x7a0f14, 0.45, 0.5);
    const wy = this.fx.wy(p.x, p.z);
    const gs = k.glow.spec.reset();
    gs.at(p.x, wy + 30 + Math.sin(k.clock * 3) * 0.8, p.z).look(Glow.Soft, GlowPal.FlareRed).sized(7, 7).lived(10).bright((1.1 + Math.sin(k.clock * 17) * 0.25) * fade);
    k.glow.imm(0.02);
    if (rand() < 0.3 * k.q) {
      const c = k.cel.spec.reset();
      c.at(p.x + spread(1), wy + 29, p.z + spread(1)).vel(0, -1.5, 0).dragTo(1.5, k.windX, -0.5, k.windZ).look(Cel.Puff, CelPal.FlareSmoke).sized(1, 3.2, 3).lived(2, 0.4);
      k.cel.emit();
    }
  }

  // ───────────── harpooner ─────────────

  private harpooner(e: EnemyState, m: Memo, run: Readonly<RunState>): void {
    const k = this.k;
    const ai = e.ai;
    const tether = ai.tether ?? 0;
    if (tether === 1) {
      const ref = ai.tetherRef ?? 0;
      if (shipFrame(run, k.ships, e.id, this.frame, this.waterY)) {
        const f = this.frame;
        const bx = f.x + f.fx * f.length * 0.46, bz = f.z + f.fz * f.length * 0.46;
        let tx: number, tz: number, ty: number;
        if (ref === 0 || ref > 0) {
          if (!shipFrame(run, k.ships, 0, this.frame2, this.waterY)) return;
          tx = this.frame2.x; tz = this.frame2.z; ty = this.frame2.gunY + 0.5;
        } else {
          const cpt = run.captains.find((c) => c.id === ref);
          if (!cpt) return;
          tx = cpt.x; tz = cpt.z; ty = this.fx.wy(cpt.x, cpt.z) + 3;
        }
        // Taut line (it hums): little sag, a bright core; spray where it cuts the water.
        k.ropes.add(bx, f.gunY + 0.8, bz, tx, ty, tz, 0.15, 0.5, 0.72, 0.58, 0.42, 0);
        if (rand() < 0.35 * k.q) {
          const u = rand();
          const x = bx + (tx - bx) * u, z = bz + (tz - bz) * u;
          this.fx.droplets(x, this.fx.wy(x, z) + 0.4, z, 1, 2, 4, 0.5);
        }
      }
    } else if (m.tether === 1) {
      // The line snapped (boost, distance or time): a whip of spray at the harpooner's bow.
      if (shipFrame(run, k.ships, e.id, this.frame, this.waterY)) {
        const f = this.frame;
        this.fx.sparks(f.x + f.fx * f.length * 0.46, f.gunY + 1, f.z + f.fz * f.length * 0.46, 8, 16, GlowPal.Spark, f.fx, 0.5, f.fz, 0.4, 0.35);
      }
    }
    m.tether = tether;
  }

  // ───────────── lantern wisps ─────────────

  private wisp(e: EnemyState, m: Memo, run: Readonly<RunState>, dt: number): void {
    const k = this.k;
    const fx = this.fx;
    const wy = fx.wy(e.x, e.z);
    const y = wy + 3.2 + Math.sin(k.clock * 2.1 + e.id * 1.3) * 0.45;
    const latched = e.ai.wl === 1;
    const flick = 0.85 + Math.sin(k.clock * 11 + e.id * 3.7) * 0.12 + Math.sin(k.clock * 23 + e.id) * 0.06;
    const gs = k.glow.spec.reset();
    gs.at(e.x, y, e.z).look(Glow.Soft, GlowPal.Teal).sized(latched ? 9 : 6.5, latched ? 9 : 6.5).lived(10).bright((latched ? 1.2 : 0.8) * flick);
    k.glow.imm(0.02);
    if (rand() < dt * 10 * k.q) {
      const s = k.glow.spec.reset();
      s.at(e.x + spread(0.8), y - 0.5, e.z + spread(0.8)).vel(spread(0.6), range(0.5, 1.5), spread(0.6)).look(Glow.Ember, GlowPal.Teal).sized(0.7, 0.2).lived(range(0.5, 1));
      k.glow.emit();
    }
    k.decals.imm(Decal.Glow, e.x, e.z, 7, 7, 0, 4, 0, 0x6affd9, 0, 0x6affd9, 0.45 * flick, 0.5, 0.5);
    if (latched) {
      // Drain: teal motes pulled out of the hull into the lantern.
      const p = run.player;
      if (rand() < dt * 14 * k.q) {
        const s = k.glow.spec.reset();
        const dx = e.x - p.x, dz = e.z - p.z;
        s.at(p.x + dx * 0.4 + spread(1.5), wy + 2.5, p.z + dz * 0.4 + spread(1.5)).vel(dx * 2.2, 1.5, dz * 2.2).look(Glow.Spark, GlowPal.Teal, Mode.Velocity).sized(0.6, 0.3).stretched(1, 0.08).lived(0.35);
        k.glow.emit();
      }
    } else if (m.wl === 1) fx.burst(e.x, y, e.z, 6, GlowPal.Teal, 0.08);
    m.wl = e.ai.wl ?? 0;
  }

  // ───────────── drowned galleon ─────────────

  private galleon(e: EnemyState, m: Memo, dt: number): void {
    const k = this.k;
    const fx = this.fx;
    const dg = e.ai.dg ?? -1;
    const r = e.length * FOES.drowned.ring;
    if (dg === 1) {
      // Rising telegraph: boiling bubbles and a sickly glow under the ring.
      if (rand() < dt * 40 * k.q) fx.bubbles(e.x + spread(r * 0.8), e.z + spread(r * 0.8), 1, 3, 2.6);
      k.decals.imm(Decal.Glow, e.x, e.z, r * 1.1, r * 1.1, 0, 10, 0, 0x2fe0b4, 0, 0x2fe0b4, 0.7, 0.5, 0.5);
      if (rand() < dt * 6) k.ocean?.stampFoam(e.x, e.z, r * 0.5, 0.12);
    } else if (dg === 2 || dg === 4) {
      // Surfacing / diving: water pours off the hull, foam churns.
      if (rand() < dt * 18 * k.q) {
        const a = rand() * TAU, rr = rand() * e.length * 0.45;
        fx.column(e.x + Math.cos(a) * rr, e.z + Math.sin(a) * rr, 3, 1.8, 0.6);
      }
      if (rand() < dt * 20 * k.q) fx.bubbles(e.x + spread(e.length * 0.3), e.z + spread(e.length * 0.3), 1, 2, 2.2);
      if (rand() < dt * 6) k.ocean?.stampFoam(e.x, e.z, e.length * 0.35, 0.12);
    }
    if (dg === 2 && m.dg === 1) {
      // Breach: towering columns along the hull and a ring of spray (the sim emits the water blast).
      for (let j = 0; j < 5; j++) {
        const along = (j / 4 - 0.5) * e.length * 0.7;
        fx.column(e.x - Math.sin(e.heading) * along, e.z - Math.cos(e.heading) * along, 8 + rand() * 4, 3, 1.3, j * 0.05);
      }
      fx.droplets(e.x, fx.wy(e.x, e.z) + 6, e.z, 36, 12, 18, 1.2);
      k.juice.shakeAt(0.35, Math.hypot(e.x - k.focusX, e.z - k.focusZ), 0.45, 60, 380);
    }
    m.dg = dg;
  }

  // ───────────── elite affixes ─────────────

  private affixes(e: EnemyState, m: Memo, run: Readonly<RunState>, dt: number): void {
    const k = this.k;
    const fx = this.fx;
    const L = e.length;
    const wy = fx.wy(e.x, e.z);
    const deck = wy + Math.max(2.5, L * 0.1);
    for (const a of e.affixes) {
      switch (a) {
        case 'burning':
          if (rand() < dt * 10 * k.q) fx.embers(e.x + spread(L * 0.25), deck + 1, e.z + spread(L * 0.25), 1, 1);
          if (rand() < dt * 3 * k.q) fx.flames(e.x + spread(L * 0.2), deck, e.z + spread(L * 0.2), 1, L * 0.12, 1, 0.6);
          break;
        case 'swift':
          if (e.speed > 4 && rand() < dt * 14 * k.q) {
            const side = rand() < 0.5 ? -1 : 1;
            const fxv = -Math.sin(e.heading), fzv = -Math.cos(e.heading);
            const gs = k.glow.spec.reset();
            gs.at(e.x + fxv * range(-0.3, 0.4) * L - fzv * side * L * 0.3, deck + range(0, 5), e.z + fzv * range(-0.3, 0.4) * L + fxv * side * L * 0.3)
              .vel(-fxv * 60, 0, -fzv * 60).look(Glow.Streak, GlowPal.Shield, Mode.Velocity).sized(0.3, 0.25).stretched(16).lived(0.3).bright(0.6);
            k.glow.emit();
          }
          break;
        case 'vampiric':
          if ((e.ai.vampT ?? 0) > 0.55 && rand() < 0.8) {
            // Siphon: red motes streaming from the player into the ship.
            const p = run.player;
            for (let i = 0; i < 3; i++) {
              const u = rand();
              const x = p.x + (e.x - p.x) * u, z = p.z + (e.z - p.z) * u;
              const gs = k.glow.spec.reset();
              gs.at(x, fx.wy(x, z) + 4 + Math.sin(u * Math.PI) * 6, z).vel((e.x - p.x) * 0.8, 0, (e.z - p.z) * 0.8).look(Glow.Spark, GlowPal.FlareRed, Mode.Velocity)
                .sized(0.7, 0.3).stretched(1, 0.05).lived(0.5);
              k.glow.emit();
            }
          }
          if (rand() < dt * 2 * k.q) fx.soft(e.x, deck + 2, e.z, L * 0.5, GlowPal.FlareRed, 0.5, 0.25);
          break;
        case 'volatile':
          if (rand() < dt * 8 * k.q) fx.sparks(e.x + spread(L * 0.25), deck + 0.5, e.z + spread(L * 0.25), 1, 6, GlowPal.Explosion, 0, 1, 0, 0.6, 0.3, 0, 0.4);
          break;
        case 'commander': {
          const pulse = 0.18 + Math.sin(k.clock * 2 + e.id) * 0.05;
          k.decals.imm(Decal.Ring, e.x, e.z, AURA_RADIUS, AURA_RADIUS, k.clock * 0.1, 1, 0.975, AFFIXES.commander.color, pulse, 0x3a1466, 0.3, 0.5);
          const gs = k.glow.spec.reset();
          gs.at(e.x, deck + L * 0.55, e.z).look(Glow.Sparkle, GlowPal.Magic).sized(4, 4).lived(1000).rotate(k.clock * 1.5);
          k.glow.imm(k.clock % 100);
          break;
        }
        default: break;
      }
    }
    const shield = e.ai.shield ?? 0;
    if (m.shield > 0.5 && shield <= 0.01 && (e.ai.shieldMax ?? 0) > 0) {
      // The bubble breaks: a blue burst and shards.
      fx.burst(e.x, deck + 3, e.z, L * 0.9, GlowPal.Shield, 0.1);
      fx.sparkles(e.x, deck + 3, e.z, 24, 18, GlowPal.Shield, 0.9);
      fx.ring(e.x, deck + 2, e.z, L * 0.4, L * 1.4, GlowPal.Shield, 0.45, 1.2);
    }
    m.shield = shield;
  }
}
