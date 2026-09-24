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
  hpScale: (minute: number, difficulty: number): number => (1 + 0.088 * minute + 0.0033 * minute * minute) * (1 + (difficulty - 1) * 0.5),
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
  fireRate: (minute: number): number => 0.06 + 0.017 * minute,
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
  fortInterval: 38,
  fortMax: 2,
  fortSearchMin: 170,
  fortSearchMax: 420,
  /** Seconds between boss loops in endless mode (after the final boss). */
  endlessBossGap: 300,
};

export type DirectorEventId = 'ambush-ring' | 'fire-ship-rush' | 'mortar-line' | 'treasure-convoy' | 'storm-front' | 'fog-bank';

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
}

export const DIRECTOR_EVENTS: Readonly<Record<DirectorEventId, DirectorEventDef>> = {
  'ambush-ring': { id: 'ambush-ring', name: 'Ambush Ring', text: 'Ambush! Raider skiffs close in from every side.', from: 1.5, weight: 5, maxPerRun: 6, duration: 12 },
  'fire-ship-rush': { id: 'fire-ship-rush', name: 'Fire Ship Rush', text: 'Fire ships on the wind! Turn broadside or turn tail.', from: 3.5, weight: 4, maxPerRun: 4, duration: 14 },
  'mortar-line': { id: 'mortar-line', name: 'Mortar Line', text: 'A mortar line has your range. Watch the water for red circles.', from: 5.5, weight: 3, maxPerRun: 3, duration: 20 },
  'treasure-convoy': { id: 'treasure-convoy', name: 'Treasure Convoy', text: 'A treasure convoy is fleeing. Catch it before it slips away!', from: 2.5, weight: 3, maxPerRun: 2, duration: 45 },
  'storm-front': { id: 'storm-front', name: 'Storm Front', text: 'A storm front rolls in: rogue waves and lightning!', from: 3.5, weight: 5, maxPerRun: 4, duration: 22 },
  'fog-bank': { id: 'fog-bank', name: 'Fog Bank', text: 'A fog bank swallows the horizon. Something sails inside it.', from: 1, weight: 6, maxPerRun: 5, duration: 30 },
};

export interface SeaEventPlan {
  /** Seconds before the first event. */
  first: number;
  /** Seconds between events (min, max). */
  gap: readonly [number, number];
  events: readonly DirectorEventId[];
}

export const SEA_EVENTS: Readonly<Record<SeaId, SeaEventPlan>> = {
  'sunward-shallows': { first: 95, gap: [60, 90], events: ['ambush-ring', 'fire-ship-rush', 'mortar-line', 'treasure-convoy'] },
  'stormwrack-reach': { first: 80, gap: [50, 80], events: ['ambush-ring', 'fire-ship-rush', 'mortar-line', 'treasure-convoy', 'storm-front'] },
  'the-gloam': { first: 75, gap: [50, 80], events: ['ambush-ring', 'fire-ship-rush', 'treasure-convoy', 'fog-bank', 'mortar-line'] },
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
};
