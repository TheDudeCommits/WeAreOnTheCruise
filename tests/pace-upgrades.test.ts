/**
 * PACE round 1: speed and handling upgrades (Clipper Rigging, Racing Keel, Momentum, Trade Winds and the Copper
 * Sheathing / Storm Sails / Rudder Chains refits), their card texts, and the pacing knobs they lean on.
 */
import { describe, expect, it } from 'vitest';
import { xpToNext } from '../src/game/constants';
import { DIRECTOR } from '../src/game/content/director';
import { MOMENTUM, PASSIVES } from '../src/game/content/passives';
import { META_UPGRADES } from '../src/game/content/world';
import type { MetaUpgradeId, PassiveId, ShipId } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { passiveCard } from '../src/game/sim/meta-cards';
import { BOOST_DURATION, boostChargesLeft } from '../src/game/sim/player';
import { recomputeStats } from '../src/game/sim/progression';
import { Sim } from '../src/game/sim/Sim';
import type { CircleHit, IslandDef, SimEvent, WorldQuery } from '../src/game/types';

function openSea(): WorldQuery {
  return {
    seed: 'open',
    islandsNear: (_x, _z, _r, out: IslandDef[] = []) => { out.length = 0; return out; },
    collideCircle: (): CircleHit => ({ hit: false, nx: 0, nz: 0, depth: 0 }),
    isWater: () => true,
    shoreDistance: (_x, _z, max) => max,
  };
}

function makeSim(opts: { ship?: ShipId; passives?: [PassiveId, number][]; meta?: Partial<Record<MetaUpgradeId, number>> } = {}): Sim {
  const meta = defaultProfile();
  meta.upgrades = { ...opts.meta };
  const sim = new Sim({ seed: 'pace', shipId: opts.ship ?? 'sunlion', seaId: 'sunward-shallows', meta, world: openSea() });
  sim.debug.god(true);
  const p = sim.state.player;
  p.weapons.length = 0;
  p.invulnerable = 0;
  for (const [id, rank] of opts.passives ?? []) p.passives.push({ id, rank });
  recomputeStats(sim);
  return sim;
}

/** Steps ticks with an empty sea (spawns removed) and the wind held on the beam whatever the heading. */
function sail(sim: Sim, seconds: number, each?: (sim: Sim) => void): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    for (const e of sim.state.enemies) e.life = 'dead';
    sim.state.sea.windDir = sim.state.player.heading + Math.PI / 2;
    sim.stepTicks(1);
    while (sim.state.status === 'levelup') sim.chooseCard(0);
    for (const e of sim.drainEvents()) events.push(e);
    each?.(sim);
  }
  return events;
}

/** Seconds from a standstill at FULL sail until the hull makes `frac` of `speed`. */
function timeTo(sim: Sim, speed: number, frac = 0.9): number {
  sim.press('gear-up');
  let t = 0;
  sail(sim, 20, (s) => { if (s.state.player.speed < speed * frac) t += s.dt; });
  return t;
}

