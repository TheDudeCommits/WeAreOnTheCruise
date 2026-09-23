import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/game/meta/save';
import { Sim } from '../src/game/sim/Sim';
import { IslandField } from '../src/world/IslandField';

function run(seconds: number, seed = 'test-seed') {
  const sim = new Sim({ seed, shipId: 'sunlion', seaId: 'sunward-shallows', meta: defaultProfile(), world: new IslandField(seed) });
  sim.setInput({ steer: 0.3 });
  for (let i = 0; i < seconds * 60; i++) {
    sim.step(1 / 60);
    if (sim.state.status === 'levelup') sim.chooseCard(0);
  }
  return sim;
}

describe('overhaul v2 sim skeleton', () => {
  it('is deterministic for a seed and inputs', () => {
    const a = run(40), b = run(40);
    expect(a.state.player.x).toBeCloseTo(b.state.player.x, 6);
    expect(a.state.stats.kills).toBe(b.state.stats.kills);
    expect(a.state.enemies.length).toBe(b.state.enemies.length);
  });

  it('spawns enemies, sinks them and levels up', () => {
    const sim = run(120);
    expect(sim.state.stats.kills).toBeGreaterThan(0);
    expect(sim.state.player.level).toBeGreaterThan(1);
    expect(sim.state.player.weapons.length + sim.state.player.passives.length).toBeGreaterThan(1);
  });

  it('pauses on level-up until a card is chosen', () => {
    const sim = new Sim({ seed: 'lv', shipId: 'dawn-ram', seaId: 'sunward-shallows', meta: defaultProfile(), world: new IslandField('lv') });
    sim.debug.grantXp(1000);
    sim.step(1 / 30);
    expect(sim.state.status).toBe('levelup');
    expect(sim.state.offers?.length).toBeGreaterThanOrEqual(3);
    const t = sim.state.time;
    sim.step(1);
    expect(sim.state.time).toBe(t);
    expect(sim.chooseCard(0)).toBe(true);
  });
});

describe('island field', () => {
  it('keeps the start clear and agrees between collision and water queries', () => {
    const world = new IslandField('islands');
    expect(world.isWater(0, 0, 60)).toBe(true);
    const islands = world.islandsNear(0, 0, 3000);
    expect(islands.length).toBeGreaterThan(3);
    const island = islands[0]!;
    expect(world.isWater(island.x, island.z, 1)).toBe(false);
    expect(world.collideCircle(island.x, island.z, 5).hit).toBe(true);
  });
});
