import type { BossId, EnemyId, SeaId } from '../ids';

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
  { from: 2, entries: [E('skiff', 8, 4, 6), E('cutter', 3, 1, 2), E('brig', 1, 1, 1), E('wraith', 3, 1, 1), E('smoke-runner', 1.2, 1, 2)] },
  { from: 3, entries: [E('skiff', 7, 4, 7), E('cutter', 3, 1, 2), E('brig', 2, 1, 1), E('corsair-brig', 2, 1, 1), E('fireship', 1, 1, 2), E('wraith', 3, 1, 2),
    E('smoke-runner', 1.5, 1, 2), E('signal-cutter', 0.8, 1, 1), E('lantern-wisp', 2, 4, 5)] },
  { from: 4, entries: [E('skiff', 7, 5, 7), E('cutter', 3, 2, 3), E('brig', 3, 1, 2), E('corsair-brig', 3, 1, 2), E('fireship', 2, 1, 3), E('mortar-barge', 1, 1, 1), E('wraith', 4, 1, 2),
    E('smoke-runner', 1.5, 1, 2), E('signal-cutter', 1, 1, 1), E('harpooner', 1.2, 1, 1), E('bomb-ketch', 0.8, 1, 1), E('lantern-wisp', 2.5, 4, 6)] },
  { from: 6, entries: [E('skiff', 6, 5, 8), E('cutter', 3, 2, 3), E('brig', 3, 1, 2), E('corsair-brig', 3, 1, 2), E('fireship', 2, 2, 3), E('mortar-barge', 2, 1, 2), E('frigate', 3, 2, 3), E('wyrmling', 3, 2, 3), E('wraith', 4, 2, 3),
    E('smoke-runner', 1.5, 1, 2), E('signal-cutter', 1.2, 1, 1), E('harpooner', 1.5, 1, 2), E('bomb-ketch', 1.2, 1, 1), E('ironclad', 1.2, 1, 1), E('lantern-wisp', 3, 5, 6)] },
  { from: 7, entries: [E('skiff', 6, 5, 8), E('cutter', 2, 2, 3), E('brig', 3, 1, 2), E('corsair-brig', 3, 1, 3), E('fireship', 2, 2, 3), E('mortar-barge', 2, 1, 2), E('frigate', 3, 2, 3), E('corsair-galleon', 2, 1, 1), E('wyrmling', 3, 2, 4), E('wraith', 4, 2, 3),
    E('smoke-runner', 1.5, 1, 2), E('signal-cutter', 1.2, 1, 1), E('harpooner', 1.5, 1, 2), E('bomb-ketch', 1.2, 1, 2), E('ironclad', 1.5, 1, 1), E('lantern-wisp', 3, 5, 7)] },
  { from: 9, entries: [E('skiff', 6, 6, 9), E('cutter', 2, 2, 4), E('brig', 3, 2, 2), E('corsair-brig', 3, 2, 3), E('fireship', 3, 2, 4), E('mortar-barge', 2, 1, 2), E('frigate', 3, 2, 3), E('corsair-galleon', 2, 1, 2), E('man-o-war', 1, 1, 1), E('wyrmling', 3, 2, 4), E('wraith', 5, 2, 3),
    E('smoke-runner', 1.5, 2, 3), E('signal-cutter', 1.2, 1, 2), E('harpooner', 1.5, 1, 2), E('bomb-ketch', 1.5, 1, 2), E('ironclad', 1.5, 1, 2), E('lantern-wisp', 3, 5, 7), E('drowned-galleon', 1.2, 1, 1)] },
  { from: 11, entries: [E('skiff', 7, 7, 10), E('cutter', 2, 3, 4), E('brig', 3, 2, 3), E('corsair-brig', 3, 2, 3), E('fireship', 3, 3, 4), E('mortar-barge', 3, 1, 2), E('frigate', 4, 2, 3), E('corsair-galleon', 3, 1, 2), E('man-o-war', 2, 1, 1), E('wyrmling', 4, 3, 4), E('wraith', 5, 2, 4),
    E('smoke-runner', 1.5, 2, 3), E('signal-cutter', 1.2, 1, 2), E('harpooner', 1.8, 1, 2), E('bomb-ketch', 1.5, 1, 2), E('ironclad', 1.8, 1, 2), E('lantern-wisp', 3, 6, 8), E('drowned-galleon', 1.5, 1, 1)] },
  { from: 13, entries: [E('skiff', 7, 8, 11), E('cutter', 2, 3, 5), E('brig', 3, 2, 3), E('corsair-brig', 3, 2, 4), E('fireship', 3, 3, 5), E('mortar-barge', 3, 2, 3), E('frigate', 4, 3, 3), E('corsair-galleon', 3, 1, 2), E('man-o-war', 2, 1, 2), E('wyrmling', 4, 3, 5), E('wraith', 5, 3, 4),
    E('smoke-runner', 1.5, 2, 3), E('signal-cutter', 1.5, 1, 2), E('harpooner', 1.8, 1, 2), E('bomb-ketch', 1.8, 1, 2), E('ironclad', 1.8, 1, 2), E('lantern-wisp', 3, 6, 8), E('drowned-galleon', 1.8, 1, 2)] },
];

