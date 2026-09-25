/**
 * Overhaul v2 contract: content definitions, run state, events and inputs.
 * Owned by the lead. Consumers treat RunState as read-only; only src/game/sim writes it.
 *
 * Coordinates: 1 unit = 1 metre, Y up. A ship's forward vector is (-sin(heading), 0, -cos(heading));
 * positive heading turns the bow to port (left). Starboard is (cos(heading), 0, -sin(heading)).
 */
import type {
  BossId, EliteAffixId, EnemyId, Faction, HazardKind, HeroModelKey, MetaUpgradeId, PassiveId, PickupKind, ProjectileKind, Rarity, SeaId, ShipId, SkillSlot, SpecialId, StatKey, StatusKind, Team, UltimateId, WeaponId, WeaponMount, WeatherId,
} from './ids';

export type Stats = Record<StatKey, number>;

// ─────────────────────────────── Content ───────────────────────────────

export type ShipUnlock =
  | { kind: 'start' }
  | { kind: 'doubloons'; cost: number }
  | { kind: 'achievement'; achievement: AchievementId; text: string };

export type AchievementId = 'defeat-iron-warden' | 'defeat-tidewyrm' | 'win-run' | 'survive-10' | 'kills-1000';

export interface ShipDef {
  id: ShipId;
  name: string;
  epithet: string;
  description: string;
  modelKey: HeroModelKey;
  /** Gameplay hull length/beam in metres (collision capsule). The visual model is scaled to `length`. */
  length: number;
  beam: number;
  hp: number;
  armor: number;
  /** m/s at FULL sail on a beam reach. */
  maxSpeed: number;
  accel: number;
  /** rad/s at speed. */
  turnRate: number;
  mass: number;
  /** Guns per side for the Broadside Battery at level 1. */
  broadsideGuns: number;
  pickupRadius: number;
  special: SpecialId;
  ultimate: UltimateId;
  startingWeapon: WeaponId;
  unlock: ShipUnlock;
  /** UI accent colour (hex). */
  accent: number;
}

export interface WeaponLevelDef {
  damage: number;
  /** Seconds between activations (before stat modifiers). */
  cooldown: number;
  /** Projectiles / guns / targets per activation. */
  count: number;
  range: number;
  area?: number;
  speed?: number;
  pierce?: number;
  duration?: number;
  /** Weapon-specific extra parameters. */
  extra?: Readonly<Record<string, number>>;
  /** Card text for reaching this level. */
  text: string;
}

export interface WeaponBranchDef { id: 'A' | 'B'; name: string; text: string }

export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  /** Icon path, conventionally /assets/icons/<id>.png (UI falls back if missing). */
  icon: string;
  mount: WeaponMount;
  tags: readonly ('projectile' | 'area' | 'fire' | 'lightning' | 'summon' | 'contact' | 'drop')[];
  /** Exactly 6 entries; index 0 = level 1. */
  levels: readonly WeaponLevelDef[];
  branches: readonly [WeaponBranchDef, WeaponBranchDef];
  overdrive: { name: string; text: string };
}

export interface PassiveDef {
  id: PassiveId;
  name: string;
  description: string;
  icon: string;
  maxRank: number;
  perRank: Readonly<Partial<Stats>>;
}

export type EnemyBehavior = 'swarm' | 'ram' | 'broadside' | 'chaser' | 'artillery' | 'kamikaze' | 'phase' | 'lunge' | 'stationary';

export interface EnemyAttackDef {
  projectile: ProjectileKind;
  damage: number;
  cooldown: number;
  range: number;
  count: number;
  spread: number;
  speed: number;
  /** 0 = aims at the current position, 1 = perfect intercept. Scaled up by run time. */
  lead: number;
  /** Seconds of telegraph before firing (red decal on the water); 0 = none. */
  telegraph: number;
}

export interface EnemyDef {
  id: EnemyId;
  name: string;
  faction: Faction;
  /** Visual model key resolved by src/render/ships (see /assets/fleet/manifest.json). */
  modelKey: string;
  length: number;
  radius: number;
  hp: number;
  armor: number;
  speed: number;
  turnRate: number;
  mass: number;
  behavior: EnemyBehavior;
  attack?: EnemyAttackDef;
  contactDamage: number;
  xp: number;
  doubloonChance: number;
  /** Earliest minute this enemy appears in the default director mix. */
  firstMinute: number;
}

export interface BossPhaseDef { hpFraction: number; name: string; attacks: readonly string[] }

