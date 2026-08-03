import { describe, expect, it } from 'vitest';
import { DEBUG_SCENES } from '../src/core/contracts';
import { sampleGerstnerWaves } from '../src/core/waves';
import { GameSimulation } from '../src/simulation/GameSimulation';
import { ProceduralChunkGenerator } from '../src/world/chunks';

describe('deterministic naval runtime', () => {
  it('replays every evidence scenario from the same seed', () => {
    for (const scene of DEBUG_SCENES) {
      const first = new GameSimulation('evidence-seed');
      first.loadScenario(scene);
      first.step(180);
      const second = new GameSimulation('evidence-seed');
      second.loadScenario(scene);
      second.step(180);
      expect(second.snapshot()).toEqual(first.snapshot());
    }
  });

  it('fires a physical broadside through the projectile pool', () => {
    const simulation = new GameSimulation('broadside-seed');
    simulation.loadScenario('sunny-broadside');
    simulation.setAction('fire-port', true);
    simulation.step(1);
    expect(simulation.getState().projectiles.length).toBeGreaterThan(0);
    expect(simulation.drainEvents().some((event) => event.type === 'cannon-fired')).toBe(true);
  });

  it('generates chunks independently of request order', () => {
    const generator = new ProceduralChunkGenerator(0xdecafbad);
    const first = generator.generate(-7, 11);
    generator.generate(30, -80);
    expect(generator.generate(-7, 11)).toEqual(first);
  });

  it('returns stable normalized wave samples', () => {
    const first = sampleGerstnerWaves(120.5, -88.25, 42);
    const second = sampleGerstnerWaves(120.5, -88.25, 42);
    expect(second).toEqual(first);
    expect(Math.hypot(first.normal.x, first.normal.y, first.normal.z)).toBeCloseTo(1, 6);
  });
});
