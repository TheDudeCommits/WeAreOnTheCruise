import { describe, expect, it } from 'vitest';
import { GameSimulation, type NavalSave } from '../src/simulation/GameSimulation';
import { SHIP_SPECS } from '../src/content/shipSpecs';
import type { ShipKind } from '../src/core/contracts';
import { createVoyageRoutes } from '../src/content/voyages';

function routeReady(contract = 'dawn-blockade', seed = 'semantic:save-regression'): GameSimulation {
  const sim = new GameSimulation(seed);
  sim.returnToHarbor();
  expect(sim.startVoyage(contract, 'precision')).toBe(true);
  return sim;
}

function collectBattle(sim: GameSimulation): void {
  expect(sim.chooseRoute(sim.getState().voyage!.routes[1]!.id)).toBe(true);
  // A damage fixture exercises the normal disable, aftermath and collection transitions.
  for (const ship of sim.getState().ships) if (!ship.isPlayer) ship.damage.hull = 1;
  sim.step(1);
  expect(sim.getState().voyage!.encounter!.completed).toBe(true);
  expect(sim.collectEncounterReward()).toBe(true);
}

function rejectsAtomically(save: NavalSave): void {
  const running = new GameSimulation('unrelated-session');
  running.loadScenario('fleet-battle'); running.step(30);
  const before = running.exportSave();
  expect(running.restoreSave(save)).toBe(false);
  expect(running.exportSave()).toEqual(before);
}

describe('canonical contracts and objective references', () => {
  it.each([
    ['kind', 'salvage'], ['reward', 1000000], ['name', 'Free payout'],
    ['weather', 'calm'], ['risk', 'dangerous'], ['landmarkId', 'dawn-harbor'],
    ['description', 'Forged contract'],
  ] as const)('rejects changed route %s under an existing route ID', (key, value) => {
    const save = routeReady('tempest-chart').exportSave();
    Object.assign(save.state.voyage!.routes[0]!, { [key]: value });
    rejectsAtomically(save);
  });

  it('uses authored route terms if an in-memory caller changes the displayed offer', () => {
    const sim = routeReady('tempest-chart');
    const route = sim.getState().voyage!.routes[0]!, reward = route.reward;
    route.kind = 'salvage'; route.reward = 1000000;
    expect(sim.chooseRoute(route.id)).toBe(true);
    expect(sim.getState().voyage!.encounter!.kind).toBe('storm');
    expect(sim.getState().voyage!.encounter!.reward).toBe(reward);
    expect(new GameSimulation('restore').restoreSave(sim.exportSave())).toBe(true);
  });

  it.each(['player', 'unknown', 'allied'] as const)('rejects an encounter target that is %s', (target) => {
    const sim = routeReady(); sim.chooseRoute(sim.getState().voyage!.routes[0]!.id);
    const save = sim.exportSave();
    if (target === 'allied') save.state.ships[1]!.faction = save.state.ships[0]!.faction;
    else save.state.voyage!.encounter!.targetIds = [target === 'player' ? save.state.playerId : 'absent-enemy'];
    rejectsAtomically(save);
  });

  it.each(Object.keys(SHIP_SPECS) as ShipKind[])('retains a reloadable hostile contract for %s', (kind) => {
    const sim = new GameSimulation(`ship-contract:${kind}`); sim.returnToHarbor(); sim.selectPlayerShip(kind);
    sim.startVoyage('dawn-blockade', 'precision'); sim.chooseRoute(sim.getState().voyage!.routes[0]!.id);
    const state = sim.getState(), player = state.ships[0]!, enemy = state.ships[1]!;
    expect(enemy.targetId).toBe(player.id);
    expect(enemy.faction).not.toBe(player.faction);
    expect(new GameSimulation('restore').restoreSave(JSON.parse(JSON.stringify(sim.exportSave())))).toBe(true);
  });

  it.each(['full-but-incomplete', 'complete-before-full', 'gate-count-mismatch'] as const)('rejects %s storm progress', (corruption) => {
    const sim = routeReady('tempest-chart'); sim.chooseRoute(sim.getState().voyage!.routes[0]!.id);
    const save = sim.exportSave(), encounter = save.state.voyage!.encounter!;
    if (corruption === 'full-but-incomplete') { encounter.progress = 3; encounter.nextGate = 3; }
    if (corruption === 'complete-before-full') { encounter.completed = true; encounter.resolvedAt = 0; }
    if (corruption === 'gate-count-mismatch') { encounter.progress = 1; encounter.nextGate = 2; }
    rejectsAtomically(save);
  });
});

