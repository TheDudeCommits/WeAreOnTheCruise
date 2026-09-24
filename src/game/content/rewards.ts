import type { Rarity, StatKey } from '../ids';

/**
 * Progression and reward tables (META): card pool weights, stat chips, chests, drops, bounty and the doubloon
 * economy. Read by src/game/sim/progression.ts and src/game/sim/meta-cards.ts.
 */

/** Category weights for each card slot (a category is drawn first, then an item inside it). */
export const CARD_WEIGHTS = {
  weaponUpgrade: 34,
  newWeapon: 24,
  passiveUpgrade: 18,
  newPassive: 15,
  chip: 7,
  /** Heal card weight when hull is below `healBelow` (scaled up the lower it is). */
  heal: 12,
  healBelow: 0.55,
};

/** Item weights inside the weapon-upgrade category. */
export const ENTRY_WEIGHTS = { level: 10, branch: 13, overdrive: 18 };

/** OVERDRIVE ★ cards need the weapon at level 5 and the run at this level (boss chests ignore it). */
export const OVERDRIVE_MIN_LEVEL = 10;
/** Luck needed for a 4th card. */
export const LUCK_FOURTH_CARD = 3;
/** Every crew patches its hull a little: base regen (fraction of max hull per second) added to every ship. */
export const BASE_REGEN = 0.001;
/** Heal card strength (fraction of max hull). */
export const HEAL_CARD = 0.3;
/** Doubloon card: base + per minute. */
export const DOUBLOON_CARD = { base: 20, perMinute: 2 };

export const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
/** Base rarity weights for chips; each point of luck multiplies the non-common weights by (1 + luckScale × luck). */
export const RARITY_WEIGHTS: Readonly<Record<Rarity, number>> = { common: 62, rare: 26, epic: 10, legendary: 2 };
export const RARITY_LUCK_SCALE = 0.18;

export interface ChipDef {
  stat: StatKey;
  name: string;
  /** Amount per rarity: common, rare, epic, legendary. */
  amounts: readonly [number, number, number, number];
}

/** Stat chips: small permanent bonuses for this run. Card id is `chip-<stat>` (banishing removes the stat). */
export const CHIPS: readonly ChipDef[] = [
  { stat: 'damage', name: 'Hot Shot', amounts: [0.04, 0.07, 0.11, 0.16] },
  { stat: 'cooldown', name: 'Quick Hands', amounts: [0.03, 0.05, 0.08, 0.12] },
  { stat: 'maxHp', name: 'Oak Planks', amounts: [0.06, 0.1, 0.15, 0.22] },
  { stat: 'armor', name: 'Iron Rivets', amounts: [1, 1, 2, 3] },
  { stat: 'speed', name: 'Fair Wind', amounts: [0.04, 0.06, 0.09, 0.13] },
  { stat: 'turn', name: 'Oiled Rudder', amounts: [0.05, 0.08, 0.12, 0.18] },
  { stat: 'area', name: 'Wide Charges', amounts: [0.05, 0.08, 0.12, 0.18] },
  { stat: 'range', name: 'Spyglass', amounts: [0.05, 0.08, 0.12, 0.18] },
  { stat: 'crit', name: 'Keen Eye', amounts: [0.03, 0.05, 0.08, 0.12] },
  { stat: 'critDamage', name: 'Sharpened Shot', amounts: [0.1, 0.18, 0.28, 0.4] },
  { stat: 'pickupRadius', name: 'Long Hooks', amounts: [0.1, 0.18, 0.28, 0.4] },
  { stat: 'xpGain', name: "Ship's Log", amounts: [0.04, 0.07, 0.1, 0.15] },
  { stat: 'regen', name: 'Caulking Crew', amounts: [0.001, 0.0018, 0.0028, 0.004] },
  { stat: 'projectileSpeed', name: 'Rifled Barrels', amounts: [0.06, 0.1, 0.15, 0.22] },
  { stat: 'skillCooldown', name: "Bosun's Whistle", amounts: [0.05, 0.08, 0.12, 0.18] },
  { stat: 'duration', name: 'Slow Match', amounts: [0.05, 0.08, 0.12, 0.18] },
];

