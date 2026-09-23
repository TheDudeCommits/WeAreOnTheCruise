/**
 * SimContext: the service surface shared by every sim system.
 * CONTRACT between CORE (implements) and META (calls). CORE may change the implementation freely,
 * but must keep this interface's names and semantics stable.
 */
import type { BossId, EnemyId, HazardKind, PickupKind, ProjectileKind, StatusKind, Team, WeaponId } from '../ids';
import type {
  BossState, ContentDb, EnemyState, HazardState, MetaProfile, PickupState, PlayerInput, PlayerState,
  ProjectileState, RunState, ShipRef, SimAction, SimEvent, TelegraphShape, TelegraphState, WorldQuery,
} from '../types';

export type Target = EnemyState | BossState;

export interface ProjectileSpawn {
  kind: ProjectileKind;
  team: Team;
  x: number; y?: number; z: number;
  vx: number; vy?: number; vz: number;
  damage: number;
  radius?: number;
  pierce?: number;
  ttl?: number;
  weapon?: WeaponId;
  target?: number;
  crit?: boolean;
  area?: number;
}

export interface HazardSpawn {
  kind: HazardKind;
  team: Team;
  x: number; z: number;
  radius: number;
  ttl: number;
  damage: number;
  tick?: number;
  vx?: number; vz?: number;
  weapon?: WeaponId;
  armed?: boolean;
}

export interface TelegraphSpawn {
  shape: TelegraphShape;
  team: Team;
  x: number; z: number;
  radius: number;
  length?: number;
  angle?: number;
  duration: number;
}

export interface DamageOpts {
  weapon?: WeaponId;
  crit?: boolean;
  /** Metres of knockback away from (fromX, fromZ). */
  knockback?: number;
  fromX?: number;
  fromZ?: number;
  status?: { kind: StatusKind; time: number; magnitude?: number };
  /** Skip armour (true damage). */
  pierceArmor?: boolean;
}

export interface PlayerDamageOpts {
  x?: number;
  z?: number;
  source?: ShipRef;
  kind?: 'projectile' | 'contact' | 'hazard' | 'boss';
}

export interface SimContext {
  readonly state: RunState;
  readonly content: ContentDb;
  readonly world: WorldQuery;
  readonly meta: MetaProfile;
  /** Seeded random in [0, 1). The only randomness allowed in the sim. */
  readonly random: () => number;
  /** Fixed step length in seconds. */
  readonly dt: number;
  readonly input: Readonly<PlayerInput>;
  /** Discrete actions pressed since the previous tick. */
  readonly actions: ReadonlySet<SimAction>;

  emit(event: SimEvent): void;
  nextId(): number;

  spawnEnemy(defId: EnemyId, x: number, z: number, opts?: { elite?: boolean; heading?: number }): EnemyState | null;
  spawnBoss(defId: BossId, x: number, z: number, heading?: number): BossState;
  spawnProjectile(p: ProjectileSpawn): ProjectileState | null;
  spawnHazard(h: HazardSpawn): HazardState | null;
  spawnPickup(kind: PickupKind, x: number, z: number, value?: number): PickupState | null;
  addTelegraph(t: TelegraphSpawn): TelegraphState | null;

  /** Live enemies and bosses within `radius` (uses the spatial index rebuilt each tick). */
  targetsNear(x: number, z: number, radius: number, out: Target[]): Target[];
  findTarget(id: number): Target | undefined;
  player(): PlayerState;

  /** Applies armour, crits, stats multipliers are the caller's job. Returns damage dealt. Handles death → hooks. */
  damageTarget(target: Target, amount: number, opts?: DamageOpts): number;
  /** Applies brace, shield, armour, invulnerability. Returns damage taken. */
  damagePlayer(amount: number, opts?: PlayerDamageOpts): number;
  applyStatus(target: PlayerState | Target, kind: StatusKind, time: number, magnitude?: number): void;
  hasStatus(target: PlayerState | Target, kind: StatusKind): boolean;
  /** Presentation-facing time scale (hit-stop / slow-mo). The runtime applies it to sim stepping. */
  requestTimeScale(scale: number, duration: number): void;
  /** Ends the run (victory after the final boss, defeat, or retire). */
  endRun(outcome: 'victory' | 'defeat' | 'retired'): void;
}
