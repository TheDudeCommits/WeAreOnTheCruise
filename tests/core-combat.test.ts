import { describe, expect, it } from 'vitest';
import { HAZARD_POOL, PROJECTILE_POOL } from '../src/game/constants';
import type { EnemyId, ShipId } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { BRACE_DURATION, PARRY_WINDOW } from '../src/game/sim/player';
import { Sim } from '../src/game/sim/Sim';
import type { CircleHit, EnemyState, IslandDef, SimEvent, WorldQuery } from '../src/game/types';

// ───────────── harness ─────────────

function openSea(): WorldQuery {
  return {
    seed: 'open',
    islandsNear: (_x, _z, _r, out: IslandDef[] = []) => { out.length = 0; return out; },
    collideCircle: (): CircleHit => ({ hit: false, nx: 0, nz: 0, depth: 0 }),
    isWater: () => true,
    shoreDistance: (_x, _z, max) => max,
  };
}

function makeSim(ship: ShipId = 'sunlion', god = false, seed = 'combat'): Sim {
  const sim = new Sim({ seed, shipId: ship, seaId: 'sunward-shallows', meta: defaultProfile(), world: openSea() });
  sim.debug.god(god);
  sim.state.player.weapons.length = 0;
  sim.state.player.invulnerable = 0;
  return sim;
}

interface Dummy { e: EnemyState; x: number; z: number }
function dummies(sim: Sim, spots: readonly [number, number][], def: EnemyId = 'brig'): Dummy[] {
  return spots.map(([x, z]) => { const e = sim.spawnEnemy(def, x, z)!; e.hp = 1e7; e.maxHp = 1e7; e.attackCooldown = 1e9; return { e, x, z }; });
}

function run(sim: Sim, seconds: number, keep: Dummy[] = [], free = false, each?: (s: Sim) => void): SimEvent[] {
  const events: SimEvent[] = [];
  const kept = new Set(keep.map((d) => d.e));
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    for (const e of sim.state.enemies) if (!kept.has(e)) e.life = 'dead';
    for (const d of keep) d.e.attackCooldown = Math.max(d.e.attackCooldown, 5); // dummies never shoot
    sim.stepTicks(1);
    while (sim.state.status === 'levelup') sim.chooseCard(0);
    if (!free) for (const d of keep) { d.e.x = d.x; d.e.z = d.z; d.e.vx = 0; d.e.vz = 0; }
    for (const e of sim.drainEvents()) events.push(e);
    each?.(sim);
  }
  return events;
}

// ───────────── brace / parry ─────────────

describe('CORE brace and parry', () => {
  it('bracing cuts damage to 30% after the parry window', () => {
    const open = makeSim('sunlion');
    const unbraced = open.damagePlayer(100);

    const sim = makeSim('sunlion');
    sim.press('brace');
    const ev = run(sim, PARRY_WINDOW + 0.1);
    expect(ev.some((e) => e.type === 'skill-used' && e.slot === 'brace')).toBe(true);
    const braced = sim.damagePlayer(100);
    expect(braced).toBeGreaterThan(0);
    expect(braced).toBeLessThan(unbraced * 0.4);
    const hit = sim.drainEvents().find((e) => e.type === 'player-hit');
    expect(hit?.type === 'player-hit' && hit.braced && !hit.parried).toBe(true);
    run(sim, BRACE_DURATION);
    expect(sim.damagePlayer(100)).toBeCloseTo(unbraced, 5); // brace over
  });

  it('a hit in the first 0.25 s is a parry: no damage, a shock ring, and nearby shots reflected', () => {
    const sim = makeSim('sunlion');
    const p = sim.state.player;
    const d = dummies(sim, [[35, 0]]);
    const incoming = sim.spawnProjectile({ kind: 'enemy-cannonball', team: 'enemy', x: 30, z: 0, vx: -60, vz: 0, damage: 10, ttl: 3 })!;
    sim.press('brace');
    run(sim, 1 / 60, d);
    const hp = p.hp;
    expect(sim.damagePlayer(100)).toBe(0);
    expect(p.hp).toBe(hp);
    const ev = run(sim, 0.5, d);
    const all = [...ev];
    expect(all.some((e) => e.type === 'player-hit' && e.parried)).toBe(true);
    expect(all.filter((e) => e.type === 'skill-used' && e.slot === 'brace').length).toBeGreaterThanOrEqual(1);
    expect(all.some((e) => e.type === 'hazard-spawned' && e.kind === 'shockwave')).toBe(true);
    expect(d[0]!.e.hp).toBeLessThan(d[0]!.e.maxHp); // the ring hit the neighbour
    expect(incoming.team === 'player' || !incoming.alive).toBe(true); // reflected (or already spent on the enemy)
    expect(p.skills.brace.cooldown).toBeLessThanOrEqual(1.5); // parry refunds most of the cooldown
  });
});

