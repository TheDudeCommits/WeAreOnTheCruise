/**
 * The logbook (REPLAY): MetaProfile.history keeps the last 20 voyages, newest first, and lifetime stats are derived
 * from the profile (nothing here needs its own storage).
 */
import { SEA_IDS, SHIP_IDS, type SeaId, type ShipId } from '../ids';
import type { MetaProfile, RunResult, RunSummary } from '../types';
import { longestVoyage } from './quests';

export const HISTORY_MAX = 20;

export function summarize(result: Readonly<RunResult>, heat: number, daily?: string, at = Date.now()): RunSummary {
  const s: RunSummary = {
    at, shipId: result.shipId, seaId: result.seaId, outcome: result.outcome, time: result.time, level: result.level,
    kills: result.stats.kills, bounty: result.stats.bounty, doubloons: Math.max(0, Math.floor(result.doubloonsEarned)), heat,
  };
  if (daily) s.daily = daily;
  return s;
}

/** Adds a voyage to the front of the logbook (capped at HISTORY_MAX). */
export function pushHistory(profile: MetaProfile, entry: RunSummary): void {
  const list = (profile.history ??= []);
  list.unshift(entry);
  if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
}

/**
 * A won voyage that sailed on into endless mode is one logbook entry: the endless stretch updates the newest entry
 * instead of logging a second voyage. `stretch` is the runtime's continuation result: time, level and bounty cover
 * the whole voyage; kills and doubloonsEarned only the endless stretch (the victory banked the rest).
 */
export function extendHistory(profile: MetaProfile, stretch: Readonly<RunResult>): void {
  const top = profile.history?.[0];
  if (!top || top.shipId !== stretch.shipId || top.seaId !== stretch.seaId) return;
  top.time = Math.max(top.time, stretch.time);
  top.level = Math.max(top.level, stretch.level);
  top.kills += Math.max(0, Math.floor(stretch.stats.kills));
  top.bounty = Math.max(top.bounty, stretch.stats.bounty);
  top.doubloons += Math.max(0, Math.floor(stretch.doubloonsEarned));
}

export interface LifetimeStats {
  voyages: number;
  wins: number;
  winRate: number;
  kills: number;
  bestBounty: number;
  bestBountyShip: ShipId | null;
  longestVoyage: number;
  /** Most sailed ship in the logbook. */
  favouriteShip: ShipId | null;
  /** Highest heat cleared per sea (0 = none). */
  heat: Record<SeaId, number>;
  /** Doubloons banked by the voyages in the logbook. */
  logbookDoubloons: number;
  /** Victories in the logbook's voyages (last 20). */
  recentWins: number;
}

export function lifetimeStats(profile: Readonly<MetaProfile>): LifetimeStats {
  let bestBounty = 0, bestBountyShip: ShipId | null = null;
  for (const id of SHIP_IDS) { const b = profile.bestBounty[id] ?? 0; if (b > bestBounty) { bestBounty = b; bestBountyShip = id; } }
  const counts = new Map<ShipId, number>();
  let logbookDoubloons = 0, recentWins = 0;
  for (const h of profile.history ?? []) {
    counts.set(h.shipId, (counts.get(h.shipId) ?? 0) + 1);
    logbookDoubloons += h.doubloons;
    if (h.outcome === 'victory') recentWins++;
  }
  let favouriteShip: ShipId | null = null, most = 0;
  for (const [id, n] of counts) if (n > most) { most = n; favouriteShip = id; }
  const heat = {} as Record<SeaId, number>;
  for (const id of SEA_IDS) heat[id] = profile.heat?.[id] ?? 0;
  return {
    voyages: profile.runs, wins: profile.wins, winRate: profile.runs > 0 ? profile.wins / profile.runs : 0,
    kills: profile.totalKills, bestBounty, bestBountyShip, longestVoyage: longestVoyage(profile), favouriteShip, heat,
    logbookDoubloons, recentWins,
  };
}
