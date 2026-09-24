/**
 * Spawning and damage scaling shared by the director, AI and bosses (META).
 * HP is set here (not in Sim.spawnEnemy) so the heat curve lives in one content table (content/director.ts).
 */
import { DIRECTOR } from '../content/director';
import type { EnemyId } from '../ids';
import type { EnemyState } from '../types';
import type { SimContext } from './context';

export interface ScaledSpawnOpts {
  elite?: boolean;
  heading?: number;
  /** Extra HP multiplier (e.g. convoy galleons are lighter). */
  hpMul?: number;
}

/** Spawns an enemy and overrides its HP with the heat-scaled table value (× elite). */
export function spawnScaled(c: SimContext, id: EnemyId, x: number, z: number, opts: ScaledSpawnOpts = {}): EnemyState | null {
  const e = c.spawnEnemy(id, x, z, { elite: !!opts.elite, heading: opts.heading });
  if (!e) return null;
  const def = c.content.enemies[id];
  const hp = def.hp * enemyHpScale(c) * (opts.elite ? DIRECTOR.eliteHp : 1) * (opts.hpMul ?? 1);
  e.hp = hp;
  e.maxHp = hp;
  return e;
}

const difficulty = (c: SimContext): number => c.content.seas[c.state.seaId].difficulty;

/** Enemy HP multiplier for this moment of the run (time × sea difficulty). */
export function enemyHpScale(c: SimContext): number {
  return DIRECTOR.hpScale(c.state.time / 60, difficulty(c));
}

/** Enemy damage multiplier for this moment of the run. */
export function enemyDamageScale(c: SimContext): number {
  return DIRECTOR.damageScale(c.state.time / 60, difficulty(c));
}

/** Enemy attack damage after time/difficulty and elite scaling. */
export function enemyDamage(c: SimContext, e: EnemyState, base: number): number {
  return base * enemyDamageScale(c) * (e.elite ? DIRECTOR.eliteDamage : 1);
}

/** Boss attack damage (bosses scale half as fast as the fleet). */
export function bossDamage(c: SimContext, base: number): number {
  return base * (1 + (enemyDamageScale(c) - 1) * 0.5);
}

export function countAliveEnemies(c: SimContext): number {
  let n = 0;
  for (const e of c.state.enemies) if (e.life === 'alive') n++;
  return n;
}
