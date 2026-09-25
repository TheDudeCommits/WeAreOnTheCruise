/**
 * Per-frame RunState visuals: projectiles (heads + analytic trails + emitters + ghost trails), hazards,
 * pickups, telegraph decals, the aim reticle and broadside wedge, enemy statuses, sinking ships, and the
 * player's skill auras (brace, shield, boost, Lionburst airtime, Deep Dive, frenzy).
 */
import { CONTENT } from '../../game/content';
import type { ProjectileKind } from '../../game/ids';
import { rangeMul } from '../../game/sim/stats';
import type { BossState, CaptainState, EnemyState, HazardState, PickupState, RunState } from '../../game/types';
import type { FrameContext } from '../frame';
import { CelPal, GlowPal, INK_HEX, Lin } from './core/palette';
import { hash01, rand, range, spread } from './core/rand';
import { Mode } from './core/SpritePass';
import type { EventFx } from './EventFx';
import type { FxKit } from './Kit';
import { Cel } from './passes/CelSprites';
import { Decal } from './passes/Decals';
import { Glow } from './passes/GlowSprites';
import { Head } from './passes/Heads';
import { Prop } from './passes/Props';
import type { Sakuga } from './Sakuga';
import { ShipFrame, findShip, shipFrame } from './ShipFrames';

const TAU = Math.PI * 2;
const GRAVITY = 18; // matches src/game/sim/projectiles.ts

interface KindVis {
  head: number; size: number; stretch: number; color: number; mode: number;
  trail: number; width: number; pal: number; swell: number; ballistic: boolean;
  smoke: number; glow: number; glowPal: number; spin: number;
  /** Visual-only lob for flat shots (m/s²): the head and trail follow a parabola that lands exactly at ttl. */
  arc: number;
}

const V = (head: number, size: number, color: number, trail: number, width: number, pal: number, extra: Partial<KindVis> = {}): KindVis => ({
  head, size, stretch: 1, color, mode: Mode.Screen, trail, width, pal, swell: 0.6, ballistic: false, smoke: 0, glow: 0, glowPal: pal, spin: 0, arc: 0, ...extra,
});

const KINDS: Record<ProjectileKind, KindVis> = {
  cannonball: V(Head.Ball, 1.3, 0x2c2c38, 0.3, 0.62, GlowPal.Muzzle, { arc: 14 }),
  'chain-shot': V(Head.Chain, 2.6, 0x30303c, 0.22, 0.7, GlowPal.Muzzle, { spin: 16, arc: 14 }),
  'heavy-shot': V(Head.Ball, 1.8, 0x3a2622, 0.3, 0.95, GlowPal.Explosion, { glow: 4.5, glowPal: GlowPal.Explosion, arc: 10 }),
  'chaser-shot': V(Head.Slug, 1.1, 0x6a5234, 0.2, 0.5, GlowPal.Spark, { stretch: 2, mode: Mode.Velocity, arc: 5 }),
  lance: V(Head.Pellet, 2.2, 0xfff0b0, 0.3, 2.2, GlowPal.Gold, { glow: 9, glowPal: GlowPal.Gold, swell: 1.2 }),
  'mortar-shell': V(Head.Shell, 2.0, 0x2c2c38, 0.4, 0.75, GlowPal.Muzzle, { ballistic: true, smoke: 14 }),
  bomblet: V(Head.Ball, 1.0, 0x2c2c38, 0.25, 0.45, GlowPal.Muzzle, { ballistic: true }),
  'swivel-shot': V(Head.Pellet, 0.55, 0xfff2b0, 0.09, 0.28, GlowPal.Spark),
  grapeshot: V(Head.Pellet, 0.45, 0xfff2b0, 0.07, 0.22, GlowPal.Spark),
  harpoon: V(Head.Spear, 1.3, 0xffffff, 0, 0, GlowPal.Spark, { stretch: 3.2, mode: Mode.Velocity }),
  rocket: V(Head.Rocket, 1.1, 0xffffff, 0.12, 0.7, GlowPal.Explosion, { stretch: 2.6, mode: Mode.Velocity, smoke: 42, glow: 4, glowPal: GlowPal.Explosion }),
  torpedo: V(Head.Torpedo, 0, 0x1a2a3a, 0, 0, GlowPal.WaterBolt),
  'skiff-shot': V(Head.Ball, 0.8, 0x2c2c38, 0.14, 0.38, GlowPal.Muzzle, { arc: 10 }),
  'enemy-cannonball': V(Head.Ball, 1.3, 0x2e2428, 0.3, 0.62, GlowPal.Enemy, { arc: 12 }),
  'enemy-chaser': V(Head.Slug, 1.1, 0x5a2a2a, 0.2, 0.55, GlowPal.Enemy, { stretch: 2, mode: Mode.Velocity, arc: 5 }),
  'enemy-mortar': V(Head.Shell, 2.0, 0x2e2428, 0.4, 0.75, GlowPal.Enemy, { ballistic: true, smoke: 14 }),
  'water-bolt': V(Head.Orb, 2.8, 0x2ab8ff, 0.28, 1.5, GlowPal.WaterBolt, { glow: 5, glowPal: GlowPal.WaterBolt, smoke: 0, arc: 6 }),
  'boss-shell': V(Head.Shell, 2.6, 0x2e2428, 0.45, 0.95, GlowPal.Enemy, { ballistic: true, smoke: 16 }),
  // Round 1 (FOES): the harpoon's rope and the bomb's keg body are drawn by FoeFx.
  'enemy-harpoon': V(Head.Spear, 1.5, 0xd8d0c0, 0, 0, GlowPal.Enemy, { stretch: 3.2, mode: Mode.Velocity }),
  'enemy-bomb': V(Head.Ball, 0.6, 0x2e2428, 0.4, 0.55, GlowPal.Ember, { ballistic: true, smoke: 10 }),
  'enemy-flare': V(Head.Pellet, 1.2, 0xff6a5a, 0.3, 0.8, GlowPal.FlareRed, { glow: 4, glowPal: GlowPal.FlareRed }),
};

const KIND_LIN = new Map<ProjectileKind, Lin>();
for (const key of Object.keys(KINDS) as ProjectileKind[]) KIND_LIN.set(key, new Lin().hex(KINDS[key].color));
const KIND_INDEX = new Map<ProjectileKind, number>();
(Object.keys(KINDS) as ProjectileKind[]).forEach((key, i) => KIND_INDEX.set(key, i));
const KIND_BY_INDEX = Object.keys(KINDS) as ProjectileKind[];

const SLOT_CAP = 2048;
const GHOST_CAP = 384;
const HAZ_CAP = 512;
/** Battle-damage smoke starts below this hull fraction (deck fire below 30%). */
const DAMAGE_SMOKE_HP = 0.5;
/** Damaged ships that may smoke at the full rate at once; beyond that they share the rate. */
const DAMAGE_SMOKE_SHIPS = 5;

const PICKUP_HEX: Record<PickupState['kind'], number> = {
  'xp-copper': 0xe0874a, 'xp-silver': 0xe6eef6, 'xp-gold': 0xffc93a, doubloon: 0xffd24a, repair: 0xffffff,
  compass: 0x8fd8ff, 'powder-keg': 0x4d4856, chest: 0xffffff,
};

export class StateFx {
  private readonly frame = new ShipFrame();
  // projectile slot tracking (index-based; the sim reuses dead slots)
  private readonly slotId = new Int32Array(SLOT_CAP).fill(-1);
  private readonly slotAlive = new Uint8Array(SLOT_CAP);
  private readonly slotKind = new Int8Array(SLOT_CAP);
  private readonly slotX = new Float32Array(SLOT_CAP * 3);
  private readonly slotV = new Float32Array(SLOT_CAP * 3);
  private readonly slotAge = new Float32Array(SLOT_CAP);
  private readonly slotCrit = new Uint8Array(SLOT_CAP);
  private readonly slotG = new Float32Array(SLOT_CAP);
  private readonly emitAcc = new Float32Array(SLOT_CAP);
  // ghost trails (a dead shot's trail catching up to its end point)
  private readonly ghostX = new Float32Array(GHOST_CAP * 3);
  private readonly ghostV = new Float32Array(GHOST_CAP * 3);
  private readonly ghostAge = new Float32Array(GHOST_CAP).fill(99);
  private readonly ghostDur = new Float32Array(GHOST_CAP);
  private readonly ghostKind = new Int8Array(GHOST_CAP);
  private readonly ghostCrit = new Uint8Array(GHOST_CAP);
  private readonly ghostG = new Float32Array(GHOST_CAP);
  private ghostHead = 0;
  // hazard slot tracking
  private readonly hazId = new Int32Array(HAZ_CAP).fill(-1);
  private readonly hazAlive = new Uint8Array(HAZ_CAP);
  private readonly hazR0 = new Float32Array(HAZ_CAP);
  private readonly hazTick = new Float32Array(HAZ_CAP);
  private readonly hazX = new Float32Array(HAZ_CAP * 2);
  private readonly hazKind = new Int8Array(HAZ_CAP);
  // player transitions
  private prevAir = 0;
  private prevSub = 0;
  private emitPlayer = 0;
  /** Smoke rules: this frame's damage-smoke rate multiplier for ordinary ships (shared between smokers). */
  private smokeShare = 1;