/**
 * Per-boss HP multipliers on top of content/bosses.ts (see DIRECTOR.bossHpScale). PACE round 1 set 2.1 / 2.4 / 1.8;
 * REPLAY round 2 eased the Tidewyrm and the Sovereign (2.25 / 1.6): the flagship had become a DPS wall that
 * lower-level Dawn Rams sailed around for minutes, and the fights now land in 45–120 s on every sea.
 * DIFFICULTY round 3 (bosses at 3:00 / 6:00 / 15:00 with rematches, content/world.ts): 2.1 / 2.25 / 1.6 → 1.3 / 1.25 / 3
 * — the Warden and the Tidewyrm meet a smaller ship two and four minutes earlier; the Sovereign meets the builds that
 * survived a harder run (they sank a 1.6 flagship in ~20 s). Fights still average 50–105 s (balance-sim).
 */
export const BOSS_HP_MUL: Readonly<Record<BossId, number>> = { 'iron-warden': 1.3, tidewyrm: 1.25, sovereign: 3 };

/**
 * What one heat rule or daily-voyage rule changes (REPLAY). Multipliers (enemyHp, enemyDamage, enemySpeed, bossHp,
 * eliteChance, eventGap, drops, healing, reward, xp) stack by multiplication; counts and player bonuses
 * (extraElites, bountyCaptains, playerDamage, playerHull, playerSpeed) add up. See src/game/sim/run-mods.ts.
 */
export interface HeatEffect {
  enemyHp?: number;
  enemyDamage?: number;
  enemySpeed?: number;
  bossHp?: number;
  eliteChance?: number;
  extraElites?: number;
  eliteHp?: number;
  /** Caps on chest rewards (the lowest cap in force wins). */
  eliteChestCap?: number;
  bossChestCap?: number;
  eventGap?: number;
  bountyCaptains?: number;
  drops?: number;
  healing?: number;
  reward?: number;
  playerDamage?: number;
  playerHull?: number;
  playerSpeed?: number;
  xp?: number;
}

export interface HeatRule { level: number; name: string; text: string; effect: HeatEffect }

/**
 * Per-sea balance on top of the difficulty curves (REPLAY round 2). Difficulty scales everything together; these
 * rows set what it cannot: with AI captains sailing (the default), Stormwrack's storms were easier to survive than
 * the Gloam's night broadsides by far more than their difficulties say. Tuned with
 * `npx tsx scripts/balance-sim.ts --seeds 8 --minutes 18 --proxy off --captains 3` (and checked with --captains 0).
 * DIFFICULTY round 3 (the shared curves got much steeper): Sunward hull 1 → 1.1 and fire 1.26 → 1.12, Stormwrack fire
 * 1.3 → 0.98 and bosses 0.85 → 0.8, the Gloam fire 1.12 → 1 and bosses 0.65 → 0.6. Measured with 24 seeds × 2 ships:
 * deaths 44% / 60% / 71% (targets 35–50 / 50–65 / 60–75).
 */
export const SEA_BALANCE: Readonly<Record<SeaId, { enemyHp: number; enemyDamage: number; bossHp: number }>> = {
  // Round 1 with 3 captains: 1/16 deaths here, 2/16 on Stormwrack, 9/16 in the Gloam (8 seeds × 2 ships).
  'sunward-shallows': { enemyHp: 1.1, enemyDamage: 1.12, bossHp: 1 },
  'stormwrack-reach': { enemyHp: 1, enemyDamage: 0.98, bossHp: 0.8 },
  // The Gloam's deaths came from long boss fights at night, not from its fleet: bosses lighter, fleet a little harder.
  'the-gloam': { enemyHp: 1, enemyDamage: 1, bossHp: 0.6 },
};

