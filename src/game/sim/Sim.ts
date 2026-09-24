/**
 * Run simulation orchestrator (CORE-owned). Fixed 60 Hz step, seeded, no rendering.
 * The public API below is the contract used by src/runtime; system internals live in sibling files.
 *
 * Tick order: pools → sea → player → director → (enemy snapshot) → AI → bosses → CORE forces (stun, knockback,
 * tethers, burning) → spatial rebuild → weapons → projectiles → hazards → collisions → pickups → progression → cleanup.
 */
import { hashString, createSeededRandom } from '../../core/rng';
import { CONTENT } from '../content';
import { MAX_STEPS_PER_FRAME, SIM_DT } from '../constants';
import type { BossId, EnemyId, HazardKind, PickupKind, ProjectileKind, SeaId, ShipId, StatusKind, Team, WeaponId } from '../ids';
import type {
  BossState, ContentDb, EnemyState, HazardState, MetaProfile, PickupState, PlayerInput, PlayerState,
  ProjectileState, RunResult, RunState, SimAction, SimEvent, TelegraphState, WorldQuery,
} from '../types';
import type {
  DamageOpts, HazardSpawn, PlayerDamageOpts, ProjectileSpawn, Target, TelegraphSpawn,
} from './context';
import { updateBosses } from './bosses';
import { resolveCollisions } from './collisions';
import { applyShipForces, snapshotEnemies } from './core-forces';
import { CoreRuntime, DEFAULT_TURN, isBoss, KIND_TRAITS, K_HOMING, statusOf, untouchable, type CoreSim } from './core-runtime';
import { parry, specialCooldown, ULT_CHARGE_DAMAGE } from './core-skills';
import { updateDirector, continueEndless } from './director';
import { updateEnemies } from './ai';
import { updateHazards } from './hazards';
import { updatePickups } from './pickups';
import { BRACE_DAMAGE_TAKEN, BRACE_DURATION, PARRY_WINDOW, updatePlayer } from './player';
import {
  applyChosenCard, banishCard, initProgression, onBossKilled, onEnemyKilled, rerollOffers, updateProgression,
} from './progression';
import { updateProjectiles } from './projectiles';
import { createRunState } from './state';
import { updateWeapons } from './weapons';
import { updateSeaState } from './weather';
import { updateAffixes } from './affixes';
import { updateCaptains } from './captains';

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
  /** Gives (or raises) a weapon. Levels ≥ 3 need a branch: keeps the current one, else `branch` (default 'A'). */
  giveWeapon(id: WeaponId, level?: number, branch?: 'A' | 'B'): void;
  killAll(): void;
  sinkBosses(): void;
  /** Fills the ultimate charge (QA). */
  chargeUltimate(): void;
  /** Clears every skill cooldown (QA). */
  resetCooldowns(): void;
  /** Moves the player (QA). */
  teleport(x: number, z: number, heading?: number): void;
}

const EMPTY_INPUT: PlayerInput = { steer: 0, throttleAxis: 0, aimX: 0, aimZ: -100, broadsideHeld: false };
const NO_OPTS: DamageOpts = {};
const NO_PLAYER_OPTS: PlayerDamageOpts = {};

export class Sim implements CoreSim {
  readonly state: RunState;
  readonly content: ContentDb;
  readonly world: WorldQuery;
  readonly meta: MetaProfile;
  readonly random: () => number;
  readonly dt = SIM_DT;
  readonly debug: SimDebug;
  readonly core = new CoreRuntime();

  input: PlayerInput = { ...EMPTY_INPUT };
  actions = new Set<SimAction>();

