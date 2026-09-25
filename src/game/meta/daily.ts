/**
 * The daily voyage (REPLAY): one voyage per UTC day, the same for every captain — a date-keyed seed (islands and
 * sim), a fixed ship (lent for the day if it is not in your harbor yet), a fixed sea and two daily rules. Heat and
 * starting boons stay ashore; harbor upgrades sail. The best bounty per day is kept in MetaProfile.daily.
 */
import { createSeededRandom, hashString } from '../../core/rng';
import type { HeatEffect } from '../content/director';
import { SEA_IDS, SHIP_IDS, type SeaId, type ShipId } from '../ids';
import type { MetaProfile } from '../types';

export interface DailyRule {
  id: string;
  name: string;
  text: string;
  effect: HeatEffect;
  /** AI captains sailing (overrides the setting for the day). */
  captains?: number;
}

export const DAILY_RULES: readonly DailyRule[] = [
  { id: 'glass-cannon', name: 'Glass Cannon', text: 'Your guns hit 30% harder; your hull is 25% thinner.', effect: { playerDamage: 0.3, playerHull: -0.25 } },
  { id: 'iron-tide', name: 'Iron Tide', text: 'Enemy hulls +25%; experience +20%.', effect: { enemyHp: 1.25, xp: 1.2 } },
  { id: 'gold-rush', name: 'Gold Rush', text: 'Doubloons +50%; enemy fire hits 15% harder.', effect: { reward: 1.5, enemyDamage: 1.15 } },
  { id: 'elite-hunt', name: 'Elite Hunt', text: 'Elites sail twice as often, one more at a time.', effect: { eliteChance: 2, extraElites: 1 } },
  { id: 'restless-sea', name: 'Restless Sea', text: 'Set pieces come 40% sooner.', effect: { eventGap: 0.6 } },
  { id: 'swift-hulls', name: 'Swift Hulls', text: 'You sail 15% faster, and the enemy 10% faster.', effect: { playerSpeed: 0.15, enemySpeed: 1.1 } },
  { id: 'lean-holds', name: 'Lean Holds', text: 'Heals and repairs mend 40% less; doubloons +25%.', effect: { healing: 0.6, reward: 1.25 } },
  { id: 'wanted', name: 'Wanted, Dead or Alive', text: 'Two more bounty captains hunt you.', effect: { bountyCaptains: 2 } },
  { id: 'heavy-shot', name: 'Heavy Shot', text: 'Enemy fire hits 25% harder; your guns 15% harder.', effect: { enemyDamage: 1.25, playerDamage: 0.15 } },
  { id: 'lone-wolf', name: 'Lone Wolf', text: 'No AI captains sail with you; experience +15%.', effect: { xp: 1.15 }, captains: 0 },
  { id: 'wolf-pack', name: 'Wolf Pack', text: 'Four AI captains sail with you; enemy hulls +15%.', effect: { enemyHp: 1.15 }, captains: 4 },
];

export interface DailyVoyage {
  key: string;
  seed: string;
  shipId: ShipId;
  seaId: SeaId;
  rules: readonly DailyRule[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's key 'YYYY-MM-DD' (UTC, so every captain sails the same voyage). */
export function dailyKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export const DAILY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The voyage for a date key: seeded ship, sea and two rules that never contradict each other. */
export function dailyVoyage(key: string): DailyVoyage {
  const rng = createSeededRandom(hashString(`cruise-daily:${key}`));
  const shipId = SHIP_IDS[rng.integer(0, SHIP_IDS.length)]!;
  const seaId = SEA_IDS[rng.integer(0, SEA_IDS.length)]!;
  const first = DAILY_RULES[rng.integer(0, DAILY_RULES.length)]!;
  let second = first;
  for (let tries = 0; tries < 16 && (second === first || (second.captains !== undefined && first.captains !== undefined)); tries++) {
    second = DAILY_RULES[rng.integer(0, DAILY_RULES.length)]!;
  }
  return { key, seed: `daily:${key}`, shipId, seaId, rules: second === first ? [first] : [first, second] };
}

/** Best bounty sailed on a daily voyage (0 = not sailed). */
export function dailyBest(profile: Readonly<MetaProfile>, key: string): number {
  return profile.daily?.[key] ?? 0;
}

/** Days of daily bests kept in the save. */
export const DAILY_KEEP = 60;

/** Records a daily voyage's bounty; returns true when it beat the day's best. Old days beyond DAILY_KEEP drop off. */
export function recordDaily(profile: MetaProfile, key: string, bounty: number): boolean {
  const map = (profile.daily ??= {});
  const prev = map[key] ?? 0;
  const better = bounty > prev;
  if (better) map[key] = Math.floor(bounty);
  const keys = Object.keys(map).sort();
  for (let i = 0; i < keys.length - DAILY_KEEP; i++) delete map[keys[i]!];
  return better;
}

/** Days in a row (ending today or yesterday) with a daily voyage sailed. */
export function dailyStreak(profile: Readonly<MetaProfile>, today = dailyKey()): number {
  const map = profile.daily ?? {};
  let day = new Date(`${today}T00:00:00Z`);
  if (!map[today]) day = new Date(day.getTime() - 86400000);
  let n = 0;
  while (map[dailyKey(day)] !== undefined && n < DAILY_KEEP) { n++; day = new Date(day.getTime() - 86400000); }
  return n;
}