describe('unique rewards and payout identities', () => {
  it('rejects already owned rewards at both the restore and selection boundaries', () => {
    const sim = routeReady(); collectBattle(sim);
    const voyage = sim.getState().voyage!;
    voyage.upgrades = ['powder']; voyage.rewardChoices = ['powder', 'supplies'];
    rejectsAtomically(sim.exportSave());
    const before = sim.exportSave();
    expect(sim.chooseReward('powder')).toBe(false);
    expect(sim.exportSave()).toEqual(before);
    expect(sim.chooseReward('supplies')).toBe(true);
    expect(voyage.upgrades).toEqual(['powder']);
    expect(new GameSimulation('restore').restoreSave(sim.exportSave())).toBe(true);
  });

  it('allows supplies on every leg and reloads each transition without stacking an upgrade', () => {
    let sim = routeReady();
    for (let leg = 1; leg <= 3; leg += 1) {
      collectBattle(sim);
      expect(sim.chooseReward('supplies')).toBe(true);
      expect(sim.getState().voyage!.upgrades).toEqual([]);
      const restored = new GameSimulation('restore');
      expect(restored.restoreSave(JSON.parse(JSON.stringify(sim.exportSave())))).toBe(true);
      sim = restored;
    }
    expect(sim.getState().voyage!.phase).toBe('complete');
    expect(sim.getState().progression!.bankedCoins).toBe(1530);
    expect(sim.extractVoyage()).toBe(false);
  });

  it.each(['future', 'wrong-seed', 'leading-zero', 'malformed'] as const)('rejects %s ledger identities even with matching terminal records', (corruption) => {
    const sim = routeReady(); collectBattle(sim); sim.extractVoyage();
    const save = sim.exportSave();
    const id = corruption === 'future' ? `${save.seed}:2` : corruption === 'wrong-seed' ? 'another-world:1' : corruption === 'leading-zero' ? `${save.seed}:01` : `${save.seed}:NaN`;
    save.state.voyage!.id = id; save.state.progression!.paidVoyageIds = [id];
    rejectsAtomically(save);
  });

  it('allocates beyond existing payout IDs if an in-memory counter falls behind', () => {
    const sim = routeReady(); collectBattle(sim); sim.extractVoyage();
    sim.returnToHarbor(); sim.startVoyage('dawn-blockade', 'precision'); collectBattle(sim); sim.extractVoyage();
    sim.returnToHarbor(); sim.getState().progression!.totalVoyages = 1;
    expect(sim.startVoyage('dawn-blockade', 'precision')).toBe(true);
    expect(sim.getState().voyage!.id).toBe(`${sim.exportSave().seed}:3`);
    expect(sim.getState().progression!.totalVoyages).toBe(3);
    collectBattle(sim); expect(sim.extractVoyage()).toBe(true);
    expect(sim.getState().progression!.paidVoyageIds).toHaveLength(3);
    expect(new GameSimulation('restore').restoreSave(sim.exportSave())).toBe(true);
  });
});

