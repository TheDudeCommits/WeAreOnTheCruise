import type { EnemyId, SeaId } from '../ids';

/**
 * Spawn director tables (META). The director spends a points budget (cost = enemy xp) on groups drawn from the
 * current minute band, keeps a floor of live enemies, and fires set-piece events. Everything here is tuned with
 * scripts/balance-sim.ts. Curves take `minute` = run time / 60 (fractional).
 */

export interface SpawnEntry {
  enemy: EnemyId;
  weight: number;
  /** Group size range (inclusive). Frigates in groups sail line abreast; skiffs arrive as packs. */
  group: readonly [number, number];
}

export interface SpawnBand {
  /** First minute this band applies. */
  from: number;
  entries: readonly SpawnEntry[];
}

const E = (enemy: EnemyId, weight: number, min: number, max: number): SpawnEntry => ({ enemy, weight, group: [min, max] });

/**
 * Minute-by-minute mix. Entries whose faction is not in the sea's `enemyFactions` (or whose `firstMinute` has not
 * arrived) are skipped, so one table serves every sea: the Gloam swaps wraiths in, Sunward never sees them.
 */
export const SPAWN_BANDS: readonly SpawnBand[] = [
  { from: 0, entries: [E('skiff', 10, 3, 5)] },
  { from: 1, entries: [E('skiff', 9, 3, 6), E('cutter', 2, 1, 1)] },
  { from: 2, entries: [E('skiff', 8, 4, 6), E('cutter', 3, 1, 2), E('brig', 1, 1, 1), E('wraith', 3, 1, 1)] },
  { from: 3, entries: [E('skiff', 7, 4, 7), E('cutter', 3, 1, 2), E('brig', 2, 1, 1), E('corsair-brig', 2, 1, 1), E('fireship', 1, 1, 2), E('wraith', 3, 1, 2)] },
  { from: 4, entries: [E('skiff', 7, 5, 7), E('cutter', 3, 2, 3), E('brig', 3, 1, 2), E('corsair-brig', 3, 1, 2), E('fireship', 2, 1, 3), E('mortar-barge', 1, 1, 1), E('wraith', 4, 1, 2)] },
  { from: 6, entries: [E('skiff', 6, 5, 8), E('cutter', 3, 2, 3), E('brig', 3, 1, 2), E('corsair-brig', 3, 1, 2), E('fireship', 2, 2, 3), E('mortar-barge', 2, 1, 2), E('frigate', 3, 2, 3), E('wyrmling', 3, 2, 3), E('wraith', 4, 2, 3)] },
  { from: 7, entries: [E('skiff', 6, 5, 8), E('cutter', 2, 2, 3), E('brig', 3, 1, 2), E('corsair-brig', 3, 1, 3), E('fireship', 2, 2, 3), E('mortar-barge', 2, 1, 2), E('frigate', 3, 2, 3), E('corsair-galleon', 2, 1, 1), E('wyrmling', 3, 2, 4), E('wraith', 4, 2, 3)] },
  { from: 9, entries: [E('skiff', 6, 6, 9), E('cutter', 2, 2, 4), E('brig', 3, 2, 2), E('corsair-brig', 3, 2, 3), E('fireship', 3, 2, 4), E('mortar-barge', 2, 1, 2), E('frigate', 3, 2, 3), E('corsair-galleon', 2, 1, 2), E('man-o-war', 1, 1, 1), E('wyrmling', 3, 2, 4), E('wraith', 5, 2, 3)] },
  { from: 11, entries: [E('skiff', 7, 7, 10), E('cutter', 2, 3, 4), E('brig', 3, 2, 3), E('corsair-brig', 3, 2, 3), E('fireship', 3, 3, 4), E('mortar-barge', 3, 1, 2), E('frigate', 4, 2, 3), E('corsair-galleon', 3, 1, 2), E('man-o-war', 2, 1, 1), E('wyrmling', 4, 3, 4), E('wraith', 5, 2, 4)] },
  { from: 13, entries: [E('skiff', 7, 8, 11), E('cutter', 2, 3, 5), E('brig', 3, 2, 3), E('corsair-brig', 3, 2, 4), E('fireship', 3, 3, 5), E('mortar-barge', 3, 2, 3), E('frigate', 4, 3, 3), E('corsair-galleon', 3, 1, 2), E('man-o-war', 2, 1, 2), E('wyrmling', 4, 3, 5), E('wraith', 5, 3, 4)] },
];