  private readonly waterY = (x: number, z: number): number => this.fx.wy(x, z);

  constructor(private readonly k: FxKit, private readonly fx: Sakuga, private readonly events: EventFx) {}

  reset(): void {
    this.slotId.fill(-1); this.slotAlive.fill(0); this.ghostAge.fill(99); this.emitAcc.fill(0);
    this.hazId.fill(-1); this.hazAlive.fill(0);
    this.prevAir = this.prevSub = 0;
  }

  render(ctx: FrameContext, run: Readonly<RunState>, dt: number): void {
    this.projectiles(run, dt);
    this.ghosts(dt);
    this.hazards(ctx, run, dt);
    this.pickups(run);
    this.telegraphs(run);
    // Smoke rules: damage smoke shares a budget, so a horde of damaged ships never blankets the sea.
    let smokers = 0;
    const fx0 = this.k.focusX, fz0 = this.k.focusZ;
    for (const e of run.enemies) {
      if (e.life === 'alive' && e.hidden < 1 && e.defId !== 'kraken-arm' && e.hp < e.maxHp * DAMAGE_SMOKE_HP && (e.x - fx0) ** 2 + (e.z - fz0) ** 2 < 480 * 480) smokers++;
    }
    this.smokeShare = Math.min(1, DAMAGE_SMOKE_SHIPS / Math.max(1, smokers));
    for (const e of run.enemies) if (e.hidden < 1 && e.defId !== 'kraken-arm') this.ship(e, dt, false);
    for (const b of run.bosses) this.ship(b, dt, true);
    for (const c of run.captains) if (c.alive) this.captain(c, dt);
    this.player(run, dt);
    this.tethers(run);
    this.aim(ctx, run);
  }

  /** Harpoon lines: from the player's bow (or the previously hooked ship) to each hooked target. */
  private tethers(run: Readonly<RunState>): void {
    const ev = this.events;
    const k = this.k;
    const f = this.frame;
    let haveBow = false;
    let bx = 0, by = 0, bz = 0;
    for (let i = 0; i < ev.tetherTo.length; i++) {
      const to = ev.tetherTo[i]!;
      if (to < 0) continue;
      const t = findShip(run, to);
      let held = false;
      if (t && t.life === 'alive') for (const st of t.statuses) if ((st.kind === 'hooked' || st.kind === 'slowed') && st.time > 0) held = true;
      if (!held || k.clock - ev.tetherT[i]! > 12) { ev.tetherTo[i] = -1; continue; }
      const from = ev.tetherFrom[i]!;
      let x1: number, y1: number, z1: number;
      if (from === 0) {
        if (!haveBow) {
          if (!shipFrame(run, k.ships, 0, f, this.waterY)) { continue; }
          bx = f.x + f.fx * f.length * 0.48; bz = f.z + f.fz * f.length * 0.48; by = f.gunY + 0.5;
          haveBow = true;
        }
        x1 = bx; y1 = by; z1 = bz;
      } else {
        const s = findShip(run, from);
        if (!s) { ev.tetherTo[i] = -1; continue; }
        x1 = s.x; z1 = s.z; y1 = this.fx.wy(s.x, s.z) + Math.max(3, s.length * 0.12);
      }
      const y2 = this.fx.wy(t!.x, t!.z) + Math.max(3, t!.length * 0.12);
      const d = Math.hypot(t!.x - x1, t!.z - z1);
      const sag = Math.max(0.3, Math.min(3, 60 / Math.max(10, d)));
      k.ropes.add(x1, y1, z1, t!.x, y2, t!.z, sag, 0.24, 0.36, 0.22, 0.1, 0);
    }
  }

  // ───────────── projectiles ─────────────

  private projectiles(run: Readonly<RunState>, dt: number): void {
    const list = run.projectiles;
    const k = this.k;
    const n = Math.min(list.length, SLOT_CAP);
    for (let i = n; i < SLOT_CAP; i++) if (this.slotAlive[i]) { this.slotAlive[i] = 0; this.slotId[i] = -1; }
    for (let i = 0; i < n; i++) {
      const p = list[i]!;
      if (this.slotAlive[i] && (!p.alive || p.id !== this.slotId[i])) this.ghost(i);
      if (!p.alive) { this.slotAlive[i] = 0; continue; }
      if (this.slotId[i] !== p.id) {
        this.emitAcc[i] = rand();
        // Full Broadside: balls fired inside the manual volley window get the set-piece hits (EventFx).
        if (p.team === 'player' && p.weapon === 'broadside' && this.events.manualVolleyOpen()) this.events.trackVolleyBall(i, p.id);
      }
      const vis = KINDS[p.kind];
      const lin = KIND_LIN.get(p.kind)!;
      let y = p.y;
      const wy = this.fx.wy(p.x, p.z);
      if (!vis.ballistic && p.kind !== 'torpedo') y = Math.max(y, wy + 1.1);
      let g = vis.ballistic ? GRAVITY : 0;
      let vy = p.vy;
      if (vis.arc > 0 && p.target === undefined) {
        // visual lob: lands exactly at ttl (hits are XZ-only in the sim, so gameplay is unchanged)
        const T = Math.max(0.05, p.ttl);
        const a = Math.min(p.age, T);
        g = vis.arc;
        y += g * a * (T - a) * 0.5;
        vy = g * (T * 0.5 - a);
      }
      this.slotAlive[i] = 1; this.slotId[i] = p.id; this.slotKind[i] = KIND_INDEX.get(p.kind)!; this.slotAge[i] = p.age;
      this.slotX[i * 3] = p.x; this.slotX[i * 3 + 1] = y; this.slotX[i * 3 + 2] = p.z;
      this.slotV[i * 3] = p.vx; this.slotV[i * 3 + 1] = vy; this.slotV[i * 3 + 2] = p.vz;
      this.slotCrit[i] = p.crit ? 1 : 0;
      this.slotG[i] = g;

      if (p.kind === 'torpedo') { this.torpedo(p.x, p.z, p.vx, p.vz, wy, i, dt); continue; }
      // trail
      if (vis.trail > 0) {
        const crit = p.crit && p.team === 'player';
        k.trails.add(p.x, y, p.z, p.age, p.vx, vy, p.vz, g, vis.trail, vis.width * (crit ? 1.3 : 1), crit ? GlowPal.Gold : vis.pal, vis.swell, 1, 1, 1, crit ? 1.5 : 1);
      }
      // head
      const hs = k.heads.spec.reset();
      hs.at(p.x, y, p.z).vel(p.vx, vy, p.vz).look(vis.head, 0, vis.mode).sized(vis.size, vis.size).stretched(vis.stretch)
        .tint(lin.r, lin.g, lin.b).rotate(vis.spin ? p.age * vis.spin + p.id : 0);
      hs.seed = (p.id % 97) / 97;
      k.heads.imm(0);
      if (vis.glow > 0) {
        const gs = k.glow.spec.reset();
        gs.at(p.x, y, p.z).look(p.kind === 'lance' ? Glow.Burst : Glow.Soft, vis.glowPal).sized(vis.glow, vis.glow).lived(10).bright(p.kind === 'lance' ? 0.9 : 0.5).rotate(p.age * 7);
        k.glow.imm(0.02);
      }
      // emitters
      if (vis.smoke > 0) {
        this.emitAcc[i]! += dt * vis.smoke * k.q;
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
        while (this.emitAcc[i]! >= 1) {
          this.emitAcc[i]! -= 1;
          const back = p.kind === 'rocket' ? 1.8 : 1.2;
          const c = k.cel.spec.reset();
          const big = p.kind === 'rocket' ? 1 : 0.7;
          c.at(p.x - p.vx / sp * back + spread(0.3), y - p.vy / sp * back, p.z - p.vz / sp * back + spread(0.3))
            .vel(spread(1.5), range(0.2, 1.2), spread(1.5)).dragTo(2.2, k.windX * 0.7, 0.8, k.windZ * 0.7)
            .look(Cel.Puff, CelPal.Gunsmoke).sized(0.9 * big, range(2.4, 3.6) * big, 3).rotate(rand() * TAU).lived(range(0.7, 1.1), 0.3);
          k.cel.emit();
        }
        if (p.kind === 'rocket') {
          const gs = k.glow.spec.reset();
          gs.at(p.x - p.vx / sp * 1.4, y - p.vy / sp * 1.4, p.z - p.vz / sp * 1.4).vel(-p.vx, -p.vy, -p.vz).look(Glow.DirFlash, GlowPal.Explosion, Mode.Velocity, true)
            .sized(2.6, 2.6).stretched(1.4).lived(10);
          k.glow.imm(0.01);
        }
      }
      if (p.kind === 'water-bolt') {
        this.emitAcc[i]! += dt * 22 * k.q;
        while (this.emitAcc[i]! >= 1) { this.emitAcc[i]! -= 1; this.fx.droplets(p.x, y, p.z, 1, 3, 2, 0.6, 0, 0.6); }
      }
      if (p.kind === 'harpoon' && p.team === 'player') this.harpoonRope(run, p.x, y, p.z);
    }
  }

