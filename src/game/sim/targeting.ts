/**
 * Enemy targeting (lead-owned contract; the choice is CAPTAINS-owned). Every enemy fights a "focus": the player or an
 * AI captain. AI behaviours read the focus through `focusOf` instead of `state.player`, so the fleet's attention is
 * split without touching each behaviour. Bosses and weather keep aiming at the player (boss fights are the player's).
 *
 * Choice (CAPTAINS): the nearest friendly by `distance × weight`, held for CAPTAIN.aggro.hold (4–6 s) in the enemy's
 * AI scratch (`capFocus` = 0 for the player or the captain's negative id, `capFocusT` = run time it expires). The
 * player's weight < 1 keeps about half of the fleet on the player; a captain already drawing more than its share
 * (last tick's tally, captains.ts) weighs more, and so does one falling back or just sailed in. With no captains the
 * answer is always the player and no randomness is consumed (runs without captains are unchanged).
 */
import { CAPTAIN } from '../content/captains';
import type { Body, EnemyState } from '../types';
import { captainById, captainRuntime, captainSlot } from './captains-runtime';
import type { SimContext } from './context';

/** A ship on the player's side: the player or a live AI captain. */
export type Friendly = Body & { alive: boolean };

const RETREAT = 2;

/** The friendly ship enemy `e` is fighting this tick. */
export function focusOf(c: SimContext, e: EnemyState): Friendly {
  const s = c.state;
  const caps = s.captains;
  if (caps.length === 0) return s.player;
  const ai = e.ai;
  if (s.time < (ai.capFocusT ?? 0)) {
    const cur = ai.capFocus ?? 0;
    if (cur === 0) return s.player;
    const k = captainById(caps, cur);
    if (k && k.alive) return k;
  }
  return pickFocus(c, e);
}

function pickFocus(c: SimContext, e: EnemyState): Friendly {
  const s = c.state, p = s.player, A = CAPTAIN.aggro;
  const rt = captainRuntime(s);
  let best: Friendly = p, bestId = 0;
  let bestScore = p.alive ? Math.hypot(p.x - e.x, p.z - e.z) * A.playerWeight : Infinity;
  const alive = Math.max(1, rt.aliveEnemies);
  for (const k of s.captains) {
    if (!k.alive) continue;
    let score = Math.hypot(k.x - e.x, k.z - e.z);
    const share = (rt.focusCaptain[captainSlot(k.id)] ?? 0) / alive;
    if (share > A.loadShare) score *= 1 + (A.load * (share - A.loadShare)) / A.loadShare;
    if (k.ai.mode === RETREAT) score *= A.retreatWeight;
    if ((k.ai.grace ?? 0) > 0) score *= 2;
    if (score < bestScore) { bestScore = score; best = k; bestId = k.id; }
  }
  e.ai.capFocus = bestId;
  e.ai.capFocusT = s.time + A.hold[0] + c.random() * (A.hold[1] - A.hold[0]);
  return best;
}

/** Every friendly ship: the player first, then live captains. Fills and returns `out`. */
export function friendlies(c: SimContext, out: Friendly[] = []): Friendly[] {
  out.length = 0;
  out.push(c.state.player);
  for (const k of c.state.captains) if (k.alive) out.push(k);
  return out;
}
