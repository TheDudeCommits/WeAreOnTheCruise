import { beforeEach, describe, expect, it } from 'vitest';
import { META_SAVE_KEY, SETTINGS_KEY } from '../src/game/constants';
import { CONTENT } from '../src/game/content';
import { questDef } from '../src/game/meta/quests';
import {
  applyRunResult, defaultProfile, loadProfile, loadSettings, purchaseUpgrade, sanitizeProfile, saveProfile, saveSettings,
  shipUnlockState, unlockShip, upgradeCost,
} from '../src/game/meta/save';
import type { RunResult, RunStats } from '../src/game/types';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

const stats = (over: Partial<RunStats> = {}): RunStats => ({
  kills: 0, eliteKills: 0, damageDealt: 0, damageTaken: 0, bossesDefeated: [], doubloons: 0, xpCollected: 0, bounty: 0,
  killsByWeapon: {}, damageByWeapon: {}, ...over,
});

const result = (over: Partial<RunResult> = {}): RunResult => ({
  outcome: 'defeat', shipId: 'sunlion', seaId: 'sunward-shallows', time: 200, level: 5, stats: stats(), doubloonsEarned: 0, newUnlocks: [], ...over,
});

describe('meta save', () => {
  it('round-trips a profile and settings through localStorage', () => {
    const p = defaultProfile();
    p.doubloons = 321; p.upgrades = { hull: 2, charts: 1 }; p.achievements = ['survive-10']; p.unlockedSeas.push('stormwrack-reach');
    p.bestBounty = { sunlion: 12345 }; p.runs = 4; p.totalKills = 900;
    saveProfile(p);
    expect(loadProfile()).toEqual(p);
    const s = loadSettings();
    s.musicVolume = 0.25; s.quality = 'high'; s.reduceFlashing = true;
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });

  it('recovers from unparseable bytes and keeps them under a recovery key', () => {
    localStorage.setItem(META_SAVE_KEY, '{not json');
    localStorage.setItem(SETTINGS_KEY, '???');
    expect(loadProfile()).toEqual(defaultProfile());
    expect(localStorage.getItem(`${META_SAVE_KEY}.recovery`)).toBe('{not json');
    expect(loadSettings().version).toBe(2);
  });

  it('sanitises bad or hostile data field by field', () => {
    const p = sanitizeProfile({
      version: 1, doubloons: 'lots', upgrades: { hull: 99, powder: -3, bogus: 5, charts: 2.7 },
      unlockedShips: ['sunlion', 'nope', 'sunlion', 42], unlockedSeas: 'all', achievements: ['win-run', 'hack'],
      bestTime: { sunlion: 700, ghost: 5, 'dawn-ram': Number.NaN }, totalKills: -5, runs: 1, wins: 3, lastShip: 'ghost-ship', lastSea: 'the-gloam',
    });
    expect(p.version).toBe(2);
    expect(p.doubloons).toBe(0);
    expect(p.upgrades).toEqual({ hull: CONTENT.metaUpgrades.hull.maxRank, charts: 2 });
    expect(p.unlockedShips.filter((s) => s === 'sunlion')).toHaveLength(1);
    expect(p.unlockedShips).toContain('dawn-ram');
    // win-run held → its ship and sea are re-derived.
    expect(p.unlockedShips).toContain('white-leviathan');
    expect(p.unlockedSeas).toContain('the-gloam');
    expect(p.achievements).toEqual(['win-run']);
    expect(p.bestTime).toEqual({ sunlion: 700 });
    expect(p.totalKills).toBe(0);
    expect(p.runs).toBeGreaterThanOrEqual(p.wins);
    expect(p.lastShip).toBe('dawn-ram');
    expect(p.lastSea).toBe('the-gloam');
    expect(sanitizeProfile(null)).toEqual(defaultProfile());
    expect(sanitizeProfile([1, 2])).toEqual(defaultProfile());
  });

  it('sanitises settings', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ masterVolume: 5, sfxVolume: 'loud', quality: 'insane', cameraShake: -1, muted: 'yes' }));
    const s = loadSettings();
    expect(s.masterVolume).toBe(1);
    expect(s.sfxVolume).toBe(0.85);
    expect(s.quality).toBe('auto');
    expect(s.cameraShake).toBe(0);
    expect(s.muted).toBe(false);
  });
});