export const DIRECTOR = {
  /** Spawn points per second at difficulty 1 (1 point = 1 xp of enemies). */
  budgetRate: (minute: number): number => 0.42 + 0.14 * minute + 0.014 * minute * minute,
  /** Exponent applied to the sea difficulty for the budget (density grows slower than difficulty). */
  budgetDifficultyExp: 0.7,
  /** Live-enemy floor: below it the director spawns immediately without spending budget. */
  minAlive: (minute: number): number => Math.min(78, 3 + 3.2 * minute + 0.22 * minute * minute),
  /** Unspent budget is capped so a quiet spell never turns into one giant burst. */
  bankMax: 40,
  /**
   * Floor spawns may run the budget into debt down to −debt(minute): the floor keeps the sea busy for a slow
   * player, but a fast killer cannot farm unlimited experience (the budget sets the XP pace).
   */
  debt: (minute: number): number => 12 + 2.5 * minute,
  /** Probability that a spawned enemy is elite. */
  eliteChance: (minute: number): number => (minute < 1.5 ? 0 : Math.min(0.07, 0.006 + 0.0038 * minute)),
  maxElites: 3,
  /** Heat: difficulty × time curve. Drives enemy HP, damage and speed. */
  heat: (minute: number, difficulty: number): number => difficulty * (1 + 0.08 * minute + 0.003 * minute * minute),
  /**
   * Enemy HP multiplier: grows with time; sea difficulty counts at half strength (harder seas also bring more
   * ships, more fire and nastier weather, so HP does not need to carry all of it).
   */
  hpScale: (minute: number, difficulty: number): number => (1 + 0.11 * minute + 0.0041 * minute * minute) * (1 + (difficulty - 1) * 0.5),
  /** Enemy damage multiplier (time and difficulty), capped. */
  damageScale: (minute: number, difficulty: number): number =>
    Math.min(2.2, (1 + 0.0256 * minute + 0.00096 * minute * minute) * (1 + (difficulty - 1) * 0.35)),
  /**
   * Green crews: early enemy gunnery is forgiving and hardens over the first minutes (multipliers on lead, spread
   * and reload time), so the opening is about learning to sail, not about dodging perfect volleys.
   */
  graceLead: (minute: number): number => 0.3 + 0.7 * Math.min(1, minute / 10),
  graceSpread: (minute: number): number => 1.5 - 0.5 * Math.min(1, minute / 10),
  graceReload: (minute: number): number => 1.4 - 0.4 * Math.min(1, minute / 10),
  /**
   * Fire control: the whole enemy fleet shares a budget of volleys per second (tokens). The horde can be huge
   * for spectacle while incoming fire stays a designed curve. Bosses are exempt (their attacks are telegraphed).
   */
  fireRate: (minute: number): number => 0.072 + 0.0204 * minute,
  /** Fire-control rate multiplier from sea difficulty. */
  fireDifficultyExp: 0.5,
  fireBank: 3,
  speedScale: (minute: number): number => 1 + Math.min(0.25, 0.0064 * minute + 0.00024 * minute * minute),
  /** Boss HP multiplier for the sea difficulty and the endless loop (0 = first pass). */
  bossHpScale: (difficulty: number, loop: number): number => (1 + (difficulty - 1) * 0.8) * (1 + loop * 0.75),
  eliteHp: 3.5,
  eliteDamage: 1.25,
  eliteXp: 4,
  /** Budget and floor multipliers while a boss is alive (focus on the fight). */
  bossBudgetMul: 0.35,
  bossFloorMul: 0.3,
  /** Seconds of calm at the start of a boss fight; spawns ramp back to normal over the same span after it. */
  bossCalm: 60,
  /** Budget/floor multiplier during the boss warning countdown. */
  warningBudgetMul: 0.5,
  /** Seconds of boss warning before the spawn. */
  warningLead: 10,
  /** Forts: seconds between placement attempts, max alive, search ring (m). */
  fortInterval: 6,
  fortMax: 2,
  fortSearchMin: 170,
  fortSearchMax: 420,
  /** Seconds between boss loops in endless mode (after the final boss). */
  endlessBossGap: 300,
};