// ───────────── rams and contacts ─────────────

describe('CORE collisions', () => {
  it('ramming bow-first damages and knocks the target back; the rammer takes some recoil', () => {
    const sim = makeSim('sunlion');
    const p = sim.state.player;
    const d = dummies(sim, [[0, -80]], 'cutter');
    sim.press('gear-up');
    const ev = run(sim, 7, d, true, (s) => { s.state.sea.windDir = Math.PI / 2; });
    const ram = ev.find((e) => e.type === 'ram' && e.attacker === 0);
    expect(ram).toBeDefined();
    expect(ram?.type === 'ram' && ram.target).toBe(d[0]!.e.id);
    expect(ram?.type === 'ram' && ram.damage).toBeGreaterThan(10);
    expect(ev.some((e) => e.type === 'collision' && e.a === 0 && e.b === d[0]!.e.id)).toBe(true);
    expect(ev.some((e) => e.type === 'player-hit' && e.source === d[0]!.e.id)).toBe(true);
    expect(p.hp).toBeLessThan(p.maxHp);
  });

  it('ship contact separates hulls with a capped mass ratio; bosses do not budge', () => {
    const sim = makeSim('white-leviathan', true);
    const skiff = dummies(sim, [[0, -30]], 'skiff');
    run(sim, 1 / 60, skiff, true);
    const p = sim.state.player;
    const d = Math.hypot(skiff[0]!.e.x - p.x, skiff[0]!.e.z - p.z);
    expect(d).toBeGreaterThan(p.beam * 0.5 + skiff[0]!.e.radius - 12); // pushed mostly out in one tick

    const sim2 = makeSim('dawn-ram', true);
    const boss = sim2.spawnBoss('iron-warden', 0, -40, 0);
    let bossMovedByPlayer = 0;
    for (let i = 0; i < 30; i++) {
      const bx = boss.x, bz = boss.z;
      sim2.stepTicks(1);
      // The boss AI moves it; CORE contact resolution must never shove it.
      bossMovedByPlayer = Math.max(bossMovedByPlayer, Math.hypot(boss.x - bx, boss.z - bz) - (boss.speed + 1) / 60);
    }
    const q = sim2.state.player;
    expect(bossMovedByPlayer).toBeLessThan(0.05);
    expect(Math.hypot(q.x - boss.x, q.z - boss.z)).toBeGreaterThan(boss.radius - 2);
  });

  it('knockback is a CORE displacement scaled by hull mass', () => {
    const sim = makeSim('sunlion', true);
    const [skiff] = dummies(sim, [[100, 0]], 'skiff');
    const [frigate] = dummies(sim, [[-100, 0]], 'frigate');
    sim.damageTarget(skiff!.e, 1, { knockback: 10, fromX: 0, fromZ: 0 });
    sim.damageTarget(frigate!.e, 1, { knockback: 10, fromX: 0, fromZ: 0 });
    const s0 = skiff!.e.x, f0 = frigate!.e.x;
    // Freeze AI motion so only CORE forces move them.
    for (let i = 0; i < 60; i++) {
      sim.stepTicks(1);
      skiff!.e.vx = skiff!.e.vz = frigate!.e.vx = frigate!.e.vz = 0;
    }
    const skiffMoved = skiff!.e.x - s0, frigateMoved = f0 - frigate!.e.x;
    expect(skiffMoved).toBeGreaterThan(frigateMoved);
    expect(frigateMoved).toBeGreaterThan(0);
  });

  it('stunned ships are held in place', () => {
    const sim = makeSim('sunlion', true);
    const [d] = dummies(sim, [[0, -150]], 'skiff');
    sim.applyStatus(d!.e, 'stunned', 1, 1);
    const x0 = d!.e.x, z0 = d!.e.z;
    for (let i = 0; i < 30; i++) sim.stepTicks(1);
    expect(Math.hypot(d!.e.x - x0, d!.e.z - z0)).toBeLessThan(0.5);
  });
});

