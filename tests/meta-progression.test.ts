import { describe, expect, it } from 'vitest';
import { MAX_PASSIVE_SLOTS, MAX_WEAPON_SLOTS } from '../src/game/constants';
import { PASSIVE_IDS, WEAPON_IDS } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { Sim } from '../src/game/sim/Sim';
import { chipTotal, createOffers, onEnemyKilled, recomputeStats, spillCoins } from '../src/game/sim/progression';
import type { CardOffer, MetaProfile, SimEvent } from '../src/game/types';
import { IslandField } from '../src/world/IslandField';

function makeSim(seed = 'meta-prog', meta: MetaProfile = defaultProfile()): Sim {
  return new Sim({ seed, shipId: 'sunlion', seaId: 'sunward-shallows', meta, world: new IslandField(seed) });
}

function drawMany(sim: Sim, n: number): CardOffer[][] {
  const out: CardOffer[][] = [];
  for (let i = 0; i < n; i++) out.push(createOffers(sim));
  return out;
}

function events(sim: Sim, type: SimEvent['type']): SimEvent[] {
  return sim.drainEvents().filter((e) => e.type === type);
}

describe('card pool', () => {
  it('offers branch cards only as an A/B pair at weapon level 3', () => {
    const sim = makeSim();
    sim.state.player.weapons[0]!.level = 2;
    let pairs = 0;
    for (const offer of drawMany(sim, 300)) {
      const branches = offer.filter((o) => o.kind === 'weapon-branch');
      if (branches.length === 0) continue;
      pairs++;
      expect(branches).toHaveLength(2);
      expect(new Set(branches.map((b) => b.branch))).toEqual(new Set(['A', 'B']));
      expect(branches.every((b) => b.level === 3 && b.id === 'broadside')).toBe(true);
      // No plain level-3 card sneaks in beside the pair.
      expect(offer.some((o) => o.kind === 'weapon-level' && o.id === 'broadside')).toBe(false);
    }
    expect(pairs).toBeGreaterThan(50);
  });

  it('gates OVERDRIVE on weapon level 5 and run level 10', () => {
    const sim = makeSim();
    const p = sim.state.player;
    p.weapons[0]!.level = 5;
    p.weapons[0]!.branch = 'B';
    p.level = 9;
    for (const offer of drawMany(sim, 200)) {
      expect(offer.some((o) => o.kind === 'weapon-overdrive')).toBe(false);
      expect(offer.some((o) => o.id === 'broadside' && (o.level ?? 0) >= 6)).toBe(false);
    }
    p.level = 10;
    const withOverdrive = drawMany(sim, 200).filter((offer) => offer.some((o) => o.kind === 'weapon-overdrive'));
    expect(withOverdrive.length).toBeGreaterThan(20);
    for (const offer of withOverdrive) {
      const od = offer.find((o) => o.kind === 'weapon-overdrive')!;
      expect(od.title).toContain('★');
      expect(od.rarity).toBe('legendary');
    }
  });

  it('stops offering new weapons/passives when the slots are full', () => {
    const sim = makeSim();
    const p = sim.state.player;
    p.weapons = WEAPON_IDS.slice(0, MAX_WEAPON_SLOTS).map((id) => ({ id, level: 1, overdrive: false, cooldown: 0, scratch: {} }));
    p.passives = PASSIVE_IDS.slice(0, MAX_PASSIVE_SLOTS).map((id) => ({ id, rank: 1 }));
    for (const offer of drawMany(sim, 150)) {
      expect(offer.some((o) => o.kind === 'new-weapon')).toBe(false);
      expect(offer.some((o) => o.kind === 'new-passive')).toBe(false);
    }
  });

  it('weights owned upgrades above new items and never repeats a card in one offer', () => {
    const sim = makeSim();
    let upgrades = 0, total = 0;
    for (const offer of drawMany(sim, 300)) {
      const keys = offer.map((o) => `${o.kind}:${o.id}:${o.branch ?? ''}`);
      expect(new Set(keys).size).toBe(keys.length);
      total += offer.length;
      upgrades += offer.filter((o) => o.kind === 'weapon-level' && o.id === 'broadside').length;
    }
    // One owned weapon vs eleven new ones: the owned upgrade still shows up in most offers.
    expect(upgrades / 300).toBeGreaterThan(0.5);
    expect(total).toBe(900);
  });

  it('gives a fourth card at 3 luck', () => {
    const sim = makeSim();
    expect(createOffers(sim)).toHaveLength(3);
    sim.state.player.passives.push({ id: 'lucky-doubloon', rank: 3 });
    recomputeStats(sim);
    expect(createOffers(sim)).toHaveLength(4);
  });

  it('writes specific card texts from the tables', () => {
    const sim = makeSim();
    const lv2 = drawMany(sim, 100).flat().find((o) => o.kind === 'weapon-level' && o.id === 'broadside')!;
    expect(lv2.title).toBe('Broadside Battery Lv 2');
    expect(lv2.text).toMatch(/\+1 gun per side/);
    expect(lv2.text).toMatch(/\+\d+% damage/);
    const passive = drawMany(sim, 100).flat().find((o) => o.kind === 'new-passive' && o.id === 'master-gunner');
    expect(passive?.text).toMatch(/\+10% damage/);
  });
});

