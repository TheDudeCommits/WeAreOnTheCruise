/**
 * Per-run modifiers (REPLAY): the sea's balance row, the heat level and the daily voyage's rules folded into one
 * table of multipliers, set once at run start (src/game/meta/voyage.ts → configureRunMods) and read by the spawn
 * scaling (meta-spawn.ts), enemy speed (ai.ts), the director and progression. Keyed by the RunState in a WeakMap like
 * meta-runtime, so every Sim gets its own store; a Sim nobody configured gets its sea's defaults at heat 0.
 */
import { HEAT, SEA_BALANCE, heatRules, type HeatEffect } from '../content/director';
import type { RunState } from '../types';

export interface RunMods {
  /** Heat level 0–8 (0 = none). */
  heat: number;
  /** Daily voyage key 'YYYY-MM-DD', or '' for an ordinary voyage. */
  daily: string;
  /** Enemy hull, attack damage and sailing speed multipliers. */
  enemyHp: number;
  enemyDamage: number;
  enemySpeed: number;
  /** Boss hull multiplier (on top of DIRECTOR.bossHpScale). */
  bossHp: number;
  /** Elite chance multiplier and extra elites allowed at once. */
  eliteChance: number;
  extraElites: number;
  /** Multiplier on the seconds between set pieces (< 1 = more often). */
  eventGap: number;
  /** Seconds the first bounty captain arrives early / extra bounty captains per run (0 = FOES's schedule only). */
  bountyCaptains: number;
  /** Multiplier on repair, compass, keg and doubloon drop chances from ordinary kills. */
  drops: number;
  /** Multiplier on heal cards and repair crates. */
  healing: number;
  /** Doubloons and bounty multiplier (1 + 0.25 × heat, × daily rules). */
  reward: number;
  /** Player stat bonuses from daily rules and starting boons (added in recomputeStats). */
  playerDamage: number;
  playerHull: number;
  playerSpeed: number;
  /** XP multiplier (daily rules). */
  xp: number;
}

const STORES = new WeakMap<RunState, RunMods>();

/** Director scratch key: endless milestones reached this run (progression writes it; the run tracker reads it). */
export const MILESTONES = 'rp:milestones';

/** Heat-0 modifiers for a sea: its SEA_BALANCE row and nothing else. */
export function baseRunMods(seaId: RunState['seaId']): RunMods {
  const sea = SEA_BALANCE[seaId];
  return {
    heat: 0, daily: '',
    enemyHp: sea.enemyHp, enemyDamage: sea.enemyDamage, enemySpeed: 1, bossHp: sea.bossHp,
    eliteChance: 1, extraElites: 0, eventGap: 1, bountyCaptains: 0, drops: 1, healing: 1, reward: 1,
    playerDamage: 0, playerHull: 0, playerSpeed: 0, xp: 1,
  };
}

/** Applies heat levels 1..`heat` (each HEAT rule stacks) to `mods` in place. */
export function applyHeat(mods: RunMods, heat: number): RunMods {
  const level = Math.max(0, Math.min(HEAT.max, Math.floor(heat)));
  mods.heat = level;
  mods.reward *= 1 + HEAT.reward * level;
  mods.enemyHp *= 1 + HEAT.hpPerLevel * level;
  mods.enemyDamage *= 1 + HEAT.damagePerLevel * level;
  for (const rule of heatRules(level)) applyEffect(mods, rule.effect);
  return mods;
}

/** Folds one effect (a heat rule or a daily rule) into the modifiers. */
export function applyEffect(mods: RunMods, fx: Readonly<HeatEffect>): void {
  if (fx.enemyHp) mods.enemyHp *= fx.enemyHp;
  if (fx.enemyDamage) mods.enemyDamage *= fx.enemyDamage;
  if (fx.enemySpeed) mods.enemySpeed *= fx.enemySpeed;
  if (fx.bossHp) mods.bossHp *= fx.bossHp;
  if (fx.eliteChance) mods.eliteChance *= fx.eliteChance;
  if (fx.extraElites) mods.extraElites += fx.extraElites;
  if (fx.eventGap) mods.eventGap *= fx.eventGap;
  if (fx.bountyCaptains) mods.bountyCaptains += fx.bountyCaptains;
  if (fx.drops) mods.drops *= fx.drops;
  if (fx.healing) mods.healing *= fx.healing;
  if (fx.reward) mods.reward *= fx.reward;
  if (fx.playerDamage) mods.playerDamage += fx.playerDamage;
  if (fx.playerHull) mods.playerHull += fx.playerHull;
  if (fx.playerSpeed) mods.playerSpeed += fx.playerSpeed;
  if (fx.xp) mods.xp *= fx.xp;
}

/** This run's modifiers (the sea's heat-0 defaults until configureRunMods is called). */
export function runMods(state: RunState): RunMods {
  let mods = STORES.get(state);
  if (!mods) { mods = baseRunMods(state.seaId); STORES.set(state, mods); }
  return mods;
}

/** Sets this run's modifiers (call right after constructing the Sim, before the first tick). */
export function configureRunMods(state: RunState, mods: RunMods): void {
  STORES.set(state, mods);
}
