import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/simulation/GameSimulation';
import { VOYAGE_LANDMARKS } from '../src/content/voyages';

function advance(simulation: GameSimulation, frames: number): void {
  while (frames > 0) { const count = Math.min(frames, 600); simulation.step(count); frames -= count; }
}

function start(contract = 'dawn-blockade'): GameSimulation {
  const simulation = new GameSimulation('voyage-regression');
  simulation.returnToHarbor();
  simulation.selectPlayerShip('red-force');
  expect(simulation.startVoyage(contract, 'precision')).toBe(true);
  const route = simulation.getState().voyage!.routes[0]!;
  expect(simulation.chooseRoute(route.id)).toBe(true);
  return simulation;
}

/** Put the encounter's ships at the damage threshold; the normal tick resolves them. */
function disableEncounter(simulation: GameSimulation): void {
  for (const ship of simulation.getState().ships) if (!ship.isPlayer) ship.damage.hull = 0.99;
  advance(simulation, 280);
  expect(simulation.getState().voyage?.encounter?.completed).toBe(true);
  expect(simulation.collectEncounterReward()).toBe(true);
  expect(simulation.getState().voyage?.phase).toBe('reward');
}

describe('voyages, crews, and shared world', () => {
  it('completes a voyage, banks once, reloads, refits, and sails another build', () => {
    const simulation = start();
    for (let leg = 1; leg <= 3; leg += 1) {
      disableEncounter(simulation);
      expect(simulation.chooseReward('supplies')).toBe(true);
      if (leg < 3) {
        const route = simulation.getState().voyage!.routes[1]!;
        expect(simulation.chooseRoute(route.id)).toBe(true);
      }
    }
    const result = simulation.getState().voyage!;
    expect(result.phase).toBe('complete');
    expect(result.result?.outcome).toBe('completed');
    expect(result.result!.coins).toBeGreaterThan(900);
    const banked = simulation.getState().progression!.bankedCoins;
    const restored = new GameSimulation('different-bootstrap-seed');
    expect(restored.restoreSave(JSON.parse(JSON.stringify(simulation.exportSave())))).toBe(true);
    expect(restored.extractVoyage()).toBe(false);
    expect(restored.chooseReward('supplies')).toBe(false);
    expect(restored.getState().progression!.bankedCoins).toBe(banked);
    expect(restored.getState().progression!.paidVoyageIds).toHaveLength(1);
    expect(restored.returnToHarbor()).toBe(true);
    expect(restored.buyRefit('storm-rig')).toBe(true);
    expect(restored.buyRefit('storm-rig')).toBe(false);
    expect(restored.startVoyage('tempest-chart', 'interceptor')).toBe(true);
    expect(restored.getState().ships[0]!.kind).toBe('red-force');
    expect(restored.getState().progression!.totalVoyages).toBe(2);
    expect(restored.getState().progression!.refits['storm-rig']).toBe(1);
  });

  it('resumes an interrupted physical encounter deterministically, including in-flight projectiles', () => {
    const original = start();
    original.setAction('fire-port', true);
    original.step(12);
    original.clearActions();
    const restored = new GameSimulation('different-seed');
    expect(restored.restoreSave(JSON.parse(JSON.stringify(original.exportSave())))).toBe(true);
    original.step(180);
    restored.step(180);
    expect(restored.snapshot()).toEqual(original.snapshot());
  });

  it('permits early extraction only after an objective and does not pay a lost run', () => {
    const simulation = start();
    expect(simulation.extractVoyage()).toBe(false);
    expect(simulation.returnToHarbor()).toBe(false);
    disableEncounter(simulation);
    const expected = simulation.getState().voyage!.unbankedCoins;
    expect(simulation.extractVoyage()).toBe(true);
    expect(simulation.getState().progression!.bankedCoins).toBe(expected);
    expect(simulation.extractVoyage()).toBe(false);
    simulation.returnToHarbor();
    simulation.startVoyage('dawn-blockade', 'guardian');
    simulation.chooseRoute(simulation.getState().voyage!.routes[0]!.id);
    simulation.getState().ships[0]!.damage.hull = 1;
    simulation.step(1);
    expect(simulation.getState().voyage?.phase).toBe('failed');
    expect(simulation.getState().progression!.bankedCoins).toBe(expected);
  });

  it('requires physical salvage proximity and preserves partial salvage progress on reload', () => {
    const simulation = start('lost-cargo');
    const state = simulation.getState();
    const encounter = state.voyage!.encounter!;
    advance(simulation, 120);
    expect(encounter.progress).toBe(0);
    const player = state.ships[0]!;
    player.position = { ...encounter.waypoint };
    player.throttle = 0;
    advance(simulation, 180);
    expect(encounter.progress).toBeGreaterThan(2);
    expect(encounter.progress).toBeLessThan(encounter.target);
    const restored = new GameSimulation('resume');
    expect(restored.restoreSave(simulation.exportSave())).toBe(true);
    advance(restored, 600);
    expect(restored.getState().voyage?.encounter?.completed).toBe(true);
    expect(restored.collectEncounterReward()).toBe(true);
    expect(restored.getState().voyage?.phase).toBe('reward');
  });

  it('freezes time and clears held steering/fire on pause, then resumes predictably', () => {
    const simulation = start();
    simulation.setAction('steer-right', true);
    simulation.setAction('fire-port', true);
    simulation.setPaused(true);
    const time = simulation.getState().elapsed;
    simulation.update(0.1);
    expect(simulation.getState().elapsed).toBe(time);
    simulation.setPaused(false);
    simulation.update(1 / 60);
    expect(simulation.getState().elapsed).toBeGreaterThan(time);
    expect(simulation.getState().ships[0]!.rudder).toBe(0);
    expect(simulation.getState().projectiles.filter((shot) => shot.ownerId === 'player')).toHaveLength(0);
  });

  it('retains the selected ship and damage through chapter and voyage-leg transitions', () => {
    const simulation = new GameSimulation('ship-continuity');
    simulation.selectPlayerShip('polar-tang');
    simulation.getState().ships[0]!.damage.hull = 0.32;
    simulation.loadScenario('fleet-battle', { preservePlayer: true });
    expect(simulation.getState().ships[0]!.kind).toBe('polar-tang');
    expect(simulation.getState().ships[0]!.damage.hull).toBe(0.32);
    simulation.returnToHarbor();
    simulation.startVoyage('dawn-blockade', 'interceptor');
    simulation.chooseRoute(simulation.getState().voyage!.routes[0]!.id);
    disableEncounter(simulation);
    const before = simulation.getState().ships[0]!.damage.hull;
    const upgrade = simulation.getState().voyage!.rewardChoices.find((id) => id !== 'supplies')!;
    simulation.chooseReward(upgrade);
    simulation.chooseRoute(simulation.getState().voyage!.routes[1]!.id);
    expect(simulation.getState().ships[0]!.kind).toBe('polar-tang');
    expect(simulation.getState().ships[0]!.damage.hull).toBe(before);
  });

  it('makes crew allocation a bounded repair versus reload tradeoff', () => {
    const guns = new GameSimulation('crew-tradeoff');
    const repairs = new GameSimulation('crew-tradeoff');
    for (const simulation of [guns, repairs]) {
      simulation.loadScenario('crew-closeup');
      simulation.getState().ships[0]!.damage.hull = 0.5;
      simulation.getState().ships[0]!.throttle = 0;
    }
    expect(guns.setCrewAllocation({ helm: 2, guns: 8, repair: 2, special: 1 })).toBe(false);
    guns.setCrewPreset('gunnery');
    repairs.setCrewPreset('repair');
    for (const simulation of [guns, repairs]) { simulation.setAction('fire-port', true); simulation.step(1); }
    expect(repairs.getState().ships[0]!.weapons.portCooldown).toBeGreaterThan(guns.getState().ships[0]!.weapons.portCooldown * 1.7);
    for (const simulation of [guns, repairs]) advance(simulation, 180);
    expect(repairs.getState().ships[0]!.damage.hull).toBeLessThan(guns.getState().ships[0]!.damage.hull - 0.04);
  });

  it('uses shared shore geometry, a navigable arch gap, and persistent discoveries', () => {
    const simulation = start('tempest-chart');
    const state = simulation.getState();
    const harbor = VOYAGE_LANDMARKS.find((island) => island.service === 'harbor')!;
    const player = state.ships[0]!;
    player.position = { ...harbor.position };
    simulation.step(1);
    expect(Math.hypot(player.position.x - harbor.position.x, player.position.z - harbor.position.z)).toBeGreaterThan(harbor.radius);
    expect(player.damage.hull).toBeGreaterThan(0);
    const arch = state.islands.find((island) => island.id === 'sky-arch')!;
    player.position = { ...arch.position };
    player.throttle = 0;
    simulation.step(1);
    expect(Math.abs(player.position.x - arch.position.x)).toBeLessThan(2);
    expect(state.worldFeatures!.filter((feature) => feature.id.startsWith('sky-arch:pylon'))).toHaveLength(2);
    expect(state.progression!.discoveredIds).toContain('sky-arch');
    const treasure = state.treasure;
    player.position = { x: 4000, y: 0, z: 4000 };
    simulation.step(1);
    player.position = { ...arch.position };
    simulation.step(1);
    expect(state.islands.find((island) => island.id === arch.id)?.discovered).toBe(true);
    expect(state.treasure).toBe(treasure);
  });

  it('applies aiming correction to real projectile velocity', () => {
    const straight = new GameSimulation('aiming');
    const aimed = new GameSimulation('aiming');
    for (const simulation of [straight, aimed]) simulation.loadScenario('crew-closeup');
    aimed.setAim('port', 0.28);
    for (const simulation of [straight, aimed]) { simulation.setAction('fire-port', true); simulation.step(1); }
    const a = straight.getState().projectiles[0]!;
    const b = aimed.getState().projectiles[0]!;
    expect(Math.abs(b.velocity.z - a.velocity.z)).toBeGreaterThan(10);
  });

  it('stages each gun from its live mount and resumes pending salvo shots after reload', () => {
    const simulation = new GameSimulation('staggered-salvo');
    simulation.loadScenario('crew-closeup');
    simulation.setAction('fire-port', true);
    simulation.step(1);
    expect(simulation.getState().projectiles).toHaveLength(1);
    expect(simulation.drainEvents().filter((event) => event.type === 'cannon-fired')).toHaveLength(1);
    simulation.clearActions();
    const restored = new GameSimulation('reload');
    expect(restored.restoreSave(simulation.exportSave())).toBe(true);
    simulation.step(24);
    restored.step(24);
    const events = simulation.drainEvents().filter((event) => event.type === 'cannon-fired');
    expect(events).toHaveLength(5);
    expect(new Set(events.map((event) => event.position.z)).size).toBe(5);
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  it('resolves a player-disabled ship once and leaves a persistent sinking state', () => {
    const simulation = new GameSimulation('finishing-reward');
    simulation.loadScenario('sunny-broadside');
    const state = simulation.getState();
    const player = state.ships[0]!;
    const target = state.ships.find((ship) => ship.id === 'marine-alpha')!;
    for (const ship of state.ships) if (ship !== player && ship !== target) ship.surrendered = true;
    player.position = { x: 0, y: 0, z: 0 };
    player.heading = 0;
    player.weapons.ammo = 'heavy';
    target.position = { x: -40, y: 0, z: 0 };
    target.heading = 0;
    target.damage.hull = 0.74;
    target.damage.crew = 0.1;
    target.damage.weapons = 0.1;
    target.targetId = player.id;
    simulation.setAction('fire-port', true);
    simulation.step(90);
    expect(target.finish?.state).toBe('available');
    const spoils = state.treasure;
    expect(simulation.resolveDisabledShip(target.id, 'sink')).toBe(true);
    expect(state.treasure).toBeGreaterThan(spoils);
    expect(simulation.resolveDisabledShip(target.id, 'salvage')).toBe(false);
    advance(simulation, 760);
    expect(target.damageStage).toBe('sunk');
    expect(target.position.y).toBeLessThan(-20);
    expect(Number.isFinite(target.roll)).toBe(true);
  });

  it('telegraphs a special before the active state and keeps it finite through recovery', () => {
    const simulation = new GameSimulation('special-stages');
    simulation.loadScenario('crew-closeup');
    simulation.selectPlayerShip('polar-tang');
    simulation.setAction('special', true);
    simulation.step(1);
    expect(simulation.getState().ships[0]!.specialPhase?.phase).toBe('windup');
    simulation.step(45);
    expect(simulation.getState().ships[0]!.specialPhase?.phase).toBe('active');
    simulation.step(180);
    expect(simulation.getState().ships[0]!.position.y).toBeLessThan(-3);
    simulation.step(180);
    expect(simulation.getState().ships[0]!.specialPhase).toBeUndefined();
  });

  it('rejects invalid save versions and non-finite state without mutating the running game', () => {
    const simulation = start();
    const before = simulation.snapshot();
    const save = simulation.exportSave();
    expect(simulation.restoreSave({ ...save, version: 99 })).toBe(false);
    save.state.ships[0]!.damage.hull = Number.NaN;
    expect(simulation.restoreSave(save)).toBe(false);
    expect(simulation.snapshot()).toEqual(before);
  });
});
