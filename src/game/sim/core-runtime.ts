/**
 * CORE-internal runtime (not part of the SimContext contract).
 *
 * Holds everything the player-side systems share that is not RunState: free-list pools and per-slot auxiliary
 * data for projectiles / hazards / pickups, fixed-size target buffers, the broadside ripple queue, harpoon tethers,
 * attitude springs, active skill timers and a cached island neighbourhood. Everything is preallocated so a tick
 * never allocates in its hot loops (SimEvents are the only per-hit objects, by contract).
 */
import { HAZARD_POOL, PICKUP_POOL, PROJECTILE_POOL, TELEGRAPH_POOL } from '../constants';
import type { HazardKind, ProjectileKind, StatusKind, Team, WeaponId } from '../ids';
import type { BossState, EnemyState, IslandDef, PlayerState, RunState, StatusState } from '../types';
import type { SimContext, Target } from './context';
import { SpatialGrid } from './spatial';

// ───────────────────────────── Sim surface used by CORE systems ─────────────────────────────

export type ExplosionKind = 'small' | 'medium' | 'large' | 'fire' | 'powder' | 'mine' | 'mortar' | 'lightning' | 'water';

/** The Sim as seen by CORE modules: the SimContext contract plus allocation-free internals. */
export interface CoreSim extends SimContext {
  readonly core: CoreRuntime;
  /** QA god mode: damage is still resolved (brace/parry/events) but the hull never loses HP. */
  readonly god: boolean;
  /** Positional, allocation-free damage (same rules as damageTarget). Returns damage dealt. */
  hitTarget(
    t: Target, amount: number, weapon: WeaponId | undefined, crit: boolean, knockback: number, fromX: number, fromZ: number,
    status: StatusKind | null, statusTime: number, statusMag: number, pierceArmor: boolean,
  ): number;
  /** Positional damagePlayer. */
  hurtPlayer(amount: number, x: number, z: number, source: number | undefined, kind: 'projectile' | 'contact' | 'hazard' | 'boss'): number;
  /** Positional spawnProjectile; returns the pool index (aux arrays reset) or −1 when the pool is full. */
  shoot(
    kind: ProjectileKind, team: Team, x: number, y: number, z: number, vx: number, vy: number, vz: number,
    damage: number, radius: number, pierce: number, ttl: number, weapon: WeaponId | undefined, crit: boolean, area: number,
  ): number;
  /** Positional spawnHazard; returns the pool index (aux arrays reset) or −1 when the pool is full. */
  placeHazard(
    kind: HazardKind, team: Team, x: number, z: number, radius: number, ttl: number, damage: number, tick: number,
    vx: number, vz: number, weapon: WeaponId | undefined, armed: boolean,
  ): number;
}

// ───────────────────────────── Flags ─────────────────────────────

/** Projectile-kind traits (motion model). */
export const K_BALLISTIC = 1, K_HOMING = 2, K_ISLAND = 4, K_EXPIRE_BLAST = 8;
export const KIND_TRAITS: Readonly<Record<ProjectileKind, number>> = {
  cannonball: K_ISLAND, 'chain-shot': K_ISLAND, 'heavy-shot': K_ISLAND, 'chaser-shot': K_ISLAND, lance: 0,
  'mortar-shell': K_BALLISTIC, bomblet: K_BALLISTIC, 'swivel-shot': K_ISLAND, grapeshot: K_ISLAND,
  harpoon: K_ISLAND | K_HOMING, rocket: K_HOMING | K_EXPIRE_BLAST, torpedo: K_HOMING | K_ISLAND | K_EXPIRE_BLAST,
  'skiff-shot': K_ISLAND, 'enemy-cannonball': K_ISLAND, 'enemy-chaser': K_ISLAND, 'enemy-mortar': K_BALLISTIC,
  'water-bolt': K_ISLAND, 'boss-shell': K_BALLISTIC,
};
/** Default homing turn rates (rad/s) for homing kinds spawned through the contract with a target. */
export const DEFAULT_TURN: Partial<Record<ProjectileKind, number>> = { rocket: 3, torpedo: 2, harpoon: 2.5 };

/** Per-projectile behaviour flags (CORE aux). */
export const PF_SLOW = 1, PF_BURN = 2, PF_STUN = 4, PF_HOOK = 8, PF_CLUSTER = 16, PF_FIREPOT = 32, PF_SPARKS = 64,
  PF_CHAIN = 128, PF_GIANT = 256, PF_TOW = 512, PF_BIG = 1024, PF_WATER = 2048, PF_REFLECTED = 4096;

