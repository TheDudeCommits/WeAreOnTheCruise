/**
 * Elite affixes (FOES-owned): swift, armored, volatile, vampiric, shielded, splitting, burning, commander.
 * Contract stub. rollAffixes runs when an elite spawns (meta-spawn.spawnScaled), updateAffixes once per tick after
 * the enemy AI, onAffixDeath when an elite is sunk (progression.onEnemyKilled).
 */
import type { EnemyState } from '../types';
import type { SimContext } from './context';

export function rollAffixes(_c: SimContext, _e: EnemyState): void {}
export function updateAffixes(_c: SimContext): void {}
export function onAffixDeath(_c: SimContext, _e: EnemyState): void {}