export type DirectorEventId =
  | 'ambush-ring' | 'fire-ship-rush' | 'mortar-line' | 'treasure-convoy' | 'storm-front' | 'fog-bank'
  // Round 1 (EVENTS): big-world set pieces, run by src/game/sim/world-events.ts and src/game/sim/events/*.
  | 'kraken-rising' | 'rogue-wave' | 'maelstrom' | 'admiralty-blockade' | 'ghost-fleet' | 'volcanic-eruption'
  | 'sunken-treasure' | 'bounty-contract';

export interface DirectorEventDef {
  id: DirectorEventId;
  name: string;
  text: string;
  /** Earliest minute. */
  from: number;
  weight: number;
  maxPerRun: number;
  /** Seconds the event stays "active" (d.event) for the HUD banner and follow-up effects. */
  duration: number;
  /**
   * EVENTS: seconds of calm after this event ends before the director may start the next one (big set pieces
   * want a breather). Default EVENT_TUNING.lull.
   */
  lull?: number;
}

export const DIRECTOR_EVENTS: Readonly<Record<DirectorEventId, DirectorEventDef>> = {
  'ambush-ring': { id: 'ambush-ring', name: 'Ambush Ring', text: 'Ambush! Raider skiffs close in from every side.', from: 1.5, weight: 5, maxPerRun: 6, duration: 12 },
  'fire-ship-rush': { id: 'fire-ship-rush', name: 'Fire Ship Rush', text: 'Fire ships on the wind! Turn broadside or turn tail.', from: 3.5, weight: 4, maxPerRun: 4, duration: 14 },
  'mortar-line': { id: 'mortar-line', name: 'Mortar Line', text: 'A mortar line has your range. Watch the water for red circles.', from: 5.5, weight: 3, maxPerRun: 3, duration: 20 },
  'treasure-convoy': { id: 'treasure-convoy', name: 'Treasure Convoy', text: 'A treasure convoy is fleeing. Catch it before it slips away!', from: 2.5, weight: 3, maxPerRun: 2, duration: 45 },
  'storm-front': { id: 'storm-front', name: 'Storm Front', text: 'A storm front rolls in: rogue waves and lightning!', from: 3.5, weight: 5, maxPerRun: 4, duration: 22 },
  'fog-bank': { id: 'fog-bank', name: 'Fog Bank', text: 'A fog bank swallows the horizon. Something sails inside it.', from: 1, weight: 6, maxPerRun: 5, duration: 30 },
  // ── EVENTS (round 1): set pieces with an objective on the HUD tracker (run.worldEvent). ──
  'kraken-rising': {
    id: 'kraken-rising', name: 'Kraken Rising', text: "The sea boils! The Kraken's arms burst up all around you.",
    from: 4, weight: 4, maxPerRun: 2, duration: 45, lull: 25,
  },
  'rogue-wave': {
    id: 'rogue-wave', name: 'Rogue Wave', text: 'A rogue wave towers on the horizon. Brace for it, or boost straight through!',
    from: 2, weight: 3, maxPerRun: 3, duration: 30, lull: 12,
  },
  maelstrom: {
    id: 'maelstrom', name: 'Maelstrom', text: 'A maelstrom tears the sea open. Lure ships into its eye; slingshot round the rim.',
    from: 3, weight: 3, maxPerRun: 2, duration: 32, lull: 20,
  },
  'admiralty-blockade': {
    id: 'admiralty-blockade', name: 'Admiralty Blockade', text: 'An Admiralty blockade bars the way. Sink the flagship to break the line!',
    from: 6.5, weight: 3, maxPerRun: 2, duration: 75, lull: 25,
  },
  'ghost-fleet': {
    id: 'ghost-fleet', name: 'Ghost Fleet', text: 'Lanterns under the water... the drowned fleet rises!',
    from: 3, weight: 3, maxPerRun: 2, duration: 70, lull: 25,
  },
  'volcanic-eruption': {
    id: 'volcanic-eruption', name: 'Volcanic Eruption', text: 'The mountain wakes! Dodge the red circles; the gold ones rain treasure.',
    from: 3, weight: 3, maxPerRun: 2, duration: 30, lull: 18,
  },
  'sunken-treasure': {
    id: 'sunken-treasure', name: 'Sunken Treasure', text: 'A wreck glitters below. Hold the dig site to raise its chest!',
    from: 1, weight: 4, maxPerRun: 2, duration: 70, lull: 15,
  },
  'bounty-contract': {
    id: 'bounty-contract', name: 'Bounty Contract', text: 'A bounty is posted on the ships around you. Sink the marked ones before time runs out!',
    from: 1, weight: 4, maxPerRun: 3, duration: 60, lull: 10,
  },
};

