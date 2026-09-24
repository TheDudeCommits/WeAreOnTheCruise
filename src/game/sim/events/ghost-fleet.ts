/**
 * Ghost Fleet (EVENTS; the Gloam, or any sea after dark). Drowned galleons and lantern wisps rise from the sea in a
 * ring around the ship (plus a pair of wraiths in the Gloam). They surface over ~2.5 s (`ai.sub` 1 → 0, which ai.ts
 * turns into `hidden`, so SHIPS sinks/fades the hulls in place). Objective: sink the drowned galleons → the fleet
 * returns to the deep and leaves its cargo. Fail: at dawn of the timer the ghosts sink back, untouched.
 * FOES builds the drowned-galleon and lantern-wisp classes; while those are still placeholders (or missing) the
 * fleet uses whatever is in the content table, falling back to Gloam wraiths.
 *
 * Scratch: `ai.gRise` 1 while surfacing (`ai.gT` its timer) · `ai.gSink` 1 while sinking back.
 */
import { DIRECTOR_EVENTS, EVENT_TUNING } from '../../content/director';
import type { EnemyId } from '../../ids';
import type { EnemyState } from '../../types';
import type { SimContext } from '../context';
import { TAU } from '../meta-steer';
import { anchor, eventSpawn, openEvent, payout, resolve, undecided } from './common';
import { OUTCOME_FAIL, OUTCOME_SUCCESS, complete, type EventRuntime, type WorldEventHandler } from './runtime';

const RISE = 2.4;
const SINK = 2;
const MAX = 24;

class GhostState {
  readonly ids = new Int32Array(MAX);
  n = 0;
  readonly galleons = new Int32Array(4);
  ng = 0;
  sunk = 0;
  sinking = false;
  sinkT = 0;
  lastX = 0;
  lastZ = 0;
}

const state = (rt: EventRuntime): GhostState => rt.slot('ghost-fleet', () => new GhostState());

/** Night on the sea clock (the Gloam is always eligible). */
export function isNight(hour: number): boolean { return hour >= 19.5 || hour < 5.5; }

function classOr(c: SimContext, id: EnemyId, fallback: EnemyId): EnemyId {
  return c.content.enemies[id] ? id : fallback;
}

function ghost(c: SimContext, id: number): EnemyState | null {
  const t = c.findTarget(id);
  return t && !('phase' in t) ? t : null;
}

