import { describe, expect, it } from 'vitest';
import { GameSimulation, type NavalSave } from '../src/simulation/GameSimulation';
import { DEBUG_SCENES } from '../src/core/contracts';

const advance = (sim: GameSimulation, frames: number): void => { while (frames > 0) { const count = Math.min(frames, 600); sim.step(count); frames -= count; } };
function start(contract = 'dawn-blockade'): GameSimulation {
  const sim = new GameSimulation('integrity-regression');
  sim.returnToHarbor(); sim.selectPlayerShip('red-force');
  sim.startVoyage(contract, 'precision'); sim.chooseRoute(sim.getState().voyage!.routes[0]!.id);
  return sim;
}
function disableWithBroadside(sim: GameSimulation) {
  const state = sim.getState(), player = state.ships[0]!, target = state.ships[1]!;
  player.position = { x: 0, y: 0, z: 0 }; player.heading = 0; player.throttle = 0; player.weapons.ammo = 'heavy';
  target.position = { x: -40, y: 0, z: 0 }; target.heading = 0; target.damage.hull = .74; target.damage.crew = .1; target.damage.weapons = .1;
  target.weapons.portCooldown = 999; target.weapons.starboardCooldown = 999; target.weapons.bowCooldown = 999; target.special = 0;
  sim.setAction('fire-port', true); sim.step(90); sim.clearActions();
  expect(target.finish?.state).toBe('available');
  expect(state.voyage?.encounter?.completed).toBe(true);
  return { state, player, target };
}

/** JSON corruption is deliberately untyped input at the persistence boundary. */
const corruptions: [string, (save: any) => void][] = [
  ['missing upgrades', (s) => { delete s.state.voyage.upgrades; }],
  ['missing heading', (s) => { delete s.state.ships[0].heading; }],
  ['missing bank balance', (s) => { delete s.state.progression.bankedCoins; }],
  ['string velocity', (s) => { s.state.ships[0].verticalSpeed = 'fast'; }],
  ['NaN hull', (s) => { s.state.ships[0].damage.hull = NaN; }],
  ['null runtime tuple', (s) => { s.runtimes[0] = null; }],
  ['short runtime tuple', (s) => { s.runtimes[0] = [s.state.playerId]; }],
  ['missing runtime field', (s) => { delete s.runtimes[0][1].velocityX; }],
  ['duplicate runtime ID', (s) => { s.runtimes[1][0] = s.runtimes[0][0]; }],
  ['duplicate ship ID', (s) => { s.state.ships[1].id = s.state.playerId; }],
  ['unknown target', (s) => { s.state.ships[0].targetId = 'missing-ship'; }],
  ['400 crew', (s) => { s.state.ships[0].crew = { helm: 100, guns: 100, repair: 100, special: 100 }; }],
  ['unknown ship', (s) => { s.state.ships[0].kind = 'invisible-ship'; }],
  ['unknown build', (s) => { s.state.voyage.buildId = 'godmode'; }],
  ['unknown contract', (s) => { s.state.voyage.contractId = 'missing-contract'; }],
  ['unknown ammo', (s) => { s.projectiles[0].state.ammo = 'laser'; }],
  ['invalid projectile tuple', (s) => { s.projectiles[0] = ['projectile']; }],
  ['unknown pending cannon side', (s) => { s.projectiles[0].pending = { delay: 1, side: 'aft', lead: 0, gunOffset: 0, spread: 1 }; }],
  ['invalid progression counter', (s) => { s.state.progression.totalVoyages = -2; }],
  ['null routes', (s) => { s.state.voyage.routes = null; }],
  ['reward missing choices', (s) => { s.state.voyage.phase = 'reward'; }],
  ['unknown upgrade', (s) => { s.state.voyage.upgrades = ['everything']; }],
  ['unbounded refit', (s) => { s.state.progression.refits.rangefinder = 10; }],
  ['non-finite authored radius', (s) => { s.authoredIslands[0].radius = Infinity; }],
  ['wrong world seed', (s) => { s.state.seedNumber += 1; }],
];

