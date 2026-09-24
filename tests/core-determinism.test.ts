import { describe, expect, it } from 'vitest';
import { WEAPON_IDS, type ShipId } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { Sim } from '../src/game/sim/Sim';
import type { SimAction } from '../src/game/types';
import { IslandField } from '../src/world/IslandField';

/** A scripted battle: every weapon at ★, specials/ultimates/brace/boost pressed on a schedule, steering changes. */
function battle(seed: string, ship: ShipId = 'sunlion', seconds = 20) {
  const world = new IslandField(seed);
  const sim = new Sim({ seed, shipId: ship, seaId: 'sunward-shallows', meta: defaultProfile(), world });
  sim.debug.god(true);
  WEAPON_IDS.forEach((id, i) => sim.debug.giveWeapon(id, i % 3 === 0 ? 3 : 6, i % 2 === 0 ? 'A' : 'B'));
  sim.debug.spawnEnemy('skiff', 20);
  sim.debug.spawnEnemy('brig', 8);
  sim.debug.spawnEnemy('frigate', 3, true);
  const schedule: Record<number, SimAction[]> = {
    30: ['gear-up'], 120: ['boost'], 200: ['special'], 320: ['brace'], 400: ['broadside'], 500: ['ultimate'],
    620: ['gear-down'], 700: ['special', 'boost'], 900: ['broadside'],
  };
  const eventTypes: string[] = [];
  for (let t = 0; t < seconds * 60; t++) {
    const acts = schedule[t];
    if (acts) for (const a of acts) sim.press(a);
    if (t === 500) sim.debug.chargeUltimate();
    sim.setInput({ steer: Math.sin(t / 90), aimX: sim.state.player.x + Math.cos(t / 50) * 120, aimZ: sim.state.player.z + Math.sin(t / 50) * 120 });
    // Mixed frame lengths through the public step() path (accumulator + time scale).
    sim.step(t % 3 === 0 ? 1 / 30 : 1 / 120);
    while (sim.state.status === 'levelup') sim.chooseCard(0);
    for (const e of sim.drainEvents()) eventTypes.push(e.type);
  }
  return { sim, eventTypes };
}

describe('CORE determinism', () => {
  it('same seed + same inputs ⇒ identical state and event stream', () => {
    const a = battle('det-1');
    const b = battle('det-1');
    expect(a.sim.state.tick).toBeGreaterThan(600);
    expect(a.eventTypes.length).toBeGreaterThan(500);
    expect(JSON.stringify(a.sim.state)).toBe(JSON.stringify(b.sim.state));
    expect(a.eventTypes).toEqual(b.eventTypes);
  });

  it('a different seed diverges', () => {
    const a = battle('det-1', 'sunlion', 8);
    const b = battle('det-2', 'sunlion', 8);
    expect(JSON.stringify(a.sim.state)).not.toBe(JSON.stringify(b.sim.state));
  });

  it('every ship stays deterministic through its special and ultimate', () => {
    for (const ship of ['dawn-ram', 'yellowfin', 'grand-galley', 'seawarden', 'white-leviathan'] as const) {
      const a = battle(`det-${ship}`, ship, 12);
      const b = battle(`det-${ship}`, ship, 12);
      expect(JSON.stringify(a.sim.state), ship).toBe(JSON.stringify(b.sim.state));
    }
  });
});
