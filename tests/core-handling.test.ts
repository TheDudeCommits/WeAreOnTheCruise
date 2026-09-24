import { describe, expect, it } from 'vitest';
import { SHIP_IDS, type ShipId } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { windFactor } from '../src/game/sim/player';
import { Sim } from '../src/game/sim/Sim';
import type { CircleHit, IslandDef, SimEvent, WorldQuery } from '../src/game/types';

// ───────────── harness (stub worlds keep CORE tests independent of the island generator) ─────────────

function openSea(): WorldQuery {
  return {
    seed: 'open',
    islandsNear: (_x, _z, _r, out: IslandDef[] = []) => { out.length = 0; return out; },
    collideCircle: (): CircleHit => ({ hit: false, nx: 0, nz: 0, depth: 0 }),
    isWater: () => true,
    shoreDistance: (_x, _z, max) => max,
  };
}

/** A single round island of radius `r` centred at (cx, cz). */
function oneIsland(cx: number, cz: number, r: number): WorldQuery {
  const outline = Array.from({ length: 48 }, (_, i) => ({ x: cx + Math.sin((i / 48) * Math.PI * 2) * r, z: cz + Math.cos((i / 48) * Math.PI * 2) * r }));
  const island: IslandDef = { id: 'test-isle', x: cx, z: cz, radius: r, outline, height: 30, biome: 'rocky', seed: 1 };
  return {
    seed: 'isle',
    islandsNear: (x, z, radius, out: IslandDef[] = []) => { out.length = 0; if (Math.hypot(x - cx, z - cz) <= r + radius) out.push(island); return out; },
    collideCircle: (x, z, radius): CircleHit => {
      const d = Math.hypot(x - cx, z - cz);
      if (d - r >= radius) return { hit: false, nx: 0, nz: 0, depth: 0 };
      const nx = d > 1e-6 ? (x - cx) / d : 1, nz = d > 1e-6 ? (z - cz) / d : 0;
      return { hit: true, nx, nz, depth: radius - (d - r), islandId: island.id };
    },
    isWater: (x, z, margin) => Math.hypot(x - cx, z - cz) - r >= margin,
    shoreDistance: (x, z, max) => Math.min(max, Math.hypot(x - cx, z - cz) - r),
  };
}

function makeSim(ship: ShipId = 'sunlion', world: WorldQuery = openSea(), god = true): Sim {
  const sim = new Sim({ seed: 'core-handling', shipId: ship, seaId: 'sunward-shallows', meta: defaultProfile(), world });
  sim.debug.god(god);
  sim.state.player.weapons.length = 0;
  sim.state.player.invulnerable = 0;
  return sim;
}

/** Steps whole ticks with no enemies around (director spawns are removed before they matter). */
function sail(sim: Sim, seconds: number, each?: (sim: Sim) => void): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    for (const e of sim.state.enemies) e.life = 'dead';
    sim.stepTicks(1);
    while (sim.state.status === 'levelup') sim.chooseCard(0);
    for (const e of sim.drainEvents()) events.push(e);
    each?.(sim);
  }
  return events;
}

/** Wind blowing toward the ship's port beam: heading 0 sails a beam reach. */
function beamReachWind(sim: Sim): void { sim.state.sea.windDir = Math.PI / 2; }

function lateralAndForward(sim: Sim): { lat: number; fwd: number } {
  const p = sim.state.player;
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading), sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  return { lat: p.vx * sx + p.vz * sz, fwd: p.vx * fx + p.vz * fz };
}

// ───────────── tests ─────────────

