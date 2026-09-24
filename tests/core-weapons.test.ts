import { describe, expect, it } from 'vitest';
import { WEAPON_IDS, type EnemyId, type WeaponId } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { Sim } from '../src/game/sim/Sim';
import type { CircleHit, EnemyState, IslandDef, ProjectileState, SimEvent, WorldQuery } from '../src/game/types';

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

function makeSim(seed: string, god = true): Sim {
  const sim = new Sim({ seed, shipId: 'sunlion', seaId: 'sunward-shallows', meta: defaultProfile(), world: openSea() });
  sim.debug.god(god);
  sim.state.player.weapons.length = 0;
  sim.state.player.invulnerable = 0;
  return sim;
}

interface Dummy { e: EnemyState; x: number; z: number }

/** Very tough target ships at fixed spots (they are not allowed to die or wander unless `free`). */
function dummies(sim: Sim, spots: readonly [number, number][], def: EnemyId = 'brig'): Dummy[] {
  return spots.map(([x, z]) => {
    const e = sim.spawnEnemy(def, x, z)!;
    e.hp = 1e7; e.maxHp = 1e7;
    return { e, x, z };
  });
}

const RING: [number, number][] = [[0, 42], [0, 75]]; // two astern (drop weapons trail behind the stern)
for (const d of [45, 80, 120, 170, 220]) for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2 + d * 0.013;
  RING.push([Math.sin(a) * d, Math.cos(a) * d]);
}

interface Trace { events: SimEvent[]; kinds: Set<string>; maxHazards: Map<string, number>; projectiles: ProjectileState[] }

/**
 * Runs the sim, keeping only `keep` enemies (others are removed before they can matter) and pinning them in place
 * unless `free`. Records events, projectile kinds seen and the peak count of each hazard kind.
 */
function run(sim: Sim, seconds: number, keep: Dummy[], free = false, each?: (s: Sim) => void): Trace {
  const trace: Trace = { events: [], kinds: new Set(), maxHazards: new Map(), projectiles: [] };
  const kept = new Set(keep.map((d) => d.e));
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    for (const e of sim.state.enemies) if (!kept.has(e)) e.life = 'dead';
    sim.stepTicks(1);
    while (sim.state.status === 'levelup') sim.chooseCard(0);
    if (!free) for (const d of keep) { d.e.x = d.x; d.e.z = d.z; d.e.vx = 0; d.e.vz = 0; }
    for (const e of sim.drainEvents()) trace.events.push(e);
    for (const p of sim.state.projectiles) if (p.alive && p.team === 'player' && !trace.kinds.has(p.kind)) { trace.kinds.add(p.kind); trace.projectiles.push({ ...p, hits: [...p.hits] }); }
    const counts = new Map<string, number>();
    for (const h of sim.state.hazards) if (h.alive && h.team === 'player') counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
    for (const [k, v] of counts) trace.maxHazards.set(k, Math.max(trace.maxHazards.get(k) ?? 0, v));
    each?.(sim);
  }
  return trace;
}

const has = (t: Trace, pred: (e: SimEvent) => boolean) => t.events.some(pred);
const count = (t: Trace, pred: (e: SimEvent) => boolean) => t.events.filter(pred).length;
const dealt = (sim: Sim, id: WeaponId) => sim.state.stats.damageByWeapon[id] ?? 0;

const LEVELS = [[1, undefined], [3, 'A'], [3, 'B'], [6, 'A'], [6, 'B']] as const;

// ───────────── every weapon fires and damages at 1 / 3A / 3B / 6 ─────────────