export interface BossDef {
  id: BossId;
  name: string;
  title: string;
  modelKey: string;
  length: number;
  radius: number;
  hp: number;
  armor: number;
  speed: number;
  turnRate: number;
  mass: number;
  contactDamage: number;
  phases: readonly BossPhaseDef[];
  xp: number;
  doubloons: number;
}

/** One boss arrival on a sea's run clock. */
export interface SeaBossEntry {
  /** Run time (s) the boss arrives (its warning comes DIRECTOR.warningLead earlier). */
  at: number;
  boss: BossId;
  /** Extra hull for this meeting on top of DIRECTOR.bossHpScale (rematches of an earlier boss are tougher). Default 1. */
  hpMul?: number;
}

export interface SeaDef {
  id: SeaId;
  name: string;
  description: string;
  /** Run length in seconds; the final boss spawns at this time. */
  duration: number;
  /**
   * Boss schedule on the run clock (seconds of run time, never the player's level). The LAST entry is the final
   * boss: sinking it wins the run. A boss may appear more than once (a rematch with `hpMul`).
   */
  bosses: readonly SeaBossEntry[];
  /** Time of day (0–24 h) at run start and hours advanced over the run. */
  startHour: number;
  hoursPerRun: number;
  weather: readonly { at: number; weather: WeatherId }[];
  enemyFactions: readonly Faction[];
  difficulty: number;
  unlock: { kind: 'start' } | { kind: 'achievement'; achievement: AchievementId; text: string };
}

export interface MetaUpgradeDef {
  id: MetaUpgradeId;
  name: string;
  description: string;
  maxRank: number;
  costs: readonly number[];
  perRank: Readonly<Partial<Stats>>;
}

export interface ContentDb {
  ships: Readonly<Record<ShipId, ShipDef>>;
  weapons: Readonly<Record<WeaponId, WeaponDef>>;
  passives: Readonly<Record<PassiveId, PassiveDef>>;
  enemies: Readonly<Record<EnemyId, EnemyDef>>;
  bosses: Readonly<Record<BossId, BossDef>>;
  seas: Readonly<Record<SeaId, SeaDef>>;
  metaUpgrades: Readonly<Record<MetaUpgradeId, MetaUpgradeDef>>;
}

// ─────────────────────────────── World ───────────────────────────────

export interface Vec2 { x: number; z: number }

export type IslandBiome = 'tropical' | 'rocky' | 'volcanic' | 'fort' | 'harbor' | 'reef';

export interface IslandDef {
  id: string;
  x: number;
  z: number;
  /** Bounding radius of `outline`. */
  radius: number;
  /** Closed coastline polygon in world XZ (counter-clockwise), used for collision, shore foam and meshing. */
  outline: readonly Vec2[];
  height: number;
  biome: IslandBiome;
  seed: number;
  /** Optional authored landmark kind (arch, fort, lighthouse...). */
  landmark?: string;
}

export interface CircleHit { hit: boolean; nx: number; nz: number; depth: number; islandId?: string }

/** Deterministic island field. Implemented in src/world; used by sim (collision/spawns) and render (meshing/foam). */
export interface WorldQuery {
  readonly seed: string;
  islandsNear(x: number, z: number, radius: number, out?: IslandDef[]): IslandDef[];
  collideCircle(x: number, z: number, radius: number): CircleHit;
  /** True if a circle of `margin` metres at (x,z) is open water. */
  isWater(x: number, z: number, margin: number): boolean;
  /** Signed distance to the nearest coastline (negative inside land), capped at `max`. */
  shoreDistance(x: number, z: number, max: number): number;
}

// ─────────────────────────────── Run state ───────────────────────────────

export interface Body {
  x: number;
  z: number;
  /** Visual heave in metres (sampled from the shared waves by the sim for gameplay-relevant height). */
  y: number;
  heading: number;
  speed: number;
  vx: number;
  vz: number;
  yawRate: number;
  /** Visual roll/pitch in radians (heel from turning/waves). */
  roll: number;
  pitch: number;
  radius: number;
  length: number;
  beam: number;
}

export interface StatusState { kind: StatusKind; time: number; magnitude: number }

export interface SkillState {
  /** Remaining cooldown in seconds. */
  cooldown: number;
  /** Cooldown length used for UI rings. */
  cooldownMax: number;
  /** Remaining active time (0 = inactive). */
  active: number;
  /** Ultimate charge 0..1 (other skills: 1). */
  charge: number;
}