describe('level-ups, rerolls, banish, chips', () => {
  it('pauses on level-up, queues extra level-ups and resumes after the last card', () => {
    const sim = makeSim();
    sim.debug.grantXp(80);
    sim.step(1 / 30);
    const s = sim.state;
    expect(s.status).toBe('levelup');
    const queued = s.pendingLevelUps;
    expect(queued).toBeGreaterThan(1);
    for (let i = 0; i < queued; i++) {
      expect(s.status).toBe('levelup');
      expect(sim.chooseCard(0)).toBe(true);
    }
    expect(s.status).toBe('running');
    expect(s.pendingLevelUps).toBe(0);
    expect(s.player.level).toBe(1 + queued);
  });

  it('spends Sea Charts on rerolls and Black Spot on banishes', () => {
    const meta = defaultProfile();
    meta.upgrades = { charts: 2, banish: 1 };
    const sim = makeSim('meta-reroll', meta);
    sim.debug.grantXp(6);
    sim.step(1 / 30);
    expect(sim.state.rerolls).toBe(2);
    expect(sim.reroll()).toBe(true);
    expect(sim.reroll()).toBe(true);
    expect(sim.reroll()).toBe(false);
    const target = sim.state.offers!.find((o) => o.kind !== 'heal' && o.kind !== 'doubloons')!;
    const index = sim.state.offers!.indexOf(target);
    expect(sim.banish(index)).toBe(true);
    expect(sim.state.banished).toContain(target.id);
    expect(sim.banish(0)).toBe(false);
    for (const offer of drawMany(sim, 100)) expect(offer.some((o) => o.id === target.id)).toBe(false);
  });

  it('keeps stat chips through later stat recomputes', () => {
    const sim = makeSim();
    sim.debug.grantXp(6);
    sim.step(1 / 30);
    sim.state.offers = [{ kind: 'chip', id: 'chip-damage', title: 'Hot Shot', text: '', icon: '', rarity: 'epic', stat: 'damage', amount: 0.11 }];
    expect(sim.chooseCard(0)).toBe(true);
    expect(chipTotal(sim, 'damage')).toBeCloseTo(0.11);
    expect(sim.state.player.stats.damage).toBeCloseTo(0.11);
    sim.state.player.passives.push({ id: 'master-gunner', rank: 1 });
    recomputeStats(sim);
    expect(sim.state.player.stats.damage).toBeCloseTo(0.21);
  });
});