describe('save schema and atomic restoration', () => {
  it.each(corruptions)('rejects %s without changing the running simulation', (_name, corrupt) => {
    const incoming = start().exportSave();
    const running = new GameSimulation('unrelated-running-session'); running.loadScenario('fleet-battle'); running.step(60);
    const before = running.exportSave();
    corrupt(incoming);
    expect(() => running.restoreSave(incoming)).not.toThrow();
    expect(running.restoreSave(incoming)).toBe(false);
    expect(running.exportSave()).toEqual(before);
  });

  it('accepts every exported chapter and the pristine bootstrap', () => {
    const sim = new GameSimulation('all-chapter-saves');
    expect(new GameSimulation('restore').restoreSave(sim.exportSave())).toBe(true);
    for (const scene of DEBUG_SCENES) {
      sim.loadScenario(scene); sim.step(90);
      expect(new GameSimulation('restore').restoreSave(JSON.parse(JSON.stringify(sim.exportSave()))), scene).toBe(true);
    }
  });

  it('preserves an explicit manual pause on reload', () => {
    const sim = start(); sim.setPaused(true);
    const restored = new GameSimulation('restore');
    expect(restored.restoreSave(sim.exportSave())).toBe(true);
    expect(restored.getState().paused).toBe(true);
    const time = restored.getState().elapsed;
    restored.update(.1);
    expect(restored.getState().elapsed).toBe(time);
  });
});

describe('navigable aftermath and explicit collection', () => {
  it('keeps a distant disabled target available while sailing, then finishes a full sinking animation', () => {
    const sim = start(); const { state, player, target } = disableWithBroadside(sim);
    player.position = { x: 500, y: 0, z: 500 }; player.throttle = 0;
    advance(sim, 1500);
    expect(state.voyage!.phase).toBe('encounter');
    expect(target.finish!.state).toBe('available');
    expect(target.finish!.elapsed).toBeGreaterThan(20);
    expect(sim.resolveDisabledShip(target.id, 'salvage')).toBe(false);
    const before = { ...player.position };
    sim.setAction('throttle-up', true); advance(sim, 300); sim.clearActions();
    expect(Math.hypot(player.position.x - before.x, player.position.z - before.z)).toBeGreaterThan(10);
    player.position = { x: target.position.x + 50, y: 0, z: target.position.z }; player.throttle = 0;
    expect(sim.resolveDisabledShip(target.id, 'sink')).toBe(true);
    advance(sim, 360);
    const restored = new GameSimulation('restore');
    expect(restored.restoreSave(sim.exportSave())).toBe(true);
    advance(sim, 540); advance(restored, 540);
    expect(restored.snapshot()).toEqual(sim.snapshot());
    expect(target.finish!.state).toBe('sunk');
    expect(target.position.y).toBe(-40);
    expect(state.voyage!.phase).toBe('encounter');
    const beforeCoins = state.voyage!.unbankedCoins;
    expect(sim.collectEncounterReward()).toBe(true);
    expect(state.voyage!.phase).toBe('reward');
    expect(state.voyage!.unbankedCoins).toBe(beforeCoins + state.voyage!.encounter!.reward);
    expect(sim.collectEncounterReward()).toBe(false);
    expect(state.voyage!.unbankedCoins).toBe(beforeCoins + state.voyage!.encounter!.reward);
  });

  it('lets the captain lose the ship during aftermath without receiving the objective reward', () => {
    const sim = start(); const { state, player } = disableWithBroadside(sim);
    player.damage.hull = 1; sim.step(1);
    expect(state.voyage!.phase).toBe('failed');
    expect(state.voyage!.result!.coins).toBe(0);
    expect(sim.collectEncounterReward()).toBe(false);
    expect(state.progression!.bankedCoins).toBe(0);
  });
});