  private torpedo(x: number, z: number, vx: number, vz: number, wy: number, slot: number, dt: number): void {
    const k = this.k;
    const ang = Math.atan2(vx, vz);
    k.decals.imm(Decal.Torpedo, x, z, 2.6, 7, ang, 0, 0, 0xffffff, 1, 0x0b2438, 0, 0.5);
    const sp = Math.hypot(vx, vz) || 1;
    this.emitAcc[slot]! += dt * 26 * k.q;
    while (this.emitAcc[slot]! >= 1) {
      this.emitAcc[slot]! -= 1;
      const back = rand() * 4;
      const bx = x - vx / sp * back + spread(0.8), bz = z - vz / sp * back + spread(0.8);
      const c = k.cel.spec.reset();
      c.at(bx, wy + 0.2, bz).vel(0, range(0.2, 0.8), 0).dragTo(2, 0, 0.1, 0).look(Cel.Bubble, CelPal.Foam).sized(0.5, range(0.9, 1.6), 2).lived(range(0.4, 0.8), 0.5);
      k.cel.emit();
    }
    k.ocean?.stampWake(x, z, vx / sp, vz / sp, 2.4, 0.6);
  }

  private harpoonRope(run: Readonly<RunState>, x: number, y: number, z: number): void {
    const f = this.frame;
    if (!shipFrame(run, this.k.ships, 0, f, this.waterY)) return;
    const bx = f.x + f.fx * f.length * 0.48, bz = f.z + f.fz * f.length * 0.48;
    this.k.ropes.add(bx, f.gunY + 0.5, bz, x, y, z, 0.6, 0.18, 0.36, 0.22, 0.1, 0);
  }

  private ghost(slot: number): void {
    const kind = KIND_BY_INDEX[this.slotKind[slot]!]!;
    const vis = KINDS[kind];
    this.slotAlive[slot] = 0;
    if (vis.trail <= 0) return;
    const i = this.ghostHead;
    this.ghostHead = (i + 1) % GHOST_CAP;
    this.ghostX[i * 3] = this.slotX[slot * 3]!; this.ghostX[i * 3 + 1] = this.slotX[slot * 3 + 1]!; this.ghostX[i * 3 + 2] = this.slotX[slot * 3 + 2]!;
    this.ghostV[i * 3] = this.slotV[slot * 3]!; this.ghostV[i * 3 + 1] = this.slotV[slot * 3 + 1]!; this.ghostV[i * 3 + 2] = this.slotV[slot * 3 + 2]!;
    this.ghostAge[i] = 0;
    this.ghostDur[i] = Math.min(vis.trail, this.slotAge[slot]!);
    this.ghostKind[i] = this.slotKind[slot]!;
    this.ghostCrit[i] = this.slotCrit[slot]!;
    this.ghostG[i] = this.slotG[slot]!;
  }

  private ghosts(dt: number): void {
    const t = this.k.trails;
    for (let i = 0; i < GHOST_CAP; i++) {
      if (this.ghostAge[i]! >= this.ghostDur[i]!) continue;
      this.ghostAge[i]! += dt;
      const remain = this.ghostDur[i]! - this.ghostAge[i]!;
      if (remain <= 0.004) continue;
      const kind = KIND_BY_INDEX[this.ghostKind[i]!]!;
      const vis = KINDS[kind];
      const crit = this.ghostCrit[i] === 1 && !kind.startsWith('enemy');
      const vx = this.ghostV[i * 3]!, vy = this.ghostV[i * 3 + 1]!, vz = this.ghostV[i * 3 + 2]!;
      t.add(this.ghostX[i * 3]!, this.ghostX[i * 3 + 1]!, this.ghostX[i * 3 + 2]!, 99, vx, vy, vz, this.ghostG[i]!,
        remain, vis.width, crit ? GlowPal.Gold : vis.pal, 0, 1, 1, 1, crit ? 1.5 : 1);
    }
  }

  // ───────────── hazards ─────────────

  private hazards(ctx: FrameContext, run: Readonly<RunState>, dt: number): void {
    const list = run.hazards;
    const n = Math.min(list.length, HAZ_CAP);
    for (let i = 0; i < n; i++) {
      const h = list[i]!;
      if (this.hazAlive[i] && (!h.alive || h.id !== this.hazId[i])) this.hazardDied(i);
      if (!h.alive) { this.hazAlive[i] = 0; continue; }
      if (this.hazId[i] !== h.id) { this.hazR0[i] = h.radius; this.hazTick[i] = h.tickTimer; }
      this.hazAlive[i] = 1; this.hazId[i] = h.id;
      this.hazX[i * 2] = h.x; this.hazX[i * 2 + 1] = h.z;
      this.hazKind[i] = HAZ_KINDS.indexOf(h.kind);
      const ticked = h.tick > 0 && h.tickTimer > this.hazTick[i]! + 1e-4;
      this.hazTick[i] = h.tickTimer;
      this.hazard(h, i, dt, ticked, ctx);
    }
  }

  private hazardDied(slot: number): void {
    this.hazAlive[slot] = 0;
    const kind = HAZ_KINDS[this.hazKind[slot]!];
    const x = this.hazX[slot * 2]!, z = this.hazX[slot * 2 + 1]!;
    // lightning-strike expiry: the sim emits 'hazard-triggered' + a 'lightning' explosion (EventFx draws both)
    if (kind === 'burning-wreck') this.fx.sunk(x, z, 16);
    else if (kind === 'whirlpool') this.fx.foam(x, z, this.hazR0[slot]!, 1.6, 0, 1);
  }