describe('runtime relationships on recovery', () => {
  it.each(['player-checkpoint', 'ai-checkpoint', 'hud-checkpoint', 'empty-course', 'single-checkpoint', 'lap-overflow', 'unfinished-final-lap'] as const)('rejects invalid race %s without hydrating a crashing state', (corruption) => {
    const sim = new GameSimulation('race-recovery'); sim.loadScenario('race-rough');
    const save = sim.exportSave();
    if (corruption === 'player-checkpoint') save.runtimes[0]![1].raceCheckpoint = save.raceCourse.length;
    if (corruption === 'ai-checkpoint') save.runtimes[1]![1].raceCheckpoint = save.raceCourse.length;
    if (corruption === 'hud-checkpoint') save.state.race.checkpoint = save.raceCourse.length;
    if (corruption === 'empty-course') save.raceCourse = [];
    if (corruption === 'single-checkpoint') save.raceCourse = save.raceCourse.slice(0, 1);
    if (corruption === 'lap-overflow') save.runtimes[0]![1].raceLap = save.state.race.totalLaps + 2;
    if (corruption === 'unfinished-final-lap') save.runtimes[0]![1].raceLap = save.state.race.totalLaps + 1;
    rejectsAtomically(save);
  });

  it('reloads the final valid checkpoint and a normally resolved race finish', () => {
    let sim = new GameSimulation('race-finish-save'); sim.loadScenario('race-rough');
    for (let gate = 0; gate < sim.getRaceCourse().length - 1; gate += 1) {
      sim.getState().ships[0]!.position = { ...sim.getRaceCourse()[sim.getState().race.checkpoint]! };
      sim.step(1);
    }
    expect(sim.getState().race.checkpoint).toBe(sim.getRaceCourse().length - 1);
    const restored = new GameSimulation('restore'); expect(restored.restoreSave(sim.exportSave())).toBe(true); sim = restored;
    // Position fixtures enter each real gate; the simulation owns lap wrapping and finish bookkeeping.
    for (let gate = 0; gate < 40 && !sim.exportSave().finishOrder.includes(sim.getState().playerId); gate += 1) {
      sim.getState().ships[0]!.position = { ...sim.getRaceCourse()[sim.getState().race.checkpoint]! };
      sim.step(1);
    }
    const finished = sim.exportSave();
    expect(finished.finishOrder).toContain(finished.state.playerId);
    expect(finished.runtimes[0]![1].raceFinished).toBe(true);
    expect(finished.runtimes[0]![1].raceLap).toBe(finished.state.race.totalLaps + 1);
    expect(new GameSimulation('restore').restoreSave(finished)).toBe(true);
  });

  it.each(['free-sail', 'race', 'voyage'] as const)('rejects an unrecoverably stopped clock in %s while preserving manual pause', (mode) => {
    const sim = mode === 'voyage' ? routeReady('lost-cargo') : new GameSimulation('normal-clock');
    if (mode === 'race') sim.loadScenario('race-rough');
    if (mode === 'voyage') sim.chooseRoute(sim.getState().voyage!.routes[0]!.id);
    for (const clock of [0, 1e-9, 10]) { const save = sim.exportSave(); save.state.timeScale = clock; rejectsAtomically(save); }
    sim.setPaused(true);
    const restored = new GameSimulation('restore'); expect(restored.restoreSave(sim.exportSave())).toBe(true);
    expect(restored.getState().paused).toBe(true);
    restored.setPaused(false); const before = restored.getState().elapsed; restored.update(1 / 60);
    expect(restored.getState().elapsed).toBeGreaterThan(before);
  });

  it('rejects claimed victory over an active target but permits a real simultaneous loss', () => {
    const sim = routeReady(); sim.chooseRoute(sim.getState().voyage!.routes[0]!.id);
    const save = sim.exportSave(), encounter = save.state.voyage!.encounter!;
    encounter.completed = true; encounter.progress = encounter.target; encounter.resolvedAt = encounter.elapsed;
    rejectsAtomically(save);
    for (const ship of sim.getState().ships) ship.damage.hull = 1;
    sim.step(1);
    expect(sim.getState().voyage!.phase).toBe('failed');
    expect(sim.collectEncounterReward()).toBe(false);
    expect(new GameSimulation('restore').restoreSave(sim.exportSave())).toBe(true);
  });

  it('rejects shortened or endless salvage duration and hold progress exceeding elapsed time', () => {
    const sim = routeReady('lost-cargo'); sim.chooseRoute(sim.getState().voyage!.routes[0]!.id);
    for (const target of [1, 1000000000]) { const save = sim.exportSave(); save.state.voyage!.encounter!.target = target; rejectsAtomically(save); }
    const save = sim.exportSave(); save.state.voyage!.encounter!.progress = 1; rejectsAtomically(save);
  });

  it('validates the authored escort duration after normal reward and route transitions', () => {
    let seed;
    for (let index = 0; index < 100; index += 1) {
      const candidate = `escort-regression-${index}`;
      if (createVoyageRoutes(`${candidate}:1`, 'dawn-blockade', 2)[0]!.kind === 'escort') { seed = candidate; break; }
    }
    expect(seed).toBeDefined();
    const sim = routeReady('dawn-blockade', seed); collectBattle(sim); sim.chooseReward('supplies');
    sim.chooseRoute(sim.getState().voyage!.routes[0]!.id);
    expect(sim.getState().voyage!.encounter!.kind).toBe('escort');
    expect(new GameSimulation('restore').restoreSave(sim.exportSave())).toBe(true);
    const save = sim.exportSave(); save.state.voyage!.encounter!.target = 1000000000; rejectsAtomically(save);
  });
});
