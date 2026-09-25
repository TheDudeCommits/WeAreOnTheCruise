/**
 * REPLAY round 2: save round-trips for the new profile fields, quests, heat, the daily voyage, the logbook, the run
 * tracker and nextGoals.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { META_SAVE_KEY, SETTINGS_KEY } from '../src/game/constants';
import { HEAT } from '../src/game/content/director';
import { ECONOMY } from '../src/game/content/rewards';
import { DAILY_KEEP, dailyKey, dailyStreak, dailyVoyage, recordDaily } from '../src/game/meta/daily';
import { nextGoals } from '../src/game/meta/goals';
import { HISTORY_MAX, lifetimeStats } from '../src/game/meta/history';
import {
  QUESTS, boonCount, captainTitle, earnedBoons, earnedPennants, earnedTitles, evaluateQuests, questState,
} from '../src/game/meta/quests';
import {
  applyRunResult, bareRecord, defaultProfile, defaultSettings, loadProfile, loadSettings, sanitizeProfile, sanitizeSettings,
  saveProfile, saveSettings,
} from '../src/game/meta/save';
import { RunTracker } from '../src/game/meta/tracker';
import {
  chosenHeat, heatUnlocked, maxHeat, requestDaily, resetVoyageStore, setChosenHeat, startVoyage, takeVoyage, voyageMods,
} from '../src/game/meta/voyage';
import { Sim } from '../src/game/sim/Sim';
import { enemyDamageScale, enemyHpScale } from '../src/game/sim/meta-spawn';
import { MILESTONES, baseRunMods, runMods } from '../src/game/sim/run-mods';
import { doubloonMul } from '../src/game/sim/stats';
import type { MetaProfile, RunResult, RunStats, SimEvent } from '../src/game/types';
import { IslandField } from '../src/world/IslandField';

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

const stats = (o: Partial<RunStats> = {}): RunStats => ({
  kills: 0, eliteKills: 0, damageDealt: 0, damageTaken: 0, bossesDefeated: [], doubloons: 0, xpCollected: 0, bounty: 0,
  killsByWeapon: {}, damageByWeapon: {}, ...o,
});
const result = (o: Partial<RunResult> = {}): RunResult => ({
  outcome: 'defeat', shipId: 'sunlion', seaId: 'sunward-shallows', time: 300, level: 10, stats: stats(), doubloonsEarned: 0,
  newUnlocks: [], ...o,
});
const won = (o: Partial<RunResult> = {}) => result({ outcome: 'victory', time: 905, stats: stats({ kills: 900, bossesDefeated: ['iron-warden', 'tidewyrm', 'sovereign'] }), ...o });

function makeSim(meta: MetaProfile = defaultProfile(), seaId: 'sunward-shallows' | 'stormwrack-reach' | 'the-gloam' = 'sunward-shallows', seed = 'replay'): Sim {
  return new Sim({ seed, shipId: 'sunlion', seaId, meta, world: new IslandField(seed, { sea: seaId }) });
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  resetVoyageStore();
});

// ───────────────────────── Save ─────────────────────────

describe('save: round-2 profile fields', () => {
  it('round-trips quests, heat, history, daily bests and coach hints', () => {
    const p = defaultProfile();
    p.seenHints = ['boost', 'brace'];
    p.quests = { 'bounty-3': { progress: 2, done: false }, kraken: { progress: 1, done: true } };
    p.heat = { 'sunward-shallows': 3, 'the-gloam': 1 };
    p.daily = { '2026-09-24': 123456 };
    applyRunResult(p, won({ stats: stats({ kills: 900, bounty: 777 }) }), false, { heat: 2 });
    saveProfile(p);
    const back = loadProfile();
    expect(back).toEqual(p);
    expect(back.history?.[0]).toMatchObject({ shipId: 'sunlion', outcome: 'victory', heat: 2, bounty: 777 });
  });

  it('leaves a pre-round-2 save without the new fields', () => {
    const old = { ...defaultProfile(), doubloons: 42, wins: 1, runs: 3 };
    localStorage.setItem(META_SAVE_KEY, JSON.stringify(old));
    const back = loadProfile();
    expect(back).toEqual(old);
    for (const key of ['quests', 'heat', 'history', 'daily', 'seenHints']) expect(key in back).toBe(false);
  });

  it('sanitises garbage in every new field', () => {
    const history = Array.from({ length: 40 }, (_, i) => ({
      at: i, shipId: 'sunlion', seaId: 'the-gloam', outcome: 'defeat', time: 100, level: 5, kills: 10, bounty: 1, doubloons: 2, heat: 3,
    }));
    const p = sanitizeProfile({
      ...defaultProfile(),
      seenHints: ['a', 'a', 7, 'x'.repeat(200), 'b'],
      quests: { 'bounty-3': { progress: 99, done: false }, nope: { progress: 1, done: true }, kraken: { progress: NaN, done: 'yes' }, 'level-30': { done: true } },
      heat: { 'sunward-shallows': 99, 'stormwrack-reach': -2, 'the-gloam': 2.7, atlantis: 3 },
      history: [{ shipId: 'going-merry' }, 'junk', null, ...history, { ...history[0], outcome: 'draw' }],
      daily: { '2026-09-24': 5000, 'yesterday': 3, '2026-09-23': -5, '2026-09-22': Infinity },
    });
    expect(p.seenHints).toEqual(['a', 'b']);
    expect(p.quests).toEqual({ 'bounty-3': { progress: 3, done: false }, 'level-30': { progress: 30, done: true } });
    expect(p.heat).toEqual({ 'sunward-shallows': HEAT.max, 'the-gloam': 2 });
    expect(p.history).toHaveLength(HISTORY_MAX);
    expect(p.daily).toEqual({ '2026-09-24': 5000 });
  });

  it('keeps the round-2 settings (coach, colour-blind palette, HUD scale, cinematic camera, barks, captains)', () => {
    saveSettings({ ...defaultSettings(), coach: false, colorBlind: 'tritan', hudScale: 1.1, cinematicCamera: true, barks: false, captains: 2 });
    expect(loadSettings()).toMatchObject({ coach: false, colorBlind: 'tritan', hudScale: 1.1, cinematicCamera: true, barks: false, captains: 2 });
    for (const colorBlind of ['off', 'deutan', 'protan', 'tritan'] as const) {
      saveSettings({ ...defaultSettings(), colorBlind });
      expect(loadSettings().colorBlind).toBe(colorBlind);
    }
    const bad = sanitizeSettings({ ...defaultSettings(), coach: 'yes', barks: 0, colorBlind: 'purple', hudScale: 9, cinematicCamera: 1 });
    expect(bad.coach).toBe(true); // invalid → the default (on)
    expect(bad.barks).toBe(true);
    expect(bad.colorBlind).toBeUndefined();
    expect(bad.hudScale).toBe(1.2);
    expect(sanitizeSettings({ hudScale: 0.1 }).hudScale).toBe(0.8);
    expect(bad.cinematicCamera).toBeUndefined();
    localStorage.setItem(SETTINGS_KEY, '{nope');
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it('gives older settings saves the round-2 defaults (coach and barks on) and keeps the rest as saved', () => {
    const old = { version: 2, masterVolume: 0.5, musicVolume: 0.4, sfxVolume: 0.3, muted: true, cameraShake: 0.5, damageNumbers: false, quality: 'low', showFps: true, captains: 1 };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(old));
    expect(loadSettings()).toEqual({ ...old, coach: true, barks: true });
    expect(defaultSettings()).toMatchObject({ coach: true, barks: true });
  });
});

// ───────────────────────── Quests ─────────────────────────

describe('quests', () => {
  it('has 20–30 quests with unique ids and a reward each', () => {
    expect(QUESTS.length).toBeGreaterThanOrEqual(20);
    expect(QUESTS.length).toBeLessThanOrEqual(30);
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
    for (const q of QUESTS) expect(Object.keys(q.reward).length).toBeGreaterThan(0);
  });

  it('voyage quests keep the best voyage, ledger quests add up, and completion pays once', () => {
    const p = defaultProfile();
    const r = (n: number) => ({ ...bareRecord(result()), bountyCaptains: n });
    evaluateQuests(p, r(2));
    expect(questState(p, 'bounty-3')).toEqual({ progress: 2, done: false });
    expect(questState(p, 'bounty-10')).toEqual({ progress: 2, done: false });
    evaluateQuests(p, r(1));
    expect(questState(p, 'bounty-3').progress).toBe(2); // best voyage, not a sum
    expect(questState(p, 'bounty-10').progress).toBe(3); // summed
    const before = p.doubloons;
    const done = evaluateQuests(p, r(3));
    expect(done.map((q) => q.id)).toContain('bounty-3');
    expect(p.doubloons - before).toBe(250);
    expect(earnedTitles(p)).toContain('Bounty Hunter');
    evaluateQuests(p, r(5));
    expect(p.doubloons - before).toBe(250 + 300); // bounty-10 done at 11; bounty-3 never pays twice
  });

  it('reads profile totals for ledger quests backed by them (old saves are credited)', () => {
    const p = { ...defaultProfile(), runs: 12, wins: 1, bestTime: { sunlion: 700 } } as MetaProfile;
    const done = evaluateQuests(p, bareRecord(result()));
    expect(done.map((q) => q.id)).toEqual(expect.arrayContaining(['voyages-10', 'first-victory', 'weathered']));
    expect(boonCount(p, 'quartermaster')).toBe(1);
    expect(captainTitle(p)).toBe('Captain');
  });

  it('derives boons, pennants and the captain title from done flags', () => {
    const p = defaultProfile();
    p.quests = { 'overdrive-3': { progress: 3, done: true }, 'win-gloam': { progress: 1, done: true }, 'heat-2': { progress: 1, done: true }, 'voyages-10': { progress: 10, done: true } };
    expect(earnedBoons(p)).toEqual(expect.arrayContaining(['armourer', 'quartermaster']));
    expect(boonCount(p, 'quartermaster')).toBe(2);
    expect(earnedPennants(p)).toContain('gloam');
    expect(captainTitle(p)).toBe('Gloamwalker');
    expect(captainTitle(p, 'Deckhand')).toBe('Deckhand');
    expect(captainTitle(p, 'Admiral of the Brightwater')).toBe('Gloamwalker'); // not earned
  });

  it('applyRunResult reports completed quests on the results screen', () => {
    const p = defaultProfile();
    const lines = applyRunResult(p, won(), false, { heat: 0, run: { ...bareRecord(won()), rogueRides: 1 } });
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('Quest complete: Wave Rider'), expect.stringContaining('Quest complete: Master of the Brightwater')]));
  });
});

// ───────────────────────── Heat ─────────────────────────

describe('heat', () => {
  it('opens with the first victory, then one level per win on each sea', () => {
    const p = defaultProfile();
    expect(heatUnlocked(p)).toBe(false);
    expect(maxHeat(p, 'sunward-shallows')).toBe(0);
    applyRunResult(p, won());
    expect(maxHeat(p, 'sunward-shallows')).toBe(1);
    expect(maxHeat(p, 'the-gloam')).toBe(1);
    const lines = applyRunResult(p, won(), false, { heat: 1 });
    expect(p.heat).toEqual({ 'sunward-shallows': 1 });
    expect(lines).toContain('Heat 1 cleared on Sunward Shallows: heat 2 is open');
    expect(maxHeat(p, 'sunward-shallows')).toBe(2);
    applyRunResult(p, result({ outcome: 'defeat' }), false, { heat: 2 }); // losses clear nothing
    applyRunResult(p, won(), false, { heat: 1, daily: dailyKey() }); // neither do daily voyages
    expect(p.heat).toEqual({ 'sunward-shallows': 1 });
  });

  it('remembers the chosen heat per sea, clamped to what is open', () => {
    const p = defaultProfile();
    setChosenHeat('sunward-shallows', 5);
    expect(chosenHeat(p, 'sunward-shallows')).toBe(0);
    p.wins = 1; p.heat = { 'sunward-shallows': 6 };
    expect(chosenHeat(p, 'sunward-shallows')).toBe(5);
    resetVoyageStore();
    expect(chosenHeat(p, 'sunward-shallows')).toBe(5); // persisted
    expect(takeVoyage(p, 'sunlion', 'sunward-shallows')).toEqual({ heat: 5 });
  });

  it('stacks its rules: tougher, faster, richer', () => {
    const base = baseRunMods('sunward-shallows');
    const h4 = voyageMods('sunward-shallows', 4);
    const h8 = voyageMods('sunward-shallows', 8);
    expect(h4.enemyHp).toBeGreaterThan(base.enemyHp);
    expect(h8.enemyHp).toBeGreaterThan(h4.enemyHp);
    expect(h8.enemyDamage).toBeGreaterThan(h4.enemyDamage);
    expect(h4.enemySpeed).toBeGreaterThan(1);
    expect(h8.eventGap).toBeLessThan(1);
    expect(h8.bountyCaptains).toBe(2);
    expect(h8.drops).toBeLessThan(1);
    expect(h8.bossHp).toBeGreaterThan(base.bossHp);
    expect(h4.reward).toBeCloseTo(1 + HEAT.reward * 4);
    expect(h8.reward).toBeCloseTo(3);
  });

  it('reaches the sim: enemy hull and damage scale, doubloons and bounty pay more', () => {
    const cold = makeSim();
    const hot = makeSim();
    startVoyage(cold, cold.meta, { heat: 0 });
    startVoyage(hot, hot.meta, { heat: 6 });
    expect(runMods(hot.state).heat).toBe(6);
    expect(enemyHpScale(hot) / enemyHpScale(cold)).toBeCloseTo(runMods(hot.state).enemyHp / runMods(cold.state).enemyHp);
    expect(enemyDamageScale(hot)).toBeGreaterThan(enemyDamageScale(cold));
    expect(doubloonMul(hot.state.player.stats) / doubloonMul(cold.state.player.stats)).toBeCloseTo(2.5);
    cold.stepTicks(120); hot.stepTicks(120);
    expect(hot.state.director.heat / cold.state.director.heat).toBeCloseTo(2.5);
  });
});

// ───────────────────────── Daily voyage ─────────────────────────

describe('daily voyage', () => {
  it('is the same voyage for the same day, with one or two distinct rules', () => {
    const a = dailyVoyage('2026-09-25'), b = dailyVoyage('2026-09-25');
    expect(a).toEqual(b);
    expect(a.seed).toBe('daily:2026-09-25');
    expect(a.rules.length).toBeGreaterThanOrEqual(1);
    expect(new Set(a.rules.map((r) => r.id)).size).toBe(a.rules.length);
    const days = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(dailyVoyage(`2026-10-${String(i + 1).padStart(2, '0')}`))));
    expect(days.size).toBeGreaterThan(20);
    expect(dailyKey(new Date(Date.UTC(2026, 0, 5, 23)))).toBe('2026-01-05');
  });

  it('keeps the best bounty per day and a streak, and drops very old days', () => {
    const p = defaultProfile();
    expect(recordDaily(p, '2026-09-24', 500)).toBe(true);
    expect(recordDaily(p, '2026-09-24', 400)).toBe(false);
    expect(recordDaily(p, '2026-09-25', 10)).toBe(true);
    expect(p.daily).toEqual({ '2026-09-24': 500, '2026-09-25': 10 });
    expect(dailyStreak(p, '2026-09-25')).toBe(2);
    expect(dailyStreak(p, '2026-09-26')).toBe(2);
    for (let i = 0; i < DAILY_KEEP + 10; i++) recordDaily(p, `2025-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, 1);
    expect(Object.keys(p.daily!).length).toBe(DAILY_KEEP);
    expect(p.daily!['2026-09-25']).toBe(10);
  });

  it('starts only when requested for its ship and sea, lends the ship, and applies its rules', () => {
    const p = defaultProfile();
    const d = dailyVoyage('2026-09-25');
    requestDaily(d.key, d.shipId, d.seaId);
    expect(takeVoyage(p, 'dawn-ram', 'the-gloam').daily).toBeUndefined(); // a different launch consumes the request
    requestDaily(d.key, d.shipId, d.seaId);
    const opts = takeVoyage(p, d.shipId, d.seaId);
    expect(opts).toEqual({ heat: 0, daily: d.key });
    const sim = new Sim({ seed: d.seed, shipId: d.shipId, seaId: d.seaId, meta: p, world: new IslandField(d.seed, { sea: d.seaId }) });
    const v = startVoyage(sim, p, opts);
    expect(v.options.daily).toBe(d.key);
    expect(runMods(sim.state).daily).toBe(d.key);
    const lines = applyRunResult(p, result({ shipId: d.shipId, seaId: d.seaId, stats: stats({ bounty: 4321 }) }), false, v.bank(result()));
    expect(p.daily?.[d.key]).toBe(4321);
    expect(lines.some((l) => l.startsWith(`Daily voyage ${d.key}`))).toBe(true);
    if (!p.unlockedShips.includes(d.shipId)) expect(p.lastShip).not.toBe(d.shipId);
  });
});

// ───────────────────────── Logbook ─────────────────────────

describe('logbook', () => {
  it('keeps the last 20 voyages newest first, and folds an endless stretch into its voyage', () => {
    const p = defaultProfile();
    for (let i = 0; i < 25; i++) applyRunResult(p, result({ time: 100 + i, stats: stats({ kills: i }) }));
    expect(p.history).toHaveLength(HISTORY_MAX);
    expect(p.history![0]!.time).toBe(124);
    applyRunResult(p, won({ stats: stats({ kills: 900, bounty: 100 }), doubloonsEarned: 500 }));
    applyRunResult(p, result({ outcome: 'defeat', time: 1400, stats: stats({ kills: 300, bounty: 900 }), doubloonsEarned: 80 }), true);
    expect(p.history).toHaveLength(HISTORY_MAX);
    expect(p.history![0]).toMatchObject({ outcome: 'victory', time: 1400, kills: 1200, bounty: 900, doubloons: 580 });
    const life = lifetimeStats(p);
    expect(life.voyages).toBe(26);
    expect(life.wins).toBe(1);
    expect(life.favouriteShip).toBe('sunlion');
  });
});

// ───────────────────────── Tracker ─────────────────────────

describe('run tracker', () => {
  it('counts bosses, no-hit bosses, fast wardens, set pieces, rides, krakens, overdrives and parries', () => {
    const sim = makeSim();
    const t = new RunTracker(sim.meta, 0);
    const s = sim.state;
    const ev = (...list: SimEvent[]) => t.observe(list, s);
    ev({ type: 'boss-spawned', boss: 'iron-warden', id: 900, x: 0, z: 0 });
    s.time += 40;
    ev({ type: 'boss-defeated', boss: 'iron-warden', id: 900, x: 0, z: 0 });
    ev({ type: 'boss-spawned', boss: 'tidewyrm', id: 901, x: 0, z: 0 });
    ev({ type: 'player-hit', amount: 5, x: 0, z: 0, braced: false, parried: false });
    ev({ type: 'player-hit', amount: 0, x: 0, z: 0, braced: true, parried: true });
    ev({ type: 'boss-defeated', boss: 'tidewyrm', id: 901, x: 0, z: 0 });
    ev({ type: 'world-event', id: 'rogue-wave', phase: 'success', name: 'Rogue Wave', text: '' });
    ev({ type: 'world-event', id: 'kraken-rising', phase: 'end', name: 'Kraken Rising', text: 'x' });
    ev({ type: 'world-event', id: 'kraken-rising', phase: 'end', name: 'Kraken Rising', text: 'Cut short' });
    for (const w of ['broadside', 'harpoon', 'broadside'] as const) ev({ type: 'weapon-changed', weapon: w, level: 6, overdrive: true, isNew: false });
    s.director.scratch[MILESTONES] = 2;
    ev({ type: 'level-up', level: 2 });
    expect(t.counters()).toMatchObject({ bossesSunk: 2, noHitBosses: 1, fastWardens: 1, eventsWon: 1, rogueRides: 1, krakenSurvived: 1, overdrives: 2, parries: 1, milestones: 2 });
    const first = t.take(result());
    expect(first.delta.bossesSunk).toBe(2);
    ev({ type: 'boss-spawned', boss: 'sovereign', id: 902, x: 0, z: 0 });
    ev({ type: 'boss-defeated', boss: 'sovereign', id: 902, x: 0, z: 0 });
    const second = t.take(result());
    expect(second.run.bossesSunk).toBe(3);
    expect(second.delta.bossesSunk).toBe(1);
  });

  it('counts named bounty captains and raises a banner when a voyage quest is met mid-run', () => {
    const sim = makeSim();
    const t = new RunTracker(sim.meta, 0);
    const banners: SimEvent[] = [];
    for (let i = 0; i < 3; i++) {
      sim.debug.spawnEnemy('corsair-brig', 1, true);
      const e = sim.state.enemies[sim.state.enemies.length - 1]!;
      e.title = `Captain ${i}`;
      banners.push(...t.observe([{ type: 'enemy-killed', id: e.id, defId: e.defId, x: 0, z: 0, elite: true }], sim.state));
    }
    expect(t.counters().bountyCaptains).toBe(3);
    expect(banners.some((b) => b.type === 'director-event' && b.name === 'Quest complete: Bounty Hunter')).toBe(true);
  });
});

// ───────────────────────── Voyage start, endless, goals ─────────────────────────

describe('voyage start and endless milestones', () => {
  it('applies starting boons on ordinary voyages only', () => {
    const p = defaultProfile();
    p.quests = { 'voyages-10': { progress: 10, done: true }, 'events-4': { progress: 4, done: true }, 'overdrive-3': { progress: 3, done: true } };
    const sim = makeSim(p);
    const rerolls = sim.state.rerolls, banishes = sim.state.banishes;
    startVoyage(sim, p, { heat: 0 });
    expect(sim.state.rerolls).toBe(rerolls + 1);
    expect(sim.state.banishes).toBe(banishes + 1);
    expect(sim.state.player.weapons.some((w) => w.id === 'bow-chaser' && w.level === 2)).toBe(true);
    const d = dailyVoyage('2026-09-25');
    const daily = new Sim({ seed: d.seed, shipId: d.shipId, seaId: d.seaId, meta: p, world: new IslandField(d.seed, { sea: d.seaId }) });
    const r0 = daily.state.rerolls;
    startVoyage(daily, p, { heat: 3, daily: d.key });
    expect(daily.state.rerolls).toBe(r0);
    expect(runMods(daily.state).heat).toBe(0);
  });

  it('pays a milestone purse for every boss sunk in endless mode', () => {
    const sim = makeSim();
    startVoyage(sim, sim.meta, { heat: 0 });
    sim.state.endless = true;
    sim.debug.spawnBoss('iron-warden');
    const before = sim.state.stats.doubloons;
    sim.debug.sinkBosses();
    const milestone = sim.drainEvents().find((e) => e.type === 'director-event' && e.name.startsWith('Endless milestone'));
    expect(milestone).toBeDefined();
    expect(sim.state.director.scratch[MILESTONES]).toBe(1);
    expect(sim.state.stats.doubloons - before).toBe(Math.round(ECONOMY.endlessMilestone * doubloonMul(sim.state.player.stats)));
  });
});

describe('nextGoals', () => {
  it('points a new captain at unlocks and quests, three at most', () => {
    const goals = nextGoals(defaultProfile(), '2026-09-25');
    expect(goals.length).toBe(3);
    expect(goals[0]!.title).toMatch(/Unlock|Open/);
    for (const g of goals) { expect(g.progress).toBeGreaterThanOrEqual(0); expect(g.progress).toBeLessThanOrEqual(1); }
  });

  it('offers the next heat level and today’s daily voyage after a victory', () => {
    const p = defaultProfile();
    applyRunResult(p, won({ doubloonsEarned: 0 }));
    p.unlockedShips = ['dawn-ram', 'sunlion', 'yellowfin', 'grand-galley', 'seawarden', 'white-leviathan'];
    p.doubloons = 0;
    const goals = nextGoals(p, '2026-09-25');
    expect(goals.some((g) => g.id === 'heat:sunward-shallows')).toBe(true);
    expect(goals.some((g) => g.id.startsWith('daily:'))).toBe(true);
    expect(goals.filter((g) => g.id.startsWith('quest:')).length).toBeLessThanOrEqual(2);
  });
});