export interface WeaponSlot {
  id: WeaponId;
  level: number;
  branch?: 'A' | 'B';
  overdrive: boolean;
  /** Seconds until the next activation. */
  cooldown: number;
  /** Runtime scratch owned by the weapon behaviour (never saved). */
  scratch: Record<string, number>;
}

export interface PassiveSlot { id: PassiveId; rank: number }

export type SailGear = 0 | 1 | 2; // ANCHOR, HALF, FULL

export interface PlayerState extends Body {
  shipId: ShipId;
  alive: boolean;
  hp: number;
  maxHp: number;
  shield: number;
  gear: SailGear;
  /** Smoothed sail setting 0..1 following `gear`. */
  throttle: number;
  rudder: number;
  level: number;
  xp: number;
  xpToNext: number;
  /** Visual growth tier 0..4. */
  tier: number;
  weapons: WeaponSlot[];
  passives: PassiveSlot[];
  stats: Stats;
  skills: Record<SkillSlot, SkillState>;
  statuses: StatusState[];
  aimX: number;
  aimZ: number;
  /** 0..1 height fraction while airborne (Lionburst). */
  airborne: number;
  /** 0..1 depth fraction while submerged (Deep Dive). */
  submerged: number;
  invulnerable: number;
  revivesLeft: number;
  /** Seconds since the player last took damage. */
  sinceHit: number;
}

export type LifeState = 'alive' | 'sinking' | 'dead';

export interface EnemyState extends Body {
  /** Unique, never reused within a run (> 0). Player id is 0. */
  id: number;
  defId: EnemyId;
  faction: Faction;
  life: LifeState;
  /** 0..1 progress of the sinking animation. */
  sink: number;
  hp: number;
  maxHp: number;
  armor: number;
  elite: boolean;
  /** 0..1 flash on hit (decays). */
  hitFlash: number;
  /**
   * 0..1 how far the ship has phased out (Gloam wraith) or dived (wyrmling). Renderers fade/sink it in place;
   * at 1 it is gone: untargetable, no contacts, not shown on the minimap. Always 0 once it stops being alive.
   */
  hidden: number;
  /** Elite modifiers (FOES). Empty for ordinary ships. */
  affixes: EliteAffixId[];
  /** Display name of a named bounty captain (FOES), shown on a nameplate; null for ordinary ships. */
  title: string | null;
  statuses: StatusState[];
  attackCooldown: number;
  /** AI scratch (never saved). */
  ai: Record<string, number>;
  spawnTime: number;
  /** Last weapon that damaged it (kill credit). */
  lastHitBy?: WeaponId;
}

/**
 * An AI captain sailing the same sea as the player (CAPTAINS). Captains fill the roster while no live captains are
 * online: they fight the fleet, draw some of its fire, sink, and sail back in. Ids are negative (ShipRef < 0).
 */
export interface CaptainState extends Body {
  id: number;
  name: string;
  shipId: ShipId;
  alive: boolean;
  hp: number;
  maxHp: number;
  level: number;
  kills: number;
  bounty: number;
  /** Seconds until a sunk captain sails back in (0 while alive). */
  respawn: number;
  /** 0..1 flash on hit (decays). */
  hitFlash: number;
  statuses: StatusState[];
  /** AI scratch (never saved). */
  ai: Record<string, number>;
}

/** The set-piece currently running (EVENTS), for the HUD tracker, markers and effects. */
export interface WorldEventState {
  /** DirectorEventId (content/director.ts). */
  id: string;
  name: string;
  text: string;
  /** Seconds elapsed / total. */
  time: number;
  duration: number;
  /** Optional objective, e.g. 3 of 5 convoy ships sunk. */
  progress?: number;
  goal?: number;
  /** Optional world anchor (e.g. the maelstrom's eye) for markers and effects. */
  x?: number;
  z?: number;
  radius?: number;
}

export interface BossState extends Body {
  id: number;
  defId: BossId;
  life: LifeState;
  sink: number;
  hp: number;
  maxHp: number;
  armor: number;
  phase: number;
  hitFlash: number;
  statuses: StatusState[];
  /** Current attack name and its elapsed time. */
  attack: string;
  attackTime: number;
  /** 0..1 submerged (serpent). */
  submerged: number;
  ai: Record<string, number>;
  spawnTime: number;
}

