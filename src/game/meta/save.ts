/**
 * Meta progression persistence (META-owned): profile + settings in localStorage (`cruise.meta.v2`,
 * `cruise.settings.v2`), harbor upgrade costs, ship/sea unlocks, achievements and run banking.
 *
 * Loading never throws: every field is sanitised (wrong types, NaN, unknown ids, out-of-range ranks, duplicates),
 * unlocks are re-derived from achievements, and unparseable bytes are kept under `<key>.recovery`.
 */
import { META_SAVE_KEY, SETTINGS_KEY } from '../constants';
import { CONTENT } from '../content';
import { HEAT } from '../content/director';
import { META_UPGRADE_IDS, SEA_IDS, SHIP_IDS, type MetaUpgradeId, type SeaId, type ShipId } from '../ids';
import type { AchievementId, MetaProfile, QualitySetting, RunResult, RunSummary, Settings } from '../types';
import { DAILY_KEEP, DAILY_KEY, recordDaily } from './daily';
import { HISTORY_MAX, extendHistory, pushHistory, summarize } from './history';
import { QUEST_IDS, evaluateQuests, questDef, rewardText, type RunRecord } from './quests';

export const ACHIEVEMENT_IDS: readonly AchievementId[] = ['defeat-iron-warden', 'defeat-tidewyrm', 'win-run', 'survive-10', 'kills-1000'];

export const ACHIEVEMENTS: Readonly<Record<AchievementId, { name: string; text: string }>> = {
  'defeat-iron-warden': { name: 'Warden Breaker', text: 'Sink the Iron Warden.' },
  'defeat-tidewyrm': { name: 'Wyrmslayer', text: 'Slay the Tidewyrm.' },
  'win-run': { name: 'Master of the Brightwater', text: 'Sink the Sovereign and win a voyage.' },
  'survive-10': { name: 'Weathered Hull', text: 'Survive 10:00 on any sea.' },
  'kills-1000': { name: 'Scourge of the Seas', text: 'Sink 1,000 ships across all voyages.' },
};

const START_SHIPS: readonly ShipId[] = SHIP_IDS.filter((id) => CONTENT.ships[id].unlock.kind === 'start');
const START_SEAS: readonly SeaId[] = SEA_IDS.filter((id) => CONTENT.seas[id].unlock.kind === 'start');
const QUALITIES: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high', 'ultra'];
const COLOR_BLIND = ['off', 'deutan', 'protan', 'tritan'] as const;
const OUTCOMES: readonly RunResult['outcome'][] = ['victory', 'defeat', 'retired'];

export function defaultProfile(): MetaProfile {
  return {
    version: 2, doubloons: 0, upgrades: {}, unlockedShips: [...START_SHIPS], unlockedSeas: [...START_SEAS],
    achievements: [], bestTime: {}, bestBounty: {}, totalKills: 0, runs: 0, wins: 0, lastShip: START_SHIPS[0] ?? 'dawn-ram',
    lastSea: START_SEAS[0] ?? 'sunward-shallows',
  };
}

export function defaultSettings(): Settings {
  return {
    version: 2, masterVolume: 0.8, musicVolume: 0.7, sfxVolume: 0.85, muted: false, cameraShake: 1, damageNumbers: true, quality: 'auto', showFps: false,
    // Round 2: the first-voyage coach (FLOW) and crew barks (AUDIO) default on.
    coach: true, barks: true,
  };
}

// ───────────────────────── Sanitising ─────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown, max = 1e12): number => (finite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0);
const ratio = (v: unknown, fallback: number): number => (finite(v) ? Math.min(1, Math.max(0, v)) : fallback);

function idList<T extends string>(v: unknown, valid: readonly T[]): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v) if (typeof item === 'string' && (valid as readonly string[]).includes(item) && !out.includes(item as T)) out.push(item as T);
  return out;
}

function numberMap<K extends string>(v: unknown, valid: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!isObj(v)) return out;
  for (const key of valid) { const n = v[key]; if (finite(n) && n > 0) out[key] = n; }
  return out;
}

// ── Round 2 fields (all optional: saves from before round 2 load unchanged) ──

