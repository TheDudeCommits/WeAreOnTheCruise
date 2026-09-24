/**
 * Treasure Convoy tracker (EVENTS). META's Treasure Convoy runs itself (director.ts spawns the fleeing galleons,
 * ai.ts steers them and lets them slip away); this tracker only mirrors it into `run.worldEvent` so the HUD shows
 * it like every other set piece: galleons sunk of the convoy, time until it escapes, and the outcome. It is started
 * by updateWorldEvents when the director opens a convoy, never by startWorldEvent.
 */
import { EVENT_TUNING } from '../../content/director';
import type { EnemyState } from '../../types';
import type { SimContext } from '../context';
import { anchor, openEvent, resolve } from './common';
import { OUTCOME_FAIL, OUTCOME_SUCCESS, complete, type EventRuntime, type WorldEventHandler } from './runtime';

const MAX = 8;
const ALIVE = 0, SUNK = 1, ESCAPED = 2;

class ConvoyState {
  readonly ids = new Int32Array(MAX);
  readonly fate = new Uint8Array(MAX);
  n = 0;
}

const state = (rt: EventRuntime): ConvoyState => rt.slot('convoy', () => new ConvoyState());

function ship(c: SimContext, id: number): EnemyState | null {
  const t = c.findTarget(id);
  return t && !('phase' in t) ? t : null;
}

export const CONVOY_TRACKER: WorldEventHandler = {
  id: 'treasure-convoy',

  start(c, rt) {
    const v = state(rt);
    v.n = 0;
    let sx = 0, sz = 0;
    for (const e of c.state.enemies) {
      if (v.n >= MAX) break;
      if (e.life !== 'alive' || e.ai.convoy !== 1 || e.spawnTime < c.state.time - 0.5) continue;
      v.ids[v.n] = e.id; v.fate[v.n] = ALIVE; v.n++;
      sx += e.x; sz += e.z;
    }
    if (v.n === 0) return null;
    const ev = openEvent('treasure-convoy', v.n > 1 ? 'Sink the fleeing galleons' : 'Sink the fleeing galleon', EVENT_TUNING.convoyEscape, v.n);
    anchor(ev, sx / v.n, sz / v.n, 60);
    return ev;
  },

  update(c, rt, ev) {
    const v = state(rt);
    let alive = 0, sunk = 0, sx = 0, sz = 0;
    for (let i = 0; i < v.n; i++) {
      if (v.fate[i] === ALIVE) {
        const e = ship(c, v.ids[i]!);
        if (!e || e.life === 'dead') v.fate[i] = ESCAPED; // slipped over the horizon (never went down)
        else if (e.life === 'sinking') v.fate[i] = SUNK;
        else { alive++; sx += e.x; sz += e.z; }
      }
      if (v.fate[i] === SUNK) sunk++;
    }
    ev.progress = sunk;
    if (alive > 0) { ev.x = sx / alive; ev.z = sz / alive; return; }
    // META emits its own 'Convoy Escaped' banner; the tracker only adds the verdict.
    if (sunk >= v.n) resolve(c, rt, OUTCOME_SUCCESS, 'Convoy Taken!', 'Every galleon of the convoy is sunk. Its treasure is yours!');
    else if (sunk === 0) resolve(c, rt, OUTCOME_FAIL, '', 'The treasure convoy slipped over the horizon.');
    complete(rt);
  },
};
