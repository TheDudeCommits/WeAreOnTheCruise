/**
 * Per-run scratch owned by META systems (director, AI, bosses, weather) that does not belong in the contract
 * RunState: pooled pending lightning strikes, fort bookkeeping and cached spawn tables. Keyed by the RunState
 * object in a WeakMap, so every Sim instance gets its own store and nothing leaks between runs or tests.
 */
import type { SeaId } from '../ids';
import type { ContentDb, IslandDef, RunState } from '../types';
import { SPAWN_BANDS, type SpawnEntry } from '../content/director';

export interface PendingStrike {
  active: boolean;
  x: number;
  z: number;
  /** Seconds until the bolt lands. */
  t: number;
  radius: number;
  damage: number;
  enemyDamage: number;
}

export interface SeaBand {
  from: number;
  entries: SpawnEntry[];
  total: number;
}

export interface MetaRuntime {
  strikes: PendingStrike[];
  /** Islands that already carry a fort battery. */
  fortIslands: Set<string>;
  /** Spawn bands filtered for this run's sea. */
  bands: SeaBand[];
  islands: IslandDef[];
  /** Fleet fire-control tokens (volleys available now). */
  fire: number;
}

const STRIKE_POOL = 32;
const STORES = new WeakMap<RunState, MetaRuntime>();

export function metaRuntime(state: RunState, content: ContentDb): MetaRuntime {
  let rt = STORES.get(state);
  if (!rt) {
    rt = {
      strikes: Array.from({ length: STRIKE_POOL }, () => ({ active: false, x: 0, z: 0, t: 0, radius: 0, damage: 0, enemyDamage: 0 })),
      fortIslands: new Set(),
      bands: buildBands(state.seaId, content),
      islands: [],
      fire: 1,
    };
    STORES.set(state, rt);
  }
  return rt;
}

/** Spawn bands with entries filtered by the sea's factions (firstMinute is checked at draw time). */
export function buildBands(seaId: SeaId, content: ContentDb): SeaBand[] {
  const sea = content.seas[seaId];
  const out: SeaBand[] = [];
  for (const band of SPAWN_BANDS) {
    const entries = band.entries.filter((en) => sea.enemyFactions.includes(content.enemies[en.enemy].faction));
    out.push({ from: band.from, entries, total: entries.reduce((sum, en) => sum + en.weight, 0) });
  }
  return out;
}

/** The band active at `minute` (last band whose `from` has passed). */
export function bandAt(bands: readonly SeaBand[], minute: number): SeaBand {
  let pick = bands[0]!;
  for (const band of bands) if (band.from <= minute && band.entries.length > 0) pick = band;
  return pick;
}

/** Director scratch keys (DirectorState.scratch) used across META modules. Keeping them here avoids typos. */
export const SCRATCH = {
  nextEvent: 'nextEvent',
  nextFort: 'nextFort',
  victoryAt: 'victoryAt',
  lastWage: 'lastWage',
  lastBountySecond: 'lastBountySecond',
  chestElite: 'chestElite',
  chestBoss: 'chestBoss',
  fogBank: 'fogBank',
  fogBankMax: 'fogBankMax',
  stormFront: 'stormFront',
  nextStrike: 'nextStrike',
  nextEntry: 'nextEntry',
  nextSize: 'nextSize',
  nextBand: 'nextBand',
  endlessNext: 'endlessNext',
  endlessCount: 'endlessCount',
  endlessWarned: 'endlessWarned',
  mergeTimer: 'mergeTimer',
} as const;

/** Per-event run counters: `evt:<id>`. */
export const eventKey = (id: string): string => `evt:${id}`;

/** Chip totals live in DirectorState.scratch as `chip:<stat>` so they survive stat recomputes. */
export const CHIP_PREFIX = 'chip:';

