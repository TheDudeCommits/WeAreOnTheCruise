/**
 * World events (EVENTS-owned): the big-world set pieces beyond META's first six (src/game/sim/events/*), the public
 * `state.worldEvent` for the HUD tracker, minimap ring and effects, the event cadence, and the points of interest
 * between them (events/poi.ts: trade-wind lanes, lighthouse beacons, floating salvage).
 *
 * Director hooks (src/game/sim/director.ts):
 *  - startWorldEvent: startEvent's fallback for ids it does not handle (true when handled). startEvent has already
 *    emitted the director-event banner; this adds 'world-event' start → success|fail → end.
 *  - updateWorldEvents: every director tick (after runEvents): runs the set piece, clears it after its outcome
 *    flourish, and holds the cadence — while any event runs (META's included) the next one waits, then a lull.
 *  - eventWeight: runEvents' weight for every candidate: the sea's multipliers, one set piece at a time, never into
 *    a boss arrival, and each set piece's own feasibility (open water, night, something to hunt).
 */
import { DIRECTOR_EVENTS, EVENT_TUNING, SEA_EVENTS, type DirectorEventId } from '../content/director';
import type { SimContext } from './context';
import { SCRATCH } from './meta-runtime';
import { HANDLERS } from './events/registry';
import { updatePois } from './events/poi';
import { OUTCOME_END, OUTCOME_NONE, eventRuntime, type EventRuntime } from './events/runtime';

export function startWorldEvent(c: SimContext, id: DirectorEventId, minute: number): boolean {
  const handler = HANDLERS[id];
  if (!handler) return false;
  const rt = eventRuntime(c);
  if (rt.id) clear(c, rt, true);
  rt.reset();
  const ev = handler.start(c, rt, minute);
  const d = c.state.director;
  if (!ev) {
    rt.reset();
    if (d.event === DIRECTOR_EVENTS[id].name) { d.event = null; d.eventTime = 0; }
    return false;
  }
  rt.id = id;
  rt.lastId = id;
  rt.def = DIRECTOR_EVENTS[id];
  rt.handler = handler;
  rt.ev = ev;
  rt.bossAtStart = !!(d.bossWarning || d.activeBoss);
  c.state.worldEvent = ev;
  c.emit({ type: 'world-event', id, phase: 'start', name: ev.name, text: ev.text, x: ev.x, z: ev.z });
  return true;
}

export function updateWorldEvents(c: SimContext): void {
  const rt = eventRuntime(c);
  const s = c.state;
  if (rt.id && rt.handler && rt.ev) {
    const ev = rt.ev;
    rt.t += c.dt;
    if (rt.outcome === OUTCOME_NONE) ev.time = Math.min(ev.duration, rt.t);
    const d = s.director;
    if (!rt.bossAtStart && rt.outcome === OUTCOME_NONE && (d.bossWarning || d.activeBoss)) {
      // A boss is coming: the set piece gives way.
      clear(c, rt, true);
    } else {
      if (!rt.done) rt.handler.update(c, rt, ev);
      if (rt.done && rt.outcome === OUTCOME_NONE) { rt.outcome = OUTCOME_END; rt.outcomeAt = rt.t; }
      if (rt.done && rt.t - rt.outcomeAt >= EVENT_TUNING.linger) clear(c, rt, false);
    }
  }
  updatePois(c, rt);
  holdCadence(c, rt);
}

/** Director weight hook for event `id` (base = its def weight after META's own adjustments). */
export function eventWeight(c: SimContext, id: DirectorEventId, base: number, minute: number): number {
  if (!(base > 0)) return 0;
  const s = c.state;
  const rt = eventRuntime(c);
  if (rt.id) return 0;
  let w = base * (SEA_EVENTS[s.seaId]?.weights?.[id] ?? 1);
  const handler = HANDLERS[id];
  if (!handler) return w;
  // Variety: the same set piece twice in a row is rare.
  if (rt.lastId === id) w *= EVENT_TUNING.repeatWeight;
  // Never let a set piece run into a boss arrival.
  const margin = DIRECTOR_EVENTS[id].duration + EVENT_TUNING.bossMargin;
  const sea = c.content.seas[s.seaId];
  const nextBoss = sea.bosses[s.director.nextBossIndex];
  if (nextBoss && nextBoss.at - s.time < margin) return 0;
  const endlessAt = s.endless ? s.director.scratch[SCRATCH.endlessNext] ?? 0 : 0;
  if (endlessAt > 0 && endlessAt - s.time < margin) return 0;
  if (handler.weight) w *= handler.weight(c, rt, minute);
  return w;
}

/** The set piece running now (tests, QA). */
export function activeWorldEvent(c: SimContext): DirectorEventId | null {
  return eventRuntime(c).id;
}

function clear(c: SimContext, rt: EventRuntime, aborted: boolean): void {
  const ev = rt.ev;
  if (ev && rt.handler) {
    rt.handler.finish?.(c, rt, ev, aborted);
    c.emit({ type: 'world-event', id: ev.id, phase: 'end', name: ev.name, text: aborted ? 'Cut short' : ev.text, x: ev.x, z: ev.z });
    if (c.state.worldEvent === ev) c.state.worldEvent = null;
    const d = c.state.director;
    if (d.event === ev.name) { d.event = null; d.eventTime = 0; }
  }
  rt.reset();
}

/**
 * While any set piece runs the director's next draw waits, and after it a lull: the def's own `lull` (big set
 * pieces) or EVENT_TUNING.lull; META's six (which only keep d.event/d.eventTime) get EVENT_TUNING.lullAfterMeta.
 */
function holdCadence(c: SimContext, rt: EventRuntime): void {
  const s = c.state, d = s.director, sc = d.scratch;
  const next = sc[SCRATCH.nextEvent];
  if (next === undefined) return;
  let hold = 0;
  if (rt.id) hold = rt.def?.lull ?? EVENT_TUNING.lull;
  else if (d.event && d.eventTime > 0) hold = d.eventTime + EVENT_TUNING.lullAfterMeta;
  if (hold > 0 && next < s.time + hold) sc[SCRATCH.nextEvent] = s.time + hold;
}
