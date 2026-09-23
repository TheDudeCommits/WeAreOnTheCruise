import { describe, expect, it } from 'vitest';
import { DEBUG_SCENES } from '../src/core/contracts';
import { sampleGerstnerWaves } from '../src/core/waves';
import { GameSimulation } from '../src/simulation/GameSimulation';
import { areFactionsHostile } from '../src/simulation/factions';
import { toPresentationEvents } from '../src/runtime/eventAdapter';
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

  it('populates calm open sea with bounded multi-faction iconic traffic', () => {
    const simulation = new GameSimulation('living-sea-seed');
    simulation.loadScenario('calm-sailing');
    const initial = simulation.getState();
    expect(initial.ships.length).toBeGreaterThanOrEqual(6);
    expect(initial.ships.length).toBeLessThanOrEqual(10);
    expect(new Set(initial.ships.map((ship) => ship.kind)).size).toBe(6);
    expect(new Set(initial.ships.map((ship) => ship.faction)).size).toBeGreaterThanOrEqual(5);
    expect(initial.ships.find((ship) => ship.isPlayer)?.targetId).toBe('marine-patrol');

    simulation.step(120);
    const state = simulation.getState();
    const targetedAi = state.ships.filter((ship) => !ship.isPlayer && ship.targetId);
    expect(targetedAi.some((ship) => ship.targetId !== state.playerId)).toBe(true);
    for (const ship of targetedAi) {
      const target = state.ships.find((candidate) => candidate.id === ship.targetId);
      expect(target).toBeDefined();
      expect(areFactionsHostile(ship.faction, target?.faction)).toBe(true);
    }
  });

  it('directs at most ten roaming ships and deterministically calls one reinforcement', () => {
    const simulation = new GameSimulation('director-seed');
    simulation.loadScenario('calm-sailing');
    for (let interval = 0; interval < 3; interval += 1) simulation.step(600);
    simulation.step(180);
    expect(simulation.getState().ships.length).toBeLessThanOrEqual(10);
    expect(simulation.getState().combat?.reinforcements).toBe(1);
    expect(simulation.getState().ships.find((ship) => ship.id === 'marine-reinforcement-1')?.targetId).toBe(simulation.getState().playerId);
  });

  it('rewards a timed weak-point broadside with combo, special, and spoils', () => {
    const simulation = new GameSimulation('weak-point-seed');
    simulation.loadScenario('sunny-broadside');
    const state = simulation.getState();
    const player = state.ships.find((ship) => ship.isPlayer);
    const target = state.ships.find((ship) => ship.id === 'marine-alpha');
    expect(player).toBeDefined();
    expect(target).toBeDefined();
    if (!player || !target) return;
    for (const ship of state.ships) if (ship.id !== player.id && ship.id !== target.id) ship.surrendered = true;
    player.position = { x: 0, y: 0, z: 0 };
    player.heading = 0;
    player.weapons.ammo = 'heavy';
    player.special = 0;
    target.position = { x: -40, y: 0, z: 0 };
    target.heading = 0;
    target.damage.hull = 0.74;
    target.damage.crew = 0.1;
    target.damage.weapons = 0.1;
    target.targetId = player.id;
    simulation.setAction('fire-port', true);
    simulation.step(75);

    const events = simulation.drainEvents();
    const weakPointEvent = events.find((event) => event.type === 'projectile-impact' && event.shipId === target.id && event.weakPoint);
    expect(weakPointEvent).toBeDefined();
    if (weakPointEvent?.type === 'projectile-impact') {
      expect(weakPointEvent.ownerId).toBe(player.id);
      const presentation = toPresentationEvents(weakPointEvent, state);
      expect(presentation.some((event) => event.type === 'impact' && event.incoming === false && event.critical && event.combo)).toBe(true);
    }
    expect(state.combat?.combo).toBeGreaterThan(0);
    expect(player.special).toBeGreaterThan(0);
    expect(state.bounty).toBeGreaterThan(94_000_000);
    expect(state.treasure).toBeGreaterThan(0);
    expect(events.some((event) => event.type === 'ship-disabled' && event.shipId === target.id && (event.bountyReward ?? 0) > 0)).toBe(true);
  });

  it('does not misattribute AI-on-AI combat feedback to the player', () => {
    const simulation = new GameSimulation('presentation-attribution');
    const state = simulation.loadScenario('sunny-broadside');
    const aiImpact = {
      type: 'projectile-impact' as const,
      projectileId: 99,
      ownerId: 'marine-alpha',
      shipId: 'marine-beta',
      ammo: 'round' as const,
      position: { x: 0, y: 0, z: 0 },
      side: 'port' as const,
    };
    expect(toPresentationEvents(aiImpact, state)).toEqual([]);
    expect(toPresentationEvents({
      type: 'ship-disabled', shipId: 'marine-beta', attackerId: 'marine-alpha',
      position: { x: 0, y: 0, z: 0 }, bountyReward: 0, treasureReward: 0,
    }, state)).toEqual([]);
    expect(toPresentationEvents({
      type: 'ship-disabled', shipId: 'marine-beta', attackerId: state.playerId,
      position: { x: 0, y: 0, z: 0 }, bountyReward: 0, treasureReward: 0,
    }, state)).toEqual([]);
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