/** Quest progress: known quest ids only, progress clamped to 0..goal, done a boolean (done implies the goal). */
function sanitizeQuests(v: unknown): MetaProfile['quests'] {
  const out: NonNullable<MetaProfile['quests']> = {};
  if (!isObj(v)) return out;
  for (const id of QUEST_IDS) {
    const q = v[id];
    if (!isObj(q)) continue;
    const goal = questDef(id)?.goal ?? 1;
    const done = q.done === true;
    const progress = done ? goal : Math.min(goal, finite(q.progress) && q.progress > 0 ? q.progress : 0);
    if (done || progress > 0) out[id] = { progress, done };
  }
  return out;
}

/** Highest heat cleared per sea: integers 1..HEAT.max (0 = none is simply absent). */
function sanitizeHeat(v: unknown): MetaProfile['heat'] {
  const out: NonNullable<MetaProfile['heat']> = {};
  if (!isObj(v)) return out;
  for (const id of SEA_IDS) { const n = v[id]; if (finite(n) && n >= 1) out[id] = Math.min(HEAT.max, Math.floor(n)); }
  return out;
}

function sanitizeSummary(v: unknown): RunSummary | null {
  if (!isObj(v)) return null;
  if (typeof v.shipId !== 'string' || !(SHIP_IDS as readonly string[]).includes(v.shipId)) return null;
  if (typeof v.seaId !== 'string' || !(SEA_IDS as readonly string[]).includes(v.seaId)) return null;
  if (typeof v.outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(v.outcome)) return null;
  const s: RunSummary = {
    at: count(v.at, 1e15), shipId: v.shipId as ShipId, seaId: v.seaId as SeaId, outcome: v.outcome as RunResult['outcome'],
    time: finite(v.time) && v.time > 0 ? Math.min(1e7, v.time) : 0, level: Math.max(1, count(v.level, 999)), kills: count(v.kills),
    bounty: count(v.bounty), doubloons: count(v.doubloons), heat: count(v.heat, HEAT.max),
  };
  if (typeof v.daily === 'string' && DAILY_KEY.test(v.daily)) s.daily = v.daily;
  return s;
}

/** The logbook: valid entries only, newest first as stored, at most HISTORY_MAX. */
function sanitizeHistory(v: unknown): RunSummary[] {
  if (!Array.isArray(v)) return [];
  const out: RunSummary[] = [];
  for (const item of v) { const s = sanitizeSummary(item); if (s) out.push(s); if (out.length >= HISTORY_MAX) break; }
  return out;
}

/** Daily bests: 'YYYY-MM-DD' keys with positive finite bounties, the newest DAILY_KEEP days. */
function sanitizeDaily(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  const keys = Object.keys(v).filter((k) => DAILY_KEY.test(k)).sort().slice(-DAILY_KEEP);
  for (const k of keys) { const n = v[k]; if (finite(n) && n >= 0) out[k] = Math.floor(n); }
  return out;
}

/** FLOW's one-time coach hints: short unique strings. */
function sanitizeHints(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) if (typeof item === 'string' && item.length > 0 && item.length <= 64 && !out.includes(item)) { out.push(item); if (out.length >= 128) break; }
  return out;
}