export interface SeaEventPlan {
  /** Seconds before the first event. */
  first: number;
  /** Seconds between events (min, max). */
  gap: readonly [number, number];
  events: readonly DirectorEventId[];
  /** EVENTS: per-sea weight multipliers (each sea has its signature set pieces). Missing = 1. */
  weights?: Readonly<Partial<Record<DirectorEventId, number>>>;
}

/**
 * Event cadence (EVENTS): the first set piece at 1:00, then one every 35–60 s; every event is followed by a lull
 * (EVENT_TUNING.lull, or the def's own `lull` for big ones) before the next may start, and none overlaps a boss.
 * Sunward favours treasure and blockades, Stormwrack rogue waves and maelstroms, the Gloam the ghost fleet.
 */
export const SEA_EVENTS: Readonly<Record<SeaId, SeaEventPlan>> = {
  'sunward-shallows': {
    first: 60, gap: [35, 60],
    events: [
      'ambush-ring', 'fire-ship-rush', 'mortar-line', 'treasure-convoy', 'sunken-treasure', 'admiralty-blockade', 'bounty-contract',
      'kraken-rising', 'volcanic-eruption', 'rogue-wave', 'maelstrom', 'ghost-fleet',
    ],
    weights: { 'sunken-treasure': 1.8, 'admiralty-blockade': 1.8, 'bounty-contract': 1.2, 'rogue-wave': 0.5, maelstrom: 0.6, 'ghost-fleet': 0.8 },
  },
  'stormwrack-reach': {
    first: 60, gap: [35, 55],
    events: [
      'ambush-ring', 'fire-ship-rush', 'mortar-line', 'treasure-convoy', 'storm-front', 'rogue-wave', 'maelstrom', 'kraken-rising',
      'volcanic-eruption', 'admiralty-blockade', 'sunken-treasure', 'bounty-contract', 'ghost-fleet',
    ],
    weights: { 'rogue-wave': 2.2, maelstrom: 2, 'volcanic-eruption': 1.3, 'kraken-rising': 1.2, 'sunken-treasure': 0.7 },
  },
  'the-gloam': {
    first: 60, gap: [35, 55],
    events: [
      'ambush-ring', 'fire-ship-rush', 'treasure-convoy', 'fog-bank', 'mortar-line', 'ghost-fleet', 'kraken-rising', 'bounty-contract',
      'sunken-treasure', 'maelstrom', 'volcanic-eruption', 'admiralty-blockade', 'rogue-wave',
    ],
    weights: { 'ghost-fleet': 2.6, 'kraken-rising': 1.3, 'admiralty-blockade': 0.6, 'rogue-wave': 0.6 },
  },
};