export interface ProjectileState {
  id: number;
  alive: boolean;
  kind: ProjectileKind;
  team: Team;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  damage: number;
  radius: number;
  /** Remaining targets it can pass through (0 = stops on first hit). */
  pierce: number;
  ttl: number;
  age: number;
  weapon?: WeaponId;
  /** Homing target id (enemy/boss id, or 0 for the player). */
  target?: number;
  crit: boolean;
  /** Area radius on impact (0 = none). */
  area: number;
  /** Ids already hit (for pierce). */
  hits: number[];
}

/**
 * Hazard semantics: 'shockwave' radius = FINAL radius reached over ttl (expanding ring); 'wave-front' radius = half-width,
 * moving with vx/vz; 'escort-skiff' heading = its velocity direction; others are static circles unless vx/vz move them.
 */
export interface HazardState {
  id: number;
  alive: boolean;
  kind: HazardKind;
  team: Team;
  x: number;
  z: number;
  radius: number;
  ttl: number;
  age: number;
  damage: number;
  /** Seconds between damage ticks (0 = one-shot on trigger). */
  tick: number;
  tickTimer: number;
  vx: number;
  vz: number;
  weapon?: WeaponId;
  armed: boolean;
}

export interface PickupState {
  id: number;
  alive: boolean;
  kind: PickupKind;
  x: number;
  z: number;
  value: number;
  age: number;
  magnet: boolean;
}

/**
 * Telegraph geometry: 'circle'/'ring' centred at x,z with `radius`. 'line'/'cone' START at x,z and point along the ship
 * heading convention (−sin(angle), −cos(angle)); `length` is the extent and `radius` the HALF-width (cone: end half-width).
 */
export type TelegraphShape = 'circle' | 'line' | 'cone' | 'ring';

export interface TelegraphState {
  id: number;
  alive: boolean;
  shape: TelegraphShape;
  team: Team;
  x: number;
  z: number;
  radius: number;
  length: number;
  angle: number;
  /** Seconds elapsed / total before it resolves. */
  time: number;
  duration: number;
}

export interface SeaState {
  weather: WeatherId;
  /** Blend target weather for visual crossfades. */
  nextWeather: WeatherId;
  /** 0..1 progress of the current crossfade. */
  blend: number;
  /** Multiplier for the shared Gerstner waves (see src/core/waves.ts). */
  waveScale: number;
  /** Direction the wind blows TOWARD: (sin(windDir), cos(windDir)) in world XZ. */
  windDir: number;
  windStrength: number;
  /** Hours 0–24. */
  timeOfDay: number;
  fog: number;
  rain: number;
  /** Increments whenever a lightning strike happens (visual flash trigger). */
  lightningSerial: number;
}

export interface CardOffer {
  kind: 'new-weapon' | 'weapon-level' | 'weapon-branch' | 'weapon-overdrive' | 'new-passive' | 'passive-rank' | 'chip' | 'heal' | 'doubloons';
  /** WeaponId, PassiveId or a chip/stat key. */
  id: string;
  title: string;
  text: string;
  icon: string;
  rarity: Rarity;
  /** Level/rank this card grants. */
  level?: number;
  branch?: 'A' | 'B';
  stat?: StatKey;
  amount?: number;
}

/**
 * 'levelup': `offers` holds the cards; chooseCard(i) applies one.
 * 'chest': a chest was opened; `offers` holds the rewards ALREADY APPLIED (for the reveal UI); chooseCard(0) resumes.
 */
export type RunStatus = 'running' | 'levelup' | 'chest' | 'paused' | 'dead' | 'victory';

export interface RunStats {
  kills: number;
  eliteKills: number;
  damageDealt: number;
  damageTaken: number;
  bossesDefeated: BossId[];
  doubloons: number;
  xpCollected: number;
  bounty: number;
  killsByWeapon: Partial<Record<WeaponId, number>>;
  damageByWeapon: Partial<Record<WeaponId, number>>;
}

export interface DirectorState {
  minute: number;
  heat: number;
  budget: number;
  nextBossIndex: number;
  bossWarning: BossId | null;
  bossWarningTime: number;
  activeBoss: BossId | null;
  event: string | null;
  eventTime: number;
  scratch: Record<string, number>;
}

