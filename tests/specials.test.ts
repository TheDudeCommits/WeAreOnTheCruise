import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GameSimulation } from '../src/simulation/GameSimulation';
import type { NavalSave } from '../src/simulation/GameSimulation';
import type { InputAction, ShipKind } from '../src/core/contracts';
import { NavalFxView } from '../src/render/fx/NavalFxView';
import { MOBY_PRESSURE_RADIUS, POLAR_DIVE_DEPTH, polarDiveDepth } from '../src/simulation/specials';
import { cannonVolleyCount, cannonVolleyOffset, sampleCannonTrajectory } from '../src/simulation/ballistics';
import { FallbackWaveSampler } from '../src/simulation/fallbackWaves';

const flatWater = { sample: () => ({ height: 0 }) };
const tap = (sim: GameSimulation, action: InputAction) => { sim.setAction(action, true); sim.setAction(action, false); };
function scene(kind: ShipKind) {
  const sim = new GameSimulation('special-contract', { waveSampler: flatWater });
  sim.loadScenario('sunny-broadside'); sim.selectPlayerShip(kind);
  const state = sim.getState(), player = state.ships[0]!;
  player.position = { x: 0, y: 0, z: 0 }; player.heading = 0; player.throttle = 0;
  state.currentStrength = 0;
  // Isolated combat fixture: keep normal moving AI opponents but suppress their
  // unrelated cannon/special damage while measuring the pressure-wave front.
  state.ships.slice(1).forEach((ship, i) => {
    ship.position = [{ x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 125 }, { x: -230, y: 0, z: 0 }][i]!;
    ship.weapons.portCooldown = ship.weapons.starboardCooldown = ship.weapons.bowCooldown = 999;
    ship.special = 0;
  });
  return sim;
}
function until(sim: GameSimulation, condition: () => boolean, max = 600) {
  let n = 0; while (!condition() && n++ < max) sim.step(1);
  expect(condition()).toBe(true);
}
function startWave() {
  const sim = scene('moby-dick'); tap(sim, 'special');
  until(sim, () => sim.getState().ships[0]!.specialPhase?.phase === 'active');
  return sim;
}