  private hazard(h: Readonly<HazardState>, _slot: number, dt: number, ticked: boolean, _ctx: FrameContext): void {
    const k = this.k;
    const fx = this.fx;
    const wy = fx.wy(h.x, h.z);
    const fade = Math.min(1, h.age / 0.35) * Math.min(1, Math.max(0, h.ttl - h.age) / 0.6);
    const clock = k.clock;
    const id = h.id;
    switch (h.kind) {
      case 'fire-patch': {
        const r = h.radius;
        const count = Math.max(3, Math.min(12, Math.round(r / 2)));
        for (let j = 0; j < count; j++) this.loopFlame(h.x, wy, h.z, r * 0.75, r * 0.62 * fade, id, j, CelPal.Fire);
        k.decals.imm(Decal.Glow, h.x, h.z, r * 1.4, r * 1.4, 0, 14, 0, 0xff8a2a, 0, 0xff8a2a, 1.1 * fade, 0.5, 0.5);
        if (rand() < dt * 1.1 * k.q) fx.smoke(h.x + spread(r * 0.5), wy + r * 0.4, h.z + spread(r * 0.5), 1, r * 0.2, Math.min(9, r * 0.5), CelPal.DarkSmoke, 1.8, 0, 3, 0, 1, 2.6, 0.5, 0, 0.4);
        if (rand() < dt * 4 * k.q) fx.embers(h.x, wy + 1, h.z, 1, r * 0.6);
        break;
      }
      case 'barrel': {
        const bob = Math.sin(clock * 2.3 + id) * 0.25;
        k.props.add(Prop.Barrel, h.x, wy + 0.25 + bob, h.z, hash01(id, 1) * TAU, Math.PI / 2, Math.sin(clock * 1.7 + id) * 0.2, 1.05, 0xc0874a);
        this.loopFlame(h.x, wy + 1.4 + bob, h.z, 0.3, 1.8 * fade, id, 0, CelPal.Fire);
        break;
      }
      case 'powder-keg': {
        const bob = Math.sin(clock * 2.1 + id) * 0.22;
        k.props.add(Prop.Barrel, h.x, wy + 0.9 + bob, h.z, hash01(id, 1) * TAU, Math.sin(clock * 1.3 + id) * 0.12, 0, 0.9, 0x4d4856);
        const gs = k.glow.spec.reset();
        gs.at(h.x, wy + 2.7 + bob, h.z).look(Glow.Sparkle, h.armed ? GlowPal.Explosion : GlowPal.Ember).sized(2.2, 2.2).lived(1000).rotate(clock * 5);
        k.glow.imm(clock % 100);
        break;
      }
      case 'mine': {
        const bob = Math.sin(clock * 2.0 + id) * 0.3;
        k.props.add(Prop.Mine, h.x, wy + 0.5 + bob, h.z, clock * 0.4 + id, Math.sin(clock * 1.5 + id) * 0.15, 0, 1.25, 0xffffff);
        if (h.armed && Math.sin(clock * 9 + id) > 0.2) {
          const gs = k.glow.spec.reset();
          gs.at(h.x, wy + 2.0 + bob, h.z).look(Glow.Soft, GlowPal.FlareRed).sized(3.5, 3.5).lived(10).bright(1.3);
          k.glow.imm(0.02);
        }
        break;
      }
      case 'whirlpool': {
        const r = h.radius;
        k.decals.imm(Decal.Whirl, h.x, h.z, r, r, 0, 2.4, 4, 0xffffff, 0.95 * fade, 0x0a3346, 0, hash01(id, 3));
        k.ocean?.stampDisplace(h.x, h.z, r * 0.7, -2.2 * fade);
        k.ocean?.stampFoam(h.x, h.z, r, 0.35 * fade);
        if (rand() < dt * 10 * k.q) {
          const a = rand() * TAU;
          fx.droplets(h.x + Math.cos(a) * r * 0.9, wy + 0.5, h.z + Math.sin(a) * r * 0.9, 1, 3, 5, 0.6);
        }
        break;
      }
      case 'storm-cloud': {
        // `radius` is the strike range (Thunderhead: 110 m); the visible cloud is capped so it never swallows the view
        const r = h.radius;
        const vr = Math.min(r, 34);
        const cy = wy + 58;
        const count = 12;
        for (let j = 0; j < count; j++) {
          const a = hash01(id, j) * TAU + clock * 0.08;
          const rr = vr * 0.8 * Math.sqrt(hash01(id, j + 40));
          const px = h.x + Math.cos(a) * rr, py = cy + hash01(id, j + 80) * 7 - (j % 3) * 2, pz = h.z + Math.sin(a) * rr;
          const size = Math.min(22, vr * 0.62) * (0.7 + 0.5 * hash01(id, j + 120)) * fade;
          // erode puffs sitting on the camera → ship sightline
          const occl = this.sightline(px, py, pz, size * 0.5);
          const c = k.cel.spec.reset();
          c.at(px, py, pz).look(Cel.Cloud, CelPal.StormCloud).sized(size, 1).rotate(hash01(id, j + 160) * TAU).lived(10, 0.5);
          c.seed = hash01(id, j + 200);
          k.cel.imm(10 * (0.3 + 0.66 * occl));
        }
        k.decals.imm(Decal.Shadow, h.x, h.z, vr * 1.4, vr * 1.4, 0, 0, 0, 0x061426, 0.4 * fade, 0x061426, 0, 0.5);
        // ambient intra-cloud flicker only: damaging strikes arrive as 'lightning' events from the sim
        if (rand() < dt * 0.5) {
          const a = rand() * TAU;
          fx.bolt(h.x + Math.cos(a) * vr * 0.5, cy + spread(3), h.z + Math.sin(a) * vr * 0.5, h.x - Math.cos(a) * vr * 0.3, cy - 3, h.z - Math.sin(a) * vr * 0.3,
            0.7, GlowPal.Lightning, 0.14, 0, 1, 3);
        }
        if (ticked) fx.soft(h.x, cy, h.z, vr * 1.6, GlowPal.Lightning, 0.2, 0.5);
        // rain streaks
        const rain = Math.round(dt * 70 * k.q);
        for (let j = 0; j < rain; j++) {
          const gs = k.glow.spec.reset();
          gs.at(h.x + spread(vr * 0.8), cy - 6, h.z + spread(vr * 0.8)).vel(k.windX * 2, -48, k.windZ * 2).look(Glow.Streak, GlowPal.Shield, Mode.Velocity)
            .sized(0.25, 0.25).stretched(18).lived(0.8).bright(0.35);
          k.glow.emit();
        }
        break;
      }
      case 'shockwave': {
        // contract: radius is the FINAL radius; the damage front is radius·(1 − (1 − k)²) (CORE)
        const t = Math.min(0.999, h.age / Math.max(0.05, h.ttl));
        const size = h.radius;
        k.decals.imm(Decal.Shock, h.x, h.z, size, size, 0, 1.4, 2, 0xffffff, 0.7, 0xbfeaff, 1.4, 0.5, t);
        const front = size * (1 - (1 - t) * (1 - t));
        k.ocean?.stampRing(h.x, h.z, front, 0.6 * (1 - t));
        const nd = Math.round(dt * 60 * k.q);
        for (let j = 0; j < nd; j++) {
          const a = rand() * TAU;
          fx.droplets(h.x + Math.cos(a) * front, fx.wy(h.x + Math.cos(a) * front, h.z + Math.sin(a) * front) + 0.5, h.z + Math.sin(a) * front, 1, 4, 8, 0.8);
        }
        break;
      }
      case 'wave-front': {
        const sp = Math.hypot(h.vx, h.vz);
        const ang = sp > 0.01 ? Math.atan2(h.vx, h.vz) : hash01(id, 5) * TAU;
        const dx = Math.sin(ang), dz = Math.cos(ang);
        const H = Math.min(26, 12 + h.radius * 0.1);
        k.walls.add(h.x, h.z, ang, h.radius, H, fade, hash01(id, 9), 1.35);
        k.decals.imm(Decal.Blot, h.x + dx * H * 2.2, h.z + dz * H * 2.2, h.radius * 1.02, H * 1.4, ang, 0, 0, 0xffffff, 0.9 * fade, 0x8fc3d9, 0, hash01(id, 2));
        const o = k.ocean;
        if (o) for (let j = -2; j <= 2; j++) o.stampDisplace(h.x + dz * j * h.radius * 0.4, h.z - dx * j * h.radius * 0.4, H, 2.5 * fade);
        const nd = Math.round(dt * 50 * k.q);
        for (let j = 0; j < nd; j++) {
          const u = spread(h.radius * 0.95);
          const x = h.x + dz * u + dx * H * 1.5, z = h.z - dx * u + dz * H * 1.5;
          const c = k.cel.spec.reset();
          c.at(x, wy + H * 0.9, z).vel(dx * range(6, 14) + h.vx, range(4, 10), dz * range(6, 14) + h.vz).accel(0, -20, 0)
            .look(Cel.Droplet, CelPal.Water, Mode.Velocity).sized(range(0.6, 1.2), 0.8).stretched(1, 0.05).lived(range(0.6, 1.0), 0.75);
          k.cel.emit();
        }
        break;
      }
      case 'lightning-strike': {
        const t = Math.min(1, h.age / Math.max(0.05, h.ttl));
        k.decals.telegraph(Decal.TeleCircle, h.x, this.flatHeight(h.x, h.z, h.radius), h.z, h.radius, t, 0, 0x8fdcff);
        if (rand() < dt * 14) {
          const a = rand() * TAU;
          fx.sparks(h.x + Math.cos(a) * h.radius * 0.5, wy + 0.5, h.z + Math.sin(a) * h.radius * 0.5, 2, 10, GlowPal.Lightning, 0, 1, 0, 0.5, 0.25);
        }
        const gs = k.glow.spec.reset();
        gs.at(h.x, wy + 2, h.z).look(Glow.Soft, GlowPal.Lightning).sized(h.radius * 1.4, h.radius * 1.4).lived(10).bright(0.35 + 0.3 * t);
        k.glow.imm(0.02);
        break;
      }
      case 'burning-wreck': {
        for (let j = 0; j < 6; j++) {
          const a = hash01(id, j) * TAU, rr = h.radius * 0.5 * hash01(id, j + 20);
          const px = h.x + Math.cos(a) * rr, pz = h.z + Math.sin(a) * rr;
          k.debris.imm(px, fx.wy(px, pz) + 0.15 + Math.sin(clock * 1.8 + j) * 0.08, pz, Math.sin(clock + j) * 0.1, hash01(id, j + 40) * TAU,
            Math.cos(clock * 1.3 + j) * 0.1, 2 + hash01(id, j + 60) * 3, 0.9, j % 3 === 0 ? 0x3a2a24 : 0x6b4226);
        }
        for (let j = 0; j < 4; j++) this.loopFlame(h.x, wy + 0.4, h.z, h.radius * 0.5, 4.5 * fade, id, j, CelPal.Fire);
        k.decals.imm(Decal.Glow, h.x, h.z, h.radius * 1.3, h.radius * 1.3, 0, 12, 0, 0xff8a2a, 0, 0xff8a2a, fade, 0.5, 0.5);
        if (rand() < dt * 5 * k.q) fx.smoke(h.x, wy + 4, h.z, 1, 3, 9, CelPal.WreckSmoke, 3, 0, 5, 0, 1, 4, 1.5, 0, 0.45);
        break;
      }
      case 'escort-skiff': {
        const sp = Math.hypot(h.vx, h.vz);
        if (sp > 0.5) {
          k.ocean?.stampWake(h.x, h.z, h.vx / sp, h.vz / sp, 3, 0.5);
          if (rand() < dt * 6 * k.q) fx.droplets(h.x + h.vx / sp * 5, wy + 0.4, h.z + h.vz / sp * 5, 1, 2, 4, 0.5);
        }
        break;
      }
    }
  }