/** Per-hazard behaviour flags (CORE aux). */
export const HF_BURN = 1, HF_SLOW = 2, HF_STUN = 4, HF_FOLLOW = 8, HF_MAGNET = 16, HF_DEPTH = 32, HF_RING = 64,
  HF_WASH = 128, HF_ULT = 256;

/** Seconds a 'burning' status lasts when refreshed by fire. Burn damage ticks every BURN_TICK. */
export const BURN_TIME = 3;
export const BURN_TICK = 0.5;

/** Ballistic gravity (m/s²). META's enemy mortar maths (vy = 9 × flight) assumes 18. */
export const GRAVITY = 18;

// ───────────────────────────── Pools ─────────────────────────────

/** Free-list of dead slot indices, rebuilt once per tick (robust to other systems killing slots). */
export class FreeList {
  private readonly free: Int32Array;
  private count = 0;
  constructor(readonly capacity: number) { this.free = new Int32Array(capacity); }
  rebuild(list: readonly { alive: boolean }[]): void {
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) if (!list[i]!.alive) this.free[n++] = i;
    this.count = n;
  }
  /** Lowest dead index first; −1 when empty. */
  pop(): number { return this.count > 0 ? this.free[--this.count]! : -1; }
}

const BUF = 1024;
const newBuf = (): Target[] => new Array<Target>(BUF);

export const GUN_QUEUE = 192;
export const TETHERS = 96;

export class CoreRuntime {
  readonly grid = new SpatialGrid<EnemyState>(48, 10);
  readonly byId = new Map<number, Target>();

  // Pools.
  readonly projFree = new FreeList(PROJECTILE_POOL);
  readonly hazFree = new FreeList(HAZARD_POOL);
  readonly pickFree = new FreeList(PICKUP_POOL);
  readonly teleFree = new FreeList(TELEGRAPH_POOL);

  // Projectile aux (indexed by pool slot).
  readonly pFlags = new Int32Array(PROJECTILE_POOL);
  readonly pKnock = new Float32Array(PROJECTILE_POOL);
  readonly pTurn = new Float32Array(PROJECTILE_POOL);
  readonly pSpeed = new Float32Array(PROJECTILE_POOL);
  readonly pSlowMag = new Float32Array(PROJECTILE_POOL);
  readonly pSlowTime = new Float32Array(PROJECTILE_POOL);
  readonly pBurn = new Float32Array(PROJECTILE_POOL);
  readonly pStun = new Float32Array(PROJECTILE_POOL);
  readonly pA = new Float32Array(PROJECTILE_POOL);
  readonly pB = new Float32Array(PROJECTILE_POOL);
  readonly pC = new Float32Array(PROJECTILE_POOL);
  readonly pD = new Float32Array(PROJECTILE_POOL);
  /** Ship ref the harpoon line starts from (0 = player). */
  readonly pFrom = new Int32Array(PROJECTILE_POOL);
  readonly pTarget: (Target | null)[] = new Array<Target | null>(PROJECTILE_POOL).fill(null);

  // Hazard aux.
  readonly hFlags = new Int32Array(HAZARD_POOL);
  readonly hKnock = new Float32Array(HAZARD_POOL);
  readonly hA = new Float32Array(HAZARD_POOL);
  readonly hB = new Float32Array(HAZARD_POOL);
  readonly hC = new Float32Array(HAZARD_POOL);
  readonly hD = new Float32Array(HAZARD_POOL);
  readonly hTimer = new Float32Array(HAZARD_POOL);
  readonly hMode = new Int8Array(HAZARD_POOL);
  readonly hTarget: (Target | null)[] = new Array<Target | null>(HAZARD_POOL).fill(null);
  readonly hHits: number[][] = Array.from({ length: HAZARD_POOL }, () => [] as number[]);

  // Pickup aux: signed magnet speed (negative = the little outward pop before the pull).
  readonly kSpeed = new Float32Array(PICKUP_POOL);

  // Fixed-size target buffers, one per nesting level (never iterate a buffer you pass further down).
  /** projectile collision candidates */ readonly bufP = newBuf();
  /** explosion / splash victims */ readonly bufE = newBuf();
  /** hazard contacts */ readonly bufH = newBuf();
  /** weapon targeting */ readonly bufW = newBuf();
  /** secondary weapon queries (chains, clusters) */ readonly bufW2 = newBuf();
  /** collisions / forces */ readonly bufC = newBuf();
  /** tether smashes */ readonly bufT = newBuf();
  /** contract targetsNear */ readonly bufX = newBuf();
  /** small sorted selections */ readonly sel: Target[] = new Array<Target>(32);
  readonly selD = new Float64Array(32);