// ───────────── pickups and pools ─────────────

describe('CORE pickups and pools', () => {
  it('magnetised treasure pops, accelerates in and is collected', () => {
    const sim = makeSim('sunlion', true);
    const p = sim.state.player;
    const coin = sim.spawnPickup('xp-silver', p.x + 25, p.z + 5, 5)!;
    const far = sim.spawnPickup('xp-copper', p.x + 400, p.z, 1)!;
    const xp0 = sim.state.stats.xpCollected;
    let magnetTick = -1, collectedTick = -1, tick = 0, minDist = Infinity, popped = false;
    const d0 = Math.hypot(coin.x - p.x, coin.z - p.z);
    run(sim, 3, [], false, (s) => {
      tick++;
      const d = Math.hypot(coin.x - s.state.player.x, coin.z - s.state.player.z);
      if (coin.magnet && magnetTick < 0) magnetTick = tick;
      if (d > d0 + 0.01) popped = true;
      minDist = Math.min(minDist, d);
      if (!coin.alive && collectedTick < 0) collectedTick = tick;
    });
    expect(magnetTick).toBe(1);
    expect(popped).toBe(true);
    expect(collectedTick).toBeGreaterThan(0);
    expect(collectedTick).toBeLessThan(90);
    expect(sim.state.stats.xpCollected).toBeGreaterThan(xp0);
    expect(far.alive && !far.magnet).toBe(true);
  });

  it('pools reuse dead slots and never grow past their caps', () => {
    const sim = makeSim('sunlion', true);
    const spawn = () => sim.spawnProjectile({ kind: 'cannonball', team: 'player', x: 0, z: 0, vx: 0, vz: 0, damage: 1, ttl: 0.01 });
    let made = 0;
    for (let i = 0; i < PROJECTILE_POOL + 50; i++) if (spawn()) made++;
    expect(made).toBe(PROJECTILE_POOL);
    expect(sim.state.projectiles.length).toBe(PROJECTILE_POOL);
    run(sim, 2 / 60);
    expect(sim.state.projectiles.every((x) => !x.alive)).toBe(true);
    for (let i = 0; i < 100; i++) expect(spawn()).not.toBeNull();
    expect(sim.state.projectiles.length).toBe(PROJECTILE_POOL);
    // Reused slots get fresh ids and clean state.
    const ids = new Set(sim.state.projectiles.filter((x) => x.alive).map((x) => x.id));
    expect(ids.size).toBe(100);

    for (let i = 0; i < HAZARD_POOL + 10; i++) sim.spawnHazard({ kind: 'fire-patch', team: 'player', x: 0, z: 0, radius: 1, ttl: 0.01, damage: 0 });
    expect(sim.state.hazards.length).toBe(HAZARD_POOL);
  });

  it('merges loose treasure when too much piles up', () => {
    const sim = makeSim('sunlion', true);
    for (let i = 0; i < 320; i++) sim.spawnPickup('xp-copper', 600 + (i % 4) * 2, 600 + Math.floor(i / 4) * 0.2, 1);
    run(sim, 0.6);
    const alive = sim.state.pickups.filter((k) => k.alive);
    expect(alive.length).toBeLessThan(200);
    const total = alive.reduce((sum, k) => sum + k.value, 0);
    expect(total).toBe(320); // value conserved
    expect(alive.some((k) => k.kind !== 'xp-copper')).toBe(true);
  });
});
