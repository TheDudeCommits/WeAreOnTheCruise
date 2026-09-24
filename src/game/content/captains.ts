/**
 * AI captains (CAPTAINS-owned content): who sails with the player when no live captains are online, how strong they
 * are, and what they shout. Every name here is original to the Brightwater; none may reference the source franchise.
 * Tuned with `npx tsx scripts/balance-sim.ts --captains N`.
 */
import type { ShipId } from '../ids';

export interface CaptainPersona {
  /** Display name used everywhere (roster, kill feed, nameplate): "Mira Vale". */
  name: string;
  /** Title shown in front of the name on nameplates ("Captain", "Old"...), may be empty. */
  title: string;
  /** Short name for callouts ("Mira: Covering your stern!"). */
  short: string;
}

/** Original captains. Drawn without repeats per run (seeded). */
export const CAPTAIN_PERSONAS: readonly CaptainPersona[] = [
  { name: 'Mira Vale', title: 'Captain', short: 'Mira' },
  { name: 'Tomas Reed', title: 'Old', short: 'Tomas' },
  { name: 'Isolde Marr', title: 'Captain', short: 'Isolde' },
  { name: 'Kade Harrow', title: 'Bosun', short: 'Kade' },
  { name: 'Wren Calloway', title: 'Captain', short: 'Wren' },
  { name: 'Brannoc Salt-Eye', title: '', short: 'Brannoc' },
  { name: 'Juno Ashgrove', title: 'Captain', short: 'Juno' },
  { name: 'Hollis Pike', title: 'Red', short: 'Hollis' },
  { name: 'Oriel Stroud', title: 'Captain', short: 'Oriel' },
  { name: 'Maren Tull', title: 'Grey', short: 'Maren' },
  { name: 'Dace Whitlow', title: 'Captain', short: 'Dace' },
  { name: 'Ada Quill', title: 'Captain', short: 'Ada' },
];

export function personaByName(name: string): CaptainPersona | undefined {
  for (const p of CAPTAIN_PERSONAS) if (p.name === name) return p;
  return undefined;
}

/** Pennant / roster colour per captain slot (distinct from the enemy factions' red, white and wraith teal). */
export const CAPTAIN_COLORS: readonly number[] = [0x62e36f, 0x4fa3ff, 0xb56bff, 0xff7ab8];

/** Hero ships captains may sail; the player's own ship is avoided while others are free. */
export const CAPTAIN_SHIPS: readonly ShipId[] = ['dawn-ram', 'sunlion', 'yellowfin', 'grand-galley', 'seawarden', 'white-leviathan'];

