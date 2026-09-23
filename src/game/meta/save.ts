/**
 * Meta progression persistence (META-owned): profile + settings in localStorage (`cruise.meta.v2`,
 * `cruise.settings.v2`), harbor upgrade costs, ship/sea unlocks, achievements and run banking.
 *
 * Loading never throws: every field is sanitised (wrong types, NaN, unknown ids, out-of-range ranks, duplicates),
 * unlocks are re-derived from achievements, and unparseable bytes are kept under `<key>.recovery`.
 */
import { META_SAVE_KEY, SETTINGS_KEY } from '../constants';
import { CONTENT } from '../content';
import { META_UPGRADE_IDS, SEA_IDS, SHIP_IDS, type MetaUpgradeId, type SeaId, type ShipId } from '../ids';
import type { AchievementId, MetaProfile, QualitySetting, RunResult, Settings } from '../types';

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

export function defaultProfile(): MetaProfile {
  return {
    version: 2, doubloons: 0, upgrades: {}, unlockedShips: [...START_SHIPS], unlockedSeas: [...START_SEAS],
    achievements: [], bestTime: {}, bestBounty: {}, totalKills: 0, runs: 0, wins: 0, lastShip: START_SHIPS[0] ?? 'dawn-ram',
    lastSea: START_SEAS[0] ?? 'sunward-shallows',
  };
}

export function defaultSettings(): Settings {
  return { version: 2, masterVolume: 0.8, musicVolume: 0.7, sfxVolume: 0.85, muted: false, cameraShake: 1, damageNumbers: true, quality: 'auto', showFps: false };
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
    quality: typeof raw.quality === 'string' && (QUALITIES as readonly string[]).includes(raw.quality) ? (raw.quality as QualitySetting) : base.quality,
    showFps: typeof raw.showFps === 'boolean' ? raw.showFps : base.showFps,
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

/**
 * Banks a finished run into the profile and returns what it unlocked, in display order: achievements, then ships
 * and seas, then doubloon ships that just became affordable.
 */
export function applyRunResult(profile: MetaProfile, result: RunResult): string[] {
  const lines: string[] = [];
  const before = profile.doubloons;
  profile.runs++;
  profile.doubloons += Math.max(0, Math.floor(result.doubloonsEarned));
  profile.totalKills += Math.max(0, Math.floor(result.stats.kills));
  profile.bestTime[result.shipId] = Math.max(profile.bestTime[result.shipId] ?? 0, result.time);
  profile.bestBounty[result.shipId] = Math.max(profile.bestBounty[result.shipId] ?? 0, result.stats.bounty);
  profile.lastShip = result.shipId;
  profile.lastSea = result.seaId;
  const grant = (achievement: AchievementId) => {
    if (profile.achievements.includes(achievement)) return;
    profile.achievements.push(achievement);
    lines.push(`Achievement: ${ACHIEVEMENTS[achievement].name}`);
  };
  if (result.time >= 600) grant('survive-10');
  if (result.stats.bossesDefeated.includes('iron-warden')) grant('defeat-iron-warden');
  if (result.stats.bossesDefeated.includes('tidewyrm')) grant('defeat-tidewyrm');
  if (result.outcome === 'victory') { grant('win-run'); profile.wins++; }
  if (profile.totalKills >= 1000) grant('kills-1000');
  lines.push(...syncUnlocks(profile));
  for (const id of SHIP_IDS) {
    const ship = CONTENT.ships[id];
    if (ship.unlock.kind !== 'doubloons' || profile.unlockedShips.includes(id)) continue;
    if (before < ship.unlock.cost && profile.doubloons >= ship.unlock.cost) lines.push(`${ship.name} can now be bought in the harbor (${ship.unlock.cost} ◈)`);
  }
  return lines;
}