/**
 * Heat 1–8 (REPLAY): a per-sea difficulty ladder. Heat N+1 opens by winning at heat N on that sea (heat 1 opens on
 * every sea with the first victory). Every level adds hpPerLevel enemy hull and damagePerLevel enemy damage, and each
 * level brings one named rule; all rules up to the chosen level apply. Doubloons and bounty pay × (1 + reward × heat).
 * Rules that add ships which carry chests (elites, bounty captains) also thin those chests, or the extra loot would
 * make the higher level easier than the one below it (measured: heat 4 was safer than heat 2 before the caps).
 */
export const HEAT = {
  max: 8,
  reward: 0.25,
  hpPerLevel: 0.05,
  damagePerLevel: 0.03,
  rules: [
    { level: 1, name: 'Hardened Hulls', text: 'Enemy hulls +10%.', effect: { enemyHp: 1.1 } },
    { level: 2, name: 'Keen Gunners', text: 'Enemy fire hits 10% harder.', effect: { enemyDamage: 1.1 } },
    { level: 3, name: 'Elite Muster', text: 'Elites sail 50% more often, one more at a time, with 30% more hull; their chests hold one reward.', effect: { eliteChance: 1.5, extraElites: 1, eliteHp: 1.3, eliteChestCap: 1 } },
    { level: 4, name: 'Following Wind', text: 'Enemy ships sail 7% faster.', effect: { enemySpeed: 1.07 } },
    { level: 5, name: 'Restless Sea', text: 'Set pieces come 30% sooner.', effect: { eventGap: 0.7 } },
    { level: 6, name: 'Wanted Men', text: "Two more bounty captains hunt you; captain's and boss chests hold two rewards.", effect: { bountyCaptains: 2, bossChestCap: 2 } },
    { level: 7, name: 'Lean Holds', text: 'Ordinary kills drop 30% fewer repairs and doubloons; heals mend 25% less.', effect: { drops: 0.7, healing: 0.75 } },
    { level: 8, name: "Admiralty's Wrath", text: 'Bosses +20% hull; enemy hulls +10% and fire +10% on top.', effect: { bossHp: 1.2, enemyHp: 1.1, enemyDamage: 1.1 } },
  ] as readonly HeatRule[],
};

/** The heat rules in force at `level` (every rule up to it). */
export function heatRules(level: number): readonly HeatRule[] {
  return HEAT.rules.filter((r) => r.level <= level);
}

