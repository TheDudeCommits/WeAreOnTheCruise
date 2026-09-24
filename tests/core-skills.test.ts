import { describe, expect, it } from 'vitest';
import type { EnemyId, ShipId } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { ULT_CHARGE_DAMAGE } from '../src/game/sim/core-skills';
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

function makeSim(ship: ShipId, god = true): Sim {
  const sim = new Sim({ seed: `skills-${ship}`, shipId: ship, seaId: 'sunward-shallows', meta: defaultProfile(), world: openSea() });
  sim.debug.god(god);
  sim.state.player.weapons.length = 0;
  sim.state.player.invulnerable = 0;
  return sim;
}

interface Dummy { e: EnemyState; x: number; z: number }
function dummies(sim: Sim, spots: readonly [number, number][], def: EnemyId = 'brig'): Dummy[] {
  return spots.map(([x, z]) => { const e = sim.spawnEnemy(def, x, z)!; e.hp = 1e7; e.maxHp = 1e7; return { e, x, z }; });
}

/** Steps ticks keeping only `keep` enemies; pins them unless `free`. Returns the drained events. */
function run(sim: Sim, seconds: number, keep: Dummy[] = [], free = false, each?: (s: Sim) => void): SimEvent[] {
  const events: SimEvent[] = [];
  const kept = new Set(keep.map((d) => d.e));
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    for (const e of sim.state.enemies) if (!kept.has(e)) e.life = 'dead';
    sim.stepTicks(1);
    while (sim.state.status === 'levelup') sim.chooseCard(0);
    if (!free) for (const d of keep) { d.e.x = d.x; d.e.z = d.z; d.e.vx = 0; d.e.vz = 0; }
    for (const e of sim.drainEvents()) events.push(e);
    each?.(sim);
  }
  return events;
}

const hurt = (d: Dummy) => d.e.maxHp - d.e.hp;
const used = (ev: SimEvent[], skill: string) => ev.some((e) => e.type === 'skill-used' && e.skill === skill);

// ───────────── specials ─────────────