/** Turns anything (old versions, hand-edited JSON, garbage) into a valid profile. */
export function sanitizeProfile(raw: unknown): MetaProfile {
  const base = defaultProfile();
  if (!isObj(raw)) return base;
  const upgrades: Partial<Record<MetaUpgradeId, number>> = {};
  if (isObj(raw.upgrades)) {
    for (const id of META_UPGRADE_IDS) {
      const rank = count(raw.upgrades[id], CONTENT.metaUpgrades[id].maxRank);
      if (rank > 0) upgrades[id] = rank;
    }
  }
  const profile: MetaProfile = {
    version: 2,
    doubloons: count(raw.doubloons),
    upgrades,
    unlockedShips: idList(raw.unlockedShips, SHIP_IDS),
    unlockedSeas: idList(raw.unlockedSeas, SEA_IDS),
    achievements: idList(raw.achievements, ACHIEVEMENT_IDS),
    bestTime: numberMap(raw.bestTime, SHIP_IDS),
    bestBounty: numberMap(raw.bestBounty, SHIP_IDS),
    totalKills: count(raw.totalKills),
    runs: count(raw.runs),
    wins: count(raw.wins),
    lastShip: typeof raw.lastShip === 'string' && (SHIP_IDS as readonly string[]).includes(raw.lastShip) ? (raw.lastShip as ShipId) : base.lastShip,
    lastSea: typeof raw.lastSea === 'string' && (SEA_IDS as readonly string[]).includes(raw.lastSea) ? (raw.lastSea as SeaId) : base.lastSea,
  };
  // Round 2: copied only when present, so an old save round-trips byte-for-byte in shape.
  if (raw.seenHints !== undefined) profile.seenHints = sanitizeHints(raw.seenHints);
  if (raw.quests !== undefined) profile.quests = sanitizeQuests(raw.quests);
  if (raw.heat !== undefined) profile.heat = sanitizeHeat(raw.heat);
  if (raw.history !== undefined) profile.history = sanitizeHistory(raw.history);
  if (raw.daily !== undefined) profile.daily = sanitizeDaily(raw.daily);
  if (profile.wins > profile.runs) profile.runs = profile.wins;
  for (const id of START_SHIPS) if (!profile.unlockedShips.includes(id)) profile.unlockedShips.unshift(id);
  for (const id of START_SEAS) if (!profile.unlockedSeas.includes(id)) profile.unlockedSeas.unshift(id);
  syncUnlocks(profile);
  if (!profile.unlockedShips.includes(profile.lastShip)) profile.lastShip = base.lastShip;
  if (!profile.unlockedSeas.includes(profile.lastSea)) profile.lastSea = base.lastSea;
  return profile;
}

export function sanitizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!isObj(raw)) return base;
  return {
    version: 2,
    masterVolume: ratio(raw.masterVolume, base.masterVolume),
    musicVolume: ratio(raw.musicVolume, base.musicVolume),
    sfxVolume: ratio(raw.sfxVolume, base.sfxVolume),
    muted: typeof raw.muted === 'boolean' ? raw.muted : base.muted,
    cameraShake: finite(raw.cameraShake) ? Math.min(2, Math.max(0, raw.cameraShake)) : base.cameraShake,
    damageNumbers: typeof raw.damageNumbers === 'boolean' ? raw.damageNumbers : base.damageNumbers,
    ...(typeof raw.reduceFlashing === 'boolean' ? { reduceFlashing: raw.reduceFlashing } : {}),
    quality: typeof raw.quality === 'string' && (QUALITIES as readonly string[]).includes(raw.quality) ? (raw.quality as QualitySetting) : base.quality,
    showFps: typeof raw.showFps === 'boolean' ? raw.showFps : base.showFps,
    ...(finite(raw.captains) ? { captains: Math.min(4, Math.max(0, Math.round(raw.captains))) } : {}),
    // Round 2 (FLOW / IMPACT / AUDIO settings): kept when valid, so they survive a reload; coach and barks default on.
    coach: typeof raw.coach === 'boolean' ? raw.coach : true,
    barks: typeof raw.barks === 'boolean' ? raw.barks : true,
    ...(typeof raw.colorBlind === 'string' && (COLOR_BLIND as readonly string[]).includes(raw.colorBlind) ? { colorBlind: raw.colorBlind as Settings['colorBlind'] } : {}),
    ...(finite(raw.hudScale) ? { hudScale: Math.min(1.2, Math.max(0.8, raw.hudScale)) } : {}),
    ...(typeof raw.cinematicCamera === 'boolean' ? { cinematicCamera: raw.cinematicCamera } : {}),
  };
}

// ───────────────────────── Storage ─────────────────────────

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function loadProfile(): MetaProfile {
  const store = storage();
  const raw = store?.getItem(META_SAVE_KEY);
  if (!raw) return defaultProfile();
  try {
    return sanitizeProfile(JSON.parse(raw));
  } catch {
    try { store?.setItem(`${META_SAVE_KEY}.recovery`, raw); } catch { /* storage full */ }
    return defaultProfile();
  }
}

