/**
 * Bounty Contract (EVENTS). A bounty is posted on one class of ship in these waters — the class that sails here in
 * the greatest numbers right now — and a marked squadron of it joins the fight. Objective: sink N of that class
 * within 60 s → doubloons and a chest delivered to the ship. Any ship of the class counts while the contract runs.
 *
 * Scratch: `ai.bmk` 1 on live ships of the posted class (WorldEventFx marks them) · `ai.bty` = contract serial once
 * counted (or already sinking when it was posted).
 */
import { DIRECTOR_EVENTS, EVENT_TUNING } from '../../content/director';
import type { EnemyId } from '../../ids';
import type { SimContext } from '../context';
import { TAU, fwdX, fwdZ, rand } from '../meta-steer';
import { eventSpawn, openEvent, payout, resolve, undecided } from './common';
import { OUTCOME_FAIL, OUTCOME_SUCCESS, complete, type EventRuntime, type WorldEventHandler } from './runtime';

/** Classes that can carry a bounty (never forts, the kraken's arms or convoys). */
const POSTABLE = new Set<EnemyId>([
  'skiff', 'cutter', 'brig', 'fireship', 'mortar-barge', 'frigate', 'corsair-brig', 'corsair-galleon', 'wraith', 'wyrmling', 'man-o-war',
  'signal-cutter', 'ironclad', 'harpooner', 'bomb-ketch', 'smoke-runner', 'lantern-wisp', 'drowned-galleon',
]);

class BountyState {
  target: EnemyId = 'skiff';
  goal = 0;
  kills = 0;
  serial = 0;
}

const state = (rt: EventRuntime): BountyState => rt.slot('bounty', () => new BountyState());
const COUNTS = new Map<EnemyId, number>();

/** The class with the most live ships (ties: the bigger prize), if at least 3 sail. */
function postable(c: SimContext): EnemyId | null {
  COUNTS.clear();
  for (const e of c.state.enemies) {
    if (e.life !== 'alive' || e.hidden >= 1 || e.ai.convoy === 1 || !POSTABLE.has(e.defId)) continue;
    COUNTS.set(e.defId, (COUNTS.get(e.defId) ?? 0) + 1);
  }
  let best: EnemyId | null = null, bestN = 2;
  for (const [id, n] of COUNTS) {
    if (n > bestN || (n === bestN && best && c.content.enemies[id].xp > c.content.enemies[best].xp)) { best = id; bestN = n; }
  }
  return best;
}

/** "Raider Skiffs", "Men-o'-War". */
export function pluralName(name: string): string {
  if (name.startsWith("Man-o'")) return name.replace("Man-o'", "Men-o'");
  if (name.endsWith('s')) return name;
  return `${name}s`;
}

export const BOUNTY: WorldEventHandler = {
  id: 'bounty-contract',

  weight(c) { return postable(c) ? 1 : 0; },

  start(c, rt) {
    const b = state(rt);
    const target = postable(c);
    if (!target) return null;
    const def = c.content.enemies[target];
    b.target = target;
    b.goal = Math.max(3, Math.min(12, Math.round(24 / Math.max(1, def.xp))));
    b.kills = 0;
    b.serial++;
    // Ships already going down when the contract is posted do not count.
    for (const e of c.state.enemies) if (e.defId === target && e.life !== 'alive') e.ai.bty = b.serial;
    // The marked squadron: enough of the class to make the contract fair.
    const p = c.state.player;
    const extra = Math.ceil(b.goal * 0.5);
    const a0 = p.speed > 3 ? p.heading + rand(c, -1, 1) : c.random() * TAU;
    for (let k = 0; k < extra; k++) {
      const r = 280 + c.random() * 60;
      const a = a0 + (k - extra / 2) * 0.12;
      eventSpawn(c, target, p.x + fwdX(a) * r, p.z + fwdZ(a) * r, { margin: 5 });
    }
    const ev = openEvent('bounty-contract', `Sink ${b.goal} ${pluralName(def.name)}`, DIRECTOR_EVENTS['bounty-contract'].duration, b.goal);
    return ev;
  },

  update(c, rt, ev) {
    const b = state(rt);
    for (const e of c.state.enemies) {
      if (e.defId !== b.target) continue;
      if (e.life === 'alive') { e.ai.bmk = 1; continue; }
      e.ai.bmk = 0;
      if (e.ai.bty === b.serial) continue;
      e.ai.bty = b.serial;
      if (e.life === 'sinking') b.kills++;
    }
    ev.progress = Math.min(b.goal, b.kills);
    const p = c.state.player;
    if (b.kills >= b.goal) {
      const ahead = 26 + p.speed * 0.8;
      payout(c, p.x + fwdX(p.heading) * ahead, p.z + fwdZ(p.heading) * ahead, EVENT_TUNING.bountyDoubloons + b.goal, 1, 0.8, 8);
      resolve(c, rt, OUTCOME_SUCCESS, 'Bounty Collected!', 'The harbourmaster pays in full: doubloons and a chest.');
      complete(rt);
      return;
    }
    if (undecided(rt) && rt.t >= ev.duration) {
      resolve(c, rt, OUTCOME_FAIL, 'Contract Expired', 'The bounty is withdrawn. Better luck on the next one.');
      complete(rt);
    }
  },

  finish(c, rt) {
    const b = state(rt);
    for (const e of c.state.enemies) if (e.defId === b.target) e.ai.bmk = 0;
  },
};