/** Chests: 1 = elite chest, 2 = boss chest (pickup `value`). */
export const CHESTS = {
  /** Elite chest reward count weights for 1, 2, 3 rewards; luck shifts weight to more rewards. */
  eliteCounts: [60, 30, 10] as readonly number[],
  eliteLuckShift: 6,
  bossCount: 3,
  /** Doubloons added on top of the rewards (a purse: exact, see ECONOMY). */
  eliteDoubloons: 3,
  bossDoubloons: 12,
  /** Chip rarity floor for chest chips. */
  chipRarity: 1,
};

/** XP coin tiers (pickup kinds). A drop worth v XP spills into gold/silver/copper pieces. */
export const COIN_TIERS = { gold: 25, silver: 5, maxPieces: 5 };

/** Rare drops on a normal kill (chance scales with the enemy's size: × (1 + xp × sizeScale)); luck adds 6% each. */
export const RARE_DROPS = {
  repair: 0.012,
  compass: 0.002,
  powderKeg: 0.0025,
  sizeScale: 0.06,
  luckScale: 0.06,
  /** Elites always drop a chest; this adds a repair chance on top. */
  eliteRepair: 0.35,
};

/** Pickup effects. */
export const PICKUP_EFFECTS = {
  repair: 0.25,
  /** Powder keg: blast radius (m), fraction of max HP dealt to normal enemies, flat bonus, boss fraction. */
  kegRadius: 240,
  kegFraction: 0.8,
  kegFlat: 150,
  kegBossFraction: 0.04,
};

/** Bounty (score) rules. */
export const BOUNTY = {
  perXp: 100,
  eliteMul: 5,
  /** Per boss kill, multiplied by heat. */
  boss: 50000,
  /** Per second survived. */
  perSecond: 25,
  victory: 250000,
};

/**
 * Doubloon economy (REPLAY round 2). Doubloons buy the harbor: 13 upgrades (17,990 ◈) and two ships (1,550 ◈).
 *
 * Two kinds of income:
 * - **Plunder**, doubloons on the water: ordinary kills (ENEMY_AI.doubloons × the enemy's drop chance), elites
 *   (eliteKill), bosses (BossDef.doubloons), bounty captains, set pieces and salvage. A coin is worth its table value
 *   × `plunder` (at least 1). The final boss's hold is plunder too, banked directly with the victory.
 * - **Purses**, banked exactly: wages per full minute, chest purses (CHESTS), the victory bonus, endless milestones.
 * Everything is then × doubloonMul (Fortune, and the heat/daily reward: × (1 + 0.25 × heat)).
 *
 * Measured at heat 0 without harbor upgrades, 3 AI captains (balance-sim ledger, 12 seeds × 2 ships):
 * a Sunward victory banks ≈ 500 ◈ (plunder ≈ 45%, chests ≈ 25%, victory ≈ 25%, wages ≈ 5%), a run lost at ~10:00
 * ≈ 150–250 ◈. Career model (scripts/economy-model.ts): with quests, the whole harbor takes ≈ 40 runs for a captain
 * who stays at heat 0, ≈ 30 for one who climbs a heat level every few wins, ≈ 25 for a fast climber.
 */
export const ECONOMY = {
  /** Wages paid at every full minute survived (purse). */
  minuteWage: 2,
  /** Doubloons an elite spills when it sinks (plunder, before `plunder`), besides its chest. */
  eliteKill: 2,
  /** Purse banked with a victory, on top of the flagship's hold. */
  victoryBonus: 40,
  /** Value of doubloons on the water relative to their table values (kills, elites, bosses, captains, set pieces). */
  plunder: 0.45,
  /** Endless mode: every boss sunk after the victory is a milestone purse of milestone × (loop + 1) ◈. */
  endlessMilestone: 40,
  /** Endless milestone bounty (× the bounty multiplier) per loop. */
  endlessMilestoneBounty: 40000,
};