export interface RunState {
  seed: string;
  seaId: SeaId;
  shipId: ShipId;
  status: RunStatus;
  /** Seconds of run time (stops while paused / level-up). */
  time: number;
  /** Fixed-step tick counter. */
  tick: number;
  /** Real render-independent time scale requested by the sim (hit-stop/slow-mo), 1 = normal. */
  timeScale: number;
  player: PlayerState;
  enemies: EnemyState[];
  bosses: BossState[];
  projectiles: ProjectileState[];
  hazards: HazardState[];
  pickups: PickupState[];
  telegraphs: TelegraphState[];
  sea: SeaState;
  director: DirectorState;
  offers: CardOffer[] | null;
  /** Remaining queued level-ups after the current offer. */
  pendingLevelUps: number;
  rerolls: number;
  banishes: number;
  banished: string[];
  stats: RunStats;
  endless: boolean;
  /** AI captains in this sea (CAPTAINS; empty when disabled). */
  captains: CaptainState[];
  /** The set-piece running now, or null (EVENTS). */
  worldEvent: WorldEventState | null;
}

// ─────────────────────────────── Events ───────────────────────────────

export type ShipRef = number; // 0 = player, >0 = enemy or boss id, <0 = AI captain

export type SimEvent =
  | { type: 'weapon-fired'; weapon: WeaponId; owner: ShipRef; x: number; z: number; dirX: number; dirZ: number; side?: 'port' | 'starboard' | 'bow' | 'stern'; count: number }
  | { type: 'enemy-fired'; source: ShipRef; projectile: ProjectileKind; x: number; z: number; dirX: number; dirZ: number; count: number }
  | { type: 'projectile-hit'; projectile: ProjectileKind; team: Team; x: number; y: number; z: number; target: 'ship' | 'water' | 'island'; targetId?: ShipRef; damage: number; crit: boolean }
  | { type: 'explosion'; x: number; z: number; radius: number; kind: 'small' | 'medium' | 'large' | 'fire' | 'powder' | 'mine' | 'mortar' | 'lightning' | 'water'; team: Team }
  | { type: 'damage'; target: ShipRef; amount: number; crit: boolean; x: number; y: number; z: number; weapon?: WeaponId }
  | { type: 'player-hit'; amount: number; x: number; z: number; braced: boolean; parried: boolean; source?: ShipRef }
  | { type: 'enemy-spawned'; id: ShipRef; defId: EnemyId; x: number; z: number; elite: boolean }
  | { type: 'enemy-killed'; id: ShipRef; defId: EnemyId; x: number; z: number; elite: boolean; weapon?: WeaponId }
  | { type: 'enemy-sunk'; id: ShipRef; x: number; z: number }
  | { type: 'pickup-spawned'; id: number; kind: PickupKind; x: number; z: number; value: number }
  | { type: 'pickup-collected'; id: number; kind: PickupKind; x: number; z: number; value: number }
  | { type: 'level-up'; level: number }
  | { type: 'card-chosen'; offer: CardOffer }
  | { type: 'weapon-changed'; weapon: WeaponId; level: number; branch?: 'A' | 'B'; overdrive: boolean; isNew: boolean }
  | { type: 'passive-changed'; passive: PassiveId; rank: number; isNew: boolean }
  | { type: 'tier-up'; tier: number }
  | { type: 'skill-used'; slot: SkillSlot; skill: SkillSlot | SpecialId | UltimateId; x: number; z: number; aimX: number; aimZ: number }
  | { type: 'skill-ready'; slot: SkillSlot }
  | { type: 'status-changed'; target: ShipRef; status: StatusKind; on: boolean }
  | { type: 'lightning'; points: Vec2[]; team: Team }
  | { type: 'harpoon'; from: ShipRef; to: ShipRef; x1: number; z1: number; x2: number; z2: number }
  | { type: 'ram'; attacker: ShipRef; target: ShipRef; damage: number; x: number; z: number }
  | { type: 'collision'; a: ShipRef; b: ShipRef | 'island'; x: number; z: number; impulse: number }
  | { type: 'hazard-spawned'; id: number; kind: HazardKind; x: number; z: number; radius: number }
  | { type: 'hazard-triggered'; id: number; kind: HazardKind; x: number; z: number; radius: number }
  | { type: 'telegraph'; id: number; shape: TelegraphShape; team: Team; x: number; z: number; radius: number; duration: number }
  | { type: 'boss-warning'; boss: BossId; eta: number }
  | { type: 'boss-spawned'; boss: BossId; id: ShipRef; x: number; z: number }
  | { type: 'boss-phase'; boss: BossId; id: ShipRef; phase: number }
  | { type: 'boss-attack'; boss: BossId; id: ShipRef; attack: string; x: number; z: number }
  | { type: 'boss-defeated'; boss: BossId; id: ShipRef; x: number; z: number }
  | { type: 'director-event'; name: string; text: string }
  | { type: 'world-event'; id: string; phase: 'start' | 'success' | 'fail' | 'end'; name: string; text: string; x?: number; z?: number }
  | { type: 'captain-joined'; id: ShipRef; name: string; shipId: ShipId }
  | { type: 'captain-sunk'; id: ShipRef; name: string; x: number; z: number }
  | { type: 'captain-respawned'; id: ShipRef; name: string }
  | { type: 'captain-kill'; id: ShipRef; name: string; victim: EnemyId | BossId; x: number; z: number }
  | { type: 'weather-changed'; weather: WeatherId }
  | { type: 'lightning-strike'; x: number; z: number }
  | { type: 'chest-opened'; rewards: CardOffer[] }
  | { type: 'player-died'; reviving: boolean }
  | { type: 'revived' }
  | { type: 'run-ended'; outcome: 'victory' | 'defeat' | 'retired' };