  /** 0..1: how much a sphere at (x,y,z) of `radius` blocks the camera → focus sightline (1 = right on it). */
  private sightline(x: number, y: number, z: number, radius: number): number {
    const k = this.k;
    const ax = k.camX, ay = k.camY, az = k.camZ;
    const bx = k.focusX, by = this.fx.wy(k.focusX, k.focusZ) + 4, bz = k.focusZ;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t - x, cy = ay + dy * t - y, cz = az + dz * t - z;
    const d = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const inner = radius + 4, outer = radius + 26;
    return d <= inner ? 1 : d >= outer ? 0 : 1 - (d - inner) / (outer - inner);
  }

  /** A looping cel flame (hash-stable per object/index) — boils forever without particles to track. */
  private loopFlame(x: number, y: number, z: number, radius: number, size: number, id: number, j: number, pal: number): void {
    if (size <= 0.05) return;
    const k = this.k;
    const period = 0.55 + hash01(id, j + 300) * 0.45;
    const age = (k.clock + hash01(id, j + 330) * period) % period;
    const a = hash01(id, j + 360) * TAU;
    const rr = radius * Math.sqrt(hash01(id, j + 390));
    const c = k.cel.spec.reset();
    c.at(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr).vel(0, 3, 0).dragTo(2, k.windX * 0.2, 2.2, k.windZ * 0.2)
      .look(Cel.Flame, pal, Mode.Upright, true).sized(size * 0.7, size * (0.85 + 0.3 * hash01(id, j + 420)), 2).stretched(1.35).lived(period, 0.55);
    c.seed = hash01(id, j + 450);
    k.cel.imm(age);
  }

  // ───────────── pickups ─────────────

  private pickups(run: Readonly<RunState>): void {
    const k = this.k;
    const clock = k.clock;
    const p = run.player;
    for (const pk of run.pickups) {
      if (!pk.alive) continue;
      const id = pk.id;
      const wy = this.fx.wy(pk.x, pk.z);
      const bob = Math.sin(clock * 2.6 + id) * 0.35;
      const spin = clock * 2.4 + id * 0.7;
      const pop = pk.age < 0.35 ? 1 + Math.sin((pk.age / 0.35) * Math.PI) * 0.45 : 1;
      const s = Math.min(1, pk.age * 5 + 0.2) * pop;
      const hex = PICKUP_HEX[pk.kind];
      let y = wy + 1.9 + bob;
      let glint = 0;
      switch (pk.kind) {
        case 'xp-copper': k.props.add(Prop.Coin, pk.x, y, pk.z, spin, 0, 0, 1.0 * s, hex); break;
        case 'xp-silver': k.props.add(Prop.Coin, pk.x, y, pk.z, spin, 0, 0, 1.3 * s, hex); glint = 2.5; break;
        case 'xp-gold': k.props.add(Prop.Bar, pk.x, y, pk.z, spin * 0.5, 0.25, 0, 1.25 * s, hex); glint = 4; break;
        case 'doubloon': k.props.add(Prop.Coin, pk.x, y + 0.3, pk.z, spin, 0, 0, 1.7 * s, hex); glint = 5; break;
        case 'repair': k.props.add(Prop.Crate, pk.x, wy + 0.9 + bob * 0.5, pk.z, id, Math.sin(clock + id) * 0.1, 0, 1.2 * s, hex); this.plusGlint(pk.x, wy + 4.5 + bob, pk.z, id); break;
        case 'compass': k.props.add(Prop.Coin, pk.x, y + 0.4, pk.z, spin, 0, 0, 1.6 * s, hex); glint = 4; break;
        case 'powder-keg': k.props.add(Prop.Barrel, pk.x, wy + 1.0 + bob * 0.5, pk.z, id, Math.sin(clock * 1.2 + id) * 0.12, 0, 0.95 * s, hex); glint = 3; break;
        case 'chest': {
          y = wy + 0.35 + bob * 0.4;
          k.props.add(Prop.Chest, pk.x, y, pk.z, hash01(id, 3) * TAU, Math.sin(clock * 1.1 + id) * 0.06, Math.cos(clock * 1.3 + id) * 0.05, 2.0 * s, hex);
          k.beams.imm(pk.x, wy, pk.z, pk.x, wy + 48, pk.z, 500, 1000, 2.2, GlowPal.Gold, 1, 0.5, hash01(id, 5));
          k.decals.imm(Decal.Glow, pk.x, pk.z, 9, 9, 0, 5, 0, 0xffd84a, 0, 0xffd84a, 0.9, 0.5, 0.5);
          glint = 6;
          y += 3;
          break;
        }
      }
      if (glint > 0) {
        const gs = k.glow.spec.reset();
        gs.at(pk.x, y + 0.4, pk.z).look(Glow.Glint, pk.kind === 'compass' ? GlowPal.Shield : GlowPal.Glint).sized(glint, glint).lived(1000).rotate(0.3);
        gs.seed = hash01(id, 11);
        k.glow.imm((clock % 100) + hash01(id, 12) * 5);
      }
      if (pk.magnet) {
        const dx = p.x - pk.x, dz = p.z - pk.z, d = Math.hypot(dx, dz) || 1;
        const v = 40 + Math.max(0, 140 - d) * 1.2 + pk.age * 4;
        const pal = pk.kind === 'xp-copper' ? GlowPal.Ember : pk.kind === 'xp-silver' || pk.kind === 'compass' ? GlowPal.Glint : GlowPal.Gold;
        k.trails.add(pk.x, y, pk.z, 1, dx / d * v, 0, dz / d * v, 0, 0.07, 0.45, pal, 0.8, 1, 1, 1, 0.9);
      }
    }
  }

  private plusGlint(x: number, y: number, z: number, id: number): void {
    const gs = this.k.glow.spec.reset();
    gs.at(x, y, z).look(Glow.Glint, GlowPal.Heal).sized(3.2, 3.2).lived(1000).rotate(0);
    gs.seed = hash01(id, 7);
    this.k.glow.imm(this.k.clock % 100);
  }

  // ───────────── telegraphs ─────────────