export const DIRECTOR = {
  /**
   * Spawn points per second at difficulty 1 (1 point = 1 xp of enemies). PACE round 1: ~+40% (was 0.42 + 0.14m +
   * 0.014m²). The floor (minAlive) now sets most of the horde; the budget adds ships on top while the player is not
   * keeping up, so a struggling captain meets a bigger fleet (up to SOFT_ENEMY_CAP), not an empty sea.
   */
  budgetRate: (minute: number): number => 0.6 + 0.16 * minute + 0.014 * minute * minute,
  /** Exponent applied to the sea difficulty for the budget (density grows slower than difficulty). */
  budgetDifficultyExp: 0.7,
  /**
   * Experience per ship falls with sea difficulty^xpDifficultyExp (harder seas field more ships, not more levels).
   * PACE: the floor, which harder seas do not raise, now sets most of the horde, so this is gentler than the budget's.
   * REPLAY round 2: 0.35 → 0.2, the Gloam's ships were no more numerous but paid 14% less, so it levelled a band
   * behind (late gaps past PACE's 60 s) and its bosses turned into sieges.
   */
  xpDifficultyExp: 0.2,
  /**
   * Experience per ordinary kill over the run (DIFFICULTY round 3): full value for the first minutes (the quick
   * level-ups stay), then gently less, so a build that already erases the horde does not snowball ever faster.
   */
  xpScale: (minute: number): number => 1 / (1 + 0.025 * Math.max(0, minute - 1.5)),
  /**
   * Live-enemy floor: below it the director spawns immediately without spending budget. PACE: a pack of skiffs is
   * on its way from the first second (7 at 0:00; first contact ~6–8 s), then 30 at 5:00, 60 at 10:00 and 76 from
   * ~12:00, held even against a fast killer (see debt), so the sea is never empty (was min(78, 3 + 3.2m + 0.22m²)).
   */
  minAlive: (minute: number): number => Math.min(76, 7 + 3.8 * minute + 0.15 * minute * minute),
  /** Unspent budget is capped so a quiet spell never turns into one giant burst. */
  bankMax: 40,
  /**
   * Floor spawns may run the budget into debt down to −debt(minute). PACE: was 12 + 2.5m, which left a fast killer
   * sailing an empty sea; now practically bottomless, so the floor always holds and the steep xpToNext tail keeps a
   * fast killer's levels in check instead.
   */
  debt: (minute: number): number => 400 + 1500 * minute,
  /**
   * Loot per ship (× the doubloon, repair, compass and powder-keg drop chances of an ordinary kill): the bigger horde
   * must not triple the healing or the doubloon income (elites, bosses, convoys and wages are unaffected).
   */
  dropScale: (minute: number): number => 1 / (1 + 0.3 * Math.max(0, minute - 1)),
  /**
   * Probability that a spawned enemy is elite, and elites afloat at once. DIFFICULTY round 3: more elites later
   * (was min(0.07, 0.006 + 0.0038m), cap 3; now 10% from ~19 min, 4 from 6:00, 5 from 12:00). Not more than this:
   * every elite carries a chest, and a round with 14% elites snowballed the player's build past the fleet.
   */
  eliteChance: (minute: number): number => (minute < 1.5 ? 0 : Math.min(0.1, 0.006 + 0.005 * minute)),
  maxElites: (minute: number): number => 3 + Math.floor(minute / 6),
  /** Heat: difficulty × time curve. Drives enemy HP, damage and speed. */
  heat: (minute: number, difficulty: number): number => difficulty * (1 + 0.08 * minute + 0.003 * minute * minute),
  /**
   * Enemy HP multiplier: grows with time; sea difficulty counts at half strength (harder seas also bring more
   * ships, more fire and nastier weather, so HP does not need to carry all of it). DIFFICULTY round 3: was
   * 1 + 0.13m + 0.006m² (×1.8 at 5:00, ×2.9 at 10:00, ×4.3 at 15:00); now ×2.1 / ×3.7 / ×5.7, so ships live long
   * enough to shoot back at a level-20 build and the kill rate (and the XP it pays) no longer runs away.
   */
  hpScale: (minute: number, difficulty: number): number => (1 + 0.18 * minute + 0.009 * minute * minute) * (1 + (difficulty - 1) * 0.35),
  /**
   * Enemy damage multiplier (time and difficulty), capped. DIFFICULTY round 3: was min(2.6, 1 + 0.045m + 0.0035m²)
   * (×1.31 at 5:00, ×1.8 at 10:00); now ×1.6 / ×2.2, capped at 2.9 from ~16 min. A flatter, earlier curve: a
   * steeper one piled every death into a 6–9 min wall.
   */
  damageScale: (minute: number, difficulty: number): number =>
    Math.min(2.9, (1 + 0.12 * minute) * (1 + (difficulty - 1) * 0.2)),
  /**
   * Green crews: early enemy gunnery is forgiving and hardens over the first minutes (multipliers on lead, spread
   * and reload time), so the opening is about learning to sail, not about dodging perfect volleys. DIFFICULTY
   * round 3: the grace is milder (0.4 lead / ×1.4 spread / ×1.3 reload at 0:00, were 0.3 / 1.5 / 1.4) and over by
   * 5:00 (was 10:00).
   */
  graceLead: (minute: number): number => 0.4 + 0.6 * Math.min(1, minute / 5),
  graceSpread: (minute: number): number => 1.4 - 0.4 * Math.min(1, minute / 5),
  graceReload: (minute: number): number => 1.3 - 0.3 * Math.min(1, minute / 5),
  /**
   * Fire control: the whole enemy fleet shares a budget of volleys per second (tokens). The horde can be huge
   * for spectacle while incoming fire stays a designed curve. Bosses are exempt (their attacks are telegraphed).
   * The budget binds from ~5:00 on Sunward and ~2:00 in the Gloam (the bank sits near empty), so this is the dial
   * for mid/late incoming fire. DIFFICULTY round 3: 0.1 + 0.03m → 0.2 + 0.032m (+56% at 5:00, +38% at 10:00).
   */
  fireRate: (minute: number): number => 0.2 + 0.032 * minute,
  /** Fire-control rate multiplier from sea difficulty. */
  fireDifficultyExp: 0.3,
  fireBank: 3,
  /** Enemy sailing speed multiplier (PACE: +12% at every minute, so the horde closes in and keeps up). */
  speedScale: (minute: number): number => 1.12 + Math.min(0.25, 0.0064 * minute + 0.00024 * minute * minute),
  /**
   * Boss HP multiplier for the sea difficulty, the endless loop (0 = first pass) and the boss (BOSS_HP_MUL: the
   * faster level curve meets each boss with a stronger ship, so fights still last 45–120 s).
   */
  bossHpScale: (difficulty: number, loop: number, boss?: BossId): number =>
    (1 + (difficulty - 1) * 0.4) * (1 + loop * 0.75) * (boss ? BOSS_HP_MUL[boss] : 1),
  eliteHp: 3.5,
  eliteDamage: 1.25,
  eliteXp: 4,
  /**
   * Budget and floor multipliers while a boss is alive. DIFFICULTY round 3: a boss fight is no breather any more
   * (was 0.35 / 0.3 for 60 s, full again after 120 s; now 0.6 / 0.55 for 20 s, full after 40 s): the fleet keeps
   * pressing while the boss telegraphs.
   */
  bossBudgetMul: 0.6,
  bossFloorMul: 0.55,
  /** Seconds of calm at the start of a boss fight; spawns ramp back to normal over the same span after it. */
  bossCalm: 20,
  /** Budget/floor multiplier during the boss warning countdown (was 0.5, then 0.8; round 3: the fleet keeps coming). */
  warningBudgetMul: 1,
  /** Seconds of boss warning before the spawn (was 10). */
  warningLead: 7,
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
    id: 'volcanic-eruption', name: 'Volcanic Eruption', text: 'Fire from the deep! Dodge the red circles; the gold ones rain treasure.',
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
  /** Weight multiplier for running the same set piece twice in a row. */
  repeatWeight: 0.2,
  /** Rewards: XP spilled on success (minute-scaled), bounty per success (× heat). */
  rewardXp: (minute: number): number => 6 + 2.5 * minute,
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
  krakenDoubloons: 8,

  rogueWaves: (minute: number): number => (minute < 8 ? 1 : 2),
  rogueWaveHalfWidth: 240,
  rogueWaveSpeed: 24,
  rogueWaveStart: 330,
  rogueWaveHeight: 21,
  rogueWaveDamage: 16,
  rogueWaveEnemy: 55,
  /** Forward speed gained when boosting through a wave (m/s). */
  rogueWaveSurge: 16,
  rogueWaveDoubloons: 3,

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
  maelstromDoubloons: 5,

  blockadeFrigates: (minute: number): number => (minute < 9 ? 3 : minute < 12 ? 4 : 5),
  blockadeDistance: 300,
  blockadeFlagshipHp: 1,
  blockadeDoubloons: 8,

  ghostGalleons: (minute: number): number => (minute < 10 ? 2 : 3),
  ghostWisps: (minute: number): number => Math.min(12, 6 + Math.floor(minute / 2)),
  ghostDoubloons: 8,

  eruptionDuration: 28,
  /** Seconds between bombs (early → late run). */
  eruptionInterval: (minute: number): number => Math.max(0.32, 0.6 - minute * 0.02),
  eruptionBombRadius: 12,
  eruptionBombDamage: 11,
  eruptionBombEnemy: 70,
  /** Share of bombs that are treasure (gold circles, harmless). */
  eruptionGoldShare: 0.16,
  eruptionDoubloons: 4,

  treasureDig: (minute: number): number => Math.min(18, 12 + Math.floor(minute / 3)),
  treasureRadius: 30,
  treasureWaveEvery: 6,
  treasureDoubloons: 7,

  bountyDoubloons: 6,

  // Points of interest (between set pieces).
  /** Seconds into the run (after the first sim tick) before the first trade wind / salvage. */
  poiFirst: 90,
  tradeWindEvery: [80, 120] as readonly [number, number],
  tradeWindTtl: 55,
  /** Current speed (m/s), patches per lane and their radius (m). */
  tradeWindSpeed: 8,
  tradeWindPatches: 5,
  tradeWindRadius: 34,
  /** Sailing with the current: extra acceleration (m/s²) up to this multiple of top speed. */
  tradeWindAccel: 5,
  tradeWindCap: 1.35,
  salvageEvery: [55, 85] as readonly [number, number],
  salvageTtl: 50,
  salvageRadius: 14,
  salvageXp: (minute: number): number => 4 + 1.5 * minute,
  salvageRepair: 0.12,
  /** Lighthouse beacons: reach (m) from the ship, ring radius, lifetime, blessing length, fire-rate and shield. */
  beaconReach: 650,
  beaconRadius: 22,
  beaconTtl: 120,
  beaconBuff: 15,
  beaconFireRate: 1.3,
  beaconShield: 0.1,
};