export const CAPTAIN = {
  /** Most captains a sea holds (Settings.captains is clamped to this). */
  max: 4,
  /** Settings default when the save has no value. */
  defaultCount: 3,
  /** Seconds into the run when each captain sails in (by slot). */
  joinAt: [2.5, 5, 7.5, 10] as readonly number[],
  /** Join distance from the player (m): close enough to see them arrive. */
  joinRange: [150, 210] as readonly [number, number],
  /** Seconds a sunk captain waits before sailing back in, and the spawn protection after it. */
  respawn: 25,
  respawnGrace: 2.5,
  /** Hull: ship hp × hpMul × (1 + hpPerLevel × (level − 1)); armour: ship armour + level × armorPerLevel. */
  hpMul: 1.05,
  hpPerLevel: 0.055,
  armorPerLevel: 0.06,
  /** Regeneration (fraction of max hull per second): always, when out of the fight, and while falling back. */
  regen: 0.002,
  regenCalm: 0.008,
  regenRetreat: 0.014,
  /** Seconds without a hit before the calm regeneration starts. */
  calmAfter: 6,
  /** Level = 1 + minutes × levelPerMinute + kills × levelPerKill (captains keep pace with a player of their age). */
  levelPerMinute: 1.2,
  levelPerKill: 0.02,
  maxLevel: 40,
  /** Gun damage: base × damageMul × (1 + damagePerLevel × (level − 1)). Bosses take bossDamageMul (their fight is yours). */
  damageMul: 0.8,
  damagePerLevel: 0.06,
  bossDamageMul: 0.25,
  critChance: 0.05,
  critMul: 1.5,
  broadside: { damage: 14, cooldown: 2.6, range: 150, rangePerLevel: 1.2, speed: 95, arcDeg: 40, ripple: 0.05, gunsPerLevels: 7, maxGuns: 8 },
  chaser: { level: 6, damage: 30, cooldown: 2.4, range: 230, speed: 150, coneDeg: 25 },
  mortar: { level: 12, damage: 28, cooldown: 4, range: 250, minRange: 90, area: 16, flightMin: 1.2, flightMax: 3, twinLevel: 20 },
  /** Enemies within this of the player are fair game (fights stay shared); beyond it captains close back in. */
  engageRadius: 300,
  /** Beyond `leash` from the player a captain sails back at full speed; beyond `recall` it re-enters on the ring. */
  leash: 330,
  recall: 700,
  /** Escort station around the player when nothing is in reach: distance (m) and angles off the player's stern. */
  escortRange: [95, 135] as readonly [number, number],
  escortAngles: [2.35, -2.35, 1.6, -1.6] as readonly number[],
  /** Hull fraction that sends a captain back to patch up, and the fraction that ends the retreat. */
  retreatBelow: 0.25,
  recoverAbove: 0.55,
  retreatMax: 14,
  /** Handling multipliers on the ship's table values. */
  speedMul: 0.96,
  turnMul: 1.1,
  catchUp: 1.25,
  /** Director: extra spawn budget per captain afloat (the sea fills up for the extra hunters). */
  budgetPerCaptain: 0.3,
  /**
   * Fleet fire control: extra volley tokens per captain afloat (the enemy fleet shares one volley budget; without this
   * the captains would soak up fire the player no longer takes, and runs would get easier).
   */
  firePerCaptain: 0.42,
  /**
   * Aggro: enemies pick the nearest friendly by `distance × weight` and hold it for `hold` seconds. The player's
   * weight < 1 keeps roughly half of the fleet on the player; `load` penalises captains already drawing a crowd.
   */
  aggro: { playerWeight: 0.85, hold: [4, 6] as readonly [number, number], load: 1.2, loadShare: 0.2, retreatWeight: 1.5 },
  /** Contact with enemy hulls (fraction of a ram's crush the enemy takes; knock-off metres). */
  contactCrush: 0.4,
  contactBounce: 7,
  /** Seconds between 'damage' events per captain (hits are summed so the numbers stay readable). */
  damageTick: 0.3,
  /**
   * XP value of the treasure a captain's kill spills (the rest is the captain's own salvage): the player can scoop it,
   * but the level pace stays near a run without captains.
   */
  salvageXp: 0.6,
  /** Share of the player's per-second bounty a captain earns while afloat. */
  bountyPerSecond: 0.8,
} as const;

/** Short radio lines (UI callouts). `{s}` is not used: lines are spoken by the captain named in front. */
export const CAPTAIN_LINES = {
  join: ['Sails up — I\'m with you!', 'Running out the guns!', 'Formed up on your flank!', 'Fair winds, let\'s hunt!'],
  kill: ['Scratch one!', 'That one\'s going down!', 'Another for the deep!', 'Covering your stern!', 'Got \'em!'],
  retreat: ['Taking water — falling back!', 'Patching the hull, cover me!', 'Hull\'s holed, pulling out!'],
  respawn: ['Back in the fight!', 'New hull, same captain!', 'Sailing back in!'],
  sunk: ['Abandon ship!', 'She\'s going under!'],
  boss: ['Big one on the horizon — stay close!', 'All guns on the flagship!'],
  playerLow: ['Hold on, we\'ve got you!', 'Pull back, we\'ll cover you!'],
  elite: ['Elite off the bow — watch it!', 'That one\'s trouble, mind the guns!'],
} as const;