export const GHOST_FLEET: WorldEventHandler = {
  id: 'ghost-fleet',

  weight(c) {
    const s = c.state;
    return s.seaId === 'the-gloam' || isNight(s.sea.timeOfDay) ? 1 : 0;
  },

  start(c, rt, minute) {
    const g = state(rt);
    const s = c.state, p = s.player;
    g.n = 0; g.ng = 0; g.sunk = 0; g.sinking = false; g.sinkT = 0;
    const galleonId = classOr(c, 'drowned-galleon', 'wraith');
    const wispId = classOr(c, 'lantern-wisp', 'wraith');
    const galleons = Math.min(g.galleons.length, EVENT_TUNING.ghostGalleons(minute));
    const wisps = EVENT_TUNING.ghostWisps(minute);
    const offset = c.random() * TAU;
    const rise = (e: EnemyState | null, delay: number): void => {
      if (!e || g.n >= MAX) return;
      e.ai.gRise = 1; e.ai.gT = -delay; e.ai.sub = 0.95; e.hidden = 0.95;
      g.ids[g.n++] = e.id;
    };
    for (let k = 0; k < galleons; k++) {
      const a = offset + (k / galleons) * TAU;
      const r = 190 + c.random() * 40;
      const e = eventSpawn(c, galleonId, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, { margin: 8, force: true });
      if (!e) continue;
      g.galleons[g.ng++] = e.id;
      rise(e, k * 0.4);
      g.lastX = e.x; g.lastZ = e.z;
    }
    if (g.ng === 0) return null;
    for (let k = 0; k < wisps; k++) {
      const a = offset + ((k + 0.5) / wisps) * TAU + (c.random() - 0.5) * 0.4;
      const r = 150 + c.random() * 70;
      rise(eventSpawn(c, wispId, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, { margin: 4 }), 0.6 + c.random() * 1.4);
    }
    if (s.seaId === 'the-gloam') {
      for (let k = 0; k < 2; k++) {
        const a = offset + Math.PI * (k + 0.5);
        rise(eventSpawn(c, 'wraith', p.x + Math.sin(a) * 230, p.z + Math.cos(a) * 230, { margin: 6 }), 1.2 + k * 0.5);
      }
    }
    const ev = openEvent('ghost-fleet', g.ng > 1 ? 'Sink the drowned galleons' : 'Sink the drowned galleon', DIRECTOR_EVENTS['ghost-fleet'].duration, g.ng);
    anchor(ev, p.x, p.z, 215);
    return ev;
  },

  update(c, rt, ev) {
    const g = state(rt);
    const dt = c.dt;
    // Surfacing / sinking back.
    let left = 0;
    for (let i = 0; i < g.n; i++) {
      const e = ghost(c, g.ids[i]!);
      if (!e || e.life !== 'alive') continue;
      left++;
      const ai = e.ai;
      if (ai.gSink === 1) {
        ai.gT = (ai.gT ?? 0) + dt;
        ai.sub = Math.min(1, ai.gT / SINK);
        if (ai.gT >= SINK) e.life = 'dead';
      } else if (ai.gRise === 1) {
        ai.gT = (ai.gT ?? 0) + dt;
        ai.sub = ai.gT < 0 ? 0.95 : Math.max(0, 0.95 * (1 - ai.gT / RISE));
        if (ai.gT >= RISE) { ai.gRise = 0; ai.sub = 0; }
      }
    }
    if (g.sinking) {
      g.sinkT += dt;
      if (left === 0 || g.sinkT > SINK + 0.5) complete(rt);
      return;
    }
    // Objective: the galleons.
    let sunk = 0;
    for (let i = 0; i < g.ng; i++) {
      const e = ghost(c, g.galleons[i]!);
      if (e && e.life === 'alive') { ev.x = e.x; ev.z = e.z; continue; }
      if (e) { g.lastX = e.x; g.lastZ = e.z; }
      sunk++;
    }
    g.sunk = sunk;
    ev.progress = sunk;
    if (sunk >= g.ng) {
      payout(c, g.lastX, g.lastZ, EVENT_TUNING.ghostDoubloons, 1, 1.2, 18);
      resolve(c, rt, OUTCOME_SUCCESS, 'The Drowned Fleet Sinks', 'Its galleons return to the deep and leave their cargo on the water.');
      sinkBack(g, c);
      return;
    }
    if (undecided(rt) && rt.t >= ev.duration) {
      resolve(c, rt, OUTCOME_FAIL, 'The Ghosts Sink Back', 'The drowned fleet slips under the Gloam again, untouched.');
      sinkBack(g, c);
    }
  },

  finish(c, rt) {
    const g = state(rt);
    for (let i = 0; i < g.n; i++) {
      const e = ghost(c, g.ids[i]!);
      if (!e) continue;
      e.ai.gRise = 0;
      if (e.ai.gSink === 1 && e.life === 'alive') e.life = 'dead';
      e.ai.gSink = 0;
      if (e.life === 'alive' && (e.ai.sub ?? 0) > 0) e.ai.sub = 0;
    }
    g.n = 0; g.ng = 0;
  },
};

/** Every surviving ghost of the fleet sinks back into the sea (no loot). */
function sinkBack(g: GhostState, c: SimContext): void {
  g.sinking = true;
  g.sinkT = 0;
  for (let i = 0; i < g.n; i++) {
    const e = ghost(c, g.ids[i]!);
    if (!e || e.life !== 'alive') continue;
    e.ai.gRise = 0; e.ai.gSink = 1; e.ai.gT = 0;
  }
}