  // Broadside ripple queue (guns firing one after another along the hull).
  readonly gunT = new Float32Array(GUN_QUEUE);
  readonly gunSide = new Int8Array(GUN_QUEUE);
  readonly gunAlong = new Float32Array(GUN_QUEUE);
  readonly gunAngle = new Float32Array(GUN_QUEUE);
  readonly gunDamage = new Float32Array(GUN_QUEUE);
  readonly gunSpeed = new Float32Array(GUN_QUEUE);
  readonly gunRadius = new Float32Array(GUN_QUEUE);
  readonly gunPierce = new Int16Array(GUN_QUEUE);
  readonly gunKnock = new Float32Array(GUN_QUEUE);
  readonly gunTtl = new Float32Array(GUN_QUEUE);
  readonly gunKind = new Uint8Array(GUN_QUEUE);
  readonly gunFlags = new Int32Array(GUN_QUEUE);
  readonly gunSlowMag = new Float32Array(GUN_QUEUE);
  readonly gunSlowTime = new Float32Array(GUN_QUEUE);
  readonly gunBurn = new Float32Array(GUN_QUEUE);
  readonly gunRecoil = new Float32Array(GUN_QUEUE);
  gunCount = 0;

  // Harpoon tethers.
  readonly tTarget: (Target | null)[] = new Array<Target | null>(TETHERS).fill(null);
  /** null = the player is the anchor. */
  readonly tAnchor: (Target | null)[] = new Array<Target | null>(TETHERS).fill(null);
  readonly tTime = new Float32Array(TETHERS);
  readonly tPull = new Float32Array(TETHERS);
  readonly tSmash = new Float32Array(TETHERS);
  readonly tTow = new Uint8Array(TETHERS);

  // Enemy positions before AI (stun freeze).
  snapX = new Float64Array(256);
  snapZ = new Float64Array(256);
  snapId = new Int32Array(256);
  snapCount = 0;

  // Attitude springs.
  rollVel = 0;
  pitchVel = 0;
  prevForward = 0;
  forwardAccel = 0;

  // Skill timers (seconds remaining; ≤ 0 = inactive).
  dashTime = 0; dashDur = 1; dashSX = 0; dashSZ = 0; dashEX = 0; dashEZ = 0; dashH0 = 0; dashH1 = 0;
  dive = 0; diveBurstDone = true;
  rammingSpeed = 0;
  sunfire = 0;
  inferno = 0;
  ultGunT = 0;
  ultGunCursor = 0;
  parryUsed = false;
  islandCd = 0;
  playerBurnT = 0;

  // Islands around the player (broad phase for projectiles / ships).
  readonly islands: IslandDef[] = [];
  islandX = 1e9;
  islandZ = 1e9;
  islandTick = -1e9;

  // ───────────── Queries ─────────────

  /** Live enemies + bosses intersecting the circle, written to buf[0..n). */
  near(state: RunState, x: number, z: number, radius: number, buf: Target[]): number {
    let n = this.grid.collect(x, z, radius, buf as EnemyState[], 0);
    const bosses = state.bosses;
    for (let i = 0; i < bosses.length && n < buf.length; i++) {
      const b = bosses[i]!;
      if (b.life !== 'alive') continue;
      const dx = b.x - x, dz = b.z - z, rr = b.radius + radius;
      if (dx * dx + dz * dz <= rr * rr) buf[n++] = b;
    }
    return n;
  }

