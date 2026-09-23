/**
 * Run simulation orchestrator (CORE-owned). Fixed 60 Hz step, seeded, no rendering.
 * The public API below is the contract used by src/runtime; system internals live in sibling files.
 */
import { hashString, createSeededRandom } from '../../core/rng';
import { CONTENT } from '../content';
import {
  HAZARD_POOL, MAX_STEPS_PER_FRAME, PICKUP_POOL, PROJECTILE_POOL, SIM_DT, TELEGRAPH_POOL,
} from '../constants';
import type { BossId, EnemyId, PickupKind, SeaId, ShipId, StatusKind, WeaponId } from '../ids';
import type {
  BossState, ContentDb, EnemyState, HazardState, MetaProfile, PickupState, PlayerInput, PlayerState,
  ProjectileState, RunResult, RunState, SimAction, SimEvent, TelegraphState, WorldQuery,
} from '../types';
import type {
  DamageOpts, HazardSpawn, PlayerDamageOpts, ProjectileSpawn, SimContext, Target, TelegraphSpawn,
} from './context';
import { updateBosses } from './bosses';
import { resolveCollisions } from './collisions';
import { updateDirector } from './director';
import { updateEnemies } from './ai';
import { updateHazards } from './hazards';
import { updatePickups } from './pickups';
import { BRACE_DURATION, PARRY_WINDOW, updatePlayer } from './player';
import {
  applyChosenCard, banishCard, initProgression, onBossKilled, onEnemyKilled, rerollOffers, updateProgression,
} from './progression';
import { updateProjectiles } from './projectiles';
import { SpatialHash } from './spatial';
import { createRunState } from './state';
import { updateWeapons } from './weapons';
import { updateSeaState } from './weather';

export interface SimOptions {
  seed: string;
  shipId: ShipId;
  seaId: SeaId;
  meta: MetaProfile;
  world: WorldQuery;
  content?: ContentDb;
}

export interface SimDebug {
  grantXp(amount: number): void;
  setLevel(level: number): void;
  spawnEnemy(defId: EnemyId, count?: number, elite?: boolean): void;
  spawnBoss(defId: BossId): void;
  setTime(seconds: number): void;
  god(on: boolean): void;
  giveWeapon(id: WeaponId, level?: number): void;
  killAll(): void;
}

const EMPTY_INPUT: PlayerInput = { steer: 0, throttleAxis: 0, aimX: 0, aimZ: -100, broadsideHeld: false };

export class Sim implements SimContext {
  readonly state: RunState;
  readonly content: ContentDb;
  readonly world: WorldQuery;
  readonly meta: MetaProfile;
  readonly random: () => number;
  readonly dt = SIM_DT;
  readonly debug: SimDebug;

  input: PlayerInput = { ...EMPTY_INPUT };
  actions = new Set<SimAction>();

  private readonly pendingActions = new Set<SimAction>();
  private readonly events: SimEvent[] = [];
  private readonly spatial = new SpatialHash<Target>(40);
  private idCounter = 1;
  private accumulator = 0;
  private timeScaleTimer = 0;
  private godMode = false;
  private ended: RunResult | null = null;

  constructor(opts: SimOptions) {
    this.content = opts.content ?? CONTENT;
    this.world = opts.world;
    this.meta = opts.meta;
    const rng = createSeededRandom(hashString(`${opts.seed}:${opts.shipId}:${opts.seaId}`));
    this.random = rng.next;
    this.state = createRunState({ seed: opts.seed, shipId: opts.shipId, seaId: opts.seaId, content: this.content, meta: opts.meta });
    initProgression(this);
    this.debug = this.createDebug();
  }

  // ───────────── Public API (runtime) ─────────────

  setInput(input: Partial<PlayerInput>): void { Object.assign(this.input, input); }

  press(action: SimAction): void { this.pendingActions.add(action); }

  chooseCard(index: number): boolean { return applyChosenCard(this, index); }