  private telegraphs(run: Readonly<RunState>): void {
    const d = this.k.decals;
    const pal = this.k.tele;
    for (const t of run.telegraphs) {
      if (!t.alive) continue;
      const prog = Math.min(1, t.time / Math.max(0.01, t.duration));
      const enemy = t.team === 'enemy';
      const c1 = enemy ? pal.danger : pal.mark;
      const c2 = enemy ? pal.deep : pal.markDeep;
      switch (t.shape) {
        // circles and rings: flat SDF discs just above the local wave maximum (never warped by rough water)
        case 'circle': d.telegraph(Decal.TeleCircle, t.x, this.flatHeight(t.x, t.z, t.radius), t.z, t.radius, prog, 0, c1); break;
        case 'ring': {
          const inner = t.length > 0 && t.length < t.radius ? t.length / t.radius : 0.62;
          d.telegraph(Decal.TeleRing, t.x, this.flatHeight(t.x, t.z, t.radius), t.z, t.radius, prog, inner, c1);
          break;
        }
        case 'line': {
          // contract: START at x,z, direction (−sin a, −cos a) (ship heading convention), radius = half-width
          const len = t.length > 0 ? t.length : t.radius * 8;
          const dx = -Math.sin(t.angle), dz = -Math.cos(t.angle);
          d.imm(Decal.Line, t.x + dx * len * 0.5, t.z + dz * len * 0.5, t.radius, len * 0.5, t.angle + Math.PI, prog, 0, c1, 1, c2, 0, 0.5);
          break;
        }
        case 'cone': {
          // apex at x,z; radius = half-width at the far end
          const len = t.length > 0 ? t.length : t.radius;
          const half = t.length > 0 ? t.radius : t.radius * 0.7;
          const dx = -Math.sin(t.angle), dz = -Math.cos(t.angle);
          d.imm(Decal.Cone, t.x + dx * len * 0.5, t.z + dz * len * 0.5, half, len * 0.5, t.angle + Math.PI, prog, 0, c1, 1, c2, 0, 0.5);
          break;
        }
      }
    }
  }

  /** Height just above the local wave maximum over a disc (centre + two rings of samples) for flat telegraphs. */
  private flatHeight(x: number, z: number, r: number): number {
    const w = this.k.water;
    let h = w.height(x, z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      h = Math.max(h, w.height(x + ca * r * 0.55, z + sa * r * 0.55), w.height(x + (ca * 0.924 - sa * 0.383) * r, z + (sa * 0.924 + ca * 0.383) * r));
    }
    return h + 0.45 + 0.25 * w.strength;
  }

  // ───────────── ships: statuses and sinking ─────────────

  private ship(s: Readonly<EnemyState | BossState>, dt: number, boss: boolean): void {
    const k = this.k;
    const fx = this.fx;
    const L = s.length;
    const wy = fx.wy(s.x, s.z);
    const fxv = -Math.sin(s.heading), fzv = -Math.cos(s.heading);
    if (s.life === 'sinking') {
      const t = s.sink;
      this.events.trackSinking(s.id, s.x, s.z, L);
      const a = Math.min(1, t * 5) * (1 - Math.max(0, (t - 0.8) / 0.2));
      k.decals.imm(Decal.Whirl, s.x, s.z, L * 0.8, L * 0.8, 0, 1.3, 3, 0xffffff, a, 0x0d4760, 0, hash01(s.id, 1));
      if (rand() < dt * (boss ? 40 : 16) * k.q * (L / 25)) fx.bubbles(s.x, s.z, 1, L * 0.3, Math.min(3, 1 + L / 25));
      if (t < 0.6) {
        const deck = wy + Math.max(2.5, L * 0.1) - t * L * 0.4;
        const flames = boss ? 7 : 3;
        for (let j = 0; j < flames; j++) {
          const along = (hash01(s.id, j + 500) - 0.5) * L * 0.6;
          this.loopFlame(s.x + fxv * along, deck, s.z + fzv * along, L * 0.06, L * 0.17 * (1 - t * 1.4), s.id, j, CelPal.Fire);
        }
      }
      if (t < 0.85 && rand() < dt * (boss ? 6 : 3) * k.q) {
        fx.smoke(s.x + spread(L * 0.2), wy + L * 0.12, s.z + spread(L * 0.2), 1, L * 0.1, L * 0.26, CelPal.WreckSmoke, 3.2, 0, 6, 0, 1, 5, 1, 0, 0.45);
      }
      if (rand() < dt * 1.5 * k.q) fx.planks(s.x + spread(L * 0.3), wy + 0.5, s.z + spread(L * 0.3), 1, 2, 2, 1, 2.6, 0.3);
      k.ocean?.stampFoam(s.x, s.z, L * 0.5, 0.3);
      k.ocean?.stampDisplace(s.x, s.z, L * 0.35, -0.6 * t);
      return;
    }
    if (s.life !== 'alive') return;
    this.damage(s.id, s.x, s.z, s.heading, L, s.hp / Math.max(1, s.maxHp), wy, dt, boss, boss ? 1 : this.smokeShare);
    if (boss) this.bossWater(s as Readonly<BossState>, wy, dt);
    const statuses = s.statuses;
    for (let i = 0; i < statuses.length; i++) {
      const st = statuses[i]!;
      if (st.time <= 0) continue;
      switch (st.kind) {
        case 'burning': {
          const deck = wy + Math.max(2.5, L * 0.1);
          for (let j = 0; j < 3; j++) {
            const along = (hash01(s.id, j + 600) - 0.5) * L * 0.5;
            this.loopFlame(s.x + fxv * along, deck, s.z + fzv * along, L * 0.05, L * 0.14, s.id, j + 10, CelPal.Fire);
          }
          if (rand() < dt * 3 * k.q) fx.smoke(s.x, deck + 2, s.z, 1, 2, 6, CelPal.DarkSmoke, 2, 0, 3, 0, 1, 3, 1, 0, 0.4);
          break;
        }
        case 'slowed': {
          k.decals.imm(Decal.Blot, s.x - fxv * L * 0.35, s.z - fzv * L * 0.35, L * 0.35, L * 0.35, 0, 0, 0, 0xdff6ff, 0.55, 0x7fc8e8, 0, hash01(s.id, 4));
          if (rand() < dt * 4) {
            const gs = k.glow.spec.reset();
            gs.at(s.x + spread(L * 0.3), wy + L * 0.2, s.z + spread(L * 0.3)).vel(0, -3, 0).look(Glow.Sparkle, GlowPal.Shield).sized(1.6, 0.6).lived(0.6);
            k.glow.emit();
          }
          break;
        }
        case 'stunned': {
          const top = wy + Math.max(8, L * 0.45);
          for (let j = 0; j < 3; j++) {
            const a = k.clock * 4 + (j / 3) * TAU;
            const gs = k.glow.spec.reset();
            gs.at(s.x + Math.cos(a) * L * 0.18, top + Math.sin(a * 2) * 0.5, s.z + Math.sin(a) * L * 0.18).look(Glow.Sparkle, GlowPal.Gold).sized(2.4, 2.4).lived(1000).rotate(a);
            gs.seed = j / 3;
            k.glow.imm((k.clock % 100) + j);
          }
          if (rand() < dt * 5) fx.sparks(s.x, top, s.z, 2, 10, GlowPal.Lightning, 0, 1, 0, 0.3, 0.2);
          break;
        }
        case 'hooked': break; // ropes come from the 'harpoon' tether table (tethers())
        default: break;
      }
    }
  }

  /**
   * Battle damage (T3 / T11) under the smoke rules: thin rising plumes below 50% hull (dark below 30%) and deck fire
   * below 30%. `share` < 1 when many ships smoke at once. Also drives AI captains (negative ids).
   */
  private damage(id: number, x: number, z: number, heading: number, L: number, frac: number, wy: number, dt: number, big: boolean, share: number): void {
    if (frac >= DAMAGE_SMOKE_HP) return;
    const k = this.k;
    const dx = x - k.focusX, dz = z - k.focusZ;
    if (dx * dx + dz * dz > 480 * 480) return;
    const fxv = -Math.sin(heading), fzv = -Math.cos(heading);
    const deck = wy + Math.max(2.5, L * 0.1);
    const severity = 1.3 - frac * 1.6;
    if (rand() < dt * (big ? 3.5 : 1.6) * severity * share * k.q) {
      const along = (hash01(id, 800 + ((k.clock * 3) | 0) % 5) - 0.5) * L * 0.5;
      this.fx.smoke(x + fxv * along, deck + 1, z + fzv * along, 1, L * 0.05, L * (big ? 0.16 : 0.22), frac < 0.3 ? CelPal.DarkSmoke : CelPal.Gunsmoke,
        3.4, 0, 4, 0, 1, 6, 1, 0, 0.45);
    }
    if (frac < 0.3) {
      const fires = big ? 4 : 2;
      for (let j = 0; j < fires; j++) {
        const along = (hash01(id, j + 900) - 0.5) * L * 0.55;
        this.loopFlame(x + fxv * along, deck, z + fzv * along, L * 0.03, L * (big ? 0.09 : 0.13), id, j + 30, CelPal.Fire);
      }
    }
  }