describe('CORE specials (E)', () => {
  it('Second Wind heals 30% and raises a 3 s shield', () => {
    const sim = makeSim('dawn-ram', false);
    const p = sim.state.player;
    p.hp = p.maxHp * 0.4;
    sim.press('special');
    const ev = run(sim, 1 / 60);
    expect(used(ev, 'second-wind')).toBe(true);
    expect(p.hp / p.maxHp).toBeCloseTo(0.7, 1);
    expect(p.shield).toBeGreaterThan(p.maxHp * 0.4);
    expect(sim.hasStatus(p, 'shielded')).toBe(true);
    const hp = p.hp;
    sim.damagePlayer(40);
    expect(p.hp).toBe(hp); // the shield soaks it
    sim.press('special');
    expect(used(run(sim, 1 / 60), 'second-wind')).toBe(false); // on cooldown
    run(sim, 3.2);
    expect(p.shield).toBe(0);
  });

  it('Lionburst leaps to the cursor, untouchable in the air, and lands with a damaging ring', () => {
    const sim = makeSim('sunlion');
    const p = sim.state.player;
    const d = dummies(sim, [[150, 30]]); // inside the landing ring, clear of the landing spot
    sim.setInput({ aimX: 150, aimZ: 0 });
    sim.press('special');
    const ev = run(sim, 0.5, d);
    expect(used(ev, 'lionburst')).toBe(true);
    expect(p.airborne).toBeGreaterThan(0.8);
    expect(sim.damagePlayer(50)).toBe(0);
    const land: SimEvent[] = [];
    for (let i = 0; i < 60 && p.airborne > 0; i++) land.push(...run(sim, 1 / 60, d));
    expect(p.airborne).toBe(0);
    expect(Math.hypot(p.x - 150, p.z)).toBeLessThan(3);
    expect(Math.abs(Math.atan2(-Math.sin(p.heading), -Math.cos(p.heading)) - Math.PI / 2)).toBeLessThan(0.05); // faces +X
    expect(land.some((e) => e.type === 'hazard-spawned' && e.kind === 'shockwave')).toBe(true);
    run(sim, 0.6, d);
    expect(hurt(d[0]!)).toBeGreaterThan(0);
  });

  it('Deep Dive submerges (untargetable, silent, faster) and surfaces with a burst', () => {
    const sim = makeSim('yellowfin');
    const p = sim.state.player;
    sim.debug.giveWeapon('broadside', 1);
    sim.press('gear-up');
    run(sim, 8, [], false, (s) => { s.state.sea.windDir = Math.PI / 2; });
    const cruise = p.speed;
    sim.press('special');
    run(sim, 0.6, [], false, (s) => { s.state.sea.windDir = Math.PI / 2; });
    expect(p.submerged).toBeGreaterThan(0.9);
    expect(sim.damagePlayer(80)).toBe(0);
    const d = dummies(sim, [[p.x + 90, p.z]]);
    const under = run(sim, 1.2, d, false, (s) => { s.state.sea.windDir = Math.PI / 2; });
    expect(under.some((e) => e.type === 'weapon-fired')).toBe(false);
    expect(p.speed).toBeGreaterThan(cruise * 1.2);
    // Surface next to a ship: the burst hits it.
    d[0]!.x = p.x + 20; d[0]!.z = p.z;
    const up = run(sim, 2, d);
    expect(p.submerged).toBe(0);
    expect(up.some((e) => e.type === 'hazard-spawned' && e.kind === 'shockwave')).toBe(true);
    expect(hurt(d[0]!)).toBeGreaterThan(0);
  });

  it("Chef's Banquet heals 20% and whips the crew into a frenzy (+50% fire rate)", () => {
    const sim = makeSim('grand-galley', false);
    const p = sim.state.player;
    sim.debug.giveWeapon('broadside', 1);
    p.hp = p.maxHp * 0.5;
    sim.press('special');
    run(sim, 1 / 60);
    expect(p.hp / p.maxHp).toBeCloseTo(0.7, 1);
    expect(sim.hasStatus(p, 'frenzy')).toBe(true);
    const slot = p.weapons[0]!;
    slot.cooldown = 10;
    run(sim, 1);
    expect(slot.cooldown).toBeCloseTo(10 - 1.5, 1);
  });

  it('Signal Flare drops a telegraphed 12-shell barrage on the cursor', () => {
    const sim = makeSim('seawarden');
    const target = dummies(sim, [[0, -150], [12, -158], [-10, -144]]);
    const far = dummies(sim, [[0, 150]]);
    sim.setInput({ aimX: 0, aimZ: -150 });
    sim.press('special');
    const ev = run(sim, 3, [...target, ...far]);
    expect(used(ev, 'signal-flare')).toBe(true);
    expect(ev.filter((e) => e.type === 'telegraph' && e.shape === 'circle').length).toBe(12);
    expect(ev.filter((e) => e.type === 'explosion' && e.kind === 'mortar').length).toBeGreaterThanOrEqual(12);
    expect(target.every((d) => hurt(d) > 0)).toBe(true);
    expect(hurt(far[0]!)).toBe(0);
  });

  it('Seaquake blasts a 160 m ring: damage, knockback and slow — nothing beyond', () => {
    const sim = makeSim('white-leviathan');
    const inside = dummies(sim, [[80, 0], [0, 140]]);
    const outside = dummies(sim, [[0, -260]]);
    sim.press('special');
    const ev = run(sim, 1, [...inside, ...outside], true);
    expect(used(ev, 'seaquake')).toBe(true);
    for (const d of inside) {
      expect(hurt(d)).toBeGreaterThan(0);
      expect(sim.hasStatus(d.e, 'slowed')).toBe(true);
      expect(Math.hypot(d.e.x, d.e.z)).toBeGreaterThan(Math.hypot(d.x, d.z)); // pushed away
    }
    expect(hurt(outside[0]!)).toBe(0);
  });
});