describe('live gun crew preserves reload work', () => {
  it('cannot borrow a fast gunnery cooldown while the same hands repair', () => {
    const make = () => { const sim = new GameSimulation('reload-work'); sim.loadScenario('crew-closeup'); sim.setCrewPreset('gunnery'); sim.setAction('fire-port', true); sim.step(1); sim.clearActions(); return sim; };
    const guns = make(), swapped = make();
    const original = swapped.getState().ships[0]!.weapons.portCooldown;
    swapped.setCrewPreset('repair');
    expect(swapped.getState().ships[0]!.weapons.portCooldown).toBeCloseTo(original * 1.45 / .7, 9);
    // Repeated zero-time assignments cannot manufacture reload progress.
    for (let index = 0; index < 10; index += 1) { swapped.setCrewPreset('gunnery'); swapped.setCrewPreset('repair'); }
    expect(swapped.getState().ships[0]!.weapons.portCooldown).toBeCloseTo(original * 1.45 / .7, 9);
    advance(guns, 60); advance(swapped, 60);
    swapped.setCrewPreset('gunnery');
    expect(swapped.getState().ships[0]!.weapons.portCooldown).toBeCloseTo(original - .7 / 1.45, 8);
    expect(swapped.getState().ships[0]!.weapons.portCooldown).toBeGreaterThan(guns.getState().ships[0]!.weapons.portCooldown + .5);
    const saved = swapped.exportSave();
    const restored = new GameSimulation('restore'); expect(restored.restoreSave(saved)).toBe(true);
    const allocation = { helm: 2, guns: 2, repair: 5, special: 1 };
    swapped.setCrewAllocation(allocation); restored.setCrewAllocation(allocation);
    advance(swapped, 60); advance(restored, 60);
    expect(restored.snapshot()).toEqual(swapped.snapshot());
  });
});

function steer(sim: GameSimulation, waypoint: { x: number; z: number }): void {
  const player = sim.getState().ships[0]!, dx = waypoint.x - player.position.x, dz = waypoint.z - player.position.z;
  const desired = Math.atan2(-dx, -dz), error = Math.atan2(Math.sin(desired - player.heading), Math.cos(desired - player.heading));
  sim.setAction('steer-left', error > .03); sim.setAction('steer-right', error < -.03);
  const throttle = Math.abs(error) > 1 ? .25 : .8;
  sim.setAction('throttle-up', player.throttle < throttle - .02); sim.setAction('throttle-down', player.throttle > throttle + .02);
  sim.step(1);
}

describe('ordered storm passage', () => {
  it('rejects sailing around the arch and approaching the finish from behind', () => {
    const sim = new GameSimulation('storm-input-probe'); sim.returnToHarbor(); sim.startVoyage('tempest-chart', 'interceptor'); sim.chooseRoute(sim.getState().voyage!.routes[0]!.id);
    const points = [{ x: -155, z: -350 }, { x: -155, z: -570 }, { x: -55, z: -590 }];
    let index = 0;
    for (let frame = 0; frame < 6000; frame += 1) {
      const p = sim.getState().ships[0]!.position, waypoint = points[index]!;
      if (Math.hypot(waypoint.x - p.x, waypoint.z - p.z) < 30 && index < points.length - 1) index += 1;
      steer(sim, points[index]!);
    }
    expect(sim.getState().voyage!.encounter!.completed).toBe(false);
    expect(sim.getState().voyage!.encounter!.progress).toBeLessThan(3);
    expect(sim.collectEncounterReward()).toBe(false);
    expect(sim.getState().voyage!.unbankedCoins).toBe(0);
  });

  it('crosses the approach, central opening and exit using ordinary sailing inputs and resumes the sequence', () => {
    const sim = new GameSimulation('storm-straight'); sim.returnToHarbor(); sim.startVoyage('tempest-chart', 'interceptor'); sim.chooseRoute(sim.getState().voyage!.routes[0]!.id);
    for (let frame = 0; frame < 6000 && sim.getState().voyage!.encounter!.progress < 1; frame += 1) steer(sim, { x: 0, z: -700 });
    expect(sim.getState().voyage!.encounter!.progress).toBe(1);
    sim.clearActions();
    const saved: NavalSave = sim.exportSave();
    const restored = new GameSimulation('restore'); expect(restored.restoreSave(saved)).toBe(true);
    for (let frame = 0; frame < 6000 && !restored.getState().voyage!.encounter!.completed; frame += 1) steer(restored, { x: 0, z: -700 });
    expect(restored.getState().voyage!.encounter!.progress).toBe(3);
    expect(restored.getState().voyage!.encounter!.nextGate).toBe(3);
    expect(restored.getState().voyage!.encounter!.completed).toBe(true);
    expect(restored.collectEncounterReward()).toBe(true);
  });
});