  /** AI captains (negative ids, ShipFrames.findCaptain): the same damage smoke and deck fire as the fleet, and burning. */
  private captain(c: Readonly<CaptainState>, dt: number): void {
    const wy = this.fx.wy(c.x, c.z);
    this.damage(c.id, c.x, c.z, c.heading, c.length, c.hp / Math.max(1, c.maxHp), wy, dt, false, 1);
    for (let i = 0; i < c.statuses.length; i++) {
      const st = c.statuses[i]!;
      if (st.kind !== 'burning' || st.time <= 0) continue;
      const deck = wy + Math.max(2.5, c.length * 0.1);
      const fxv = -Math.sin(c.heading), fzv = -Math.cos(c.heading);
      for (let j = 0; j < 3; j++) {
        const along = (hash01(c.id, j + 600) - 0.5) * c.length * 0.5;
        this.loopFlame(c.x + fxv * along, deck, c.z + fzv * along, c.length * 0.05, c.length * 0.14, c.id, j + 10, CelPal.Fire);
      }
      if (rand() < dt * 3 * this.k.q) this.fx.smoke(c.x, deck + 2, c.z, 1, 2, 6, CelPal.DarkSmoke, 2, 0, 3, 0, 1, 3, 1, 0, 0.4);
    }
  }

  // boss submerge tracking (serpents): id → previous submerged fraction (≤ 4 bosses at once)
  private readonly bossId = new Int32Array(4).fill(-1);
  private readonly bossSub = new Float32Array(4);

  /** Breach / dive / wake FX for bosses that submerge (T9). */
  private bossWater(b: Readonly<BossState>, wy: number, dt: number): void {
    let slot = -1;
    for (let i = 0; i < 4; i++) if (this.bossId[i] === b.id) slot = i;
    if (slot < 0) { slot = 0; for (let i = 0; i < 4; i++) if (this.bossId[i] === -1) { slot = i; break; } this.bossId[slot] = b.id; this.bossSub[slot] = b.submerged; }
    const prev = this.bossSub[slot]!;
    const sub = b.submerged;
    this.bossSub[slot] = sub;
    const fx = this.fx;
    const k = this.k;
    const L = b.length;
    const fxv = -Math.sin(b.heading), fzv = -Math.cos(b.heading);
    if (prev > 0.5 && sub <= 0.5) {
      // breach: towering columns along the body, pouring sheets, cloud ring, droplets
      fx.explosion('water', b.x, b.z, Math.max(18, b.radius * 1.4), true, false, 'enemy');
      for (let j = 0; j < 6; j++) {
        const along = (j / 5 - 0.5) * L * 0.5;
        fx.column(b.x + fxv * along, b.z + fzv * along, 9 + rand() * 5, 3.4, 1.6, j * 0.05);
      }
      fx.cloudRing(b.x, wy + 8, b.z, fxv, fzv, L * 0.3, 26);
      fx.droplets(b.x, wy + 10, b.z, 50, 14, 22, 1.4);
      k.juice.shakeAt(0.6, Math.hypot(b.x - k.focusX, b.z - k.focusZ), 0.6, 60, 420);
    } else if (prev <= 0.5 && sub > 0.5) {
      fx.waterSplash(b.x, b.z, 3.2);
      fx.foam(b.x, b.z, L * 0.4, 3, 0, 1.4);
      fx.bubbles(b.x, b.z, 24, L * 0.25, 3);
    }
    if (sub > 0.05 && sub < 0.98) {
      // moving shadow + wake while under the surface
      k.decals.imm(Decal.Shadow, b.x, b.z, L * 0.18, L * 0.45, Math.atan2(fxv, fzv), 0, 0, 0x03162a, 0.5 * sub, 0x03162a, 0, 0.5);
      if (rand() < dt * 20 * k.q) fx.bubbles(b.x + spread(L * 0.2), b.z + spread(L * 0.2), 1, 2, 2.2);
      k.ocean?.stampWake(b.x, b.z, fxv, fzv, b.radius, 0.6);
    }
    if (sub < 0.4 && b.speed > 2 && rand() < dt * 10 * k.q) {
      // water pouring off the body
      const along = spread(L * 0.3);
      const px = b.x + fxv * along, pz = b.z + fzv * along;
      const c = k.cel.spec.reset();
      c.at(px, wy + range(6, 16), pz).vel(spread(2), -range(4, 8), spread(2)).accel(0, -18, 0).look(Cel.Column, CelPal.Water, Mode.Upright, true)
        .sized(2.2, 3.2, 2).stretched(2.2).lived(0.7, 0.5);
      k.cel.emit();
    }
  }

  // ───────────── player ─────────────

