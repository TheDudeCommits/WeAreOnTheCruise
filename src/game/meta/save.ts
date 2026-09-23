/**
 * Meta progression persistence (META-owned). Versioned JSON in localStorage; invalid data falls back to defaults
 * (the bad bytes are kept under a recovery key).
 */
import { META_SAVE_KEY, SETTINGS_KEY } from '../constants';
import { CONTENT } from '../content';
import { META_UPGRADE_IDS, SEA_IDS, SHIP_IDS, type MetaUpgradeId, type ShipId } from '../ids';
import type { MetaProfile, RunResult, Settings } from '../types';

export function defaultProfile(): MetaProfile {
  return {
    version: 2, doubloons: 0, upgrades: {}, unlockedShips: ['dawn-ram', 'sunlion'], unlockedSeas: ['sunward-shallows'],
    achievements: [], bestTime: {}, bestBounty: {}, totalKills: 0, runs: 0, wins: 0, lastShip: 'dawn-ram', lastSea: 'sunward-shallows',
  };
}

export function defaultSettings(): Settings {
  return { version: 2, masterVolume: 0.8, musicVolume: 0.7, sfxVolume: 0.85, muted: false, cameraShake: 1, damageNumbers: true, quality: 'auto', showFps: false };
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function loadProfile(): MetaProfile {
  const raw = storage()?.getItem(META_SAVE_KEY);
  if (!raw) return defaultProfile();
  try {
    const value = JSON.parse(raw) as Partial<MetaProfile>;
    if (value.version !== 2) throw new Error('version');
    const base = defaultProfile();
    const profile: MetaProfile = { ...base, ...value, version: 2 };
    profile.unlockedShips = (profile.unlockedShips ?? []).filter((id) => (SHIP_IDS as readonly string[]).includes(id));
    for (const id of base.unlockedShips) if (!profile.unlockedShips.includes(id)) profile.unlockedShips.push(id);
    profile.unlockedSeas = (profile.unlockedSeas ?? []).filter((id) => (SEA_IDS as readonly string[]).includes(id));
    if (!profile.unlockedSeas.includes('sunward-shallows')) profile.unlockedSeas.unshift('sunward-shallows');
    if (!Number.isFinite(profile.doubloons) || profile.doubloons < 0) profile.doubloons = 0;
    for (const key of Object.keys(profile.upgrades)) if (!(META_UPGRADE_IDS as readonly string[]).includes(key)) delete profile.upgrades[key as MetaUpgradeId];
    if (!profile.unlockedShips.includes(profile.lastShip)) profile.lastShip = 'dawn-ram';
    return profile;
  } catch {
    storage()?.setItem(`${META_SAVE_KEY}.recovery`, raw);
    return defaultProfile();
  }
}

export function saveProfile(profile: MetaProfile): void {
  try { storage()?.setItem(META_SAVE_KEY, JSON.stringify(profile)); } catch { /* storage unavailable */ }
}

export function loadSettings(): Settings {
  const raw = storage()?.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings();
  try {
    const value = JSON.parse(raw) as Partial<Settings>;
    return { ...defaultSettings(), ...value, version: 2 };
  } catch { return defaultSettings(); }
}

export function saveSettings(settings: Settings): void {
  try { storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

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

export function unlockShip(profile: MetaProfile, id: ShipId): boolean {
  const def = CONTENT.ships[id];
  if (profile.unlockedShips.includes(id) || def.unlock.kind !== 'doubloons') return false;
  if (profile.doubloons < def.unlock.cost) return false;
  profile.doubloons -= def.unlock.cost;
  profile.unlockedShips.push(id);
  return true;
}

/** Banks a finished run into the profile; returns human-readable new unlocks. */
export function applyRunResult(profile: MetaProfile, result: RunResult): string[] {
  const unlocks: string[] = [];
  profile.runs++;
  profile.doubloons += result.doubloonsEarned;
  profile.totalKills += result.stats.kills;
  profile.bestTime[result.shipId] = Math.max(profile.bestTime[result.shipId] ?? 0, result.time);
  profile.bestBounty[result.shipId] = Math.max(profile.bestBounty[result.shipId] ?? 0, result.stats.bounty);
  const grant = (achievement: MetaProfile['achievements'][number]) => {
    if (!profile.achievements.includes(achievement)) profile.achievements.push(achievement);
  };
  if (result.time >= 600) grant('survive-10');
  if (result.stats.bossesDefeated.includes('iron-warden')) grant('defeat-iron-warden');
  if (result.stats.bossesDefeated.includes('tidewyrm')) grant('defeat-tidewyrm');
  if (result.outcome === 'victory') { grant('win-run'); profile.wins++; }
  if (profile.totalKills >= 1000) grant('kills-1000');
  for (const ship of Object.values(CONTENT.ships)) {
    if (ship.unlock.kind === 'achievement' && profile.achievements.includes(ship.unlock.achievement) && !profile.unlockedShips.includes(ship.id)) {
      profile.unlockedShips.push(ship.id); unlocks.push(`New ship: ${ship.name}`);
    }
  }
  for (const sea of Object.values(CONTENT.seas)) {
    if (sea.unlock.kind === 'achievement' && profile.achievements.includes(sea.unlock.achievement) && !profile.unlockedSeas.includes(sea.id)) {
      profile.unlockedSeas.push(sea.id); unlocks.push(`New sea: ${sea.name}`);
    }
  }
  return unlocks;
}