  /** Nearest weapon-targetable ship to (x,z) within `radius` (edge distance), skipping `excludeId`. */
  nearest(state: RunState, x: number, z: number, radius: number, buf: Target[], excludeId = -1): Target | null {
    const n = this.near(state, x, z, radius, buf);
    let best: Target | null = null, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const t = buf[i]!;
      if (t.id === excludeId || !targetable(t)) continue;
      const dx = t.x - x, dz = t.z - z, d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  /** True if (x,z) is on land, using the cached island neighbourhood as the broad phase. */
  onLand(sim: SimContext, x: number, z: number): boolean {
    const isl = this.islands;
    for (let i = 0; i < isl.length; i++) {
      const island = isl[i]!;
      const dx = x - island.x, dz = z - island.z;
      if (dx * dx + dz * dz < island.radius * island.radius) return !sim.world.isWater(x, z, 0);
    }
    return false;
  }

  /** True if a circle may touch an island (broad phase only). */
  nearIsland(x: number, z: number, radius: number): boolean {
    const isl = this.islands;
    for (let i = 0; i < isl.length; i++) {
      const island = isl[i]!;
      const dx = x - island.x, dz = z - island.z, r = island.radius + radius;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  refreshIslands(sim: SimContext): void {
    const p = sim.state.player;
    const moved = Math.abs(p.x - this.islandX) + Math.abs(p.z - this.islandZ);
    if (moved < 150 && sim.state.tick - this.islandTick < 45) return;
    sim.world.islandsNear(p.x, p.z, 1150, this.islands);
    this.islandX = p.x; this.islandZ = p.z; this.islandTick = sim.state.tick;
  }

  // ───────────── Forces ─────────────

  /**
   * Knockback as a displacement impulse integrated by CORE (independent of the AI's velocity model):
   * the ship slides `metres` (scaled by hull mass) away along (dx,dz) over ~0.4 s.
   */
  push(sim: SimContext, t: Target, dx: number, dz: number, metres: number): void {
    if (metres <= 0 || isBoss(t) || t.life !== 'alive') return;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-6) return;
    const k = (metres * KNOCK_DECAY * massFactor(sim, t)) / d;
    const ai = t.ai;
    ai.coreKx = (ai.coreKx ?? 0) + dx * k;
    ai.coreKz = (ai.coreKz ?? 0) + dz * k;
  }

  /** Adds or refreshes a harpoon tether. `anchor` null = the player. */
  tether(t: Target, anchor: Target | null, time: number, pull: number, smash: number, tow: boolean): void {
    let free = -1;
    for (let i = 0; i < TETHERS; i++) {
      const cur = this.tTarget[i];
      if (cur === t) { free = i; break; }
      if (free < 0 && (cur === null || this.tTime[i]! <= 0)) free = i;
    }
    if (free < 0) return;
    this.tTarget[free] = t; this.tAnchor[free] = anchor; this.tTime[free] = time; this.tPull[free] = pull;
    this.tSmash[free] = smash; this.tTow[free] = tow ? 1 : 0;
  }

  kickRoll(v: number): void { this.rollVel += v; }
  kickPitch(v: number): void { this.pitchVel += v; }
}

// ───────────────────────────── Shared helpers ─────────────────────────────

export const KNOCK_DECAY = 7;

export const isBoss = (t: Target): t is BossState => 'phase' in t;

/** Weapons skip untargetable ships (submerged serpents, phased wraiths). */
export function targetable(t: Target): boolean {
  if (t.life !== 'alive') return false;
  if (isBoss(t) && t.submerged > 0.6) return false;
  const st = t.statuses;
  for (let i = 0; i < st.length; i++) if (st[i]!.kind === 'invulnerable' && st[i]!.time > 0) return false;
  return true;
}

/** Knockback / pull scale by hull mass: light skiffs fly, men-o'-war barely budge. */
export function massFactor(sim: SimContext, t: Target): number {
  if (isBoss(t)) return 0;
  const def = sim.content.enemies[t.defId];
  const mass = (def?.mass ?? 250) * (t.elite ? 1.6 : 1);
  return Math.min(1.4, Math.max(0.35, Math.sqrt(250 / mass)));
}

export function statusOf(statuses: readonly StatusState[], kind: StatusKind): StatusState | null {
  for (let i = 0; i < statuses.length; i++) {
    const st = statuses[i]!;
    if (st.kind === kind && st.time > 0) return st;
  }
  return null;
}

/** Keel segment of the player's hull: bow/stern circle centres and half-width. */
export interface Keel { bx: number; bz: number; sx: number; sz: number; hw: number; fx: number; fz: number }
const KEEL: Keel = { bx: 0, bz: 0, sx: 0, sz: 0, hw: 0, fx: 0, fz: 0 };
export function keelOf(p: PlayerState): Keel {
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const half = Math.max(0, p.length * 0.5 - p.beam * 0.5);
  KEEL.fx = fx; KEEL.fz = fz;
  KEEL.bx = p.x + fx * half; KEEL.bz = p.z + fz * half;
  KEEL.sx = p.x - fx * half; KEEL.sz = p.z - fz * half;
  KEEL.hw = p.beam * 0.5;
  return KEEL;
}

/** Closest point on the player's keel to (x,z): writes CLOSEST and returns the distance. `t` = 0 stern … 1 bow. */
export const CLOSEST = { x: 0, z: 0, t: 0 };
export function keelDistance(p: PlayerState, x: number, z: number): number {
  const k = keelOf(p);
  const ex = k.bx - k.sx, ez = k.bz - k.sz;
  const len2 = ex * ex + ez * ez;
  let t = len2 > 1e-6 ? ((x - k.sx) * ex + (z - k.sz) * ez) / len2 : 0.5;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  CLOSEST.x = k.sx + ex * t; CLOSEST.z = k.sz + ez * t; CLOSEST.t = t;
  const dx = x - CLOSEST.x, dz = z - CLOSEST.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
