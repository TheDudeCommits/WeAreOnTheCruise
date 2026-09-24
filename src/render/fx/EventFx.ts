/**
 * SimEvent → effect router. Every event type in the contract is handled here (or deliberately ignored with a
 * reason). Heavy frames shed load: per-hit particle counts scale down when many hits land in one frame.
 */
import { CONTENT } from '../../game/content';
import type { ProjectileKind, SkillSlot, SpecialId, UltimateId, WeaponId } from '../../game/ids';
import type { RunState, SimEvent } from '../../game/types';
import type { FrameContext } from '../frame';
import { CelPal, GlowPal } from './core/palette';
import { rand, range, spread } from './core/rand';
import { Mode } from './core/SpritePass';
import type { FxKit } from './Kit';
import { Cel } from './passes/CelSprites';
import { Decal } from './passes/Decals';
import { Glow } from './passes/GlowSprites';
import type { Sakuga } from './Sakuga';
import { ShipFrame, findShip, shipFrame } from './ShipFrames';

const TAU = Math.PI * 2;

/** Hit scale per projectile kind (1 = broadside ball). */
const HIT_SCALE: Record<ProjectileKind, number> = {
  cannonball: 1, 'chain-shot': 1.1, 'heavy-shot': 1.35, 'chaser-shot': 1.15, lance: 1.2, 'mortar-shell': 1.3, bomblet: 0.8,
  'swivel-shot': 0.45, grapeshot: 0.4, harpoon: 0.7, rocket: 1.1, torpedo: 1.4, 'skiff-shot': 0.6, 'enemy-cannonball': 0.95,
  'enemy-chaser': 1.0, 'enemy-mortar': 1.3, 'water-bolt': 1.2, 'boss-shell': 1.4,
};

const enum Job { FinaleBurst = 1, FinaleEnd = 2, Shake = 3 }

const MAX_JOBS = 64;
const MAX_SUNK = 96;

export class EventFx {
  private readonly frame = new ShipFrame();
  private readonly frame2 = new ShipFrame();
  private readonly critTargets = new Set<number>();
  private readonly chainPts = new Float32Array(48 * 3);
  // Scheduler (allocation-free): delayed composite beats (boss finale).
  private readonly jobT = new Float32Array(MAX_JOBS);
  private readonly jobK = new Int8Array(MAX_JOBS);
  private readonly jobX = new Float32Array(MAX_JOBS);
  private readonly jobZ = new Float32Array(MAX_JOBS);
  private readonly jobA = new Float32Array(MAX_JOBS);
  private readonly jobB = new Float32Array(MAX_JOBS);
  // Last-known positions of sinking ships (enemy-sunk arrives after the ship left RunState).
  readonly sunkId = new Int32Array(MAX_SUNK).fill(-1);
  readonly sunkX = new Float32Array(MAX_SUNK);
  readonly sunkZ = new Float32Array(MAX_SUNK);
  readonly sunkL = new Float32Array(MAX_SUNK);
  private sunkHead = 0;
  /** Seconds since the last Lionburst/Deep Dive event (so state transitions don't double the launch FX). */
  launchAge = 99;
  diveAge = 99;
  private lastLevelUp = -99;

  private readonly waterY = (x: number, z: number): number => this.fx.wy(x, z);

  constructor(private readonly k: FxKit, private readonly fx: Sakuga) {}

  reset(): void {
    this.jobK.fill(0);
    this.sunkId.fill(-1);
    this.launchAge = this.diveAge = 99;
  }

  trackSinking(id: number, x: number, z: number, length: number): void {
    for (let i = 0; i < MAX_SUNK; i++) if (this.sunkId[i] === id) { this.sunkX[i] = x; this.sunkZ[i] = z; this.sunkL[i] = length; return; }
    const i = this.sunkHead; this.sunkHead = (i + 1) % MAX_SUNK;
    this.sunkId[i] = id; this.sunkX[i] = x; this.sunkZ[i] = z; this.sunkL[i] = length;
  }

  private schedule(delay: number, kind: Job, x: number, z: number, a = 0, b = 0): void {
    for (let i = 0; i < MAX_JOBS; i++) {
      if (this.jobK[i] !== 0) continue;
      this.jobT[i] = this.k.clock + delay; this.jobK[i] = kind; this.jobX[i] = x; this.jobZ[i] = z; this.jobA[i] = a; this.jobB[i] = b;
      return;
    }
  }

  private runJobs(): void {
    for (let i = 0; i < MAX_JOBS; i++) {
      const kind = this.jobK[i];
      if (!kind || this.jobT[i]! > this.k.clock) continue;
      this.jobK[i] = 0;
      const x = this.jobX[i]!, z = this.jobZ[i]!, a = this.jobA[i]!, b = this.jobB[i]!;
      if (kind === Job.FinaleBurst) {
        this.fx.kill(x, z, a, b, false, false);
        this.k.juice.shake(0.45, 0.3);
      } else if (kind === Job.FinaleEnd) {
        this.fx.kill(x, z, a * 1.4, b, true, true);
        this.fx.explosion('powder', x, z, a * 0.5, true, true, 'player');
        this.fx.shock(x, z, a * 2.2, 1.0, 0xfff2c0, 1.6, 1.6);
        this.fx.shock(x, z, a * 3.4, 1.4, 0xffffff, 0.8, 1.0, 0.15);
        this.fx.levelUp(x, z, true);
        this.k.juice.impactFrame(1);
        this.k.juice.flash(0xfff4d6, 0.7, 0.35);
        this.k.juice.shake(1, 1.1);
        this.k.juice.chromatic(0.6, 0.5);
      } else if (kind === Job.Shake) {
        this.k.juice.shake(a, b);
      }
    }
  }