// ───────────── ultimates ─────────────

describe('CORE ultimates (R)', () => {
  it('charges from damage dealt and announces readiness once', () => {
    const sim = makeSim('sunlion');
    const d = dummies(sim, [[60, 0]]);
    sim.press('ultimate');
    expect(used(run(sim, 1 / 60, d), 'sunfire-barrage')).toBe(false); // empty
    sim.damageTarget(d[0]!.e, ULT_CHARGE_DAMAGE * 0.6, { pierceArmor: true });
    expect(sim.state.player.skills.ultimate.charge).toBeCloseTo(0.6, 2);
    sim.damageTarget(d[0]!.e, ULT_CHARGE_DAMAGE * 0.6, { pierceArmor: true });
    sim.damageTarget(d[0]!.e, ULT_CHARGE_DAMAGE * 0.6, { pierceArmor: true });
    const ev = run(sim, 1 / 60, d);
    expect(ev.filter((e) => e.type === 'skill-ready' && e.slot === 'ultimate').length).toBe(1);
    expect(sim.state.player.skills.ultimate.charge).toBe(1);
    sim.press('ultimate');
    expect(used(run(sim, 1 / 60, d), 'sunfire-barrage')).toBe(true);
    expect(sim.state.player.skills.ultimate.charge).toBe(0);
  });

  it('Ramming Speed: +80% speed and ×5 rams', () => {
    const ramDamage = (ult: boolean) => {
      const sim = makeSim('dawn-ram');
      sim.state.sea.windDir = Math.PI / 2;
      sim.press('gear-up');
      const wind = (s: Sim) => { s.state.sea.windDir = Math.PI / 2; };
      run(sim, 6, [], false, wind);
      const cruise = sim.state.player.speed;
      if (ult) { sim.debug.chargeUltimate(); sim.press('ultimate'); }
      run(sim, 2, [], false, wind);
      const fast = sim.state.player.speed;
      const p = sim.state.player;
      const d = dummies(sim, [[p.x - Math.sin(p.heading) * 70, p.z - Math.cos(p.heading) * 70]], 'frigate');
      const ev = run(sim, 3, d, false, wind);
      const ram = ev.find((e) => e.type === 'ram' && e.attacker === 0);
      return { cruise, fast, damage: ram?.type === 'ram' ? ram.damage : 0 };
    };
    const plain = ramDamage(false), rush = ramDamage(true);
    expect(rush.fast / rush.cruise).toBeGreaterThan(1.5);
    expect(plain.damage).toBeGreaterThan(0);
    expect(rush.damage).toBeGreaterThan(plain.damage * 5);
  });

  it('Sunfire Barrage runs both batteries with burning rounds for 8 s', () => {
    const sim = makeSim('sunlion');
    const d = dummies(sim, [[90, 0], [-90, 0]]);
    sim.debug.chargeUltimate();
    sim.press('ultimate');
    const ev = run(sim, 3, d);
    expect(used(ev, 'sunfire-barrage')).toBe(true);
    const shots = ev.filter((e) => e.type === 'weapon-fired' && e.weapon === 'broadside');
    expect(shots.filter((e) => e.type === 'weapon-fired' && e.side === 'port').length).toBeGreaterThan(8);
    expect(shots.filter((e) => e.type === 'weapon-fired' && e.side === 'starboard').length).toBeGreaterThan(8);
    expect(sim.hasStatus(d[0]!.e, 'burning') || sim.hasStatus(d[1]!.e, 'burning')).toBe(true);
    run(sim, 6, d);
    const after = run(sim, 1, d).filter((e) => e.type === 'weapon-fired');
    expect(after.length).toBe(0); // over (no broadside weapon slot on this test ship)
  });

  it('Torpedo Swarm launches 12 homing torpedoes', () => {
    const sim = makeSim('yellowfin');
    const d = dummies(sim, [[120, -60], [-100, -90], [30, -200]]);
    sim.debug.chargeUltimate();
    sim.press('ultimate');
    run(sim, 1 / 60, d);
    expect(sim.state.projectiles.filter((x) => x.alive && x.kind === 'torpedo').length).toBe(12);
    const ev = run(sim, 6, d);
    expect(ev.some((e) => e.type === 'explosion' && e.kind === 'water')).toBe(true);
    expect(d.every((x) => hurt(x) > 0)).toBe(true);
  });

  it('Kitchen Inferno rings the ship with fire barrels and flaming broadsides', () => {
    const sim = makeSim('grand-galley');
    const d = dummies(sim, [[45, 12], [-60, 0]]);
    sim.debug.chargeUltimate();
    sim.press('ultimate');
    const ev = run(sim, 2.5, d);
    expect(ev.filter((e) => e.type === 'hazard-spawned' && e.kind === 'barrel').length).toBe(12);
    expect(ev.filter((e) => e.type === 'hazard-spawned' && e.kind === 'fire-patch').length).toBeGreaterThanOrEqual(12);
    expect(ev.filter((e) => e.type === 'weapon-fired' && e.weapon === 'broadside').length).toBeGreaterThan(8);
    expect(hurt(d[0]!)).toBeGreaterThan(0);
  });

  it("Admiral's Judgment carpets the aim line after a line telegraph", () => {
    const sim = makeSim('seawarden');
    const onLine = dummies(sim, [[0, -100], [4, -220]]);
    const offLine = dummies(sim, [[160, 0]]);
    sim.setInput({ aimX: 0, aimZ: -300 });
    sim.debug.chargeUltimate();
    sim.press('ultimate');
    const ev = run(sim, 3, [...onLine, ...offLine]);
    const line = ev.find((e) => e.type === 'telegraph' && e.shape === 'line');
    expect(line).toBeDefined();
    const tele = sim.state.telegraphs.find((t) => t.shape === 'line');
    if (tele) {
      expect(-Math.sin(tele.angle)).toBeCloseTo(0, 2); // heading convention: direction (−sin a, −cos a) = (0, −1)
      expect(-Math.cos(tele.angle)).toBeCloseTo(-1, 2);
    }
    expect(onLine.every((d) => hurt(d) > 0)).toBe(true);
    expect(hurt(offLine[0]!)).toBe(0);
  });

  it('Tidal Colossus sweeps a wave front ~400 m ahead, carrying ships and washing out shots', () => {
    const sim = makeSim('white-leviathan');
    const ahead = dummies(sim, [[0, -150], [30, -330]]);
    const astern = dummies(sim, [[0, 160]]);
    sim.debug.chargeUltimate();
    sim.press('ultimate');
    const first = run(sim, 1 / 60, [...ahead, ...astern]);
    expect(first.some((e) => e.type === 'hazard-spawned' && e.kind === 'wave-front')).toBe(true);
    const shot = sim.spawnProjectile({ kind: 'enemy-cannonball', team: 'enemy', x: 0, z: -120, vx: 0, vz: 0, damage: 5, ttl: 10 })!;
    const shotId = shot.id; // pooled slots are reused once dead: track the shot by id
    const z0 = ahead[0]!.e.z;
    let washed = false;
    const ev = run(sim, 5, [...ahead, ...astern], true, () => { if (!washed && !(shot.alive && shot.id === shotId)) washed = true; });
    expect(ahead.every((d) => hurt(d) > 0)).toBe(true);
    expect(ahead[0]!.e.z).toBeLessThan(z0 - 20); // carried along −Z
    expect(hurt(astern[0]!)).toBe(0);
    expect(washed).toBe(true);
    expect(ev.some((e) => e.type === 'projectile-hit' && e.team === 'enemy' && e.target === 'water' && Math.abs(e.z + 120) < 1)).toBe(true);
  });
});