describe('PACE speed upgrades', () => {
  it('Clipper Rigging: quicker off the mark, and the full-sail bonus only shows under full sail', () => {
    const base = makeSim(), rigged = makeSim({ passives: [['clipper-rigging', 5]] });
    const cruise = (sim: Sim, gear: 1 | 2) => { if (gear === 2) sim.press('gear-up'); sail(sim, 18); return sim.state.player.speed; };
    const fullBase = cruise(makeSim(), 2), fullRigged = cruise(makeSim({ passives: [['clipper-rigging', 5]] }), 2);
    const halfBase = cruise(makeSim(), 1), halfRigged = cruise(makeSim({ passives: [['clipper-rigging', 5]] }), 1);
    const s = PASSIVES['clipper-rigging'].perRank;
    expect(fullRigged / fullBase).toBeCloseTo((1 + 5 * s.speed!) * (1 + 5 * s.fullSail!), 1);
    expect(halfRigged / halfBase).toBeCloseTo(1 + 5 * s.speed!, 1);
    // Acceleration: reaches 90% of the plain hull's full-sail cruise sooner.
    expect(timeTo(rigged, fullBase)).toBeLessThan(timeTo(base, fullBase) * 0.8);
  });

  it('Racing Keel: holds more speed through a hard turn', () => {
    const turnSpeed = (sim: Sim) => {
      sim.press('gear-up');
      sail(sim, 15);
      sim.setInput({ steer: 1 });
      let sum = 0, n = 0;
      sail(sim, 6, (s) => { if (s.state.time > 17) { sum += s.state.player.speed; n++; } });
      return sum / n;
    };
    const plain = turnSpeed(makeSim()), keel = turnSpeed(makeSim({ passives: [['racing-keel', 5]] }));
    expect(keel).toBeGreaterThan(plain * 1.06);
  });

  it('Momentum: sinkings stack a capped speed surge the HUD can read, which holds and then drains', () => {
    const sim = makeSim({ passives: [['momentum', 2]] });
    const cap = 2 * PASSIVES.momentum.perRank.surge!;
    const p = sim.state.player;
    sim.press('gear-up');
    sail(sim, 15);
    const cruise = p.speed;
    const sink = () => { const e = sim.spawnEnemy('skiff', p.x + 60, p.z)!; sim.damageTarget(e, 1e6, { pierceArmor: true }); };
    sink();
    const st = () => p.statuses.find((x) => x.kind === 'momentum');
    expect(st()?.magnitude).toBeCloseTo(MOMENTUM.perKill);
    for (let i = 0; i < 20; i++) sink();
    expect(st()?.magnitude).toBeCloseTo(cap);
    // Keep sinking one ship a second: the surge stays topped up and the hull runs faster.
    for (let k = 0; k < 4; k++) { sail(sim, 1); sink(); }
    expect(p.speed).toBeGreaterThan(cruise * (1 + cap * 0.6));
    // Holds for `hold` s after the last sinking, then drains to nothing.
    const evs = sail(sim, MOMENTUM.hold + cap / MOMENTUM.drain + 0.2);
    expect(st()).toBeUndefined();
    expect(evs.some((e) => e.type === 'status-changed' && e.status === 'momentum' && !e.on)).toBe(true);
    // Without the passive there is no surge.
    const plain = makeSim();
    const e = plain.spawnEnemy('skiff', 60, 0)!;
    plain.damageTarget(e, 1e6, { pierceArmor: true });
    expect(plain.state.player.statuses.some((x) => x.kind === 'momentum')).toBe(false);
  });

  it('Trade Winds: longer boosts and, from rank 4, a second charge', () => {
    const r3 = makeSim({ passives: [['trade-winds', 3]] });
    const p = r3.state.player;
    r3.press('boost');
    sail(r3, 1 / 60);
    expect(p.skills.boost.active).toBeGreaterThan(BOOST_DURATION * 1.4);
    expect(p.skills.boost.cooldown).toBeGreaterThan(0); // one charge only

    const r4 = makeSim({ passives: [['trade-winds', 4]] });
    const q = r4.state.player;
    expect(boostChargesLeft(r4)).toBe(2);
    const used = (evs: SimEvent[]) => evs.filter((e) => e.type === 'skill-used' && e.slot === 'boost').length;
    r4.press('boost');
    let n = used(sail(r4, 0.5));
    expect(q.skills.boost.cooldown).toBe(0); // the second charge is ready
    r4.press('boost');
    n += used(sail(r4, 0.5));
    expect(n).toBe(2);
    expect(boostChargesLeft(r4)).toBe(0);
    expect(q.skills.boost.cooldown).toBeGreaterThan(0);
    // Charges come back one at a time, each announced when the boost becomes usable again.
    const ready = sail(r4, q.skills.boost.cooldownMax + 0.1).filter((e) => e.type === 'skill-ready' && e.slot === 'boost');
    expect(ready.length).toBe(1);
    expect(boostChargesLeft(r4)).toBe(1);
    sail(r4, q.skills.boost.cooldownMax + 0.1);
    expect(boostChargesLeft(r4)).toBe(2);
  });

  it('harbor refits: Copper Sheathing accelerates, Storm Sails stretches boosts, Rudder Chains answers the helm', () => {
    const fullBase = (() => { const s = makeSim(); s.press('gear-up'); sail(s, 18); return s.state.player.speed; })();
    expect(timeTo(makeSim({ meta: { 'copper-sheathing': 5 } }), fullBase)).toBeLessThan(timeTo(makeSim(), fullBase) * 0.85);

    const storm = makeSim({ meta: { 'storm-sails': 5 } });
    storm.press('boost');
    sail(storm, 1 / 60);
    const plain = makeSim();
    plain.press('boost');
    sail(plain, 1 / 60);
    expect(storm.state.player.skills.boost.active).toBeGreaterThan(plain.state.player.skills.boost.active * 1.3);
    expect(storm.state.player.skills.boost.cooldownMax).toBeLessThan(plain.state.player.skills.boost.cooldownMax * 0.8);

    const response = (sim: Sim) => {
      sim.press('gear-up');
      sail(sim, 10);
      sim.setInput({ steer: 1 });
      let t = 0;
      const target = sim.content.ships.sunlion.turnRate * 0.5;
      sail(sim, 4, (s) => { if (s.state.player.yawRate < target) t += s.dt; });
      return t;
    };
    expect(response(makeSim({ meta: { 'rudder-chains': 5 } }))).toBeLessThan(response(makeSim()) * 0.85);
  });

  it('writes the new stats into readable card and harbor text', () => {
    expect(passiveCard(PASSIVES['clipper-rigging'], 1).text).toMatch(/^\+3% top speed, \+10% acceleration, \+3% top speed at full sail\./);
    expect(passiveCard(PASSIVES['racing-keel'], 2).text).toMatch(/30% less speed lost in turns/);
    expect(passiveCard(PASSIVES['trade-winds'], 1).text).toMatch(/\+1 boost charge at rank 4/);
    expect(passiveCard(PASSIVES['trade-winds'], 4).text).toMatch(/^\+15% boost duration, 8% faster boost recharge, \+1 boost charge\./);
    expect(passiveCard(PASSIVES.momentum, 1).text).toMatch(/up to \+6%/);
    expect(META_UPGRADES['copper-sheathing'].description).toBe('+2% top speed, +6% acceleration per rank.');
    expect(META_UPGRADES['rudder-chains'].description).toMatch(/helm response per rank\.$/);
  });
});

describe('PACE pacing knobs', () => {
  it('cheap opening levels, a steep late curve', () => {
    expect(xpToNext(1)).toBe(4);
    let early = 0, v2 = 0;
    for (let l = 1; l < 8; l++) { early += xpToNext(l); v2 += 6 + 4 * (l - 1); }
    expect(early).toBeLessThan(v2 * 0.9);
    expect(xpToNext(25)).toBeGreaterThan(4 * xpToNext(5));
  });

  it('the horde floor starts with a pack and reaches the 60–90 band by 12:00; loot per ship thins as it grows', () => {
    expect(DIRECTOR.minAlive(0)).toBeGreaterThanOrEqual(6);
    expect(DIRECTOR.minAlive(12)).toBeGreaterThanOrEqual(60);
    expect(DIRECTOR.minAlive(12)).toBeLessThanOrEqual(90);
    expect(DIRECTOR.xpScale(1)).toBe(1);
    expect(DIRECTOR.xpScale(12)).toBeLessThan(DIRECTOR.xpScale(6));
    expect(DIRECTOR.dropScale(12)).toBeLessThan(DIRECTOR.dropScale(3));
  });
});