describe('harbor and unlocks', () => {
  it('prices upgrades on a rising curve and stops at max rank', () => {
    const p = defaultProfile();
    p.doubloons = 100000;
    const costs: number[] = [];
    while (upgradeCost(p, 'hull') !== null) { costs.push(upgradeCost(p, 'hull')!); expect(purchaseUpgrade(p, 'hull')).toBe(true); }
    expect(costs).toHaveLength(CONTENT.metaUpgrades.hull.maxRank);
    for (let i = 1; i < costs.length; i++) expect(costs[i]!).toBeGreaterThan(costs[i - 1]!);
    expect(purchaseUpgrade(p, 'hull')).toBe(false);
    const poor = defaultProfile();
    expect(purchaseUpgrade(poor, 'hull')).toBe(false);
  });

  it('buys doubloon ships; achievement ships cannot be bought', () => {
    const p = defaultProfile();
    const yellowfin = CONTENT.ships.yellowfin.unlock;
    expect(yellowfin.kind).toBe('doubloons');
    const cost = yellowfin.kind === 'doubloons' ? yellowfin.cost : 0;
    p.doubloons = cost - 1;
    expect(unlockShip(p, 'yellowfin')).toBe(false);
    p.doubloons = cost;
    expect(shipUnlockState(p, 'yellowfin').affordable).toBe(true);
    expect(unlockShip(p, 'yellowfin')).toBe(true);
    expect(p.doubloons).toBe(0);
    expect(p.unlockedShips).toContain('yellowfin');
    p.doubloons = 1e6;
    expect(unlockShip(p, 'seawarden')).toBe(false);
    expect(unlockShip(p, 'white-leviathan')).toBe(false);
  });

  it('follows the design unlock rules', () => {
    const p = defaultProfile();
    expect(p.unlockedShips.sort()).toEqual(['dawn-ram', 'sunlion']);
    expect(p.unlockedSeas).toEqual(['sunward-shallows']);

    // Surviving 10:00 → Stormwrack Reach.
    let lines = applyRunResult(p, result({ time: 605, doubloonsEarned: 120, stats: stats({ kills: 400, bounty: 5000 }) }));
    expect(p.unlockedSeas).toContain('stormwrack-reach');
    expect(lines.some((l) => l.includes('Stormwrack Reach'))).toBe(true);
    // 120 banked + the 'Weathered Hull' quest purse (REPLAY quests pay on completion).
    expect(lines.some((l) => l.includes('Quest complete: Weathered Hull'))).toBe(true);
    expect(p.doubloons).toBe(120 + (questDef('weathered')?.reward.doubloons ?? 0));
    expect(p.bestBounty.sunlion).toBe(5000);

    // Defeating the Iron Warden → Seawarden.
    lines = applyRunResult(p, result({ time: 420, stats: stats({ bossesDefeated: ['iron-warden'] }) }));
    expect(p.unlockedShips).toContain('seawarden');
    expect(lines.some((l) => l.includes('Seawarden'))).toBe(true);

    // A victory → White Leviathan and The Gloam; kills accumulate to an achievement.
    lines = applyRunResult(p, result({ outcome: 'victory', time: 905, stats: stats({ kills: 700, bossesDefeated: ['iron-warden', 'tidewyrm', 'sovereign'] }) }));
    expect(p.unlockedShips).toContain('white-leviathan');
    expect(p.unlockedSeas).toContain('the-gloam');
    expect(p.wins).toBe(1);
    expect(p.achievements).toEqual(expect.arrayContaining(['survive-10', 'defeat-iron-warden', 'defeat-tidewyrm', 'win-run', 'kills-1000']));
    expect(lines.length).toBeGreaterThan(2);
    // Doubloon ships are never auto-unlocked.
    expect(p.unlockedShips).not.toContain('yellowfin');
    expect(p.runs).toBe(3);
  });

  it('announces when a doubloon ship becomes affordable', () => {
    const p = defaultProfile();
    const u = CONTENT.ships.yellowfin.unlock;
    const cost = u.kind === 'doubloons' ? u.cost : 0;
    p.doubloons = cost - 10;
    const lines = applyRunResult(p, result({ doubloonsEarned: 50 }));
    expect(lines.some((l) => l.includes('Yellowfin'))).toBe(true);
  });
});
