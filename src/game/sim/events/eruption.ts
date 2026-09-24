/**
 * Volcanic Eruption (EVENTS). A volcanic island within reach blows its top — or, out on open water, a sea vent tears
 * open beside the ship. For ~30 s lava bombs arc from the vent (run.worldEvent x/z) onto telegraphed circles around
 * the player: red circles burst (both sides take the blast and burn) and leave fire patches; gold circles are
 * treasure — they land harmlessly and leave XP and doubloons where they fall. Survive it → a last golden bomb drops
 * a purse just ahead of the ship.
 *
 * Each bomb in flight is a 'lava-bomb' hazard on its landing circle (team 'enemy' = lava, 'player' = gold) that lands
 * at `ttl`. Renderers look the vent's island up once (run.worldEvent x/z) to put the plume on its peak.
 */
import { EVENT_TUNING } from '../../content/director';
import type { HazardState } from '../../types';
import type { SimContext } from '../context';
import { TAU, fwdX, fwdZ } from '../meta-steer';
import {
  anchor, blastCircle, eventPlayerDamage, eventShipDamage, openEvent, openSpot, payout, resolve, spillDoubloons, spillTreasure,
  travelBearing,
} from './common';
import { OUTCOME_SUCCESS, complete, type EventRuntime, type WorldEventHandler } from './runtime';

/** Volcanoes farther than this from the ship stay asleep; the sea vent opens instead. */
const VOLCANO_REACH = 520;
/** Seconds after the last launch for every bomb to land. */
const SETTLE = 3.4;
const FIRE_TTL = 5.5;

class EruptionState {
  vx = 0;
  vz = 0;
  island = false;
  next = 0;
  launched = 0;
  finale = false;
  finaleId = 0;
}

const state = (rt: EventRuntime): EruptionState => rt.slot('eruption', () => new EruptionState());

/** The nearest volcanic island in reach, or null. */
function volcano(c: SimContext, rt: EventRuntime): { x: number; z: number; radius: number } | null {
  const p = c.state.player;
  const list = c.world.islandsNear(p.x, p.z, VOLCANO_REACH, rt.islands);
  let best: (typeof list)[number] | null = null, bestD = Infinity;
  for (const isl of list) {
    if (isl.biome !== 'volcanic') continue;
    const d = Math.hypot(isl.x - p.x, isl.z - p.z);
    if (d < bestD && d < VOLCANO_REACH) { bestD = d; best = isl; }
  }
  return best;
}

export const ERUPTION: WorldEventHandler = {
  id: 'volcanic-eruption',

  weight(c, rt) { return volcano(c, rt) ? 2.2 : 1; },

  start(c, rt) {
    const v = state(rt);
    const p = c.state.player;
    const isl = volcano(c, rt);
    let radius = 40;
    if (isl) {
      v.vx = isl.x; v.vz = isl.z; v.island = true; radius = Math.max(30, isl.radius * 0.6);
    } else {
      const side = c.random() < 0.5 ? 1 : -1;
      const spot = openSpot(c, p.x, p.z, travelBearing(c) + side * 0.35, 110, 25, 1.6, 10);
      v.vx = spot ? spot.x : p.x + fwdX(travelBearing(c)) * 115;
      v.vz = spot ? spot.z : p.z + fwdZ(travelBearing(c)) * 115;
      v.island = false;
    }
    v.next = 1.2; v.launched = 0; v.finale = false; v.finaleId = 0;
    const ev = openEvent('volcanic-eruption', v.island ? 'Survive the eruption; the gold circles rain treasure' : 'Survive the sea vent; the gold circles rain treasure',
      EVENT_TUNING.eruptionDuration);
    anchor(ev, v.vx, v.vz, radius);
    return ev;
  },

  update(c, rt, ev) {
    const v = state(rt);
    const minute = c.state.time / 60;
    if (rt.t < ev.duration) {
      v.next -= c.dt;
      while (v.next <= 0) {
        launch(c, v, c.random() < EVENT_TUNING.eruptionGoldShare);
        v.next += EVENT_TUNING.eruptionInterval(minute) * (0.7 + c.random() * 0.6);
      }
    } else if (!v.finale) {
      v.finale = true;
      const p = c.state.player;
      if (p.alive) {
        // The finale: one golden bomb lands just ahead of the ship with the purse.
        const d = 45 + p.speed * 1.4;
        v.finaleId = bomb(c, v, p.x + fwdX(p.heading) * d, p.z + fwdZ(p.heading) * d, true, 2.2);
      }
    }
    land(c, rt, v);
    if (v.finale && rt.t >= ev.duration + SETTLE) {
      if (c.state.player.alive) resolve(c, rt, OUTCOME_SUCCESS, 'Eruption Survived', 'The mountain falls quiet. Gold glitters on the water!');
      complete(rt);
    }
  },

  finish(c) {
    // Bombs still in the air fizzle into the sea.
    for (const h of c.state.hazards) if (h.alive && h.kind === 'lava-bomb') h.alive = false;
  },
};