describe('CORE weapons: every weapon fires and damages at levels 1, 3A, 3B and 6', () => {
  for (const id of WEAPON_IDS) {
    for (const [level, branch] of LEVELS) {
      it(`${id} @${level}${branch ?? ''}`, () => {
        const sim = makeSim(`w-${id}-${level}${branch ?? ''}`);
        sim.debug.giveWeapon(id, level, branch);
        const slot = sim.state.player.weapons[0]!;
        expect(slot.level).toBe(level);
        expect(slot.overdrive).toBe(level === 6);
        if (level >= 3) expect(slot.branch).toBe(branch);
        const ring = dummies(sim, RING);
        if (id === 'iron-ram') { sim.press('gear-up'); sim.state.player.heading = Math.atan2(-RING[0]![0], -RING[0]![1]); }
        const trace = run(sim, 10, ring);
        expect(dealt(sim, id), 'damage dealt').toBeGreaterThan(0);
        if (id !== 'iron-ram') {
          const activity = count(trace, (e) => (e.type === 'weapon-fired' && e.weapon === id) || (e.type === 'hazard-spawned'));
          expect(activity, 'fired / placed').toBeGreaterThan(0);
        }
      });
    }
  }
});

// ───────────── branch and overdrive behaviour ─────────────

describe('CORE weapons: branches and overdrives', () => {
  it('broadside volleys from the beam that faces the enemy, ripple along the hull; chain slows, heavy pierces', () => {
    const sim = makeSim('bs');
    sim.debug.giveWeapon('broadside', 1);
    const d = dummies(sim, [[100, 0]]); // starboard beam at heading 0
    const trace = run(sim, 3, d);
    const shots = trace.events.filter((e) => e.type === 'weapon-fired' && e.weapon === 'broadside');
    expect(shots.length).toBeGreaterThanOrEqual(sim.content.ships.sunlion.broadsideGuns);
    expect(shots.every((e) => e.type === 'weapon-fired' && e.side === 'starboard')).toBe(true);
    const xs = new Set(shots.slice(0, 4).map((e) => (e.type === 'weapon-fired' ? Math.round(e.z) : 0)));
    expect(xs.size).toBeGreaterThan(1); // guns spread along the hull

    const a = makeSim('bs-a'); a.debug.giveWeapon('broadside', 3, 'A');
    const da = dummies(a, [[90, 0]]);
    const ta = run(a, 3, da);
    expect(ta.kinds.has('chain-shot')).toBe(true);
    expect(a.hasStatus(da[0]!.e, 'slowed')).toBe(true);

    const b = makeSim('bs-b'); b.debug.giveWeapon('broadside', 3, 'B');
    const db = dummies(b, [[60, 0], [110, 0]]);
    const tb = run(b, 3, db);
    expect(tb.kinds.has('heavy-shot')).toBe(true);
    expect(tb.projectiles.find((p) => p.kind === 'heavy-shot')!.pierce).toBeGreaterThan(0);
    expect(dealt(b, 'broadside')).toBeGreaterThan(0);
    expect(has(tb, (e) => e.type === 'damage' && e.target === db[1]!.e.id)).toBe(true); // pierced through the first ship
  });

  it('Rolling Thunder ripples both batteries continuously', () => {
    const sim = makeSim('rt');
    sim.debug.giveWeapon('broadside', 6, 'A');
    const d = dummies(sim, [[100, 0], [-100, 0]]);
    let port = 0, star = 0, started = false, silentAfterStart = 0;
    for (let w = 0; w < 16; w++) {
      const trace = run(sim, 0.25, d);
      const shots = trace.events.filter((e) => e.type === 'weapon-fired' && e.weapon === 'broadside');
      if (shots.length > 0) started = true;
      else if (started) silentAfterStart++;
      port += shots.filter((e) => e.type === 'weapon-fired' && e.side === 'port').length;
      star += shots.filter((e) => e.type === 'weapon-fired' && e.side === 'starboard').length;
    }
    expect(port).toBeGreaterThan(10);
    expect(star).toBeGreaterThan(10);
    expect(silentAfterStart).toBe(0); // once rolling, never a quarter second without a gun
  });

  it('bow chaser only fires ahead; Longtom pierces; Lance of Dawn fires lances', () => {
    const behind = makeSim('bc-behind'); behind.debug.giveWeapon('bow-chaser', 1);
    run(behind, 3, dummies(behind, [[0, 120]]));
    expect(dealt(behind, 'bow-chaser')).toBe(0);

    const ahead = makeSim('bc-ahead'); ahead.debug.giveWeapon('bow-chaser', 1);
    const t = run(ahead, 3, dummies(ahead, [[0, -150]]));
    expect(has(t, (e) => e.type === 'weapon-fired' && e.weapon === 'bow-chaser' && e.side === 'bow')).toBe(true);
    expect(dealt(ahead, 'bow-chaser')).toBeGreaterThan(0);

    const longtom = makeSim('bc-b'); longtom.debug.giveWeapon('bow-chaser', 3, 'B');
    const line = dummies(longtom, [[0, -80], [0, -140], [0, -200]]);
    run(longtom, 3, line);
    expect(line.every((d) => d.e.hp < d.e.maxHp)).toBe(true);

    const od = makeSim('bc-6'); od.debug.giveWeapon('bow-chaser', 6, 'A');
    const t6 = run(od, 5, dummies(od, [[10, -150], [-20, -220]]));
    expect(t6.kinds.has('lance')).toBe(true);
  });

  it('stern mortar lobs at the densest cluster; cluster bomblets, firepots and Meteor Rain', () => {
    const sim = makeSim('m1'); sim.debug.giveWeapon('stern-mortar', 1);
    const cluster = dummies(sim, [[0, 150], [8, 156], [-6, 146], [4, 160], [150, 0]]);
    const trace = run(sim, 4, cluster);
    const blast = trace.events.find((e) => e.type === 'explosion' && e.kind === 'mortar');
    expect(blast).toBeDefined();
    if (blast?.type === 'explosion') expect(Math.hypot(blast.x - 0, blast.z - 153)).toBeLessThan(25);

    const a = makeSim('m-a'); a.debug.giveWeapon('stern-mortar', 3, 'A');
    const ta = run(a, 5, dummies(a, [[0, 150], [10, 150]]));
    expect(ta.kinds.has('bomblet')).toBe(true);

    const b = makeSim('m-b'); b.debug.giveWeapon('stern-mortar', 3, 'B');
    const tb = run(b, 5, dummies(b, [[0, 150], [10, 150]]));
    expect(tb.maxHazards.get('fire-patch') ?? 0).toBeGreaterThan(0);

    const od = makeSim('m-6'); od.debug.giveWeapon('stern-mortar', 6, 'A');
    let skyShells = 0;
    run(od, 4, dummies(od, [[0, 150], [60, 100], [-80, 140]]), false, (s) => {
      for (const p of s.state.projectiles) if (p.alive && p.kind === 'mortar-shell' && p.y > 60) skyShells++;
    });
    expect(skyShells).toBeGreaterThan(0);
  });

  it('swivels fire at the nearest ship; grapeshot cones; Hailstorm fires in eight directions', () => {
    const sim = makeSim('sw'); sim.debug.giveWeapon('swivel-guns', 1);
    run(sim, 2, dummies(sim, [[40, 40], [500, 0]]));
    expect(dealt(sim, 'swivel-guns')).toBeGreaterThan(0);

    const b = makeSim('sw-b'); b.debug.giveWeapon('swivel-guns', 3, 'B');
    const tb = run(b, 2, dummies(b, [[40, 30]]));
    expect(tb.kinds.has('grapeshot')).toBe(true);

    const od = makeSim('sw-6'); od.debug.giveWeapon('swivel-guns', 6, 'A');
    const t6 = run(od, 3, dummies(od, [[50, 20]]));
    expect(has(t6, (e) => e.type === 'weapon-fired' && e.weapon === 'swivel-guns' && e.count === 8)).toBe(true);
  });

  it('fire barrels ignite into fire patches; powder kegs explode; Sea of Fire burns the wake', () => {
    const sim = makeSim('fb'); sim.debug.giveWeapon('fire-barrels', 1);
    const t = run(sim, 8, dummies(sim, [[0, 60]]));
    expect(t.maxHazards.get('barrel') ?? 0).toBeGreaterThan(0);
    expect(has(t, (e) => e.type === 'hazard-spawned' && e.kind === 'fire-patch')).toBe(true);

    const b = makeSim('fb-b'); b.debug.giveWeapon('fire-barrels', 3, 'B');
    const tb = run(b, 8, dummies(b, [[0, 60]]));
    expect(has(tb, (e) => e.type === 'explosion' && e.kind === 'powder')).toBe(true);

    const od = makeSim('fb-6'); od.debug.giveWeapon('fire-barrels', 6, 'A'); od.press('gear-up');
    const t6 = run(od, 6, dummies(od, [[0, 200]]));
    expect(count(t6, (e) => e.type === 'hazard-spawned' && e.kind === 'fire-patch')).toBeGreaterThan(8);
  });

  it('harpoons hook, slow and haul; chain harpoons hop ships; tow lines smash; Leviathan Hook drags groups', () => {
    const sim = makeSim('hp'); sim.debug.giveWeapon('harpoon', 1);
    const d = dummies(sim, [[0, -110]]);
    const t = run(sim, 2.5, d, true);
    expect(has(t, (e) => e.type === 'harpoon' && e.from === 0 && e.to === d[0]!.e.id)).toBe(true);
    expect(sim.hasStatus(d[0]!.e, 'hooked') || has(t, (e) => e.type === 'status-changed' && e.status === 'hooked')).toBe(true);
    expect(Math.hypot(d[0]!.e.x, d[0]!.e.z)).toBeLessThan(105); // hauled in

    const a = makeSim('hp-a'); a.debug.giveWeapon('harpoon', 3, 'A');
    const ta = run(a, 3, dummies(a, [[0, -90], [30, -110], [60, -120]]));
    expect(has(ta, (e) => e.type === 'harpoon' && e.from !== 0)).toBe(true);

    // Tow Line: its harpoons tie tow tethers…
    const b = makeSim('hp-b'); b.debug.giveWeapon('harpoon', 3, 'B');
    const [hooked] = dummies(b, [[0, -110]], 'skiff');
    run(b, 2, [hooked!]);
    const k = b.core.tTarget.indexOf(hooked!.e);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(b.core.tTow[k]).toBe(1);
    // …and a towed ship dragged through a neighbour smashes into it ('ram' from ship to ship, both damaged).
    const tow = makeSim('hp-tow');
    const [shipA, shipB] = dummies(tow, [[0, -135], [0, -70]], 'skiff');
    tow.core.tether(shipA!.e, null, 5, 20, 30, true);
    const tt = run(tow, 5, [shipA!, shipB!], true, () => { shipB!.e.x = 0; shipB!.e.z = -70; shipB!.e.vx = 0; shipB!.e.vz = 0; });
    expect(has(tt, (e) => e.type === 'ram' && e.attacker === shipA!.e.id && e.target === shipB!.e.id)).toBe(true);
    expect(shipB!.e.hp).toBeLessThan(shipB!.e.maxHp);
    expect(shipA!.e.hp).toBeLessThan(shipA!.e.maxHp);

    const od = makeSim('hp-6'); od.debug.giveWeapon('harpoon', 6, 'B');
    const group = dummies(od, [[0, -130], [20, -140], [-20, -135], [10, -115]]);
    const t6 = run(od, 4, group, true);
    const fromShip = t6.events.filter((e) => e.type === 'harpoon' && e.from !== 0).length;
    expect(fromShip).toBeGreaterThanOrEqual(2);
  });

  it('rockets home and blast; Swarm doubles, Big Bertha blasts large, Skyburst scatters sparks', () => {
    const sim = makeSim('rk'); sim.debug.giveWeapon('rocket-rack', 1);
    const t = run(sim, 4, dummies(sim, [[-120, 60]]));
    expect(t.kinds.has('rocket')).toBe(true);
    expect(dealt(sim, 'rocket-rack')).toBeGreaterThan(0);

    const a = makeSim('rk-a'); a.debug.giveWeapon('rocket-rack', 3, 'A');
    const ta = run(a, 1, dummies(a, [[-120, 60]]));
    const volley = ta.events.find((e) => e.type === 'weapon-fired' && e.weapon === 'rocket-rack');
    expect(volley?.type === 'weapon-fired' && volley.count).toBe(8);

    const b = makeSim('rk-b'); b.debug.giveWeapon('rocket-rack', 3, 'B');
    const tb = run(b, 4, dummies(b, [[-120, 60]]));
    expect(has(tb, (e) => e.type === 'explosion' && e.kind === 'large')).toBe(true);

    const od = makeSim('rk-6'); od.debug.giveWeapon('rocket-rack', 6, 'A');
    const t6 = run(od, 4, dummies(od, [[-120, 60]]));
    expect(t6.kinds.has('bomblet')).toBe(true);
  });

  it('storm rod chains lightning; Forked forks; Thunderclap stuns; Thunderhead follows and strikes', () => {
    const sim = makeSim('sr'); sim.debug.giveWeapon('storm-rod', 1);
    const d = dummies(sim, [[60, 0], [100, 20], [140, 0], [400, 0]]);
    const t = run(sim, 1, d);
    const bolt = t.events.find((e) => e.type === 'lightning');
    expect(bolt?.type === 'lightning' && bolt.points.length).toBe(4); // mast + 3 ships
    expect(d[3]!.e.hp).toBe(d[3]!.e.maxHp);

    const a = makeSim('sr-a'); a.debug.giveWeapon('storm-rod', 3, 'A');
    const ta = run(a, 1, dummies(a, [[60, 0], [100, 20], [140, 0], [70, 50], [90, -40], [120, -60], [40, 80]]));
    expect(count(ta, (e) => e.type === 'lightning')).toBeGreaterThanOrEqual(2);

    const b = makeSim('sr-b'); b.debug.giveWeapon('storm-rod', 3, 'B');
    const db = dummies(b, [[60, 0], [70, 10]]);
    const tclap = run(b, 1, db);
    expect(has(tclap, (e) => e.type === 'status-changed' && e.status === 'stunned' && e.target === db[1]!.e.id && e.on)).toBe(true);

    const od = makeSim('sr-6'); od.debug.giveWeapon('storm-rod', 6, 'A'); od.press('gear-up');
    const t6 = run(od, 4, dummies(od, [[60, 0], [-70, 30]]));
    expect(t6.maxHazards.get('storm-cloud')).toBe(1);
    expect(has(t6, (e) => e.type === 'hazard-triggered' && e.kind === 'storm-cloud')).toBe(true);
    const cloud = od.state.hazards.find((h) => h.alive && h.kind === 'storm-cloud')!;
    expect(Math.hypot(cloud.x - od.state.player.x, cloud.z - od.state.player.z)).toBeLessThan(40);
  });

  it('mines arm then blow; magnets home; depth charges blast wide; Minefield seeds itself', () => {
    const anchored = (seed: string) => { const s = makeSim(seed); s.press('gear-down'); return s; };
    const sim = anchored('tm'); sim.debug.giveWeapon('tide-mines', 1);
    const near = dummies(sim, [[0, 40]]);
    let dropTick = -1, blastTick = -1;
    const t: Trace = { events: [], kinds: new Set(), maxHazards: new Map(), projectiles: [] };
    for (let tick = 0; tick < 360; tick++) {
      const step = run(sim, 1 / 60, near);
      for (const e of step.events) {
        t.events.push(e);
        if (dropTick < 0 && e.type === 'hazard-spawned' && e.kind === 'mine') dropTick = tick;
        if (blastTick < 0 && e.type === 'explosion' && e.kind === 'mine') blastTick = tick;
      }
    }
    expect(dropTick).toBeGreaterThanOrEqual(0);
    expect(blastTick - dropTick).toBeGreaterThanOrEqual(58); // a mine only blows once armed (~1 s)
    expect(has(t, (e) => e.type === 'explosion' && e.kind === 'mine')).toBe(true);

    const a = anchored('tm-a'); a.debug.giveWeapon('tide-mines', 3, 'A');
    const ta = run(a, 8, dummies(a, [[30, 75]]));
    expect(has(ta, (e) => e.type === 'explosion' && e.kind === 'mine')).toBe(true);

    const b = anchored('tm-b'); b.debug.giveWeapon('tide-mines', 3, 'B');
    const tb = run(b, 6, dummies(b, [[0, 40]])); // well inside the trigger reach of both stern mines
    const wet = tb.events.find((e) => e.type === 'explosion' && e.kind === 'water');
    expect(wet?.type === 'explosion' && wet.radius).toBeGreaterThan(30);

    const od = makeSim('tm-6'); od.debug.giveWeapon('tide-mines', 6, 'A');
    const t6 = run(od, 6, dummies(od, [[0, 300]]));
    expect(t6.maxHazards.get('mine') ?? 0).toBeGreaterThan(5);
  });

  it('iron ram multiplies rams; spiked hull grinds contacts; shockwave prow; Iron Tusk heals and grants i-frames', () => {
    const ramOnce = (level: number, branch?: 'A' | 'B', god = true) => {
      const sim = makeSim(`ir-${level}${branch ?? ''}`, god);
      if (level > 0) sim.debug.giveWeapon('iron-ram', level, branch);
      sim.state.sea.windDir = Math.PI / 2;
      const d = dummies(sim, [[0, -90]], 'frigate');
      sim.press('gear-up');
      const trace = run(sim, 8, d, false, (s) => { s.state.sea.windDir = Math.PI / 2; });
      const ram = trace.events.find((e) => e.type === 'ram' && e.attacker === 0);
      return { sim, trace, ram, d };
    };
    const plain = ramOnce(0, undefined, false);
    const iron = ramOnce(1, undefined, false);
    expect(plain.ram).toBeDefined();
    expect(iron.ram).toBeDefined();
    if (plain.ram?.type === 'ram' && iron.ram?.type === 'ram') expect(iron.ram.damage).toBeGreaterThan(plain.ram.damage * 1.5);
    expect(dealt(iron.sim, 'iron-ram')).toBeGreaterThan(0);
    // The plain hull took recoil; the iron prow did not.
    expect(plain.trace.events.some((e) => e.type === 'player-hit' && e.source === plain.d[0]!.e.id)).toBe(true);

    const spiked = makeSim('ir-a'); spiked.debug.giveWeapon('iron-ram', 3, 'A');
    run(spiked, 2, dummies(spiked, [[14, 0]]));
    expect(dealt(spiked, 'iron-ram')).toBeGreaterThan(0);

    const prow = ramOnce(3, 'B');
    expect(has(prow.trace, (e) => e.type === 'hazard-spawned' && e.kind === 'shockwave')).toBe(true);

    const tusk = makeSim('ir-6', false); tusk.debug.giveWeapon('iron-ram', 6, 'A');
    tusk.state.player.hp = tusk.state.player.maxHp * 0.5;
    tusk.state.sea.windDir = Math.PI / 2;
    tusk.press('gear-up');
    const d = dummies(tusk, [[0, -90]], 'skiff');
    const hp0 = tusk.state.player.hp;
    const tt = run(tusk, 8, d, false, (s) => { s.state.sea.windDir = Math.PI / 2; });
    expect(has(tt, (e) => e.type === 'ram' && e.attacker === 0)).toBe(true);
    expect(tusk.state.player.hp).toBeGreaterThan(hp0);
    expect(has(tt, (e) => e.type === 'status-changed' && e.target === 0 && e.status === 'invulnerable' && e.on)).toBe(true);
  });

  it('escort skiffs orbit and shoot; +2 skiffs; fire skiffs kamikaze and respawn; Armada of eight', () => {
    const skiffs = (s: Sim) => s.state.hazards.filter((h) => h.alive && h.kind === 'escort-skiff');
    const sim = makeSim('es'); sim.debug.giveWeapon('escort-skiffs', 1);
    const t = run(sim, 4, dummies(sim, [[60, 60]]));
    expect(skiffs(sim).length).toBe(2);
    expect(t.kinds.has('skiff-shot')).toBe(true);
    for (const h of skiffs(sim)) expect(Math.hypot(h.x - sim.state.player.x, h.z - sim.state.player.z)).toBeLessThan(80);

    const a = makeSim('es-a'); a.debug.giveWeapon('escort-skiffs', 3, 'A');
    run(a, 1, []);
    expect(skiffs(a).length).toBe(5);

    const b = makeSim('es-b'); b.debug.giveWeapon('escort-skiffs', 3, 'B');
    const tb = run(b, 10, dummies(b, [[60, 60]]));
    expect(has(tb, (e) => e.type === 'hazard-triggered' && e.kind === 'escort-skiff')).toBe(true);
    expect(count(tb, (e) => e.type === 'hazard-spawned' && e.kind === 'escort-skiff')).toBeGreaterThan(3); // respawned

    const od = makeSim('es-6'); od.debug.giveWeapon('escort-skiffs', 6, 'A');
    run(od, 1, []);
    expect(skiffs(od).length).toBe(8);
  });

  it('maelstrom whirlpools pull and grind; Twin Vortex doubles; Riptide grows; the Maelstrom follows the ship', () => {
    const sim = makeSim('mc'); sim.debug.giveWeapon('maelstrom-charm', 1);
    const group = dummies(sim, [[0, -120], [15, -128], [-12, -135]], 'skiff');
    const t = run(sim, 4, group, true);
    expect(t.maxHazards.get('whirlpool')).toBe(1);
    const pool = t.events.find((e) => e.type === 'hazard-spawned' && e.kind === 'whirlpool');
    expect(pool).toBeDefined();
    expect(dealt(sim, 'maelstrom-charm')).toBeGreaterThan(0);

    const a = makeSim('mc-a'); a.debug.giveWeapon('maelstrom-charm', 3, 'A');
    const ta = run(a, 1, dummies(a, [[0, -120], [150, 40]]));
    expect(ta.maxHazards.get('whirlpool')).toBe(2);

    const b = makeSim('mc-b'); b.debug.giveWeapon('maelstrom-charm', 3, 'B');
    const tb = run(b, 1, dummies(b, [[0, -120]]));
    const rip = tb.events.find((e) => e.type === 'hazard-spawned' && e.kind === 'whirlpool');
    const lvl3 = b.content.weapons['maelstrom-charm'].levels[2]!.area!;
    expect(rip?.type === 'hazard-spawned' && rip.radius).toBeGreaterThan(lvl3 * 1.3);

    const od = makeSim('mc-6'); od.debug.giveWeapon('maelstrom-charm', 6, 'A'); od.press('gear-up');
    run(od, 3, dummies(od, [[0, -120]]));
    const follower = od.state.hazards.find((h) => h.alive && h.kind === 'whirlpool' && h.ttl > 1e6)!;
    expect(follower).toBeDefined();
    expect(Math.hypot(follower.x - od.state.player.x, follower.z - od.state.player.z)).toBeLessThan(1);
  });
});