  process(ctx: FrameContext, run: Readonly<RunState>): void {
    this.runJobs();
    const events = ctx.events;
    const baseQ = this.k.q;
    // Pre-pass: crit targets (for impact frames on crit kills) and hit load.
    this.critTargets.clear();
    let hits = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (e.type === 'damage' && e.crit) this.critTargets.add(e.target);
      else if (e.type === 'projectile-hit') hits++;
    }
    const hitQ = baseQ * Math.max(0.2, Math.min(1, 28 / Math.max(1, hits)));
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      this.k.q = e.type === 'projectile-hit' ? hitQ : baseQ;
      this.handle(e, ctx, run);
    }
    this.k.q = baseQ;
  }

  private handle(e: SimEvent, ctx: FrameContext, run: Readonly<RunState>): void {
    const fx = this.fx;
    const k = this.k;
    const water = this.waterY;
    switch (e.type) {
      case 'weapon-fired': this.weaponFired(e, run, water); break;
      case 'enemy-fired': this.enemyFired(e, run, water); break;
      case 'projectile-hit': this.projectileHit(e, run); break;
      case 'explosion': {
        const onWater = ctx.world.isWater(e.x, e.z, 0);
        const nearShip = this.nearShip(run, e.x, e.z, e.radius);
        fx.explosion(e.kind, e.x, e.z, e.radius, onWater, nearShip, e.team);
        break;
      }
      case 'damage': {
        const wy = fx.wy(e.x, e.z);
        const ship = e.target === 0 ? null : findShip(run, e.target);
        const h = ship ? Math.min(16, 5 + ship.length * 0.16) : 7;
        k.numbers.add(e.target, e.amount, e.crit, e.x, wy + h, e.z, e.crit ? 0xffd23a : 0xffffff);
        break;
      }
      case 'player-hit': this.playerHit(e, run, water); break;
      case 'enemy-spawned':
        if (e.elite) { fx.shock(e.x, e.z, 18, 0.8, 0xffd84a, 0.9, 1); fx.sparkles(e.x, fx.wy(e.x, e.z) + 6, e.z, 10, 8, GlowPal.Gold, 1.2); }
        else fx.foam(e.x, e.z, 8, 1.4, 0, 0.8);
        break;
      case 'enemy-killed': {
        const ship = findShip(run, e.id);
        const length = ship ? ship.length : CONTENT.enemies[e.defId].length * (e.elite ? 1.2 : 1);
        const heading = ship ? ship.heading : rand() * TAU;
        fx.kill(e.x, e.z, length, heading, e.elite, false);
        this.trackSinking(e.id, e.x, e.z, length);
        if (this.critTargets.has(e.id)) k.juice.impactFrame(0.65);
        else if (e.elite) k.juice.impactFrame(0.45);
        break;
      }
      case 'enemy-sunk': {
        for (let i = 0; i < MAX_SUNK; i++) {
          if (this.sunkId[i] !== e.id) continue;
          fx.sunk(this.sunkX[i]!, this.sunkZ[i]!, this.sunkL[i]!);
          this.sunkId[i] = -1;
          break;
        }
        break;
      }
      case 'pickup-spawned': {
        const wy = fx.wy(e.x, e.z);
        if (e.kind === 'chest' || e.kind === 'doubloon') fx.sparkles(e.x, wy + 3, e.z, e.kind === 'chest' ? 12 : 4, 8, GlowPal.Gold, 0.9);
        break;
      }
      case 'pickup-collected': this.pickupCollected(e, run); break;
      case 'level-up':
        if (this.k.clock - this.lastLevelUp > 0.6) { this.lastLevelUp = this.k.clock; fx.levelUp(run.player.x, run.player.z, false); }
        break;
      case 'tier-up': this.lastLevelUp = this.k.clock; fx.levelUp(run.player.x, run.player.z, true); break;
      case 'skill-used': this.skillUsed(e.slot, e.skill, e.x, e.z, e.aimX, e.aimZ, run, water); break;
      case 'status-changed': if (e.on) this.statusOn(e.target, e.status, run, water); break;
      case 'lightning': this.lightning(e.points, e.team, run, water); break;
      case 'harpoon': {
        const wy = fx.wy(e.x2, e.z2);
        fx.sparks(e.x2, wy + 4, e.z2, 8, 24, GlowPal.Spark, 0, 0.6, 0, 0.3, 0.3);
        fx.planks(e.x2, wy + 4, e.z2, 2, 5, 8, 0.6, 1.2, 0);
        fx.burst(e.x2, wy + 4, e.z2, 4, GlowPal.Spark, 0.06);
        break;
      }
      case 'ram': {
        const wy = fx.wy(e.x, e.z);
        const s = Math.min(2, 0.8 + e.damage / 60);
        fx.sheet(e.x, wy - 0.3, e.z, 7 * s, 1.1, 0.6);
        fx.droplets(e.x, wy + 1, e.z, 16, 9 * s, 14 * s, 0.8);
        fx.planks(e.x, wy + 3, e.z, 5, 8, 12, 0.8, 2.2, 0.1);
        fx.burst(e.x, wy + 3, e.z, 7 * s, GlowPal.Spark, 0.07);
        fx.foam(e.x, e.z, 9 * s, 1.6, 0, 1.2);
        if (e.attacker === 0 || e.target === 0) k.juice.shake(0.35 * s, 0.3);
        k.ocean?.stampRing(e.x, e.z, 6 * s, 1);
        break;
      }
      case 'collision': {
        const wy = fx.wy(e.x, e.z);
        const s = Math.min(1.8, 0.4 + e.impulse / 40);
        if (e.b === 'island') {
          fx.smoke(e.x, wy + 2, e.z, 4, 2 * s, 6 * s, CelPal.Dust, 1.3, 0, 3, 0, 5, 1.2, 2, 0, 0.3);
          fx.chunks(e.x, wy + 2, e.z, 6, 8 * s, CelPal.Rock, 0.9);
          fx.sheet(e.x, wy - 0.3, e.z, 5 * s, 0.9, 0.5);
        } else {
          fx.sheet(e.x, wy - 0.3, e.z, 5 * s, 0.9, 0.5);
          fx.droplets(e.x, wy + 1, e.z, 8, 6 * s, 9 * s, 0.7);
          fx.planks(e.x, wy + 2.5, e.z, 2, 5, 8, 0.6, 1.4, 0);
        }
        if (e.a === 0 || e.b === 0) k.juice.shake(Math.min(0.6, 0.15 + e.impulse / 120), 0.25);
        break;
      }
      case 'hazard-spawned': this.hazardSpawned(e.kind, e.x, e.z, e.radius); break;
      case 'hazard-triggered':
        if (e.kind === 'lightning-strike') fx.lightningStrike(e.x, e.z);
        else if (e.kind === 'mine' || e.kind === 'powder-keg' || e.kind === 'barrel') fx.burst(e.x, fx.wy(e.x, e.z) + 2, e.z, 8, GlowPal.Explosion, 0.06);
        break;
      case 'telegraph':
        k.decals.emit(Decal.Shock, e.x, e.z, e.radius * 1.15, 0.3, 0xff5a4a, 0.6, 0xff5a4a, 0.6, 1.2);
        break;
      case 'boss-warning': {
        const p = run.player;
        for (let i = 0; i < 3; i++) {
          k.decals.emit(Decal.Shock, p.x, p.z, 320, 2.8, 0x0b1a33, 0.35, 0x3a5a8a, 0.15, 0.6, 0, i * 1.1);
        }
        this.schedule(0, Job.Shake, 0, 0, 0.12, 1.6);
        this.schedule(1.2, Job.Shake, 0, 0, 0.16, 1.6);
        this.schedule(2.4, Job.Shake, 0, 0, 0.2, 1.8);
        break;
      }
      case 'boss-spawned': {
        const r = CONTENT.bosses[e.boss].radius;
        fx.explosion('water', e.x, e.z, r * 1.2, true, false, 'enemy');
        fx.cloudRing(e.x, fx.wy(e.x, e.z) + 6, e.z, 1, 0, r * 1.6, 22);
        fx.shock(e.x, e.z, r * 5, 1.4, 0xbfe6ff, 0.6, 1.4);
        k.decals.emit(Decal.Whirl, e.x, e.z, r * 3, 3.5, 0xffffff, 0.9, 0x0b3d52, 0, 1.6, 5);
        for (let i = 0; i < 3; i++) k.decals.emit(Decal.Shock, e.x, e.z, r * (3 + i * 1.5), 1.6, 0x0b1a33, 0.4, 0x5a7ab0, 0.2, 0.8, 0, 0.2 + i * 0.35);
        k.juice.shake(0.5, 0.8);
        k.juice.impactFrame(0.5);
        break;
      }
      case 'boss-phase': {
        const b = findShip(run, e.id);
        const x = b ? b.x : run.player.x, z = b ? b.z : run.player.z;
        const len = b ? b.length : 80;
        fx.burst(x, fx.wy(x, z) + 10, z, 30, GlowPal.Gold, 0.12);
        fx.shock(x, z, len * 1.2, 0.8, 0xffe6a0, 1.4, 1.5);
        fx.ring(x, fx.wy(x, z) + 10, z, 10, len * 1.4, GlowPal.Gold, 0.6, 1.2);
        fx.sparks(x, fx.wy(x, z) + 8, z, 20, 40, GlowPal.Gold, 0, 0.5, 0, 0.2, 0.5);
        k.juice.impactFrame(1);
        k.juice.shake(0.65, 0.5);
        k.juice.flash(0xfff0c0, 0.35, 0.15);
        break;
      }
      case 'boss-attack': this.bossAttack(e.id, e.attack, run, water); break;
      case 'boss-defeated': {
        const b = findShip(run, e.id);
        const len = b ? b.length : CONTENT.bosses[e.boss].length;
        const heading = b ? b.heading : 0;
        const fxv = -Math.sin(heading), fzv = -Math.cos(heading);
        fx.kill(e.x, e.z, len * 0.7, heading, true, true);
        k.juice.impactFrame(1);
        k.juice.slowMo(0.3, 0.9);
        k.juice.flash(0xfff4d6, 0.45, 0.2);
        k.juice.shake(0.8, 0.8);
        for (let i = 0; i < 7; i++) {
          const along = (i / 6 - 0.5) * len * 0.8 * (i % 2 ? 1 : -1);
          this.schedule(0.25 + i * 0.28, Job.FinaleBurst, e.x + fxv * along + spread(4), e.z + fzv * along + spread(4), len * 0.35, heading);
        }
        this.schedule(2.35, Job.FinaleEnd, e.x, e.z, len, heading);
        this.trackSinking(e.id, e.x, e.z, len);
        break;
      }
      case 'lightning-strike': fx.lightningStrike(e.x, e.z); break;
      case 'chest-opened': {
        const p = run.player;
        const wy = fx.wy(p.x, p.z);
        fx.burst(p.x, wy + 10, p.z, 24, GlowPal.Gold, 0.12);
        fx.sparkles(p.x, wy + 8, p.z, 30, 16, GlowPal.Gold, 1.5);
        fx.ring(p.x, wy + 8, p.z, 8, 50, GlowPal.Gold, 0.6, 1.2);
        break;
      }
      case 'player-died': {
        const p = run.player;
        if (!e.reviving) {
          fx.kill(p.x, p.z, p.length, p.heading, false, true);
          k.juice.impactFrame(1);
          k.juice.slowMo(0.3, 1.0);
          k.juice.shake(0.9, 0.9);
        }
        break;
      }
      case 'revived': {
        const p = run.player;
        const wy = fx.wy(p.x, p.z);
        fx.shock(p.x, p.z, 50, 1.0, 0x9fffc4, 1.4, 1.4);
        fx.ring(p.x, wy + 8, p.z, 10, 60, GlowPal.Heal, 0.8, 1.4);
        fx.sparkles(p.x, wy + 6, p.z, 30, 14, GlowPal.Heal, 1.6);
        k.juice.flash(0xd8ffe6, 0.35, 0.25);
        break;
      }
      case 'weapon-changed': {
        const p = run.player;
        const wy = fx.wy(p.x, p.z);
        fx.sparkles(p.x, wy + 8, p.z, e.overdrive ? 24 : 10, 10, e.overdrive ? GlowPal.Gold : GlowPal.Glint, 1.2);
        if (e.overdrive) fx.ring(p.x, wy + 8, p.z, 6, 40, GlowPal.Gold, 0.6, 1.3);
        break;
      }
      // Visual-free events (UI/audio/sky own them): card-chosen, passive-changed, skill-ready, director-event,
      // weather-changed (sky crossfades), run-ended.
      default: break;
    }
  }

  private nearShip(run: Readonly<RunState>, x: number, z: number, radius: number): boolean {
    const p = run.player;
    if (Math.hypot(p.x - x, p.z - z) < p.radius + radius * 0.5) return true;
    for (const en of run.enemies) if (Math.hypot(en.x - x, en.z - z) < en.radius + radius * 0.5) return true;
    for (const b of run.bosses) if (Math.hypot(b.x - x, b.z - z) < b.radius + radius * 0.5) return true;
    return false;
  }

  // ───────────── weapons ─────────────

  private weaponFired(e: Extract<SimEvent, { type: 'weapon-fired' }>, run: Readonly<RunState>, water: (x: number, z: number) => number): void {
    const fx = this.fx;
    const f = this.frame;
    const p = run.player;
    const w = e.weapon;
    if (w === 'escort-skiffs') {
      const y = water(e.x, e.z) + 1.8;
      fx.muzzle(e.x + e.dirX * 2, y, e.z + e.dirZ * 2, e.dirX, e.dirZ, 0.55, 0, 1, false);
      return;
    }
    if (!shipFrame(run, this.k.ships, e.owner, f, water)) return;
    if (w === 'broadside') {
      const sideSign = e.side === 'port' ? -1 : 1;
      const sk = p.skills.broadside;
      const manual = e.owner === 0 && sk.cooldownMax > 0 && sk.cooldown > sk.cooldownMax - 0.15;
      this.broadside(f, sideSign, e.count, manual ? 1.3 : 1, manual ? 0.045 : 0.028, manual ? 4 : 2, true, GlowPal.Muzzle);
      if (manual) {
        this.k.juice.kick(5, 0.35);
        this.k.juice.shake(0.28, 0.3);
        // the smoke wall of a full broadside
        const dx = f.sx * sideSign, dz = f.sz * sideSign;
        for (let i = 0; i < 5; i++) {
          const along = (i / 4 - 0.5) * f.length * 0.8;
          fx.smoke(f.x + f.fx * along + dx * (f.gunSide + 9), f.gunY + 2, f.z + f.fz * along + dz * (f.gunSide + 9), 2, 5, 11, CelPal.Gunsmoke, 3.0,
            dx * 6, 1, dz * 6, 2, 1.4, 3, 0.05 + i * 0.03, 0.4);
        }
        const o = this.k.ocean;
        if (o) o.stampWake(f.x + dx * f.gunSide, f.z + dz * f.gunSide, dx, dz, f.length * 0.7, 0.8);
      }
      return;
    }
    const dirX = e.dirX, dirZ = e.dirZ;
    switch (w) {
      case 'bow-chaser': {
        const x = f.x + f.fx * f.length * 0.48, z = f.z + f.fz * f.length * 0.48;
        for (let i = 0; i < Math.max(1, e.count); i++) fx.muzzle(x, f.gunY + 0.5, z, dirX, dirZ, 1.1, i * 0.08, 3, true);
        break;
      }
      case 'stern-mortar': {
        const x = f.x - f.fx * f.length * 0.4, z = f.z - f.fz * f.length * 0.4;
        const y = f.gunY + 1.5;
        const g = this.k.glow;
        g.spec.reset().at(x, y, z).vel(dirX * 0.004, 0.01, dirZ * 0.004).look(Glow.DirFlash, GlowPal.Muzzle, Mode.Velocity, true).sized(8, 9, 2).stretched(1.5).lived(0.09);
        g.emit();
        fx.burst(x, y + 1, z, 5, GlowPal.Muzzle, 0.07);
        fx.smoke(x, y + 2, z, 5, 2, 6.5, CelPal.Gunsmoke, 2.2, 0, 9, 0, 4, 1.5, 1, 0, 0.35);
        this.k.juice.shake(0.12, 0.2);
        break;
      }
      case 'swivel-guns': {
        const n = Math.min(6, Math.max(1, e.count));
        for (let i = 0; i < n; i++) {
          const along = spread(f.length * 0.35);
          const side = dirX * f.sx + dirZ * f.sz >= 0 ? 1 : -1;
          fx.muzzle(f.x + f.fx * along + f.sx * side * f.gunSide, f.gunY + 1.2, f.z + f.fz * along + f.sz * side * f.gunSide, dirX, dirZ, 0.45, i * 0.035, 1, false);
        }
        break;
      }
      case 'rocket-rack': {
        const n = Math.min(12, Math.max(1, e.count));
        for (let i = 0; i < n; i++) {
          const x = f.x + spread(f.length * 0.15), z = f.z + spread(f.length * 0.15);
          fx.burst(x, f.gunY + 2, z, 3.5, GlowPal.Explosion, 0.06, i * 0.04);
          fx.smoke(x, f.gunY + 2, z, 2, 1.5, 4.5, CelPal.Gunsmoke, 1.4, 0, 6, 0, 3, 1.2, 1, i * 0.04, 0.3);
        }
        break;
      }
      case 'harpoon': fx.muzzle(f.x + f.fx * f.length * 0.5, f.gunY, f.z + f.fz * f.length * 0.5, dirX, dirZ, 0.6, 0, 1, false); break;
      case 'storm-rod': {
        const wy = water(f.x, f.z);
        const top = wy + f.length * 0.62;
        fx.burst(f.x, top, f.z, 7, GlowPal.Lightning, 0.08);
        fx.soft(f.x, top, f.z, 18, GlowPal.Lightning, 0.25, 0.8);
        break;
      }
      case 'fire-barrels': case 'tide-mines': {
        const x = f.x - f.fx * f.length * 0.5, z = f.z - f.fz * f.length * 0.5;
        fx.plop(x, z, 1.4);
        break;
      }
      case 'maelstrom-charm': {
        const wy = water(f.x, f.z);
        fx.sparkles(f.x, wy + 6, f.z, 8, 8, GlowPal.Magic, 0.8);
        break;
      }
      default: fx.muzzle(f.x, f.gunY, f.z, dirX, dirZ, 0.8, 0, 2, false); break;
    }
  }

  /** Ripple fire down one side: flashes staggered bow → stern, each with smoke and a water blast. */
  private broadside(f: ShipFrame, sideSign: number, guns: number, scale: number, stagger: number, puffs: number, water: boolean, pal: number): void {
    const n = Math.max(1, Math.min(24, guns));
    const dx = f.sx * sideSign, dz = f.sz * sideSign;
    const maxDelay = 0.24;
    const st = n > 1 ? Math.min(stagger, maxDelay / (n - 1)) : 0;
    for (let i = 0; i < n; i++) {
      const along = n > 1 ? (i / (n - 1) - 0.5) * f.length * 0.6 : 0;
      const x = f.x + f.fx * along + dx * f.gunSide;
      const z = f.z + f.fz * along + dz * f.gunSide;
      const delay = (n - 1 - i) * st + rand() * 0.008;
      this.fx.muzzle(x, f.gunY, z, dx, dz, scale, delay, puffs, water, pal);
    }
  }

  private enemyFired(e: Extract<SimEvent, { type: 'enemy-fired' }>, run: Readonly<RunState>, water: (x: number, z: number) => number): void {
    const f = this.frame;
    if (!shipFrame(run, this.k.ships, e.source, f, water)) return;
    const s = Math.max(0.6, Math.min(1.4, f.length / 30));
    if (e.projectile === 'enemy-mortar') {
      const g = this.k.glow;
      g.spec.reset().at(f.x, f.gunY + 1, f.z).vel(e.dirX * 0.004, 0.01, e.dirZ * 0.004).look(Glow.DirFlash, GlowPal.Enemy, Mode.Velocity, true).sized(7 * s, 8 * s, 2).stretched(1.5).lived(0.09);
      g.emit();
      this.fx.smoke(f.x, f.gunY + 2, f.z, 4, 2 * s, 6 * s, CelPal.Gunsmoke, 2.0, 0, 8, 0, 3, 1.4, 1, 0, 0.35);
      return;
    }
    if (e.projectile === 'enemy-chaser' || e.count <= 1) {
      this.fx.muzzle(f.x + f.fx * f.length * 0.45, f.gunY, f.z + f.fz * f.length * 0.45, e.dirX, e.dirZ, 0.8 * s, 0, 2, false);
      return;
    }
    const side = e.dirX * f.sx + e.dirZ * f.sz >= 0 ? 1 : -1;
    this.broadside(f, side, e.count, 0.85 * s, 0.035, 2, e.count >= 5, GlowPal.Muzzle);
  }

  private bossAttack(id: number, attack: string, run: Readonly<RunState>, water: (x: number, z: number) => number): void {
    const f = this.frame;
    if (!shipFrame(run, this.k.ships, id, f, water)) return;
    const p = run.player;
    const dx = p.x - f.x, dz = p.z - f.z;
    if (attack.includes('broadside') || attack.includes('volley')) {
      const side = dx * f.sx + dz * f.sz >= 0 ? 1 : -1;
      this.broadside(f, side, 10, 1.5, 0.03, 3, true, GlowPal.Muzzle);
      this.k.juice.shakeAt(0.2, Math.hypot(dx, dz), 0.3);
    } else if (attack.includes('mortar') || attack.includes('judgment')) {
      this.fx.burst(f.x, f.gunY + 4, f.z, 12, GlowPal.Enemy, 0.08);
      this.fx.smoke(f.x, f.gunY + 4, f.z, 6, 3, 9, CelPal.Gunsmoke, 2.4, 0, 10, 0, 5, 1.5, 4, 0, 0.35);
    } else if (attack.includes('submerge') || attack.includes('dive')) {
      this.fx.waterSplash(f.x, f.z, 3);
      this.fx.bubbles(f.x, f.z, 20, f.length * 0.3, 3);
    } else if (attack.includes('lunge') || attack.includes('breach') || attack.includes('surface')) {
      this.fx.explosion('water', f.x, f.z, 30, true, false, 'enemy');
      this.fx.cloudRing(f.x, water(f.x, f.z) + 4, f.z, f.fx, f.fz, 24, 18);
    } else if (attack.includes('slam') || attack.includes('wave')) {
      this.fx.shock(f.x, f.z, 90, 1.2, 0xdff4ff, 1, 1.5);
      this.fx.foam(f.x, f.z, 30, 2.5, 0, 1.4);
      this.k.juice.shakeAt(0.5, Math.hypot(dx, dz), 0.5);
    } else if (attack.includes('ram') || attack.includes('charge')) {
      this.fx.sheet(f.x + f.fx * f.length * 0.5, water(f.x, f.z), f.z + f.fz * f.length * 0.5, 14, 1.3, 0.8);
      this.fx.droplets(f.x + f.fx * f.length * 0.5, water(f.x, f.z) + 2, f.z + f.fz * f.length * 0.5, 20, 12, 16, 1);
    }
  }

  private projectileHit(e: Extract<SimEvent, { type: 'projectile-hit' }>, run: Readonly<RunState>): void {
    const fx = this.fx;
    const s = HIT_SCALE[e.projectile] ?? 1;
    if (e.target === 'water') {
      if (e.projectile === 'torpedo') { fx.explosion('water', e.x, e.z, 10, true, false, e.team); return; }
      if (e.projectile === 'rocket') { fx.explosion('small', e.x, e.z, 6, true, false, e.team); return; }
      if (s < 0.5) { fx.plop(e.x, e.z, 1.2); return; }
      fx.waterSplash(e.x, e.z, s);
      return;
    }
    const wy = fx.wy(e.x, e.z);
    if (e.target === 'island') { fx.islandHit(e.x, Math.max(e.y, wy + 1), e.z, s); return; }
    // ship hit: estimate travel direction (player shots come from the player; enemy shots head into the player)
    const p = run.player;
    let dx: number, dz: number;
    if (e.team === 'player') { dx = e.x - p.x; dz = e.z - p.z; } else { dx = p.x - e.x; dz = p.z - e.z; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const ship = e.targetId !== undefined && e.targetId !== 0 ? findShip(run, e.targetId) : null;
    const y = wy + (ship ? Math.max(2.5, Math.min(6, ship.length * 0.1)) : 3.5);
    switch (e.projectile) {
      case 'water-bolt':
        fx.explosion('water', e.x, e.z, 7, true, false, e.team);
        fx.burst(e.x, y, e.z, 7, GlowPal.WaterBolt, 0.08);
        break;
      case 'rocket': fx.explosion('small', e.x, e.z, 7, false, true, e.team); break;
      case 'torpedo': fx.explosion('water', e.x, e.z, 11, true, true, e.team); fx.planks(e.x, y, e.z, 5, 8, 14, 0.8, 2, 0.2); break;
      case 'harpoon':
        fx.sparks(e.x, y, e.z, 6, 22, GlowPal.Spark, -dx, 0.4, -dz, 0.4, 0.3);
        fx.planks(e.x, y, e.z, 2, 5, 8, 0.5, 1.2, 0);
        break;
      case 'lance':
        fx.burst(e.x, y, e.z, 9, GlowPal.Gold, 0.08);
        fx.hullHit(e.x, y, e.z, dx, dz, 1.1, e.crit, false);
        break;
      default:
        if (s < 0.5) { fx.sparks(e.x, y, e.z, 4, 20, GlowPal.Spark, -dx, 0.4, -dz, 0.4, 0.25); fx.burst(e.x, y, e.z, 2.5, GlowPal.Spark, 0.05); }
        else fx.hullHit(e.x, y, e.z, dx, dz, s, e.crit, e.team === 'enemy');
    }
  }

  private playerHit(e: Extract<SimEvent, { type: 'player-hit' }>, run: Readonly<RunState>, water: (x: number, z: number) => number): void {
    const p = run.player;
    const fx = this.fx;
    const wy = water(e.x, e.z);
    if (e.parried) { fx.parry(p.x, p.z, p.length * 0.6); return; }
    if (e.braced) fx.brace(p.x, p.z, p.length * 0.6);
    const frac = e.amount / Math.max(1, p.maxHp);
    let dx = p.x - e.x, dz = p.z - e.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const hx = l > p.length ? p.x - dx * p.beam * 0.5 : e.x, hz = l > p.length ? p.z - dz * p.beam * 0.5 : e.z;
    if (e.amount > 0.5) {
      fx.sparks(hx, wy + 3.5, hz, 8, 26, GlowPal.Enemy, -dx, 0.6, -dz, 0.4, 0.4);
      fx.planks(hx, wy + 3.5, hz, 2 + Math.min(4, frac * 40), 6, 10, 0.6, 1.6, 0.2, -dx * 3, -dz * 3);
      fx.burst(hx, wy + 3.5, hz, 5, GlowPal.Enemy, 0.07);
      fx.soft(p.x, wy + 4, p.z, p.length * 0.9, GlowPal.Enemy, 0.14, Math.min(0.8, 0.35 + frac * 6));
      this.k.numbers.add(-1, e.amount, false, p.x, wy + 12, p.z, 0xff5a4a);
    }
    this.k.juice.shake(Math.min(0.9, 0.22 + frac * 5), 0.3);
    if (frac > 0.04) this.k.juice.chromatic(Math.min(0.8, 0.3 + frac * 4), 0.22);
    if (frac > 0.12) this.k.juice.flash(0xff3b30, 0.18, 0.12);
  }

  private pickupCollected(e: Extract<SimEvent, { type: 'pickup-collected' }>, run: Readonly<RunState>): void {
    const fx = this.fx;
    const p = run.player;
    switch (e.kind) {
      case 'xp-copper': fx.pickup(e.x, e.z, p.x, p.z, GlowPal.Ember, 2); break;
      case 'xp-silver': fx.pickup(e.x, e.z, p.x, p.z, GlowPal.Glint, 3); break;
      case 'xp-gold': fx.pickup(e.x, e.z, p.x, p.z, GlowPal.Gold, 5); break;
      case 'doubloon': fx.pickup(e.x, e.z, p.x, p.z, GlowPal.Gold, 6); break;
      case 'repair': {
        fx.pickup(e.x, e.z, p.x, p.z, GlowPal.Heal, 8);
        const wy = fx.wy(p.x, p.z);
        fx.sparkles(p.x, wy + 5, p.z, 18, 10, GlowPal.Heal, 1.3);
        fx.ring(p.x, wy + 6, p.z, 8, p.length * 1.4, GlowPal.Heal, 0.5, 1.1);
        break;
      }
      case 'compass': {
        fx.pickup(e.x, e.z, p.x, p.z, GlowPal.Shield, 8);
        this.k.decals.emit(Decal.Shock, p.x, p.z, 260, 1.4, 0x9fdcff, 0.4, 0x9fdcff, 0.8, 0.5);
        break;
      }
      case 'powder-keg': {
        fx.explosion('powder', e.x, e.z, 12, true, false, 'player');
        this.k.decals.emit(Decal.Shock, p.x, p.z, 260, 0.9, 0xfff0c0, 0.6, 0xffc86a, 1.4, 1.2);
        this.k.decals.emit(Decal.Shock, p.x, p.z, 200, 0.7, 0xffffff, 0.4, 0xffffff, 0.8, 0.8, 0, 0.1);
        this.k.juice.flash(0xfff2c0, 0.5, 0.2);
        this.k.juice.shake(0.7, 0.6);
        this.k.juice.impactFrame(0.8);
        break;
      }
      case 'chest': {
        const wy = fx.wy(e.x, e.z);
        fx.burst(e.x, wy + 4, e.z, 18, GlowPal.Gold, 0.1);
        fx.sparkles(e.x, wy + 4, e.z, 26, 14, GlowPal.Gold, 1.4);
        fx.pickup(e.x, e.z, p.x, p.z, GlowPal.Gold, 10);
        this.k.juice.flash(0xffe7a0, 0.2, 0.15);
        break;
      }
    }
  }

  private statusOn(target: number, status: string, run: Readonly<RunState>, water: (x: number, z: number) => number): void {
    const ship = target === 0 ? run.player : findShip(run, target);
    if (!ship) return;
    const wy = water(ship.x, ship.z) + 4;
    switch (status) {
      case 'stunned': this.fx.sparks(ship.x, wy + 4, ship.z, 10, 18, GlowPal.Lightning, 0, 1, 0, 0.5, 0.4); this.fx.burst(ship.x, wy + 5, ship.z, 6, GlowPal.Lightning, 0.07); break;
      case 'burning': this.fx.fireballs(ship.x, wy, ship.z, 3, 4, 2, 5, 0.5); break;
      case 'slowed': this.k.decals.emit(Decal.Shock, ship.x, ship.z, ship.length * 0.9, 0.5, 0x9fe6ff, 0.5, 0x9fe6ff, 0.5, 1); break;
      case 'hooked': this.fx.burst(ship.x, wy, ship.z, 5, GlowPal.Spark, 0.06); break;
      default: break;
    }
  }

  private lightning(points: readonly { x: number; z: number }[], team: 'player' | 'enemy', run: Readonly<RunState>, water: (x: number, z: number) => number): void {
    const n = Math.min(points.length, 48);
    if (n < 2) return;
    const p = run.player;
    const pts = this.chainPts;
    for (let i = 0; i < n; i++) {
      const pt = points[i]!;
      let y = water(pt.x, pt.z) + 6;
      if (i === 0 && team === 'player' && Math.hypot(pt.x - p.x, pt.z - p.z) < p.length) {
        y = water(p.x, p.z) + p.length * 0.62;
      } else {
        const ship = this.nearestShipHeight(run, pt.x, pt.z);
        if (ship > 0) y = water(pt.x, pt.z) + ship;
      }
      pts[i * 3] = pt.x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = pt.z;
    }
    this.fx.chain(pts, n, team === 'player' ? GlowPal.Lightning : GlowPal.Magic);
    const d = Math.hypot(points[0]!.x - p.x, points[0]!.z - p.z);
    if (d < 200) this.k.juice.flash(0xcfefff, 0.1, 0.08);
  }

  private nearestShipHeight(run: Readonly<RunState>, x: number, z: number): number {
    for (const en of run.enemies) if (Math.abs(en.x - x) < en.radius && Math.abs(en.z - z) < en.radius) return Math.max(4, en.length * 0.18);
    for (const b of run.bosses) if (Math.abs(b.x - x) < b.radius && Math.abs(b.z - z) < b.radius) return Math.max(6, b.length * 0.12);
    return 0;
  }

  private hazardSpawned(kind: string, x: number, z: number, radius: number): void {
    const fx = this.fx;
    switch (kind) {
      case 'barrel': case 'powder-keg': case 'mine': fx.plop(x, z, 1.3); break;
      case 'whirlpool': fx.foam(x, z, radius, 1.8, 0, 1.2); fx.droplets(x, fx.wy(x, z) + 1, z, 12, 8, 10, 0.8); break;
      case 'shockwave': fx.burst(x, fx.wy(x, z) + 3, z, 10, GlowPal.Shield, 0.08); break;
      case 'wave-front': fx.sheet(x, fx.wy(x, z) - 0.5, z, radius * 0.4, 1.3, 0.9); break;
      case 'burning-wreck': fx.fireballs(x, fx.wy(x, z) + 1, z, 5, 6, 3, 6, 0.7); break;
      case 'fire-patch': fx.fireballs(x, fx.wy(x, z) + 0.5, z, 4, radius * 0.5, radius * 0.5, 4, 0.5); break;
      case 'escort-skiff': fx.plop(x, z, 1.6); break;
      default: break;
    }
  }

  // ───────────── skills ─────────────

  private skillUsed(slot: SkillSlot, skill: SkillSlot | SpecialId | UltimateId, x: number, z: number, aimX: number, aimZ: number,
    run: Readonly<RunState>, water: (x: number, z: number) => number): void {
    const fx = this.fx;
    const k = this.k;
    const p = run.player;
    const f = this.frame2;
    shipFrame(run, k.ships, 0, f, water);
    const wy = water(x, z);
    const L = p.length;
    let ax = aimX - x, az = aimZ - z;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    switch (skill) {
      case 'brace': fx.brace(x, z, L * 0.6); break;
      case 'boost': {
        k.juice.speedLines(0.55, 2.5);
        const bx = x + f.fx * L * 0.5, bz = z + f.fz * L * 0.5;
        fx.sheet(bx, wy - 0.3, bz, 9, 1.1, 0.6, f.fx * 4, f.fz * 4);
        fx.droplets(bx, wy + 1, bz, 18, 9, 12, 0.8);
        fx.cloudRing(x - f.fx * L * 0.5, wy + 3, z - f.fz * L * 0.5, f.fx, f.fz, 9, 12);
        k.ocean?.stampWake(x, z, f.fx, f.fz, L * 0.8, 1);
        break;
      }
      case 'broadside': k.juice.kick(5, 0.35); break;
      case 'lionburst': {
        this.launchAge = 0;
        k.juice.speedLines(1, 1.2);
        k.juice.kick(9, 0.5);
        k.juice.shake(0.45, 0.35);
        fx.cloudRing(x - ax * L * 0.45, wy + 6, z - az * L * 0.45, ax, az, L * 0.85, 30);
        fx.explosion('water', x - ax * L * 0.3, z - az * L * 0.3, 14, true, false, 'player');
        fx.burst(x - ax * L * 0.5, wy + 5, z - az * L * 0.5, 22, GlowPal.Gold, 0.1);
        fx.sparks(x - ax * L * 0.5, wy + 4, z - az * L * 0.5, 16, 50, GlowPal.Gold, -ax, 0.3, -az, 0.6, 0.5);
        // landing marker along the dash line
        k.decals.emit(Decal.Line, x + ax * 90, z + az * 90, 6, 1.0, 0xffd76a, 0.8, 0x5a4210, 0.4, 1, 0, 0, Math.atan2(ax, az), 90);
        break;
      }
      case 'second-wind': {
        fx.shock(x, z, L * 1.6, 0.8, 0x9fffc4, 1.4, 1.4);
        fx.ring(x, wy + 6, z, 8, L * 1.6, GlowPal.Heal, 0.6, 1.4);
        fx.sparkles(x, wy + 4, z, 34, 12, GlowPal.Heal, 1.6);
        const g = k.glow;
        g.spec.reset().at(x, wy - 1, z).look(Glow.Shaft, GlowPal.Heal, Mode.Upright, true).sized(L * 0.6, L * 0.8, 3).stretched(4).lived(1.2);
        g.emit();
        k.juice.flash(0xd8ffe6, 0.25, 0.2);
        break;
      }
      case 'deep-dive': {
        this.diveAge = 0;
        fx.waterSplash(x, z, 2.2);
        fx.bubbles(x, z, 30, L * 0.4, 2.2);
        fx.foam(x, z, L * 0.9, 3, 0, 1.4);
        k.decals.emit(Decal.Whirl, x, z, L * 0.8, 1.6, 0xffffff, 0.9, 0x0b3d52, 0, 3, 4);
        k.ocean?.stampDisplace(x, z, L * 0.6, -2);
        break;
      }
      case 'chefs-banquet': {
        fx.sparkles(x, wy + 6, z, 36, 14, GlowPal.Frenzy, 1.5);
        fx.sparkles(x, wy + 6, z, 18, 10, GlowPal.Heal, 1.3);
        fx.ring(x, wy + 6, z, 8, L * 1.5, GlowPal.Frenzy, 0.5, 1.2);
        fx.flames(x, wy + 2, z, 6, 5, L * 0.3, 0.9, 0, CelPal.GoldFire);
        fx.shock(x, z, L * 1.4, 0.7, 0xffc070, 1.1, 1.2);
        break;
      }
      case 'signal-flare': {
        const g = k.glow;
        // a red flare streaks up and hangs over the target
        g.spec.reset().at(x, wy + 6, z).vel((aimX - x) * 0.9, 42, (aimZ - z) * 0.9).dragTo(1.2, 0, 0, 0).look(Glow.Spark, GlowPal.FlareRed, Mode.Velocity)
          .sized(1.6, 1.4).stretched(3, 0.05).lived(1.2);
        g.emit();
        g.spec.reset().at(aimX, water(aimX, aimZ) + 40, aimZ).vel(0, -1.5, 0).look(Glow.Burst, GlowPal.FlareRed).sized(6, 8).lived(2.6).after(0.9).bright(0.8);
        g.emit();
        g.spec.reset().at(aimX, water(aimX, aimZ) + 40, aimZ).vel(0, -1.5, 0).look(Glow.Soft, GlowPal.FlareRed).sized(40, 44).lived(2.6).after(0.9).bright(0.7);
        g.emit();
        fx.smoke(aimX, water(aimX, aimZ) + 40, aimZ, 5, 2, 7, CelPal.FlareSmoke, 3.2, 0, 1, 0, 1, 0.6, 2, 0.9, 0.35);
        fx.muzzle(x, f.gunY + 2, z, ax, az, 0.8, 0, 2, false, GlowPal.FlareRed);
        k.decals.emit(Decal.Circle, aimX, aimZ, 30, 2.4, 0xffd76a, 0.8, 0x5a4210, 0.2, 0.5);
        break;
      }
      case 'seaquake': {
        k.decals.emit(Decal.Cracks, x, z, 170, 1.4, 0xbff2ff, 1, 0x1b2340, 1.2);
        fx.shock(x, z, 170, 1.1, 0xffffff, 1.6, 1.8);
        fx.shock(x, z, 120, 0.9, 0xbfeaff, 1.0, 1.2, 0.12);
        fx.foam(x, z, 60, 3.0, 0, 1.0);
        const n = 18;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          fx.column(x + Math.cos(a) * 55, z + Math.sin(a) * 55, 6, 2.6, 1.1, 0.12 + (i % 3) * 0.05);
        }
        k.ocean?.stampRing(x, z, 80, 1);
        k.ocean?.stampDisplace(x, z, 50, -3);
        k.juice.impactFrame(1);
        k.juice.chromatic(0.8, 0.5);
        k.juice.shake(1, 0.8);
        k.juice.flash(0xdff6ff, 0.3, 0.15);
        break;
      }
      case 'ramming-speed': {
        k.juice.speedLines(0.85, 6);
        k.juice.kick(6, 0.4);
        const bx = x + f.fx * L * 0.5, bz = z + f.fz * L * 0.5;
        fx.burst(bx, wy + 4, bz, 16, GlowPal.Frenzy, 0.1);
        fx.sheet(bx, wy - 0.3, bz, 14, 1.3, 0.8, f.fx * 6, f.fz * 6);
        fx.cloudRing(x - f.fx * L * 0.4, wy + 4, z - f.fz * L * 0.4, f.fx, f.fz, 12, 16);
        break;
      }
      case 'sunfire-barrage': {
        fx.burst(x, wy + 10, z, 36, GlowPal.Gold, 0.14);
        fx.ring(x, wy + 10, z, 10, 90, GlowPal.Gold, 0.8, 1.3);
        fx.shock(x, z, 90, 1.0, 0xffd84a, 1.4, 1.5);
        fx.sparkles(x, wy + 8, z, 30, 18, GlowPal.Gold, 1.5);
        k.juice.flash(0xffe7a0, 0.35, 0.2);
        k.juice.kick(6, 0.4);
        k.juice.impactFrame(0.6);
        break;
      }
      case 'torpedo-swarm': {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          const tx = x + Math.cos(a) * L * 0.4, tz = z + Math.sin(a) * L * 0.4;
          fx.plop(tx, tz, 1.3);
          fx.bubbles(tx, tz, 3, 2, 1.4, i * 0.03);
        }
        k.juice.shake(0.2, 0.3);
        break;
      }
      case 'kitchen-inferno': {
        const n = 16;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          fx.fireballs(x + Math.cos(a) * L * 0.9, wy + 1, z + Math.sin(a) * L * 0.9, 2, 7, 1.5, 6, 0.8, i * 0.02);
          fx.flames(x + Math.cos(a) * L * 0.9, wy, z + Math.sin(a) * L * 0.9, 1, 7, 1, 1.4, 0.1);
        }
        fx.shock(x, z, L * 1.4, 0.8, 0xff9a3a, 1.4, 1.6);
        k.decals.emit(Decal.Glow, x, z, L * 1.3, 1.6, 0xff8a2a, 0, 0xff8a2a, 1.4, 12);
        k.juice.flash(0xffb070, 0.3, 0.2);
        k.juice.shake(0.35, 0.4);
        break;
      }
      case 'admirals-judgment': {
        const len = 320;
        const ang = Math.atan2(ax, az);
        k.decals.emit(Decal.Line, x + ax * len * 0.5, z + az * len * 0.5, 16, 2.0, 0xffd76a, 0.9, 0x5a4210, 0.6, 1, 0, 0, ang, len * 0.5);
        const g = k.glow;
        g.spec.reset().at(x, wy + 6, z).vel(ax * 40, 60, az * 40).dragTo(1.4, 0, 0, 0).look(Glow.Spark, GlowPal.Gold, Mode.Velocity).sized(1.8, 1.4).stretched(3, 0.05).lived(1.0);
        g.emit();
        fx.burst(x, f.gunY + 3, z, 14, GlowPal.Gold, 0.1);
        k.juice.kick(4, 0.3);
        break;
      }
      case 'tidal-colossus': {
        fx.explosion('water', x - f.fx * L * 0.4, z - f.fz * L * 0.4, 22, true, false, 'player');
        fx.cloudRing(x - f.fx * L * 0.5, wy + 6, z - f.fz * L * 0.5, f.fx, f.fz, L * 0.6, 26);
        fx.shock(x, z, 120, 1.2, 0xdff6ff, 1.2, 1.6);
        k.ocean?.stampDisplace(x + f.fx * L, z + f.fz * L, 40, 3);
        k.juice.shake(0.8, 1.0);
        k.juice.speedLines(0.7, 1.4);
        k.juice.impactFrame(0.6);
        break;
      }
      default: {
        if (slot === 'special' || slot === 'ultimate') { fx.burst(x, wy + 8, z, 20, GlowPal.Gold, 0.1); fx.sparkles(x, wy + 6, z, 16, 10, GlowPal.Gold, 1.2); }
        break;
      }
    }
    void range;
    void Cel;
  }

  /** Called every frame by FxSystem to age launch/dive markers. */
  tick(dt: number): void { this.launchAge += dt; this.diveAge += dt; }

  /** Weapon ids that exist; referenced so the table above stays exhaustive at compile time. */
  static readonly weapons: readonly WeaponId[] = [];
}