/** Picks a landing circle around the player and throws a bomb at it. */
function launch(c: SimContext, v: EruptionState, gold: boolean): void {
  const p = c.state.player;
  if (!p.alive) return;
  const lead = 1.2;
  let tx = p.x + p.vx * lead, tz = p.z + p.vz * lead;
  const a = c.random() * TAU;
  // Gold lands a sail away (worth a detour); lava hunts the ship or blankets the water around it.
  const r = gold ? 30 + c.random() * 45 : c.random() < 0.4 ? c.random() * 9 : 12 + c.random() * 55;
  tx += Math.sin(a) * r; tz += Math.cos(a) * r;
  if (!c.world.isWater(tx, tz, 3)) return;
  const dist = Math.hypot(tx - v.vx, tz - v.vz);
  bomb(c, v, tx, tz, gold, Math.max(1.7, Math.min(3, 1.6 + dist / 300)));
}

/** Throws one bomb; returns its hazard id (0 when the pool is full). */
function bomb(c: SimContext, v: EruptionState, x: number, z: number, gold: boolean, flight: number): number {
  const radius = gold ? EVENT_TUNING.eruptionBombRadius * 0.7 : EVENT_TUNING.eruptionBombRadius * (0.85 + c.random() * 0.35);
  const h = c.spawnHazard({
    kind: 'lava-bomb', team: gold ? 'player' : 'enemy', x, z, radius, ttl: flight,
    damage: gold ? 0 : eventPlayerDamage(c, EVENT_TUNING.eruptionBombDamage),
  });
  if (!h) return 0;
  v.launched++;
  c.addTelegraph({ shape: 'circle', team: gold ? 'player' : 'enemy', x, z, radius, duration: flight });
  return h.id;
}

/** Resolves every bomb that lands this tick (CORE would expire it at the end of the tick). */
function land(c: SimContext, rt: EventRuntime, v: EruptionState): void {
  const hazards = c.state.hazards;
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i]!;
    if (!h.alive || h.kind !== 'lava-bomb' || h.age + c.dt < h.ttl - 1e-6) continue;
    h.alive = false;
    if (h.team === 'player') gold(c, h, v);
    else lava(c, rt, h);
  }
}

function lava(c: SimContext, rt: EventRuntime, h: HazardState): void {
  const burn = eventPlayerDamage(c, 1.6);
  blastCircle(c, rt, h.x, h.z, h.radius, h.damage, eventShipDamage(c, EVENT_TUNING.eruptionBombEnemy), { knock: 6, burn, bossMul: 0.2 });
  c.emit({ type: 'explosion', x: h.x, z: h.z, radius: h.radius, kind: 'fire', team: 'enemy' });
  c.spawnHazard({ kind: 'fire-patch', team: 'enemy', x: h.x, z: h.z, radius: h.radius * 0.72, ttl: FIRE_TTL, damage: burn * 0.5, tick: 0.5 });
}

function gold(c: SimContext, h: HazardState, v: EruptionState): void {
  const minute = c.state.time / 60;
  c.emit({ type: 'explosion', x: h.x, z: h.z, radius: 7, kind: 'water', team: 'player' });
  if (h.id === v.finaleId) {
    payout(c, h.x, h.z, EVENT_TUNING.eruptionDoubloons, 0, 1, 10);
    return;
  }
  spillTreasure(c, h.x, h.z, minute >= 8 ? 12 : 6, 5, 3);
  if (c.random() < 0.3) spillDoubloons(c, h.x, h.z, 2, 5);
}
