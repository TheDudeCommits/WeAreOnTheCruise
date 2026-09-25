/**
 * Per-run captain bookkeeping (CAPTAINS-owned) that does not belong in the contract RunState: the configured count
 * (from Settings.captains through `configureCaptains`), join progress and last tick's aggro tallies. Keyed by the
 * RunState in a WeakMap like META's meta-runtime, so every Sim gets its own store and nothing leaks between runs.
 */
import { CAPTAIN } from '../content/captains';
import type { CaptainState, RunState } from '../types';

export interface CaptainRuntime {
  /** Captains this sea holds (0–4). */
  count: number;
  /** Captains that have sailed in so far. */
  joined: number;
  /** Seeded draws: persona index and ship per slot (filled on the first tick). */
  personas: number[];
  /** Enemies that focused the player / each captain slot on the last tallied tick. */
  focusPlayer: number;
  focusCaptain: Int32Array;
  /** Live (non-boss) enemies on the last tallied tick. */
  aliveEnemies: number;
  /** QA/balance counters: enemy-ticks focused on the player vs on captains, captain sinkings. */
  ticksPlayer: number;
  ticksCaptains: number;
  sinkings: number;
  /** Rivals: captains the player sank, seconds some captain was hostile to the player. */
  sunkByPlayer: number;
  hostileTime: number;
  /** Run time of the last rival chest (CAPTAIN.rival.chestGap). */
  rivalChestAt: number;
}

const STORES = new WeakMap<RunState, CaptainRuntime>();

export function captainRuntime(state: RunState): CaptainRuntime {
  let rt = STORES.get(state);
  if (!rt) {
    rt = {
      count: 0, joined: 0, personas: [], focusPlayer: 0, focusCaptain: new Int32Array(CAPTAIN.max), aliveEnemies: 0,
      ticksPlayer: 0, ticksCaptains: 0, sinkings: 0, sunkByPlayer: 0, hostileTime: 0, rivalChestAt: -1e9,
    };
    STORES.set(state, rt);
  }
  return rt;
}

/**
 * Sets how many AI captains sail this run (clamped 0–4). Call right after constructing the Sim (the runtime passes
 * Settings.captains; tests and tools default to 0). Lowering the count mid-run sinks nobody: it only stops joins.
 */
export function configureCaptains(state: RunState, count: number): void {
  const n = Number.isFinite(count) ? Math.max(0, Math.min(CAPTAIN.max, Math.floor(count))) : 0;
  captainRuntime(state).count = n;
}

/** Settings.captains with the default for older saves. */
export function captainSetting(settings: { captains?: number }): number {
  const v = settings.captains;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(CAPTAIN.max, Math.round(v))) : CAPTAIN.defaultCount;
}

/** Live captain by id (ids are negative ShipRefs), or null. */
export function captainById(list: readonly CaptainState[], id: number): CaptainState | null {
  for (let i = 0; i < list.length; i++) { const k = list[i]!; if (k.id === id) return k; }
  return null;
}

/** Slot index (0..3) of a captain id. */
export const captainSlot = (id: number): number => -id - 1;

/** Number of captains afloat right now. */
export function captainsAfloat(state: RunState): number {
  let n = 0;
  for (const k of state.captains) if (k.alive) n++;
  return n;
}

/** Director budget multiplier: the sea fills up for the extra hunters (+CAPTAIN.budgetPerCaptain per captain afloat). */
export function captainBudgetMul(state: RunState): number {
  const caps = state.captains;
  if (caps.length === 0) return 1;
  let n = 0;
  for (const k of caps) if (k.alive) n++;
  return 1 + CAPTAIN.budgetPerCaptain * n;
}
