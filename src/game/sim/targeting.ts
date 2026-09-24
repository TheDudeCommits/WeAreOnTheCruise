/**
 * Enemy targeting (lead-owned contract). Every enemy fights a "focus": the player or an AI captain.
 * AI behaviours read the focus through `focusOf` instead of `state.player`, so CAPTAINS can split the fleet's
 * attention without touching each behaviour. Until CAPTAINS implements the choice, every enemy focuses the player.
 * Bosses and weather keep aiming at the player (boss fights are the player's).
 */
import type { Body, EnemyState } from '../types';
import type { SimContext } from './context';

/** A ship on the player's side: the player or a live AI captain. */
export type Friendly = Body & { alive: boolean };

/** The friendly ship enemy `e` is fighting this tick. */
export function focusOf(c: SimContext, _e: EnemyState): Friendly {
  return c.state.player;
}

/** Every friendly ship: the player first, then live captains. Fills and returns `out`. */
export function friendlies(c: SimContext, out: Friendly[] = []): Friendly[] {
  out.length = 0;
  out.push(c.state.player);
  for (const k of c.state.captains) if (k.alive) out.push(k);
  return out;
}