/** Event tuning. */
export const EVENT_TUNING = {
  ambushSkiffs: (minute: number): number => Math.min(22, 8 + Math.floor(minute)),
  ambushRadius: 230,
  fireShips: (minute: number): number => Math.min(8, 4 + Math.floor(minute / 4)),
  mortarBarges: (minute: number): number => (minute < 10 ? 3 : 4),
  mortarEscorts: 2,
  convoyGalleons: 3,
  convoyEscape: 45,
  convoyDoubloons: 14,
  convoyHpMul: 0.6,
  stormWaves: 3,
  stormWaveWidth: 7,
  stormStrikes: 9,
  fogWraiths: (minute: number): number => Math.min(8, 3 + Math.floor(minute / 3)),
  fogAmount: 0.85,

  // ── EVENTS (round 1) ──
  /** Seconds of calm after a set piece ends (default; big ones set DirectorEventDef.lull) and after META's six. */
  lull: 8,
  lullAfterMeta: 6,
  /** Seconds a finished set piece stays on the tracker (outcome flourish) after it is physically done. */
  linger: 2.2,
  /** A set piece never starts if it could still be running this close to a boss arrival (s). */
  bossMargin: 15,
  /** Rewards: XP spilled on success (minute-scaled), bounty per success (× heat). */
  rewardXp: (minute: number): number => 10 + 4 * minute,
  successBounty: 1500,

  krakenArms: (minute: number): number => (minute < 8 ? 5 : minute < 12 ? 6 : 7),
  /** Ring radius (m) around the player where the arms break the surface. */
  krakenRing: 78,
  /** Arm HP multiplier on top of the heat-scaled kraken-arm HP. */
  krakenArmHp: 1,
  /** Attacks in the air at once (telegraphs) and per-arm cooldown range (s). */
  krakenConcurrent: (minute: number): number => (minute < 8 ? 2 : 3),
  krakenCooldown: [3.2, 5.4] as readonly [number, number],
  /** Slam damage to the player (boss-scaled) and to ships caught under it (× enemy HP scale). */
  krakenSlam: 14,
  krakenSlamEnemy: 90,
  /** Grab: reach (m), telegraph (s), hold (s), damage per 0.5 s tick (boss-scaled). */
  krakenGrabReach: 42,
  krakenGrabTelegraph: 0.9,
  krakenGrabTime: 2.2,
  krakenGrabTick: 4.5,
  krakenDoubloons: 12,

  rogueWaves: (minute: number): number => (minute < 8 ? 1 : 2),
  rogueWaveHalfWidth: 240,
  rogueWaveSpeed: 24,
  rogueWaveStart: 330,
  rogueWaveHeight: 30,
  rogueWaveDamage: 16,
  rogueWaveEnemy: 55,
  /** Forward speed gained when boosting through a wave (m/s). */
  rogueWaveSurge: 16,
  rogueWaveDoubloons: 5,

  maelstromRadius: 150,
  maelstromEye: 36,
  maelstromDuration: 30,
  /** Peak swirl and inflow speeds (m/s) near the eye; both taper to the rim. */
  maelstromSwirl: 16,
  maelstromPull: 7,
  /** Grind damage per 0.5 s in the eye: player (boss-scaled) and ships (× enemy HP scale). */
  maelstromGrind: 5,
  maelstromGrindEnemy: 40,
  /** Ships the maelstrom must swallow for its treasure. */
  maelstromGoal: (minute: number): number => Math.min(16, 8 + Math.floor(minute / 2)),
  maelstromDoubloons: 8,

  blockadeFrigates: (minute: number): number => (minute < 9 ? 3 : minute < 12 ? 4 : 5),
  blockadeDistance: 300,
  blockadeFlagshipHp: 1,
  blockadeDoubloons: 12,

  ghostGalleons: (minute: number): number => (minute < 10 ? 2 : 3),
  ghostWisps: (minute: number): number => Math.min(12, 6 + Math.floor(minute / 2)),
  ghostDoubloons: 12,

  eruptionDuration: 28,
  /** Seconds between bombs (early → late run). */
  eruptionInterval: (minute: number): number => Math.max(0.32, 0.6 - minute * 0.02),
  eruptionBombRadius: 12,
  eruptionBombDamage: 11,
  eruptionBombEnemy: 70,
  /** Share of bombs that are treasure (gold circles, harmless). */
  eruptionGoldShare: 0.22,
  eruptionDoubloons: 6,

  treasureDig: (minute: number): number => Math.min(18, 12 + Math.floor(minute / 3)),
  treasureRadius: 30,
  treasureWaveEvery: 6,
  treasureDoubloons: 10,

  bountyDoubloons: 12,
};