export type SimEventType = SimEvent['type'];

// ─────────────────────────────── Input ───────────────────────────────

export interface PlayerInput {
  /** −1..1; positive = port (left, A key), matching the heading convention. */
  steer: number;
  /** Optional analog throttle −1..1 (gamepad); keyboard uses gear actions instead. */
  throttleAxis: number;
  /** World-space aim point on the water. */
  aimX: number;
  aimZ: number;
  /** True while the broadside button is held (repeat on cooldown). */
  broadsideHeld: boolean;
}

export type SimAction =
  | 'gear-up' | 'gear-down' | 'broadside' | 'special' | 'ultimate' | 'brace' | 'boost'
  | 'reroll';

// ─────────────────────────────── Meta / settings ───────────────────────────────

export interface MetaProfile {
  version: 2;
  doubloons: number;
  upgrades: Partial<Record<MetaUpgradeId, number>>;
  unlockedShips: ShipId[];
  unlockedSeas: SeaId[];
  achievements: AchievementId[];
  bestTime: Partial<Record<ShipId, number>>;
  bestBounty: Partial<Record<ShipId, number>>;
  totalKills: number;
  runs: number;
  wins: number;
  lastShip: ShipId;
  lastSea: SeaId;
  // ── Round 2 (optional for older saves) ──
  /** One-time coach hints already shown (FLOW). */
  seenHints?: string[];
  /** Quest progress by quest id (REPLAY). */
  quests?: Record<string, { progress: number; done: boolean }>;
  /** Highest heat cleared per sea (REPLAY; 0 = none). */
  heat?: Partial<Record<SeaId, number>>;
  /** Most recent runs, newest first, capped at 20 (REPLAY). */
  history?: RunSummary[];
  /** Best daily-voyage bounty by date key 'YYYY-MM-DD' (REPLAY). */
  daily?: Record<string, number>;
}

/** A compact record of a finished run for the harbor's logbook (REPLAY). */
export interface RunSummary {
  at: number;
  shipId: ShipId;
  seaId: SeaId;
  outcome: RunResult['outcome'];
  time: number;
  level: number;
  kills: number;
  bounty: number;
  doubloons: number;
  heat: number;
  daily?: string;
}

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  version: 2;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  cameraShake: number;
  /** Tones down impact frames, flashes and chromatic pulses (photosensitivity). Optional for older saves. */
  reduceFlashing?: boolean;
  damageNumbers: boolean;
  quality: QualitySetting;
  showFps: boolean;
  /** First-voyage coach prompts (FLOW). Default on. */
  coach?: boolean;
  /** Telegraph palette for colour-blind players (FLOW + IMPACT). */
  colorBlind?: 'off' | 'deutan' | 'protan' | 'tritan';
  /** HUD scale 0.8–1.2 (FLOW). */
  hudScale?: number;
  /** Lower, cinematic camera while the sea is quiet (IMPACT). Default off. */
  cinematicCamera?: boolean;
  /** Crew barks (AUDIO). Default on. */
  barks?: boolean;
  /** AI captains sailing with you (0–4). Optional for older saves (default 3). */
  captains?: number;
}

export interface RunResult {
  outcome: 'victory' | 'defeat' | 'retired';
  shipId: ShipId;
  seaId: SeaId;
  time: number;
  level: number;
  stats: RunStats;
  doubloonsEarned: number;
  newUnlocks: string[];
}
