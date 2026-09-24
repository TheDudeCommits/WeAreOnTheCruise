/**
 * Per-run store for world events (EVENTS-owned): the set piece running now, its handler scratch and the points of
 * interest. Keyed by RunState in a WeakMap (like META's metaRuntime), so every Sim gets its own store and nothing
 * leaks between runs or tests. Everything here is sim state that the contract RunState does not carry; what the
 * renderer and HUD need is mirrored into `run.worldEvent`, hazards, telegraphs and enemy AI scratch.
 */
import type { DirectorEventDef, DirectorEventId } from '../../content/director';
import type { IslandDef, WorldEventState } from '../../types';
import type { SimContext, Target } from '../context';

export const OUTCOME_NONE = 0;
export const OUTCOME_SUCCESS = 1;
export const OUTCOME_FAIL = 2;
/** Finished without a verdict (survival set pieces, aborts). */
export const OUTCOME_END = 3;

/** One set piece: a module in src/game/sim/events/. */
export interface WorldEventHandler {
  readonly id: DirectorEventId;
  /**
   * Weight multiplier right now (0 = it cannot run here: no open water, no night, nothing to hunt). Called when the
   * director draws its next event (every 35–60 s), so it may query the world.
   */
  weight?(c: SimContext, rt: EventRuntime, minute: number): number;
  /** Sets the piece up; returns its public state, or null when it cannot start after all. */
  start(c: SimContext, rt: EventRuntime, minute: number): WorldEventState | null;
  /**
   * Every tick until the handler calls `complete(rt)`. The objective verdict comes from `resolve()` (common.ts),
   * which may happen before the piece is physically over (a wave still rolling, arms still sinking).
   */
  update(c: SimContext, rt: EventRuntime, ev: WorldEventState): void;
  /** Cleanup when the state clears. `aborted`: cut short (a boss arrives, another event is forced). */
  finish?(c: SimContext, rt: EventRuntime, ev: WorldEventState, aborted: boolean): void;
}

export class EventRuntime {
  id: DirectorEventId | null = null;
  def: DirectorEventDef | null = null;
  handler: WorldEventHandler | null = null;
  ev: WorldEventState | null = null;
  /** Seconds since the set piece started. */
  t = 0;
  outcome = OUTCOME_NONE;
  /** `t` when the outcome was decided. */
  outcomeAt = 0;
  /** The handler is physically done (arms gone, wave passed…); the state clears after the linger. */
  done = false;
  /** A boss was already about when it started (then a boss does not abort it). */
  bossAtStart = false;
  /** Scratch for spatial queries. */
  readonly targets: Target[] = [];
  readonly islands: IslandDef[] = [];
  private readonly slots = new Map<string, unknown>();

  /** Handler scratch, created once per run on first use (no per-tick allocation). */
  slot<T>(key: string, make: () => T): T {
    let v = this.slots.get(key) as T | undefined;
    if (v === undefined) { v = make(); this.slots.set(key, v); }
    return v;
  }

  reset(): void {
    this.id = null; this.def = null; this.handler = null; this.ev = null;
    this.t = 0; this.outcome = OUTCOME_NONE; this.outcomeAt = 0; this.done = false; this.bossAtStart = false;
  }
}

const STORES = new WeakMap<object, EventRuntime>();

export function eventRuntime(c: SimContext): EventRuntime {
  let rt = STORES.get(c.state);
  if (!rt) { rt = new EventRuntime(); STORES.set(c.state, rt); }
  return rt;
}

/** Marks the running set piece as physically finished. */
export function complete(rt: EventRuntime): void { rt.done = true; }