export function saveProfile(profile: MetaProfile): void {
  try { storage()?.setItem(META_SAVE_KEY, JSON.stringify(profile)); } catch { /* storage unavailable */ }
}

export function loadSettings(): Settings {
  const store = storage();
  const raw = store?.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings();
  try {
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    try { store?.setItem(`${SETTINGS_KEY}.recovery`, raw); } catch { /* storage full */ }
    return defaultSettings();
  }
}

export function saveSettings(settings: Settings): void {
  try { storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

// ───────────────────────── Harbor ─────────────────────────

/** Cost of the next rank, or null when maxed. */
export function upgradeCost(profile: MetaProfile, id: MetaUpgradeId): number | null {
  const def = CONTENT.metaUpgrades[id];
  const rank = profile.upgrades[id] ?? 0;
  return rank >= def.maxRank ? null : def.costs[rank] ?? null;
}

export function purchaseUpgrade(profile: MetaProfile, id: MetaUpgradeId): boolean {
  const cost = upgradeCost(profile, id);
  if (cost === null || profile.doubloons < cost) return false;
  profile.doubloons -= cost;
  profile.upgrades[id] = (profile.upgrades[id] ?? 0) + 1;
  return true;
}

/** Buys a doubloon-unlocked ship. Achievement ships unlock themselves in applyRunResult. */
export function unlockShip(profile: MetaProfile, id: ShipId): boolean {
  const def = CONTENT.ships[id];
  if (profile.unlockedShips.includes(id) || def.unlock.kind !== 'doubloons') return false;
  if (profile.doubloons < def.unlock.cost) return false;
  profile.doubloons -= def.unlock.cost;
  profile.unlockedShips.push(id);
  return true;
}

export interface UnlockState {
  unlocked: boolean;
  /** Doubloon price when the ship can be bought. */
  cost?: number;
  affordable?: boolean;
  /** How to unlock ("Defeat the Iron Warden", "450 ◈"). */
  text: string;
}

export function shipUnlockState(profile: MetaProfile, id: ShipId): UnlockState {
  const u = CONTENT.ships[id].unlock;
  const unlocked = profile.unlockedShips.includes(id);
  if (u.kind === 'doubloons') return { unlocked, cost: u.cost, affordable: profile.doubloons >= u.cost, text: `${u.cost} ◈` };
  if (u.kind === 'achievement') return { unlocked, text: u.text };
  return { unlocked: true, text: 'Available from the start' };
}

export function seaUnlockState(profile: MetaProfile, id: SeaId): UnlockState {
  const u = CONTENT.seas[id].unlock;
  return { unlocked: profile.unlockedSeas.includes(id), text: u.kind === 'achievement' ? u.text : 'Available from the start' };
}

/** Unlocks every achievement-gated ship/sea whose achievement is held. Returns human-readable unlock lines. */
function syncUnlocks(profile: MetaProfile): string[] {
  const unlocks: string[] = [];
  for (const id of SHIP_IDS) {
    const ship = CONTENT.ships[id];
    if (ship.unlock.kind === 'achievement' && profile.achievements.includes(ship.unlock.achievement) && !profile.unlockedShips.includes(id)) {
      profile.unlockedShips.push(id);
      unlocks.push(`New ship: ${ship.name}, ${ship.epithet}`);
    }
  }
  for (const id of SEA_IDS) {
    const sea = CONTENT.seas[id];
    if (sea.unlock.kind === 'achievement' && profile.achievements.includes(sea.unlock.achievement) && !profile.unlockedSeas.includes(id)) {
      profile.unlockedSeas.push(id);
      unlocks.push(`New sea: ${sea.name}`);
    }
  }
  return unlocks;
}

/** What REPLAY adds to a banked run: heat, the daily key and the run tracker's quest record. */
export interface VoyageRecord {
  heat: number;
  daily?: string;
  /** Whole-voyage counters (voyage quests); omitted = nothing tracked. */
  run?: RunRecord;
  /** Counters since the last banking (ledger quests); defaults to `run`. */
  delta?: RunRecord;
}

/** A quest record with no tracked counters (tests, and callers without a RunTracker). */
export function bareRecord(result: RunResult, heat = 0, daily?: string): RunRecord {
  return {
    result, heat, daily, bountyCaptains: 0, eventsWon: 0, rogueRides: 0, krakenSurvived: 0, noHitBosses: 0, bossesSunk: 0,
    fastWardens: 0, overdrives: 0, parries: 0, milestones: 0,
  };
}

/**
 * Banks a finished run into the profile and returns what it unlocked, in display order: achievements, then ships
 * and seas, heat, quests and the daily best, then doubloon ships that just became affordable.
 * `continuation`: the endless stretch of a run already credited at its victory (not another run or win).
 */
export function applyRunResult(profile: MetaProfile, result: RunResult, continuation = false, voyage: VoyageRecord = { heat: 0 }): string[] {
  const lines: string[] = [];
  const before = profile.doubloons;
  const heat = Math.max(0, Math.min(HEAT.max, Math.floor(voyage.heat || 0)));
  const daily = voyage.daily;
  if (!continuation) profile.runs++;
  profile.doubloons += Math.max(0, Math.floor(result.doubloonsEarned));
  profile.totalKills += Math.max(0, Math.floor(result.stats.kills));
  profile.bestTime[result.shipId] = Math.max(profile.bestTime[result.shipId] ?? 0, result.time);
  profile.bestBounty[result.shipId] = Math.max(profile.bestBounty[result.shipId] ?? 0, result.stats.bounty);
  // A daily voyage may sail a lent ship or sea: never leave the harbor pointed at one the captain does not own.
  if (profile.unlockedShips.includes(result.shipId)) profile.lastShip = result.shipId;
  if (profile.unlockedSeas.includes(result.seaId)) profile.lastSea = result.seaId;
  const grant = (achievement: AchievementId) => {
    if (profile.achievements.includes(achievement)) return;
    profile.achievements.push(achievement);
    lines.push(`Achievement: ${ACHIEVEMENTS[achievement].name}`);
  };
  if (result.time >= 600) grant('survive-10');
  if (result.stats.bossesDefeated.includes('iron-warden')) grant('defeat-iron-warden');
  if (result.stats.bossesDefeated.includes('tidewyrm')) grant('defeat-tidewyrm');
  if (result.outcome === 'victory' && !continuation) { grant('win-run'); profile.wins++; }
  if (profile.totalKills >= 1000) grant('kills-1000');
  lines.push(...syncUnlocks(profile));
  // Heat: winning heat N on a sea opens N + 1 there (daily voyages sail at heat 0 and do not count).
  if (result.outcome === 'victory' && !continuation && !daily && heat >= 1 && heat > (profile.heat?.[result.seaId] ?? 0)) {
    (profile.heat ??= {})[result.seaId] = heat;
    const sea = CONTENT.seas[result.seaId].name;
    lines.push(heat < HEAT.max ? `Heat ${heat} cleared on ${sea}: heat ${heat + 1} is open` : `Heat ${heat} cleared on ${sea}: the top of the ladder`);
  }
  // Logbook.
  if (continuation) extendHistory(profile, result);
  else pushHistory(profile, summarize(result, heat, daily));
  // Daily best.
  if (daily && recordDaily(profile, daily, result.stats.bounty)) lines.push(`Daily voyage ${daily}: new best bounty ${Math.floor(result.stats.bounty).toLocaleString('en-US')}`);
  // Quests (after the totals above, which ledger quests read).
  const record = voyage.run ?? bareRecord(result, heat, daily);
  for (const q of evaluateQuests(profile, record, voyage.delta ?? record)) {
    const reward = rewardText(q.reward);
    lines.push(`Quest complete: ${q.name}${reward ? ` (${reward})` : ''}`);
  }
  for (const id of SHIP_IDS) {
    const ship = CONTENT.ships[id];
    if (ship.unlock.kind !== 'doubloons' || profile.unlockedShips.includes(id)) continue;
    if (before < ship.unlock.cost && profile.doubloons >= ship.unlock.cost) lines.push(`${ship.name} can now be bought in the harbor (${ship.unlock.cost} ◈)`);
  }
  return lines;
}