  private pendingActions = new Set<SimAction>();
  private events: SimEvent[] = [];
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
    const ship = this.content.ships[opts.shipId];
    this.state.player.skills.special.cooldownMax = specialCooldown(ship.special);
    initProgression(this);
    this.debug = this.createDebug();
  }

  get god(): boolean { return this.godMode; }

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

  /** After a victory: clears the ended state and hands the run to the director's endless loop. */
  continueEndless(): boolean {
    if (this.ended?.outcome !== 'victory') return false;
    continueEndless(this);
    this.ended = null;
    this.state.status = 'running';
    return true;
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

  /** Runs exactly `count` fixed ticks while the run is 'running' (tests, benchmarks). Ignores time scale. */
  stepTicks(count: number): number {
    let ticks = 0;
    for (let i = 0; i < count && this.state.status === 'running'; i++) { this.tick(); ticks++; }
    this.state.timeScale = 1;
    this.timeScaleTimer = 0;
    return ticks;
  }

  drainEvents(): SimEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  result(): RunResult | null { return this.ended; }

  // ───────────── Tick ─────────────

  private tick(): void {
    const s = this.state;
    const core = this.core;
    // Discrete actions pressed since the previous tick (swap the two sets; no allocation).
    const used = this.actions;
    this.actions = this.pendingActions;
    this.pendingActions = used;
    used.clear();
    s.tick++;
    s.time += SIM_DT;

    core.projFree.rebuild(s.projectiles);
    core.hazFree.rebuild(s.hazards);
    core.pickFree.rebuild(s.pickups);
    core.teleFree.rebuild(s.telegraphs);
    core.refreshIslands(this);

    updateSeaState(this);
    updatePlayer(this);
    updateDirector(this);
    snapshotEnemies(this);
    updateEnemies(this);
    updateAffixes(this);
    updateBosses(this);
    updateCaptains(this);
    applyShipForces(this);
    this.rebuildSpatial();
    updateWeapons(this);
    updateProjectiles(this);
    updateHazards(this);
    resolveCollisions(this);
    updatePickups(this);
    updateProgression(this);
    this.cleanup();
    if (this.godMode && s.player.alive) s.player.hp = s.player.maxHp;
    if (!s.player.alive && s.status === 'running') this.endRun('defeat');
  }

  private rebuildSpatial(): void {
    const grid = this.core.grid;
    grid.clear();
    const list = this.state.enemies;
    for (let i = 0; i < list.length; i++) { const e = list[i]!; if (e.life === 'alive') grid.insert(e); }
  }

  private cleanup(): void {
    const s = this.state;
    const byId = this.core.byId;
    const enemies = s.enemies;
    let w = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      if (e.life === 'sinking') {
        e.sink = Math.min(1, e.sink + SIM_DT / 3);
        if (e.sink >= 1) { e.life = 'dead'; this.emit({ type: 'enemy-sunk', id: e.id, x: e.x, z: e.z }); }
      }
      if (e.life === 'dead') { byId.delete(e.id); continue; }
      enemies[w++] = e;
    }
    if (w !== enemies.length) enemies.length = w;
    const bosses = s.bosses;
    w = 0;
    for (let i = 0; i < bosses.length; i++) {
      const b = bosses[i]!;
      if (b.life === 'sinking') { b.sink = Math.min(1, b.sink + SIM_DT / 6); if (b.sink >= 1) b.life = 'dead'; }
      if (b.life === 'dead') { byId.delete(b.id); continue; }
      bosses[w++] = b;
    }
    if (w !== bosses.length) bosses.length = w;
    const tele = s.telegraphs;
    for (let i = 0; i < tele.length; i++) {
      const t = tele[i]!;
      if (t.alive) { t.time += SIM_DT; if (t.time >= t.duration) t.alive = false; }
    }
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
    if (!def) return null;
    const heat = this.state.director.heat;
    const elite = !!opts.elite;
    const hp = def.hp * (1 + (heat - 1) * 0.6) * (elite ? 3.5 : 1);
    const scale = elite ? 1.2 : 1;
    const enemy: EnemyState = {
      id: this.nextId(), defId, faction: def.faction, life: 'alive', sink: 0,
      x, z, y: 0, heading: opts.heading ?? Math.atan2(-(this.state.player.x - x), -(this.state.player.z - z)),
      speed: 0, vx: 0, vz: 0, yawRate: 0, roll: 0, pitch: 0,
      radius: def.radius * scale, length: def.length * scale, beam: def.radius * 2 * scale,
      hp, maxHp: hp, armor: def.armor, elite, hitFlash: 0, hidden: 0, affixes: [], title: null, statuses: [],
      attackCooldown: 1 + this.random() * 2, ai: newAiScratch(), spawnTime: this.state.time,
    };
    this.state.enemies.push(enemy);
    this.core.byId.set(enemy.id, enemy);
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
      submerged: 0, ai: newAiScratch(), spawnTime: this.state.time,
    };
    this.state.bosses.push(boss);
    this.core.byId.set(boss.id, boss);
    this.state.director.activeBoss = defId;
    this.emit({ type: 'boss-spawned', boss: defId, id: boss.id, x, z });
    return boss;
  }

  spawnProjectile(p: ProjectileSpawn): ProjectileState | null {
    const idx = this.shoot(
      p.kind, p.team, p.x, p.y ?? 3, p.z, p.vx, p.vy ?? 0, p.vz, p.damage, p.radius ?? 1.2, p.pierce ?? 0,
      p.ttl ?? 3, p.weapon, p.crit ?? false, p.area ?? 0,
    );
    if (idx < 0) return null;
    const slot = this.state.projectiles[idx]!;
    if (p.target !== undefined) {
      slot.target = p.target;
      if (KIND_TRAITS[p.kind] & K_HOMING) {
        this.core.pTurn[idx] = DEFAULT_TURN[p.kind] ?? 2;
        this.core.pTarget[idx] = p.target === 0 ? null : this.core.byId.get(p.target) ?? null;
      }
    }
    return slot;
  }

  shoot(
    kind: ProjectileKind, team: Team, x: number, y: number, z: number, vx: number, vy: number, vz: number,
    damage: number, radius: number, pierce: number, ttl: number, weapon: WeaponId | undefined, crit: boolean, area: number,
  ): number {
    const list = this.state.projectiles;
    const core = this.core;
    const idx = core.projFree.acquire(list, this.state.tick);
    if (idx < 0) return -1;
    if (idx === list.length) {
      list.push({
        id: 0, alive: false, kind, team, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, damage: 0, radius: 0, pierce: 0,
        ttl: 0, age: 0, weapon: undefined, target: undefined, crit: false, area: 0, hits: [],
      });
    }
    const s = list[idx]!;
    s.id = this.nextId(); s.alive = true; s.kind = kind; s.team = team;
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz;
    s.damage = damage; s.radius = radius; s.pierce = pierce; s.ttl = ttl; s.age = 0;
    s.weapon = weapon; s.target = undefined; s.crit = crit; s.area = area;
    if (s.hits.length > 0) s.hits.length = 0;
    core.pFlags[idx] = 0; core.pKnock[idx] = 0; core.pTurn[idx] = 0; core.pSpeed[idx] = Math.sqrt(vx * vx + vz * vz);
    core.pSlowMag[idx] = 0; core.pSlowTime[idx] = 0; core.pBurn[idx] = 0; core.pStun[idx] = 0;
    core.pA[idx] = 0; core.pB[idx] = 0; core.pC[idx] = 0; core.pD[idx] = 0; core.pFrom[idx] = 0; core.pTarget[idx] = null;
    return idx;
  }

  spawnHazard(h: HazardSpawn): HazardState | null {
    const idx = this.placeHazard(h.kind, h.team, h.x, h.z, h.radius, h.ttl, h.damage, h.tick ?? 0, h.vx ?? 0, h.vz ?? 0, h.weapon, h.armed ?? true);
    return idx < 0 ? null : this.state.hazards[idx]!;
  }

  placeHazard(
    kind: HazardKind, team: Team, x: number, z: number, radius: number, ttl: number, damage: number, tick: number,
    vx: number, vz: number, weapon: WeaponId | undefined, armed: boolean,
  ): number {
    const list = this.state.hazards;
    const core = this.core;
    const idx = core.hazFree.acquire(list, this.state.tick);
    if (idx < 0) return -1;
    if (idx === list.length) {
      list.push({
        id: 0, alive: false, kind, team, x: 0, z: 0, radius: 0, ttl: 0, age: 0, damage: 0, tick: 0, tickTimer: 0,
        vx: 0, vz: 0, weapon: undefined, armed: true,
      });
    }
    const h = list[idx]!;
    h.id = this.nextId(); h.alive = true; h.kind = kind; h.team = team; h.x = x; h.z = z;
    h.radius = radius; h.ttl = ttl; h.age = 0; h.damage = damage; h.tick = tick; h.tickTimer = 0;
    h.vx = vx; h.vz = vz; h.weapon = weapon; h.armed = armed;
    core.hFlags[idx] = 0; core.hKnock[idx] = 0; core.hA[idx] = 0; core.hB[idx] = 0; core.hC[idx] = 0; core.hD[idx] = 0;
    core.hTimer[idx] = 0; core.hMode[idx] = 0; core.hTarget[idx] = null;
    const hits = core.hHits[idx]!;
    if (hits.length > 0) hits.length = 0;
    this.emit({ type: 'hazard-spawned', id: h.id, kind, x, z, radius });
    return idx;
  }

  spawnPickup(kind: PickupKind, x: number, z: number, value = 1): PickupState | null {
    const list = this.state.pickups;
    const core = this.core;
    const idx = core.pickFree.acquire(list, this.state.tick);
    if (idx < 0) return null;
    if (idx === list.length) list.push({ id: 0, alive: false, kind, x: 0, z: 0, value: 0, age: 0, magnet: false });
    const k = list[idx]!;
    k.id = this.nextId(); k.alive = true; k.kind = kind; k.x = x; k.z = z; k.value = value; k.age = 0; k.magnet = false;
    core.kSpeed[idx] = 0;
    this.emit({ type: 'pickup-spawned', id: k.id, kind, x, z, value });
    return k;
  }

  addTelegraph(t: TelegraphSpawn): TelegraphState | null {
    const list = this.state.telegraphs;
    const core = this.core;
    const idx = core.teleFree.acquire(list, this.state.tick);
    if (idx < 0) return null;
    if (idx === list.length) {
      list.push({ id: 0, alive: false, shape: t.shape, team: t.team, x: 0, z: 0, radius: 0, length: 0, angle: 0, time: 0, duration: 0 });
    }
    const slot = list[idx]!;
    slot.id = this.nextId(); slot.alive = true; slot.shape = t.shape; slot.team = t.team; slot.x = t.x; slot.z = t.z;
    slot.radius = t.radius; slot.length = t.length ?? 0; slot.angle = t.angle ?? 0; slot.time = 0; slot.duration = t.duration;
    this.emit({ type: 'telegraph', id: slot.id, shape: t.shape, team: t.team, x: t.x, z: t.z, radius: t.radius, duration: t.duration });
    return slot;
  }

  targetsNear(x: number, z: number, radius: number, out: Target[]): Target[] {
    const buf = this.core.bufX;
    const n = this.core.near(this.state, x, z, radius, buf);
    // Overwrite in place, then trim: `out.length = 0` would drop the backing store and reallocate every query.
    for (let i = 0; i < n; i++) out[i] = buf[i]!;
    if (out.length !== n) out.length = n;
    return out;
  }

  findTarget(id: number): Target | undefined {
    return this.core.byId.get(id);
  }

  damageTarget(target: Target, amount: number, opts: DamageOpts = NO_OPTS): number {
    const st = opts.status;
    return this.hitTarget(
      target, amount, opts.weapon, !!opts.crit, opts.knockback ?? 0, opts.fromX ?? target.x, opts.fromZ ?? target.z,
      st ? st.kind : null, st ? st.time : 0, st ? st.magnitude ?? 1 : 0, !!opts.pierceArmor,
    );
  }

  hitTarget(
    t: Target, amount: number, weapon: WeaponId | undefined, crit: boolean, knockback: number, fromX: number, fromZ: number,
    status: StatusKind | null, statusTime: number, statusMag: number, pierceArmor: boolean,
  ): number {
    if (t.life !== 'alive' || !(amount > 0)) return 0;
    const boss = isBoss(t);
    if ((boss && t.submerged > 0.6) || untouchable(t)) return 0;
    const dealt = pierceArmor ? amount : Math.max(amount * 0.3, amount - t.armor);
    const effective = Math.min(dealt, t.hp);
    t.hp -= dealt;
    t.hitFlash = 1;
    const s = this.state;
    s.stats.damageDealt += effective;
    if (weapon) {
      s.stats.damageByWeapon[weapon] = (s.stats.damageByWeapon[weapon] ?? 0) + effective;
      if (!boss) t.lastHitBy = weapon;
    }
    const ult = s.player.skills.ultimate;
    if (ult.active <= 0 && ult.charge < 1) {
      ult.charge = Math.min(1, ult.charge + effective / ULT_CHARGE_DAMAGE);
      if (ult.charge >= 1) this.emit({ type: 'skill-ready', slot: 'ultimate' });
    }
    if (knockback > 0 && !boss) this.core.push(this, t, t.x - fromX, t.z - fromZ, knockback);
    if (status && statusTime > 0 && !(boss && (status === 'stunned' || status === 'hooked'))) {
      this.applyStatus(t, status, statusTime, statusMag);
    }
    this.emit({ type: 'damage', target: t.id, amount: dealt, crit, x: t.x, y: 4, z: t.z, weapon });
    if (t.hp <= 0) {
      t.hp = 0;
      t.life = 'sinking';
      if (boss) onBossKilled(this, t);
      else onEnemyKilled(this, t);
    }
    return dealt;
  }

  damagePlayer(amount: number, opts: PlayerDamageOpts = NO_PLAYER_OPTS): number {
    const p = this.state.player;
    return this.hurtPlayer(amount, opts.x ?? p.x, opts.z ?? p.z, opts.source, opts.kind ?? 'projectile');
  }

  hurtPlayer(amount: number, x: number, z: number, source: number | undefined, _kind: 'projectile' | 'contact' | 'hazard' | 'boss'): number {
    const p = this.state.player;
    if (!p.alive || !(amount > 0)) return 0;
    if (p.invulnerable > 0 || p.airborne > 0.2 || p.submerged > 0.5) return 0;
    const brace = p.skills.brace;
    const braced = brace.active > 0;
    const parried = braced && brace.active > BRACE_DURATION - PARRY_WINDOW;
    if (parried) {
      if (!this.core.parryUsed) { this.core.parryUsed = true; parry(this, x, z); }
      this.emit({ type: 'player-hit', amount: 0, x, z, braced: true, parried: true, source });
      return 0;
    }
    let value = braced ? amount * BRACE_DAMAGE_TAKEN : amount;
    value = Math.max(value * 0.25, value - p.stats.armor - this.content.ships[p.shipId].armor);
    if (p.shield > 0) { const absorbed = Math.min(p.shield, value); p.shield -= absorbed; value -= absorbed; }
    p.sinceHit = 0;
    this.emit({ type: 'player-hit', amount: value, x, z, braced, parried: false, source });
    if (this.godMode || value <= 0) return value;
    p.hp -= value;
    this.state.stats.damageTaken += value;
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
    const list = target.statuses;
    for (let i = 0; i < list.length; i++) {
      const st = list[i]!;
      if (st.kind === kind) {
        const wasOff = st.time <= 0;
        st.time = Math.max(st.time, time);
        st.magnitude = wasOff ? magnitude : Math.max(st.magnitude, magnitude);
        return;
      }
    }
    list.push({ kind, time, magnitude });
    this.emit({ type: 'status-changed', target: 'shipId' in target ? 0 : target.id, status: kind, on: true });
  }

  hasStatus(target: PlayerState | Target, kind: StatusKind): boolean {
    return statusOf(target.statuses, kind) !== null;
  }

  requestTimeScale(scale: number, duration: number): void {
    this.state.timeScale = Math.min(this.state.timeScale, scale);
    this.timeScaleTimer = Math.max(this.timeScaleTimer, duration);
  }

  // ───────────── Debug ─────────────

  private createDebug(): SimDebug {
    return {
      grantXp: (amount) => { const p = this.state.player; p.xp += amount; },
      setLevel: (level) => {
        const p = this.state.player;
        let guard = 0;
        while (p.level < level && guard++ < 200) {
          p.xp = p.xpToNext; updateProgression(this);
          let cards = 0;
          while (this.state.offers && cards++ < 50) if (!applyChosenCard(this, 0)) break;
        }
      },
      spawnEnemy: (defId, count = 1, elite = false) => {
        const p = this.state.player;
        for (let i = 0; i < count; i++) {
          const a = this.random() * Math.PI * 2, r = 180 + this.random() * 60;
          this.spawnEnemy(defId, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, { elite });
        }
      },
      spawnBoss: (defId) => { const p = this.state.player; this.spawnBoss(defId, p.x + 260, p.z - 260); },
      setTime: (seconds) => { this.state.time = seconds; },
      god: (on) => { this.godMode = on; },
      giveWeapon: (id, level = 1, branch) => {
        const p = this.state.player;
        const lv = Math.max(1, Math.min(6, level));
        let slot = p.weapons.find((w) => w.id === id);
        const isNew = !slot;
        if (!slot) { slot = { id, level: lv, overdrive: false, cooldown: 0.5, scratch: {} }; p.weapons.push(slot); }
        slot.level = Math.max(slot.level, lv);
        if (slot.level >= 3) slot.branch = branch ?? slot.branch ?? 'A';
        slot.overdrive = slot.level >= 6;
        this.emit({ type: 'weapon-changed', weapon: id, level: slot.level, branch: slot.branch, overdrive: slot.overdrive, isNew });
      },
      killAll: () => { for (const e of this.state.enemies) this.damageTarget(e, 1e9, { pierceArmor: true }); },
      sinkBosses: () => { for (const b of this.state.bosses) if (b.life === 'alive') this.damageTarget(b, 1e9, { pierceArmor: true }); },
      chargeUltimate: () => { this.state.player.skills.ultimate.charge = 1; },
      resetCooldowns: () => {
        const sk = this.state.player.skills;
        sk.broadside.cooldown = 0; sk.special.cooldown = 0; sk.brace.cooldown = 0; sk.boost.cooldown = 0;
      },
      teleport: (x, z, heading) => {
        const p = this.state.player;
        p.x = x; p.z = z; p.vx = 0; p.vz = 0; p.speed = 0;
        if (heading !== undefined) p.heading = heading;
      },
    };
  }
}

/** AI scratch with the CORE keys pre-declared (stable object shape; META adds its own keys). */
function newAiScratch(): Record<string, number> {
  return { contactCd: 0, coreKx: 0, coreKz: 0, coreBurnT: 0, coreBurnW: -1, coreSmash: 0 };
}