describe('chests', () => {
  it('opens an elite chest: rewards applied, status chest, chooseCard(0) resumes', () => {
    const sim = makeSim();
    const p = sim.state.player;
    const before = p.weapons[0]!.level;
    sim.drainEvents();
    sim.spawnPickup('chest', p.x, p.z, 1);
    sim.step(1 / 60);
    const s = sim.state;
    expect(s.status).toBe('chest');
    expect(s.offers!.length).toBeGreaterThanOrEqual(2);
    expect(s.offers!.at(-1)!.kind).toBe('doubloons');
    const opened = events(sim, 'chest-opened');
    expect(opened).toHaveLength(1);
    const t = s.time;
    sim.step(0.5);
    expect(s.time).toBe(t);
    expect(sim.chooseCard(0)).toBe(true);
    expect(s.status).toBe('running');
    expect(s.offers).toBeNull();
    expect(p.weapons[0]!.level + p.passives.length + Object.keys(s.director.scratch).filter((k) => k.startsWith('chip:')).length).toBeGreaterThan(before);
  });

  it('boss chests force an OVERDRIVE on a level-5 weapon, and chests never make the branch choice', () => {
    const sim = makeSim();
    const p = sim.state.player;
    p.weapons[0]!.level = 5;
    p.weapons[0]!.branch = 'A';
    p.weapons.push({ id: 'bow-chaser', level: 2, overdrive: false, cooldown: 0, scratch: {} });
    sim.spawnPickup('chest', p.x, p.z, 2);
    sim.step(1 / 60);
    expect(sim.state.status).toBe('chest');
    expect(sim.state.offers![0]!.kind).toBe('weapon-overdrive');
    expect(p.weapons[0]!.level).toBe(6);
    expect(p.weapons[0]!.overdrive).toBe(true);
    expect(p.weapons[1]!.level).toBe(2);
    expect(p.weapons[1]!.branch).toBeUndefined();
  });

  it('queues a second chest collected in the same tick', () => {
    const sim = makeSim();
    const p = sim.state.player;
    sim.spawnPickup('chest', p.x, p.z, 1);
    sim.spawnPickup('chest', p.x + 1, p.z, 1);
    sim.step(1 / 60);
    expect(sim.state.status).toBe('chest');
    sim.chooseCard(0);
    expect(sim.state.status).toBe('chest');
    sim.chooseCard(0);
    expect(sim.state.status).toBe('running');
  });
});

describe('drops and bounty', () => {
  it('spills XP into gold/silver/copper coins without losing value', () => {
    const sim = makeSim();
    for (const value of [1, 4, 7, 24, 60, 150]) {
      const before = sim.state.pickups.filter((k) => k.alive).length;
      spillCoins(sim, 0, 0, value, 10);
      const coins = sim.state.pickups.filter((k) => k.alive).slice(before);
      expect(coins.reduce((sum, k) => sum + k.value, 0)).toBeCloseTo(value);
      expect(coins.length).toBeLessThanOrEqual(5);
      for (const k of coins) expect(k.kind === 'xp-gold' ? k.value >= 25 : k.kind === 'xp-silver' ? k.value >= 5 : k.value < 5).toBe(true);
    }
  });

  it('elite kills pay a chest, extra xp and bounty', () => {
    const sim = makeSim();
    const e = sim.spawnEnemy('brig', 50, 0, { elite: true })!;
    const pickupsBefore = sim.state.pickups.filter((k) => k.alive).length;
    sim.damageTarget(e, 1e6, { pierceArmor: true });
    const drops = sim.state.pickups.filter((k) => k.alive).slice(pickupsBefore);
    expect(drops.some((k) => k.kind === 'chest')).toBe(true);
    const xp = drops.filter((k) => k.kind.startsWith('xp')).reduce((sum, k) => sum + k.value, 0);
    expect(xp).toBeCloseTo(sim.content.enemies.brig.xp * 4);
    expect(sim.state.stats.kills).toBe(1);
    expect(sim.state.stats.eliteKills).toBe(1);
    expect(sim.state.stats.bounty).toBeGreaterThan(0);
  });

  it('a sunk fire ship explodes on the next tick (chain reactions)', () => {
    const sim = makeSim();
    const f = sim.spawnEnemy('fireship', 120, 0)!;
    const brig = sim.spawnEnemy('brig', 128, 0)!;
    sim.step(1 / 60); // builds the spatial index the blast queries
    onEnemyKilled(sim, f);
    f.life = 'sinking';
    sim.drainEvents();
    const hpBefore = brig.hp;
    sim.step(1 / 60);
    const blasts = sim.drainEvents().filter((e) => e.type === 'explosion' && e.kind === 'fire');
    expect(blasts.length).toBe(1);
    expect(brig.hp).toBeLessThan(hpBefore);
  });
});