describe('authoritative reference specials', () => {
  it('telegraphs Moby before damage and hits each moving target only when the real front reaches it', () => {
    const sim = scene('moby-dick'), state = sim.getState(), player = state.ships[0]!, target = state.ships[1]!;
    const originalHull = target.damage.hull;
    tap(sim, 'special'); sim.step(60);
    expect(player.specialPhase?.phase).toBe('windup'); expect(target.damage.hull).toBe(originalHull);
    expect(sim.drainEvents().filter(e => e.type === 'special-impact')).toHaveLength(0);
    until(sim, () => player.specialPhase?.phase === 'active');
    expect(player.specialPhase!.pressureWave!.radius).toBe(0);
    const origin = structuredClone(player.specialPhase!.pressureWave!.origin);
    sim.step(50); // Front is only 62.5m; the moving target remains beyond it.
    expect(player.specialPhase!.pressureWave!.radius).toBeCloseTo(62.5, 6);
    expect(target.damage.hull).toBe(originalHull);
    until(sim, () => player.specialPhase!.pressureWave!.hitIds.includes(target.id));
    const hits = sim.drainEvents().filter(e => e.type === 'special-impact');
    const impact = hits.find(e => e.type === 'special-impact' && e.shipId === target.id)!;
    expect(impact).toBeDefined();
    if (impact.type === 'special-impact') expect(Math.hypot(impact.position.x-origin.x,impact.position.z-origin.z)).toBeLessThanOrEqual(impact.radius + 1e-6);
    expect(target.damage.hull).toBeGreaterThan(originalHull);
    expect(player.specialPhase!.pressureWave!.origin).toEqual(origin);
    sim.step(180);
    expect(sim.drainEvents().filter(e => e.type === 'special-impact' && e.shipId === target.id)).toHaveLength(0);
  });

  it('allows an escaping target to leave the future wave and never hits behind an already-passed front', () => {
    const sim = startWave(), player = sim.getState().ships[0]!, target = sim.getState().ships[1]!;
    const original = target.damage.hull;
    // Explicit movement fixture samples two crossing cases independently of AI.
    for (let i = 0; i < 115; i++) { target.position.x += 1; sim.step(1); }
    expect(target.damage.hull).toBe(original);
    expect(sim.drainEvents().filter(e => e.type === 'special-impact' && e.shipId === target.id)).toHaveLength(0);
    expect(player.specialPhase!.pressureWave!.radius).toBe(MOBY_PRESSURE_RADIUS);
    target.position.x = 85; target.position.z = 0; sim.step(20);
    expect(sim.drainEvents().filter(e => e.type === 'special-impact' && e.shipId === target.id)).toHaveLength(0);
  });

  it('lets normal bracing reduce a pressure hit', () => {
    const damage = (brace: boolean) => {
      const sim = scene('navy-galleon'), state = sim.getState(), player = state.ships[0]!, source = state.ships[1]!;
      // Enemy activation fixture, followed by the production wave and player brace input.
      source.kind = 'moby-dick'; source.faction = 'whitebeard'; source.position = { x: 100, y: 0, z: 0 };
      source.specialPhase = { phase: 'active', name: 'tremor-broadside', elapsed: 0, duration: 1.8, pressureWave: { origin: { ...source.position }, radius: 0, hitIds: [] } };
      if (brace) sim.setAction('brace', true);
      sim.step(100);
      expect(source.specialPhase!.pressureWave!.hitIds).toContain(player.id);
      return player.damage.hull;
    };
    expect(damage(true)).toBeLessThan(damage(false) * .5);
  });

  it('continues the same wave after a mid-front JSON save and does not repeat earlier hits', () => {
    const original = startWave(); original.step(84); original.clearActions();
    const restored = new GameSimulation('restore', { waveSampler: flatWater });
    expect(restored.restoreSave(JSON.parse(JSON.stringify(original.exportSave())))).toBe(true);
    original.drainEvents(); restored.drainEvents(); original.step(150); restored.step(150);
    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restored.drainEvents()).toEqual(original.drainEvents());
  });

  it('keeps legacy Moby active saves compatible without another damage wave', () => {
    const sim = startWave(); sim.step(12); const legacy = sim.exportSave();
    delete legacy.state.ships[0]!.specialPhase!.pressureWave;
    const restored = new GameSimulation('legacy', { waveSampler: flatWater });
    expect(restored.restoreSave(legacy)).toBe(true);
    expect(restored.getState().ships[0]!.specialPhase!.pressureWave!.hitIds).toHaveLength(3);
    restored.step(220);
    expect(restored.drainEvents().filter(e => e.type === 'special-impact')).toHaveLength(0);
  });

  it.each(['active', 'recovery'] as const)('normalizes accepted legacy %s timing into an export that can be restored again', (phaseName) => {
    const sim = startWave(), legacy = sim.exportSave(), phase = legacy.state.ships[0]!.specialPhase!;
    delete phase.pressureWave;
    phase.phase = phaseName; phase.duration = 1.2; phase.elapsed = .48;
    const restored = new GameSimulation('legacy-timing', { waveSampler: flatWater });
    expect(restored.restoreSave(legacy)).toBe(true);
    const normalized = restored.getState().ships[0]!.specialPhase!;
    expect(normalized.duration).toBe(phaseName === 'active' ? 1.8 : 1.25);
    expect(normalized.elapsed / normalized.duration).toBeCloseTo(.4, 10);
    const again = new GameSimulation('legacy-second-restore', { waveSampler: flatWater });
    expect(again.restoreSave(JSON.parse(JSON.stringify(restored.exportSave())))).toBe(true);
    restored.step(240); again.step(240);
    expect(restored.snapshot()).toEqual(again.snapshot());
    expect(restored.drainEvents().filter(e => e.type === 'special-impact')).toHaveLength(0);
  });

  it('hits a hull pushed across the pressure front by actual collision separation and restores that tick consistently', () => {
    const quiet = (sim: GameSimulation) => {
      (sim as any).updateAiIntent = () => {};
      (sim as any).updateEnvironmentalHazards = () => {};
      (sim as any).updateEncounterDirector = () => {};
      return sim;
    };
    const sim = quiet(new GameSimulation('collision-pressure-front', { waveSampler: flatWater }));
    sim.loadScenario('fleet-battle'); sim.selectPlayerShip('moby-dick');
    const state = sim.getState(); state.ships = state.ships.slice(0, 3); state.mode = 'explore'; state.currentStrength = 0;
    const ids = new Set(state.ships.map(ship => ship.id));
    for (const [id] of (sim as any).runtimes) if (!ids.has(id)) (sim as any).runtimes.delete(id);
    state.ships.forEach((ship, i) => {
      ship.position = { x: i === 0 ? 0 : i === 1 ? 75.1 : 97.6, y: 0, z: 0 };
      ship.throttle = ship.rudder = ship.speed = ship.verticalSpeed = ship.brace = 0;
      ship.special = i ? 0 : 1; ship.repairing = false; ship.targetId = i ? state.playerId : state.ships[1]!.id;
      ship.faction = i ? 'marine' : 'whitebeard';
      Object.assign((sim as any).runtimes.get(ship.id), { velocityX: 0, velocityZ: 0, desiredThrottle: 0, desiredRudder: 0, yawVelocity: 0 });
    });
    const source = state.ships[0]!, target = state.ships[1]!, other = state.ships[2]!;
    source.specialPhase = { name: 'tremor-broadside', phase: 'active', elapsed: 1, duration: 1.8, pressureWave: { origin: { x: 0, y: 0, z: 0 }, radius: 75, hitIds: [] } };
    other.heading = Math.PI / 2;
    Object.assign((sim as any).runtimes.get(other.id), { velocityX: -31, impactCooldown: .5 });
    const restored = quiet(new GameSimulation('restore-collision', { waveSampler: flatWater }));
    expect(restored.restoreSave(JSON.parse(JSON.stringify(sim.exportSave())))).toBe(true);
    sim.step(1); restored.step(1);
    expect(target.position.x).toBeLessThan(75);
    expect(source.specialPhase.pressureWave!.radius).toBeCloseTo(76.25, 8);
    expect(source.specialPhase.pressureWave!.hitIds).toContain(target.id);
    expect(sim.drainEvents().filter(e => e.type === 'special-impact' && e.shipId === target.id)).toHaveLength(1);
    expect(restored.snapshot()).toEqual(sim.snapshot());
    sim.step(60);
    expect(sim.drainEvents().filter(e => e.type === 'special-impact' && e.shipId === target.id)).toHaveLength(0);
  });

  it.each([
    ['non-finite origin', (save: NavalSave) => { save.state.ships[0]!.specialPhase!.pressureWave!.origin.x = NaN; }],
    ['out-of-range radius', (save: NavalSave) => { save.state.ships[0]!.specialPhase!.pressureWave!.radius = 136; }],
    ['radius inconsistent with time', (save: NavalSave) => { save.state.ships[0]!.specialPhase!.pressureWave!.radius = 12; }],
    ['unknown hit id', (save: NavalSave) => { save.state.ships[0]!.specialPhase!.pressureWave!.hitIds = ['missing']; }],
    ['self hit id', (save: NavalSave) => { save.state.ships[0]!.specialPhase!.pressureWave!.hitIds = ['player']; }],
    ['duplicate hit id', (save: NavalSave) => { save.state.ships[0]!.specialPhase!.pressureWave!.hitIds = ['marine-alpha','marine-alpha']; }],
    ['malformed hit ids', (save: NavalSave) => { (save.state.ships[0]!.specialPhase!.pressureWave as any).hitIds = {}; }],
  ] as const)('rejects %s atomically', (_name, alter) => {
    const sim = startWave(); sim.step(24); const save = sim.exportSave(); alter(save);
    const before = sim.snapshot(); expect(sim.restoreSave(save)).toBe(false); expect(sim.snapshot()).toEqual(before);
  });

  it('dives Polar physically, cancels queued underwater guns, and requires a new shot after resurfacing', () => {
    const sim = new GameSimulation('polar-window', { waveSampler: flatWater }); sim.loadScenario('crew-closeup'); sim.selectPlayerShip('polar-tang');
    const player = sim.getState().ships[0]!;
    tap(sim, 'special');
    until(sim, () => Boolean(player.specialPhase && player.specialPhase.elapsed >= .615));
    tap(sim, 'fire-port'); sim.step(1);
    expect(sim.exportSave().projectiles.some(slot => slot.pending && slot.state.ownerId === player.id)).toBe(true);
    until(sim, () => player.specialPhase?.phase === 'active'); sim.drainEvents();
    tap(sim, 'fire-starboard'); tap(sim, 'fire-bow'); sim.step(120);
    expect(player.position.y).toBeLessThan(-POLAR_DIVE_DEPTH + 2);
    expect(sim.drainEvents().filter(e => e.type === 'cannon-fired' && e.shipId === player.id)).toHaveLength(0);
    expect(sim.exportSave().projectiles.some(slot => slot.pending && slot.state.ownerId === player.id)).toBe(false);
    until(sim, () => player.specialPhase?.phase === 'recovery');
    expect(polarDiveDepth(player)).toBe(POLAR_DIVE_DEPTH);
    tap(sim, 'fire-bow'); sim.step(30);
    expect(polarDiveDepth(player)).toBeGreaterThan(0); expect(polarDiveDepth(player)).toBeLessThan(POLAR_DIVE_DEPTH);
    expect(sim.drainEvents().filter(e => e.type === 'cannon-fired')).toHaveLength(0);
    until(sim, () => !player.specialPhase); sim.step(90);
    expect(player.position.y).toBeGreaterThan(-1);
    expect(sim.drainEvents().filter(e => e.type === 'cannon-fired')).toHaveLength(0);
    tap(sim, 'fire-bow'); sim.step(12);
    expect(sim.drainEvents().some(e => e.type === 'cannon-fired' && e.shipId === player.id)).toBe(true);
  });

  it.each(['flat', 'normal-waves'] as const)('holds Polar recovery until all real battery mounts clear %s water, preserving a mid-hold save', (water) => {
    const sampler = water === 'flat' ? flatWater : new FallbackWaveSampler();
    const sim = new GameSimulation('physical-surfacing', { waveSampler: sampler });
    sim.loadScenario('storm-sailing'); sim.selectPlayerShip('polar-tang'); tap(sim, 'special');
    const player = sim.getState().ships[0]!;
    until(sim, () => player.specialPhase?.phase === 'recovery');
    until(sim, () => player.specialPhase!.elapsed === player.specialPhase!.duration);
    const restored = new GameSimulation('surfacing-restore', { waveSampler: sampler });
    expect(restored.restoreSave(JSON.parse(JSON.stringify(sim.exportSave())))).toBe(true);
    let heldFrames = 0;
    while (player.specialPhase && heldFrames++ < 120) { sim.step(1); restored.step(1); }
    expect(player.specialPhase).toBeUndefined(); expect(heldFrames).toBeLessThan(120);
    expect(restored.snapshot()).toEqual(sim.snapshot());
    for (const side of ['port', 'starboard', 'bow'] as const) {
      const count = cannonVolleyCount(player, side);
      for (let index = 0; index < count; index++) {
        const muzzle = sampleCannonTrajectory(player, side, 0, cannonVolleyOffset(index, count)).position;
        expect(muzzle.y).toBeGreaterThan(sampler.sample(muzzle.x, muzzle.z, sim.getState().elapsed).height + .1);
      }
    }
    sim.drainEvents(); tap(sim, 'fire-bow'); sim.step(1);
    expect(sim.drainEvents().some(e => e.type === 'cannon-fired' && e.shipId === player.id)).toBe(true);
  });

  it.each(['fallback-waves', 'local-slope'] as const)('releases every real Polar volley mount at heading PI over %s, including an immediate first port shot', (water) => {
    const sampler = water === 'fallback-waves' ? new FallbackWaveSampler() : { sample: (_x: number, z: number) => ({ height: .12 * z }) };
    const sim = new GameSimulation('polar-actual-mounts', { waveSampler: sampler });
    sim.loadScenario('crew-closeup'); sim.selectPlayerShip('polar-tang');
    const state = sim.getState(), player = state.ships[0]!;
    player.position = { x: 0, y: 0, z: 0 }; player.heading = Math.PI; player.throttle = 0; state.currentStrength = 0;
    tap(sim, 'special'); until(sim, () => player.specialPhase?.phase === 'recovery');
    until(sim, () => player.specialPhase!.elapsed === player.specialPhase!.duration);
    const restored = new GameSimulation('mounts-restored', { waveSampler: sampler });
    expect(restored.restoreSave(JSON.parse(JSON.stringify(sim.exportSave())))).toBe(true);
    let hold = 0;
    while (player.specialPhase && hold++ < 120) { sim.step(1); restored.step(1); }
    expect(player.specialPhase).toBeUndefined(); expect(hold).toBeLessThan(120);
    expect(restored.snapshot()).toEqual(sim.snapshot());
    for (const side of ['port', 'starboard', 'bow'] as const) {
      const count = cannonVolleyCount(player, side);
      for (let index = 0; index < count; index++) {
        const muzzle = sampleCannonTrajectory(player, side, 0, cannonVolleyOffset(index, count)).position;
        expect(muzzle.y - sampler.sample(muzzle.x, muzzle.z, state.elapsed).height).toBeGreaterThan(.1);
      }
    }
    sim.drainEvents(); tap(sim, 'fire-port'); sim.step(1);
    const first = sim.drainEvents().filter(event => event.type === 'cannon-fired' && event.shipId === player.id);
    expect(first).toHaveLength(1);
    let fired = first.length;
    for (let frame = 0; frame < 12; frame++) {
      sim.step(1);
      for (const event of sim.drainEvents()) if (event.type === 'cannon-fired' && event.shipId === player.id) {
        fired += 1;
        expect(event.position.y).toBeGreaterThan(sampler.sample(event.position.x, event.position.z, state.elapsed).height + .1);
      }
    }
    expect(fired).toBe(cannonVolleyCount(player, 'port'));
  });

  it('projects distinct phase meshes and exact authoritative pressure radius without creating damage', () => {
    const sim = startWave(); sim.step(40);
    const choppyWater = { sample: (x: number, z: number) => ({ height: Math.sin(x * .13) * 4 + Math.cos(z * .11) * 3 }) };
    const scene3d = new THREE.Scene(), fx = new NavalFxView(scene3d, { waveSampler: choppyWater });
    const before = sim.snapshot(); fx.sync(sim.getState());
    const front = fx.root.getObjectByName('moby-authoritative-pressure-front') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(front.geometry.drawRange.count).toBe(96 * 3 * 6);
    const positions = front.geometry.getAttribute('position'), wave = sim.getState().ships[0]!.specialPhase!.pressureWave!;
    let minCrest = Number.POSITIVE_INFINITY, maxCrest = 0;
    for (let segment = 0; segment <= 96; segment++) for (let row = 0; row < 4; row++) {
      const index = segment * 4 + row, x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
      const radius = Math.hypot(x - wave.origin.x, z - wave.origin.z);
      expect(radius).toBeLessThanOrEqual(wave.radius + .0001);
      expect(y).toBeGreaterThan(choppyWater.sample(x, z).height);
      if (row === 3) expect(radius).toBeCloseTo(wave.radius, 4);
      if (row === 2) { const crest = y - choppyWater.sample(x, z).height; minCrest = Math.min(minCrest, crest); maxCrest = Math.max(maxCrest, crest); }
    }
    expect(minCrest).toBeGreaterThan(4);
    expect(maxCrest - minCrest).toBeGreaterThan(.5);
    expect(front.material.transparent).toBe(true);
    expect(front.material.depthTest).toBe(true);
    expect(sim.snapshot()).toEqual(before); fx.dispose();
    const sunny = scene('thousand-sunny'); tap(sunny, 'special'); sunny.step(50);
    const sunnyFx = new NavalFxView(new THREE.Scene(), { waveSampler: flatWater }); sunnyFx.sync(sunny.getState());
    const jets = sunnyFx.root.getObjectByName('sunny-stern-pressure-jets') as THREE.InstancedMesh;
    expect(jets.count).toBe(9);
    const jetMatrix = new THREE.Matrix4(), jetPosition = new THREE.Vector3(), jetRotation = new THREE.Quaternion(), jetScale = new THREE.Vector3();
    jets.getMatrixAt(0, jetMatrix); jetMatrix.decompose(jetPosition, jetRotation, jetScale);
    expect(jetScale.y).toBeGreaterThan(50);
    expect((sunnyFx.root.getObjectByName('moby-authoritative-pressure-front') as THREE.Mesh).geometry.drawRange.count).toBe(0);
    expect(sunnyFx.root.getObjectByName('hull-contact-foam:player')!.visible).toBe(false); sunnyFx.dispose();
  });

  it('gives the real Polar dive surface bubbles and keeps emergence foam visible during the physical surfacing hold', () => {
    const sim = scene('polar-tang'); tap(sim, 'special'); sim.step(90);
    const fx = new NavalFxView(new THREE.Scene(), { waveSampler: flatWater });
    const activeBefore = sim.snapshot(); fx.sync(sim.getState());
    const particles = fx.root.getObjectByName('special-foam-exhaust-and-bubbles') as THREE.InstancedMesh;
    expect(particles.count).toBeGreaterThan(40);
    expect(Array.from((particles.geometry.getAttribute('fxStyle') as THREE.InstancedBufferAttribute).array).slice(0, particles.count)).toContain(2);
    expect(sim.snapshot()).toEqual(activeBefore);
    for (let frame = 0; frame < 400 && sim.getState().ships[0]!.specialPhase?.phase !== 'recovery'; frame++) sim.step(1);
    for (let frame = 0; frame < 100 && sim.getState().ships[0]!.specialPhase!.elapsed < 1.25; frame++) sim.step(1);
    const recoveryBefore = sim.snapshot(); fx.sync(sim.getState());
    expect(particles.count).toBeGreaterThan(28);
    expect(particles.visible).toBe(true);
    expect(sim.snapshot()).toEqual(recoveryBefore);
    fx.dispose();
  });

  it('reuses bounded special buffers across a full fleet and clears phase geometry when the effect ends', () => {
    const sim = startWave(); sim.step(40);
    const state = structuredClone(sim.getState());
    state.ships = Array.from({ length: 20 }, (_, index) => ({ ...structuredClone(state.ships[0]!), id: `wave-${index}` }));
    const fx = new NavalFxView(new THREE.Scene(), { waveSampler: flatWater }); fx.sync(state);
    const front = fx.root.getObjectByName('moby-authoritative-pressure-front') as THREE.Mesh<THREE.BufferGeometry>;
    const particles = fx.root.getObjectByName('special-foam-exhaust-and-bubbles') as THREE.InstancedMesh;
    const geometry = front.geometry, buffer = geometry.getAttribute('position').array, childCount = fx.root.children.length;
    expect(front.geometry.drawRange.count).toBe(20 * 96 * 3 * 6);
    expect(particles.count).toBeLessThanOrEqual(particles.instanceMatrix.count);
    fx.sync(state, state.elapsed + 1 / 60);
    expect(front.geometry).toBe(geometry); expect(geometry.getAttribute('position').array).toBe(buffer); expect(fx.root.children).toHaveLength(childCount);
    for (const ship of state.ships) ship.specialPhase = undefined;
    fx.sync(state, state.elapsed + 2 / 60);
    expect(front.visible).toBe(false); expect(front.geometry.drawRange.count).toBe(0); expect(particles.count).toBe(0);
    fx.dispose();
  });
});