  private player(run: Readonly<RunState>, dt: number): void {
    const k = this.k;
    const fx = this.fx;
    const p = run.player;
    if (!p.alive) { this.prevAir = this.prevSub = 0; return; }
    const f = this.frame;
    shipFrame(run, k.ships, 0, f, this.waterY);
    const wy = fx.wy(p.x, p.z);
    const L = p.length;
    this.emitPlayer += dt;
    const sk = p.skills;
    // brace shield dome
    if (sk.brace.active > 0) {
      const t = sk.brace.active;
      const gs = k.glow.spec.reset();
      gs.at(p.x, wy + 6, p.z).look(Glow.Ring, GlowPal.Shield).sized(L * 1.3, L * 1.3).lived(1000).bright(0.8 + 0.4 * Math.sin(k.clock * 18));
      k.glow.imm(0);
      k.decals.imm(Decal.Shock, p.x, p.z, L * 0.75, L * 0.75, 0, 1, 0, 0xdff4ff, 0.35, 0x9fd8ff, 0.6, 0.5, 0.55);
      for (let j = 0; j < 4; j++) {
        const a = k.clock * 3 + (j / 4) * TAU;
        const ss = k.glow.spec.reset();
        ss.at(p.x + Math.cos(a) * L * 0.6, wy + 4 + Math.sin(k.clock * 5 + j) * 2, p.z + Math.sin(a) * L * 0.6).look(Glow.Sparkle, GlowPal.Shield).sized(2.2, 2.2).lived(1000).rotate(a);
        k.glow.imm(t + j);
      }
    }
    // shield (Second Wind etc.)
    let shielded = p.shield > 0;
    for (const st of p.statuses) if (st.kind === 'shielded' && st.time > 0) shielded = true;
    if (shielded) {
      const gs = k.glow.spec.reset();
      gs.at(p.x, wy + 6, p.z).look(Glow.Ring, GlowPal.Heal).sized(L * 1.2, L * 1.2).lived(1000).bright(0.55 + 0.2 * Math.sin(k.clock * 6));
      k.glow.imm(0);
    }
    // boost: bow spray + wind streaks
    if (sk.boost.active > 0) {
      if (rand() < dt * 26 * k.q) {
        const side = rand() < 0.5 ? -1 : 1;
        const bx = f.x + f.fx * L * 0.45 + f.sx * side * f.beam * 0.35, bz = f.z + f.fz * L * 0.45 + f.sz * side * f.beam * 0.35;
        fx.droplets(bx, wy + 0.6, bz, 2, 4, 7, 0.8);
        fx.sheet(bx, wy - 0.3, bz, 4, 0.9, 0.35, f.sx * side * 5, f.sz * side * 5);
      }
      this.windStreaks(f, wy, dt, 22);
      k.ocean?.stampWake(p.x, p.z, f.fx, f.fz, L * 0.5, 0.8);
    }
    // Lionburst airtime / landing
    const air = p.airborne;
    if (air > 0.01) {
      k.decals.imm(Decal.Shadow, p.x, p.z, L * 0.45, L * 0.6, Math.atan2(f.fx, f.fz), 0, 0, 0x06203a, 0.4 * (1 - air * 0.4), 0x06203a, 0, 0.5);
      if (rand() < dt * 30 * k.q) {
        const along = spread(L * 0.4);
        const c = k.cel.spec.reset();
        c.at(f.x + f.fx * along, f.y + spread(1), f.z + f.fz * along).vel(spread(3), -2, spread(3)).accel(0, -20, 0)
          .look(Cel.Droplet, CelPal.Water, Mode.Velocity).sized(0.9, 0.7).stretched(1, 0.05).lived(1.0, 0.8);
        k.cel.emit();
      }
      this.windStreaks(f, f.y + 2, dt, 30);
      if (this.prevAir <= 0.01 && this.events.launchAge > 0.4) {
        fx.cloudRing(p.x, wy + 4, p.z, f.fx, f.fz, L * 0.45, 22);
        fx.waterSplash(p.x, p.z, 2);
        k.juice.speedLines(0.75, 0.8);
      }
    } else if (this.prevAir > 0.01) {
      // landing
      fx.waterSplash(p.x, p.z, 2.6);
      fx.crown(p.x, p.z, L * 0.35, 12, 18, 3.2);
      fx.foam(p.x, p.z, L * 0.9, 2.8, 0, 1.5);
      fx.shock(p.x, p.z, L * 2.2, 0.6, 0xffe7a0, 1.4, 1.5);
      fx.shock(p.x, p.z, L * 1.4, 0.45, 0xffffff, 0.8, 1, 0.08);
      k.ocean?.stampRing(p.x, p.z, L * 0.8, 1);
      k.ocean?.stampDisplace(p.x, p.z, L * 0.6, -2);
      k.juice.shake(0.7, 0.45);
      // Lionburst landing: one crisp impact (PostStack: 2 two-tone frames, silhouettes kept) — never a pale wash.
      k.juice.impactFrame(0.8);
      k.juice.slowMo(0.45, 0.18);
    }
    this.prevAir = air;
    // Deep Dive
    const sub = p.submerged;
    if (sub > 0.01) {
      k.decals.imm(Decal.Shadow, p.x, p.z, L * 0.35, L * 0.55, Math.atan2(f.fx, f.fz), 0, 0, 0x04182c, 0.5 * sub, 0x04182c, 0, 0.5);
      if (rand() < dt * 30 * k.q) fx.bubbles(p.x + spread(L * 0.25), p.z + spread(L * 0.25), 1, 1, 1.4);
      k.ocean?.stampFoam(p.x, p.z, L * 0.3, 0.3);
      if (this.prevSub <= 0.01 && this.events.diveAge > 0.4) { fx.waterSplash(p.x, p.z, 2); fx.bubbles(p.x, p.z, 20, L * 0.3, 2); }
    } else if (this.prevSub > 0.01) {
      fx.explosion('water', p.x, p.z, 16, true, false, 'player');
      fx.cloudRing(p.x, wy + 3, p.z, f.fx, f.fz, L * 0.4, 18);
      k.juice.shake(0.4, 0.3);
    }
    this.prevSub = sub;
    // invulnerable shimmer (revive etc.)
    if (p.invulnerable > 0 && air <= 0.01 && sub <= 0.01 && rand() < dt * 8 * k.q) {
      fx.sparkles(p.x + spread(L * 0.4), wy + 5, p.z + spread(L * 0.4), 1, 3, GlowPal.Gold, 0.7);
    }
    // statuses on the player
    for (const st of p.statuses) {
      if (st.time <= 0) continue;
      if (st.kind === 'frenzy' && rand() < dt * 12 * k.q) fx.embers(p.x, wy + 4, p.z, 1, L * 0.3);
      if (st.kind === 'burning') {
        for (let j = 0; j < 3; j++) {
          const along = (hash01(j, 700) - 0.5) * L * 0.5;
          this.loopFlame(f.x + f.fx * along, f.gunY, f.z + f.fz * along, 1, L * 0.12, 0, j + 20, CelPal.Fire);
        }
      }
    }
    // ultimate auras
    if (sk.ultimate.active > 0) {
      const ult = CONTENT.ships[run.shipId].ultimate;
      if (ult === 'ramming-speed') {
        const bx = f.x + f.fx * L * 0.5, bz = f.z + f.fz * L * 0.5;
        const gs = k.glow.spec.reset();
        gs.at(bx, f.gunY, bz).vel(f.fx, 0, f.fz).look(Glow.DirFlash, GlowPal.Frenzy, Mode.Velocity, true).sized(L * 0.35, L * 0.35).stretched(1.2).lived(1000).bright(0.8);
        k.glow.imm(k.clock % 0.08);
        this.windStreaks(f, wy + 3, dt, 30);
        if (rand() < dt * 30 * k.q) fx.sheet(bx, wy - 0.3, bz, 7, 1.1, 0.4, f.sx * spread(6), f.sz * spread(6));
      } else if (ult === 'sunfire-barrage') {
        if (rand() < dt * 14 * k.q) fx.embers(p.x, wy + 4, p.z, 1, L * 0.4);
      } else if (ult === 'kitchen-inferno') {
        for (let j = 0; j < 8; j++) {
          const a = (j / 8) * TAU + k.clock * 0.6;
          this.loopFlame(p.x + Math.cos(a) * L * 0.85, wy, p.z + Math.sin(a) * L * 0.85, 1, 5, 7, j, CelPal.Fire);
        }
      }
    }
  }

  private windStreaks(f: ShipFrame, y: number, dt: number, rate: number): void {
    const k = this.k;
    const n = rand() < (dt * rate * k.q) % 1 ? Math.ceil(dt * rate * k.q) : Math.floor(dt * rate * k.q);
    for (let j = 0; j < n; j++) {
      const side = rand() < 0.5 ? -1 : 1;
      const along = range(-0.2, 0.7) * f.length;
      const gs = k.glow.spec.reset();
      gs.at(f.x + f.fx * along + f.sx * side * (f.beam * 0.6 + rand() * 6), y + range(0, 8), f.z + f.fz * along + f.sz * side * (f.beam * 0.6 + rand() * 6))
        .vel(-f.fx * 70, 0, -f.fz * 70).look(Glow.Streak, GlowPal.Glint, Mode.Velocity).sized(0.35, 0.3).stretched(22).lived(0.35).bright(0.55);
      k.glow.emit();
    }
  }

  // ───────────── aim ─────────────

  private aim(ctx: FrameContext, run: Readonly<RunState>): void {
    const p = run.player;
    if (!p.alive || run.status !== 'running') return;
    const d = this.k.decals;
    const ready = p.skills.broadside.cooldown <= 0 ? 1 : 0.25;
    const MARK = this.k.tele.mark, MARK_DEEP = this.k.tele.markDeep;
    d.imm(Decal.Reticle, ctx.aim.x, ctx.aim.z, 5, 5, this.k.clock * 0.4, ready, 0, MARK, 1, INK_HEX, 0, 0.5);
    const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
    const side = (ctx.aim.x - p.x) * sx + (ctx.aim.z - p.z) * sz >= 0 ? 1 : -1;
    const angle = p.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    let level = 1;
    for (let i = 0; i < p.weapons.length; i++) if (p.weapons[i]!.id === 'broadside') level = p.weapons[i]!.level;
    const range = CONTENT.weapons.broadside.levels[Math.max(0, Math.min(5, level - 1))]!.range * rangeMul(p.stats);
    d.imm(Decal.Wedge, p.x, p.z, range, range, angle, ready, (40 * Math.PI) / 180, MARK, 1, INK_HEX, 0, 0.5);
    // aimed special/ultimate target previews while ready (quiet: outline only)
    const ship = CONTENT.ships[run.shipId];
    let ax = ctx.aim.x - p.x, az = ctx.aim.z - p.z;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const aimAngle = Math.atan2(ax, az);
    if (p.skills.special.cooldown <= 0) {
      if (ship.special === 'signal-flare') d.imm(Decal.Circle, ctx.aim.x, ctx.aim.z, 30, 30, 0, 0, 0, MARK, 0.45, MARK_DEEP, 0, 0.5);
      else if (ship.special === 'lionburst') {
        const len = Math.max(70, Math.min(180, al)); // CORE: Lionburst dash 70–180 m toward the aim point
        const start = p.length * 0.6;
        if (len > start + 10) {
          d.imm(Decal.Line, p.x + ax * (start + len) * 0.5, p.z + az * (start + len) * 0.5, 2, (len - start) * 0.5, aimAngle, 0, 0, MARK, 0.28, MARK_DEEP, 0, 0.5);
          d.imm(Decal.Reticle, p.x + ax * len, p.z + az * len, 8, 8, this.k.clock * -0.6, 0.35, 0, MARK, 0.6, INK_HEX, 0, 0.5);
        }
      }
    }
    if (p.skills.ultimate.charge >= 1 && ship.ultimate === 'admirals-judgment') {
      d.imm(Decal.Line, p.x + ax * 160, p.z + az * 160, 14, 160, aimAngle, 0, 0, MARK, 0.3, MARK_DEEP, 0, 0.5);
    }
  }
}

const HAZ_KINDS: readonly HazardState['kind'][] = [
  'fire-patch', 'barrel', 'powder-keg', 'mine', 'whirlpool', 'storm-cloud', 'shockwave', 'wave-front', 'lightning-strike', 'burning-wreck', 'escort-skiff',
];
