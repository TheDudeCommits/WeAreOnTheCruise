/**
 * Admiralty Blockade (EVENTS). A line of frigates with a man-o'-war flagship walls off the way ahead: the flagship
 * leads, the frigates hold line-abreast slots on its beam (META's formation AI) until the fight closes. Objective:
 * sink the flagship before the line sails past → the line breaks (the frigates scatter for a few seconds), a chest
 * and doubloons float up where the flagship went down. The world anchor follows the flagship.
 */
import { DIRECTOR_EVENTS, EVENT_TUNING } from '../../content/director';
import type { EnemyState } from '../../types';
import type { SimContext } from '../context';
import { headingTo, sideX, sideZ } from '../meta-steer';
import { anchor, eventSpawn, openEvent, openSpot, payout, resolve, travelBearing, undecided } from './common';
import { OUTCOME_FAIL, OUTCOME_SUCCESS, complete, type EventRuntime, type WorldEventHandler } from './runtime';

/** META's AI retreat mode (src/game/sim/ai.ts M_RETREAT) — a documented scratch key, set when the line breaks. */
const AI_RETREAT = 1;
const FLAGSHIP_NAMES = ['Indomitable', 'Resolute', 'Unyielding', 'Vigilant', 'Steadfast', 'Relentless'] as const;

class BlockadeState {
  flagship = 0;
  readonly ids = new Int32Array(10);
  n = 0;
  lastX = 0;
  lastZ = 0;
}

const state = (rt: EventRuntime): BlockadeState => rt.slot('blockade', () => new BlockadeState());

function line(c: SimContext): { x: number; z: number } | null {
  const p = c.state.player;
  return openSpot(c, p.x, p.z, travelBearing(c), EVENT_TUNING.blockadeDistance, 40, 1.2, 10);
}

export const BLOCKADE: WorldEventHandler = {
  id: 'admiralty-blockade',

  weight(c) {
    return c.content.seas[c.state.seaId].enemyFactions.includes('admiralty') && line(c) ? 1 : 0;
  },

  start(c, rt, minute) {
    const b = state(rt);
    const spot = line(c);
    if (!spot) return null;
    const p = c.state.player;
    const cx = spot.x, cz = spot.z;
    const heading = headingTo(p.x - cx, p.z - cz);
    const flag = eventSpawn(c, 'man-o-war', cx, cz, { heading, hpMul: EVENT_TUNING.blockadeFlagshipHp, force: true, margin: 8 });
    if (!flag) return null;
    const name = FLAGSHIP_NAMES[Math.floor(c.random() * FLAGSHIP_NAMES.length)]!;
    flag.title = `Flagship ${name}`;
    flag.ai.isLeader = 1;
    flag.ai.flank = 0;
    b.flagship = flag.id; b.n = 0; b.lastX = flag.x; b.lastZ = flag.z;
    const frigates = EVENT_TUNING.blockadeFrigates(minute);
    for (let k = 1; k <= frigates; k++) {
      const slot = (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2);
      const off = slot * 46;
      const e = eventSpawn(c, 'frigate', cx + sideX(heading, -1) * off, cz + sideZ(heading, -1) * off, { heading, margin: 6 });
      if (!e) continue;
      e.ai.leader = flag.id;
      e.ai.fslot = slot;
      if (b.n < b.ids.length) b.ids[b.n++] = e.id;
    }
    const ev = openEvent('admiralty-blockade', `Sink the flagship ${name}`, DIRECTOR_EVENTS['admiralty-blockade'].duration, 1);
    anchor(ev, flag.x, flag.z, 45);
    return ev;
  },

  update(c, rt, ev) {
    const b = state(rt);
    const flag = c.findTarget(b.flagship) as EnemyState | undefined;
    if (flag && flag.life === 'alive') {
      b.lastX = flag.x; b.lastZ = flag.z;
      ev.x = flag.x; ev.z = flag.z;
      if (rt.t >= ev.duration && undecided(rt)) {
        resolve(c, rt, OUTCOME_FAIL, 'The Blockade Holds', 'The Admiralty line sails on. Their flagship lives to fight another day.');
        if (flag.title) flag.title = null;
        complete(rt);
      }
      return;
    }
    // Sunk (or gone): the line breaks.
    ev.progress = 1;
    payout(c, b.lastX, b.lastZ, EVENT_TUNING.blockadeDoubloons, 1, 1.2, 18);
    for (let i = 0; i < b.n; i++) {
      const e = c.findTarget(b.ids[i]!) as EnemyState | undefined;
      if (!e || e.life !== 'alive') continue;
      e.ai.leader = 0;
      e.ai.mode = AI_RETREAT;
      e.ai.t = 5 + c.random() * 3;
    }
    resolve(c, rt, OUTCOME_SUCCESS, 'Blockade Broken!', 'The flagship is going down and the line scatters. Plunder in the water!');
    complete(rt);
  },
};