  reroll(): boolean { return rerollOffers(this); }

  banish(index: number): boolean { return banishCard(this, index); }

  setPaused(paused: boolean): void {
    const s = this.state;
    if (paused && s.status === 'running') s.status = 'paused';
    else if (!paused && s.status === 'paused') s.status = 'running';
  }

  retire(): void {
    if (this.ended) return;
    this.endRun('retired');
  }

  /** Advances by real seconds. Returns the number of fixed ticks executed. */
  step(realDt: number): number {
    if (this.timeScaleTimer > 0) {
      this.timeScaleTimer -= realDt;
      if (this.timeScaleTimer <= 0) this.state.timeScale = 1;
    }
    const s = this.state;
    if (s.status !== 'running') return 0;
    this.accumulator += Math.min(0.25, Math.max(0, realDt)) * s.timeScale;
    let ticks = 0;
    while (this.accumulator >= SIM_DT && ticks < MAX_STEPS_PER_FRAME) {
      this.accumulator -= SIM_DT;
      this.tick();
      ticks++;
      if (this.state.status !== 'running') { this.accumulator = 0; break; }
    }
    if (ticks >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
    return ticks;
  }

  drainEvents(): SimEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0, this.events.length);
  }

  result(): RunResult | null { return this.ended; }

  // ───────────── Tick ─────────────

  private tick(): void {
    const s = this.state;
    this.actions = new Set(this.pendingActions);
    this.pendingActions.clear();
    s.tick++;
    s.time += SIM_DT;

    updateSeaState(this);
    updatePlayer(this);
    updateDirector(this);
    updateEnemies(this);
    updateBosses(this);
    this.rebuildSpatial();
    updateWeapons(this);
    updateProjectiles(this);
    updateHazards(this);
    resolveCollisions(this);
    updatePickups(this);
    updateProgression(this);
    this.cleanup();
    if (this.godMode) { s.player.hp = s.player.maxHp; }
    if (!s.player.alive && s.status === 'running') this.endRun('defeat');
  }

  private rebuildSpatial(): void {
    this.spatial.clear();
    for (const e of this.state.enemies) if (e.life === 'alive') this.spatial.insert(e);
    for (const b of this.state.bosses) if (b.life === 'alive') this.spatial.insert(b);
  }

  private cleanup(): void {
    const s = this.state;
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i]!;
      if (e.life === 'sinking') {
        e.sink = Math.min(1, e.sink + SIM_DT / 3);
        if (e.sink >= 1) { e.life = 'dead'; this.emit({ type: 'enemy-sunk', id: e.id }); }
      }
      if (e.life === 'dead') s.enemies.splice(i, 1);
    }
    for (let i = s.bosses.length - 1; i >= 0; i--) {
      const b = s.bosses[i]!;
      if (b.life === 'sinking') { b.sink = Math.min(1, b.sink + SIM_DT / 6); if (b.sink >= 1) b.life = 'dead'; }
      if (b.life === 'dead') s.bosses.splice(i, 1);
    }
    for (const t of s.telegraphs) if (t.alive) { t.time += SIM_DT; if (t.time >= t.duration) t.alive = false; }
  }

  endRun(outcome: 'victory' | 'defeat' | 'retired'): void {
    const s = this.state;
    if (this.ended) return;
    s.status = outcome === 'victory' ? 'victory' : 'dead';
    this.emit({ type: 'run-ended', outcome });
    this.ended = {
      outcome, shipId: s.shipId, seaId: s.seaId, time: s.time, level: s.player.level, stats: s.stats,
      doubloonsEarned: s.stats.doubloons, newUnlocks: [],
    };
  }

  // ───────────── SimContext services ─────────────

  emit(event: SimEvent): void {
    if (this.events.length < 4096) this.events.push(event);
  }

  nextId(): number { return this.idCounter++; }

  player(): PlayerState { return this.state.player; }

  spawnEnemy(defId: EnemyId, x: number, z: number, opts: { elite?: boolean; heading?: number } = {}): EnemyState | null {
    const def = this.content.enemies[defId];
    const heat = this.state.director.heat;
    const elite = !!opts.elite;
    const hp = def.hp * (1 + (heat - 1) * 0.6) * (elite ? 3.5 : 1);
    const enemy: EnemyState = {
      id: this.nextId(), defId, faction: def.faction, life: 'alive', sink: 0,
      x, z, y: 0, heading: opts.heading ?? Math.atan2(-(this.state.player.x - x), -(this.state.player.z - z)),
      speed: 0, vx: 0, vz: 0, yawRate: 0, roll: 0, pitch: 0,
      radius: def.radius * (elite ? 1.2 : 1), length: def.length * (elite ? 1.2 : 1), beam: def.radius * 2 * (elite ? 1.2 : 1),
      hp, maxHp: hp, armor: def.armor, elite, hitFlash: 0, statuses: [],
      attackCooldown: 1 + this.random() * 2, ai: {}, spawnTime: this.state.time,
    };
    this.state.enemies.push(enemy);
    this.emit({ type: 'enemy-spawned', id: enemy.id, defId, x, z, elite });
    return enemy;
  }

  spawnBoss(defId: BossId, x: number, z: number, heading = 0): BossState {
    const def = this.content.bosses[defId];
    const hp = def.hp * this.state.director.heat;
    const boss: BossState = {
      id: this.nextId(), defId, life: 'alive', sink: 0,
      x, z, y: 0, heading, speed: 0, vx: 0, vz: 0, yawRate: 0, roll: 0, pitch: 0,
      radius: def.radius, length: def.length, beam: def.radius * 2,
      hp, maxHp: hp, armor: def.armor, phase: 0, hitFlash: 0, statuses: [], attack: 'arrive', attackTime: 0,
      submerged: 0, ai: {}, spawnTime: this.state.time,
    };
    this.state.bosses.push(boss);
    this.state.director.activeBoss = defId;
    this.emit({ type: 'boss-spawned', boss: defId, id: boss.id, x, z });
    return boss;
  }

  spawnProjectile(p: ProjectileSpawn): ProjectileState | null {
    const list = this.state.projectiles;
    let slot = list.find((q) => !q.alive);
    if (!slot) {
      if (list.length >= PROJECTILE_POOL) return null;
      slot = { id: 0, alive: false, kind: p.kind, team: p.team, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, damage: 0, radius: 0, pierce: 0, ttl: 0, age: 0, crit: false, area: 0, hits: [] };
      list.push(slot);
    }
    slot.id = this.nextId(); slot.alive = true; slot.kind = p.kind; slot.team = p.team;
    slot.x = p.x; slot.y = p.y ?? 3; slot.z = p.z; slot.vx = p.vx; slot.vy = p.vy ?? 0; slot.vz = p.vz;
    slot.damage = p.damage; slot.radius = p.radius ?? 1.2; slot.pierce = p.pierce ?? 0; slot.ttl = p.ttl ?? 3;
    slot.age = 0; slot.weapon = p.weapon; slot.target = p.target; slot.crit = p.crit ?? false; slot.area = p.area ?? 0;
    slot.hits.length = 0;
    return slot;
  }

  spawnHazard(h: HazardSpawn): HazardState | null {
    const list = this.state.hazards;
    let slot = list.find((q) => !q.alive);
    if (!slot) {
      if (list.length >= HAZARD_POOL) return null;
      slot = { id: 0, alive: false, kind: h.kind, team: h.team, x: 0, z: 0, radius: 0, ttl: 0, age: 0, damage: 0, tick: 0, tickTimer: 0, vx: 0, vz: 0, armed: true };
      list.push(slot);
    }
    slot.id = this.nextId(); slot.alive = true; slot.kind = h.kind; slot.team = h.team; slot.x = h.x; slot.z = h.z;
    slot.radius = h.radius; slot.ttl = h.ttl; slot.age = 0; slot.damage = h.damage; slot.tick = h.tick ?? 0; slot.tickTimer = 0;
    slot.vx = h.vx ?? 0; slot.vz = h.vz ?? 0; slot.weapon = h.weapon; slot.armed = h.armed ?? true;
    this.emit({ type: 'hazard-spawned', id: slot.id, kind: h.kind, x: h.x, z: h.z, radius: h.radius });
    return slot;
  }

  spawnPickup(kind: PickupKind, x: number, z: number, value = 1): PickupState | null {
    const list = this.state.pickups;
    let slot = list.find((q) => !q.alive);
    if (!slot) {
      if (list.length >= PICKUP_POOL) return null;
      slot = { id: 0, alive: false, kind, x: 0, z: 0, value: 0, age: 0, magnet: false };
      list.push(slot);
    }
    slot.id = this.nextId(); slot.alive = true; slot.kind = kind; slot.x = x; slot.z = z; slot.value = value; slot.age = 0; slot.magnet = false;
    this.emit({ type: 'pickup-spawned', id: slot.id, kind, x, z, value });
    return slot;
  }

  addTelegraph(t: TelegraphSpawn): TelegraphState | null {
    const list = this.state.telegraphs;
    let slot = list.find((q) => !q.alive);
    if (!slot) {
      if (list.length >= TELEGRAPH_POOL) return null;
      slot = { id: 0, alive: false, shape: t.shape, team: t.team, x: 0, z: 0, radius: 0, length: 0, angle: 0, time: 0, duration: 0 };
      list.push(slot);
    }
    slot.id = this.nextId(); slot.alive = true; slot.shape = t.shape; slot.team = t.team; slot.x = t.x; slot.z = t.z;
    slot.radius = t.radius; slot.length = t.length ?? 0; slot.angle = t.angle ?? 0; slot.time = 0; slot.duration = t.duration;
    this.emit({ type: 'telegraph', id: slot.id, shape: t.shape, x: t.x, z: t.z, radius: t.radius, duration: t.duration });
    return slot;
  }

  targetsNear(x: number, z: number, radius: number, out: Target[]): Target[] {
    return this.spatial.query(x, z, radius, out);
  }

  findTarget(id: number): Target | undefined {
    return this.state.enemies.find((e) => e.id === id) ?? this.state.bosses.find((b) => b.id === id);
  }

  damageTarget(target: Target, amount: number, opts: DamageOpts = {}): number {
    if (target.life !== 'alive' || amount <= 0) return 0;
    if ('submerged' in target && target.submerged > 0.6) return 0;
    const dealt = opts.pierceArmor ? amount : Math.max(amount * 0.3, amount - target.armor);
    target.hp -= dealt;
    target.hitFlash = 1;
    const s = this.state;
    s.stats.damageDealt += dealt;
    if (opts.weapon) {
      s.stats.damageByWeapon[opts.weapon] = (s.stats.damageByWeapon[opts.weapon] ?? 0) + dealt;
      if ('defId' in target && !('phase' in target)) (target as EnemyState).lastHitBy = opts.weapon;
    }
    const ult = s.player.skills.ultimate;
    ult.charge = Math.min(1, ult.charge + dealt / 2500);
    if (opts.knockback && opts.fromX !== undefined && opts.fromZ !== undefined && !('phase' in target)) {
      const dx = target.x - opts.fromX, dz = target.z - opts.fromZ, d = Math.hypot(dx, dz) || 1;
      target.vx += (dx / d) * opts.knockback; target.vz += (dz / d) * opts.knockback;
    }
    if (opts.status) this.applyStatus(target, opts.status.kind, opts.status.time, opts.status.magnitude);
    this.emit({ type: 'damage', target: target.id, amount: dealt, crit: !!opts.crit, x: target.x, y: 4, z: target.z, weapon: opts.weapon });
    if (target.hp <= 0) {
      target.hp = 0;
      target.life = 'sinking';
      if ('phase' in target) onBossKilled(this, target);
      else onEnemyKilled(this, target);
    }
    return dealt;
  }

  damagePlayer(amount: number, opts: PlayerDamageOpts = {}): number {
    const p = this.state.player;
    if (!p.alive || amount <= 0 || this.godMode) return 0;
    if (p.invulnerable > 0 || p.airborne > 0.2 || p.submerged > 0.5) return 0;
    const brace = p.skills.brace;
    const braced = brace.active > 0;
    const parried = braced && brace.active > BRACE_DURATION - PARRY_WINDOW;
    let value = braced ? amount * 0.3 : amount;
    value = Math.max(value * 0.25, value - p.stats.armor - this.content.ships[p.shipId].armor);
    if (p.shield > 0) { const absorbed = Math.min(p.shield, value); p.shield -= absorbed; value -= absorbed; }
    p.hp -= value;
    p.sinceHit = 0;
    this.state.stats.damageTaken += value;
    this.emit({ type: 'player-hit', amount: value, x: opts.x ?? p.x, z: opts.z ?? p.z, braced, parried, source: opts.source });
    if (p.hp <= 0) {
      if (p.revivesLeft > 0) {
        p.revivesLeft--; p.hp = p.maxHp * 0.5; p.invulnerable = 3;
        this.emit({ type: 'player-died', reviving: true });
        this.emit({ type: 'revived' });
      } else {
        p.hp = 0; p.alive = false;
        this.emit({ type: 'player-died', reviving: false });
      }
    }
    return value;
  }

  applyStatus(target: PlayerState | Target, kind: StatusKind, time: number, magnitude = 1): void {
    const existing = target.statuses.find((st) => st.kind === kind);
    if (existing) { existing.time = Math.max(existing.time, time); existing.magnitude = Math.max(existing.magnitude, magnitude); return; }
    target.statuses.push({ kind, time, magnitude });
    this.emit({ type: 'status-changed', target: 'shipId' in target ? 0 : target.id, status: kind, on: true });
  }

  hasStatus(target: PlayerState | Target, kind: StatusKind): boolean {
    return target.statuses.some((st) => st.kind === kind && st.time > 0);
  }

  requestTimeScale(scale: number, duration: number): void {
    this.state.timeScale = Math.min(this.state.timeScale, scale);
    this.timeScaleTimer = Math.max(this.timeScaleTimer, duration);
  }

  // ───────────── Debug ─────────────

  private createDebug(): SimDebug {
    return {
      grantXp: (amount) => { const p = this.state.player; p.xp += amount; },
      setLevel: (level) => { const p = this.state.player; while (p.level < level) { p.xp = p.xpToNext; updateProgression(this); if (this.state.offers) applyChosenCard(this, 0); } },
      spawnEnemy: (defId, count = 1, elite = false) => {
        const p = this.state.player;
        for (let i = 0; i < count; i++) { const a = this.random() * Math.PI * 2, r = 180 + this.random() * 60; this.spawnEnemy(defId, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, { elite }); }
      },
      spawnBoss: (defId) => { const p = this.state.player; this.spawnBoss(defId, p.x + 260, p.z - 260); },
      setTime: (seconds) => { this.state.time = seconds; },
      god: (on) => { this.godMode = on; },
      giveWeapon: (id, level = 1) => {
        const p = this.state.player;
        const slot = p.weapons.find((w) => w.id === id);
        if (slot) slot.level = Math.max(slot.level, level);
        else p.weapons.push({ id, level, overdrive: level >= 6, cooldown: 0.5, scratch: {} });
        this.emit({ type: 'weapon-changed', weapon: id, level, overdrive: level >= 6, isNew: !slot });
      },
      killAll: () => { for (const e of this.state.enemies) this.damageTarget(e, 1e9, { pierceArmor: true }); },
    };
  }
}
