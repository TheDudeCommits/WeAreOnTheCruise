/**
 * Stat helpers shared by CORE and META (contract; lead-owned).
 * Stats hold summed bonuses; these helpers turn them into effective values so every system agrees.
 */
import type { StatKey } from '../ids';
import type { Stats } from '../types';

export const STAT_KEYS: readonly StatKey[] = [
  'maxHp', 'armor', 'regen', 'speed', 'turn', 'damage', 'cooldown', 'area', 'range', 'projectileSpeed', 'duration',
  'amount', 'crit', 'critDamage', 'pickupRadius', 'xpGain', 'luck', 'skillCooldown', 'ramDamage', 'doubloonGain', 'revives',
  'accel', 'fullSail', 'carve', 'helm', 'surge', 'boostDuration', 'boostCooldown', 'boostCharges',
];

export function emptyStats(): Stats {
  const stats = {} as Stats;
  for (const key of STAT_KEYS) stats[key] = 0;
  return stats;
}

export function addStats(target: Stats, bonus: Readonly<Partial<Stats>>, times = 1): Stats {
  for (const key of STAT_KEYS) {
    const value = bonus[key];
    if (value) target[key] += value * times;
  }
  return target;
}

export const BASE_CRIT_CHANCE = 0.05;
export const BASE_CRIT_MULTIPLIER = 1.5;

export const damageMul = (s: Stats) => 1 + s.damage;
/** Cooldown multiplier (reductions cap at 70%). */
export const cooldownMul = (s: Stats) => 1 - Math.min(0.7, s.cooldown);
export const skillCooldownMul = (s: Stats) => 1 - Math.min(0.7, s.skillCooldown);
export const areaMul = (s: Stats) => 1 + s.area;
export const rangeMul = (s: Stats) => 1 + s.range;
export const projectileSpeedMul = (s: Stats) => 1 + s.projectileSpeed;
export const durationMul = (s: Stats) => 1 + s.duration;
export const extraAmount = (s: Stats) => Math.floor(s.amount + 1e-6);
export const critChance = (s: Stats) => Math.min(0.95, BASE_CRIT_CHANCE + s.crit);
export const critMultiplier = (s: Stats) => BASE_CRIT_MULTIPLIER + s.critDamage;
/** Top speed multiplier; bonuses past +50% count half (stacked speed builds stay steerable). */
export const speedMul = (s: Stats) => 1 + (s.speed <= 0.5 ? s.speed : 0.5 + (s.speed - 0.5) * 0.5);
export const turnMul = (s: Stats) => 1 + s.turn;
export const pickupMul = (s: Stats) => 1 + s.pickupRadius;
export const xpMul = (s: Stats) => 1 + s.xpGain;
export const ramMul = (s: Stats) => 1 + s.ramDamage;
export const doubloonMul = (s: Stats) => 1 + s.doubloonGain;
/** Acceleration multiplier (Clipper Rigging, Copper Sheathing). */
export const accelMul = (s: Stats) => 1 + s.accel;
/** Extra top speed while the sails are set past half (Clipper Rigging), scaled by the trim 0.55 → 1. */
export const fullSailMul = (s: Stats, throttle: number) => 1 + s.fullSail * Math.min(1, Math.max(0, (throttle - 0.55) / 0.45));
/** Fraction of the speed a hard turn costs that the keel keeps (Racing Keel), capped at 80%. */
export const carveOf = (s: Stats) => Math.min(0.8, Math.max(0, s.carve));
/** Rudder and yaw response multiplier (Rudder Chains). */
export const helmMul = (s: Stats) => 1 + s.helm;
/** Boost duration multiplier and recharge multiplier (reductions cap at 60%, on top of skill cooldowns). */
export const boostDurationMul = (s: Stats) => 1 + s.boostDuration;
export const boostCooldownMul = (s: Stats) => 1 - Math.min(0.6, s.boostCooldown);
/** Boost charges the ship can store (1 + whole extra charges). */
export const boostChargesOf = (s: Stats) => 1 + Math.max(0, Math.floor(s.boostCharges + 1e-6));

/** Rolls a crit with the player's stats; returns the multiplier (1 when not critical). */
export function rollCrit(s: Stats, random: () => number): { crit: boolean; multiplier: number } {
  const crit = random() < critChance(s);
  return { crit, multiplier: crit ? critMultiplier(s) : 1 };
}
