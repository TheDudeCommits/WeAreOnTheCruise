/**
 * Sunken Treasure (EVENTS). A wreck glitters below a dig site out on open water. Holding station inside the circle
 * raises its chest: the dig only advances while the ship's centre is inside (it pauses, never resets). Raiders come
 * for the prize in waves while the dig runs. Objective: dig for N seconds before the wreck slides into the deep →
 * a big (boss-grade) chest breaks the surface at the site.
 */
import { DIRECTOR_EVENTS, EVENT_TUNING } from '../../content/director';
import type { EnemyId } from '../../ids';
import type { SimContext } from '../context';
import { TAU, headingTo } from '../meta-steer';
import { anchor, eventSpawn, openEvent, openSpot, payout, resolve, travelBearing, undecided } from './common';
import { OUTCOME_FAIL, OUTCOME_SUCCESS, complete, type EventRuntime, type WorldEventHandler } from './runtime';

const MAX_WAVES = 5;

class TreasureState {
  x = 0;
  z = 0;
  r = 0;
  dug = 0;
  goal = 0;
  begun = false;
  waveT = 0;
  waves = 0;
}

const state = (rt: EventRuntime): TreasureState => rt.slot('treasure', () => new TreasureState());

function site(c: SimContext): { x: number; z: number } | null {
  const p = c.state.player;
  const r = EVENT_TUNING.treasureRadius;
  return openSpot(c, p.x, p.z, travelBearing(c), 175, r + 18, 2, 12);
}

/** The raiders sent after the prize (by sea and minute). */
function raider(c: SimContext, minute: number, k: number): EnemyId {
  const factions = c.content.seas[c.state.seaId].enemyFactions;
  if (factions.includes('wraith') && k % 3 === 2) return 'wraith';
  if (minute >= 6 && k % 4 === 3) return 'corsair-brig';
  if (minute >= 3 && k % 3 === 1) return 'cutter';
  return 'skiff';
}

export const SUNKEN_TREASURE: WorldEventHandler = {
  id: 'sunken-treasure',

  weight(c) { return site(c) ? 1 : 0; },

  start(c, rt, minute) {
    const t = state(rt);
    const spot = site(c);
    if (!spot) return null;
    t.x = spot.x; t.z = spot.z; t.r = EVENT_TUNING.treasureRadius;
    t.dug = 0; t.goal = EVENT_TUNING.treasureDig(minute); t.begun = false; t.waveT = 0; t.waves = 0;
    const ev = openEvent('sunken-treasure', 'Hold the dig site to raise the chest', DIRECTOR_EVENTS['sunken-treasure'].duration, t.goal);
    anchor(ev, t.x, t.z, t.r);
    return ev;
  },

  update(c, rt, ev) {
    const t = state(rt);
    const s = c.state, p = s.player;
    const minute = s.time / 60;
    const inside = p.alive && Math.hypot(p.x - t.x, p.z - t.z) <= t.r;
    if (inside) {
      t.dug = Math.min(t.goal, t.dug + c.dt);
      if (!t.begun) { t.begun = true; t.waveT = 1.5; }
    }
    ev.progress = t.dug;
    if (t.begun && t.waves < MAX_WAVES) {
      t.waveT -= c.dt;
      if (t.waveT <= 0) { t.waveT += EVENT_TUNING.treasureWaveEvery; wave(c, t, minute); }
    }
    if (t.dug >= t.goal) {
      payout(c, t.x, t.z, EVENT_TUNING.treasureDoubloons, 2, 1.2, 14);
      resolve(c, rt, OUTCOME_SUCCESS, 'Treasure Raised!', 'A barnacled chest breaks the surface. It is yours!');
      complete(rt);
      return;
    }
    if (undecided(rt) && rt.t >= ev.duration) {
      resolve(c, rt, OUTCOME_FAIL, 'The Wreck Slips Away', 'The wreck slides off the shelf into the deep.');
      complete(rt);
    }
  },
};

/** A raiding party closing on the site from open water. */
function wave(c: SimContext, t: TreasureState, minute: number): void {
  t.waves++;
  const n = 3 + Math.min(3, Math.floor(minute / 3)) + (t.waves > 2 ? 1 : 0);
  const a0 = c.random() * TAU;
  const R = 240;
  for (let k = 0; k < n; k++) {
    const a = a0 + (c.random() - 0.5) * 0.9;
    const x = t.x + Math.sin(a) * (R + k * 8), z = t.z + Math.cos(a) * (R + k * 8);
    const e = eventSpawn(c, raider(c, minute, k), x, z, { heading: headingTo(t.x - x, t.z - z) });
    if (e) e.ai.t = 0.4 + k * 0.25;
  }
}