describe('CORE handling', () => {
  it('turns faster and tighter at half sail than at full sail, for every ship', () => {
    for (const ship of SHIP_IDS) {
      const measure = (gear: 1 | 2) => {
        const sim = makeSim(ship);
        const each = beamReachWind;
        if (gear === 2) sim.press('gear-up');
        sail(sim, 12, each);
        sim.setInput({ steer: 1 });
        let yaw = 0, speed = 0, samples = 0;
        sail(sim, 1.5, each);
        sail(sim, 1, (s) => { each(s); yaw += s.state.player.yawRate; speed += Math.abs(s.state.player.speed); samples++; });
        return { yaw: yaw / samples, radius: speed / samples / (yaw / samples) };
      };
      const half = measure(1), full = measure(2);
      expect(half.yaw, ship).toBeGreaterThan(full.yaw * 1.2);
      expect(half.radius, ship).toBeLessThan(full.radius);
    }
  });

  it('keeps lateral drift bounded in hard turns (keel model)', () => {
    for (const ship of ['dawn-ram', 'white-leviathan'] as const) {
      const sim = makeSim(ship);
      sim.press('gear-up');
      sail(sim, 10, beamReachWind);
      sim.setInput({ steer: 1 });
      let worst = 0;
      sail(sim, 6, (s) => {
        beamReachWind(s);
        const { lat, fwd } = lateralAndForward(s);
        worst = Math.max(worst, Math.abs(lat) / Math.max(4, Math.abs(fwd)));
      });
      expect(worst, ship).toBeLessThan(0.3);
      expect(worst, ship).toBeGreaterThan(0.01); // it does carve with a little drift
    }
  });

  it('answers the helm faster on light hulls than on heavy ones', () => {
    const response = (ship: ShipId) => {
      const sim = makeSim(ship);
      sim.press('gear-up');
      sail(sim, 10, beamReachWind);
      sim.setInput({ steer: 1 });
      let t = 0;
      const target = sim.content.ships[ship].turnRate * 0.5;
      sail(sim, 4, (s) => { beamReachWind(s); if (s.state.player.yawRate < target) t += s.dt; });
      return t;
    };
    expect(response('dawn-ram')).toBeLessThan(response('white-leviathan'));
  });

  it('follows the points-of-sail polar', () => {
    const sea = { windDir: 0.7, windStrength: 0.5 } as never;
    const at = (deg: number) => windFactor(0.7 + Math.PI + (deg * Math.PI) / 180, sea);
    expect(at(0)).toBeCloseTo(0.35, 2);
    expect(at(90)).toBeCloseTo(1.0, 2);
    expect(at(135)).toBeCloseTo(1.1, 2);
    expect(at(180)).toBeCloseTo(0.95, 2);
    expect(at(-90)).toBeCloseTo(at(90), 6);

    const cruise = (windDir: number) => {
      const sim = makeSim('sunlion');
      sim.press('gear-up');
      sail(sim, 15, (s) => { s.state.sea.windDir = windDir; });
      return sim.state.player.speed;
    };
    const beam = cruise(Math.PI / 2), irons = cruise(Math.PI), broad = cruise(Math.PI / 4), running = cruise(0);
    expect(irons / beam).toBeGreaterThan(0.3);
    expect(irons / beam).toBeLessThan(0.4);
    expect(broad).toBeGreaterThan(beam);
    expect(running).toBeLessThan(beam);
  });

  it('boost kicks immediately and holds ~+45% for its duration', () => {
    const sim = makeSim('sunlion');
    sim.press('gear-up');
    sail(sim, 12, beamReachWind);
    const cruise = sim.state.player.speed;
    sim.press('boost');
    const events = sail(sim, 1 / 60, beamReachWind);
    expect(sim.state.player.speed - cruise).toBeGreaterThan(3);
    expect(events.some((e) => e.type === 'skill-used' && e.slot === 'boost')).toBe(true);
    sail(sim, 2, beamReachWind);
    expect(sim.state.player.speed / cruise).toBeGreaterThan(1.35);
    sail(sim, 6, beamReachWind);
    expect(sim.state.player.speed / cruise).toBeLessThan(1.08);
  });

  it('heels out of turns and rocks under broadside recoil', () => {
    const sim = makeSim('dawn-ram');
    sim.press('gear-up');
    sail(sim, 10, beamReachWind);
    sim.setInput({ steer: 1 });
    sail(sim, 3, beamReachWind);
    expect(sim.state.player.roll).toBeLessThan(-0.03); // port turn → heel to starboard (negative roll)
    sim.setInput({ steer: 0 });
    sail(sim, 6, beamReachWind);
    const before = sim.state.player.roll;
    sim.setInput({ aimX: sim.state.player.x + 100, aimZ: sim.state.player.z }); // starboard side at heading ~
    sim.press('broadside');
    let peak = 0;
    sail(sim, 1, (s) => { beamReachWind(s); peak = Math.max(peak, Math.abs(s.state.player.roll - before)); });
    expect(peak).toBeGreaterThan(0.02);
  });

  it('bounces off islands, never sinks into them, and hard impacts hurt', () => {
    const world = oneIsland(0, -400, 120);
    const sim = makeSim('sunlion', world, false);
    const p = sim.state.player;
    p.heading = 0; // bow toward −Z, straight at the island
    sim.press('gear-up');
    let deepest = 0;
    const events = sail(sim, 25, (s) => {
      beamReachWind(s);
      const q = s.state.player;
      const fx = -Math.sin(q.heading), fz = -Math.cos(q.heading), half = q.length * 0.5 - q.beam * 0.5;
      for (const k of [-1, 0, 1]) {
        const hit = world.collideCircle(q.x + fx * half * k, q.z + fz * half * k, q.beam * 0.5);
        if (hit.hit) deepest = Math.max(deepest, hit.depth);
      }
    });
    const hits = events.filter((e) => e.type === 'collision' && e.b === 'island');
    expect(hits.length).toBeGreaterThan(0);
    expect(deepest).toBeLessThan(1.5);
    expect(Math.hypot(p.x, p.z + 400)).toBeGreaterThan(120);

    // A hard (> 8 m/s) impact costs hull.
    const sim2 = makeSim('sunlion', oneIsland(0, -200, 120), false);
    const q = sim2.state.player;
    const hp0 = q.hp;
    q.z = -52; q.heading = 0; q.vz = -22; q.vx = 0;
    const ev2 = sail(sim2, 0.5);
    expect(ev2.some((e) => e.type === 'collision' && e.b === 'island' && e.impulse > 8)).toBe(true);
    expect(q.hp).toBeLessThan(hp0);
    expect(q.vz).toBeGreaterThan(-5); // bounced / stopped
  });
});
