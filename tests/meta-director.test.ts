import { describe, expect, it } from 'vitest';
import { DIRECTOR } from '../src/game/content/director';
import type { EnemyId, SeaId } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { Sim } from '../src/game/sim/Sim';
import { spawnBossAhead, startEvent } from '../src/game/sim/director';
import { scheduleStrike } from '../src/game/sim/weather';
import type { BossState, SimEvent } from '../src/game/types';
import { IslandField } from '../src/world/IslandField';

function makeSim(seed = 'meta-dir', sea: SeaId = 'sunward-shallows'): Sim {
  const sim = new Sim({ seed, shipId: 'sunlion', seaId: sea, meta: defaultProfile(), world: new IslandField(seed, { sea }) });
  sim.debug.god(true);
  return sim;
}

/** Runs `seconds` of sim time, auto-picking cards, and returns every event. */
function run(sim: Sim, seconds: number, steer = 0.3): SimEvent[] {
  const out: SimEvent[] = [];
  sim.setInput({ steer });
  const end = sim.state.time + seconds;
  let guard = 0;
  while (sim.state.time < end && guard++ < seconds * 70 + 100) {
    if (sim.state.status === 'levelup' || sim.state.status === 'chest') sim.chooseCard(0);
    sim.step(1 / 60);
    out.push(...sim.drainEvents());
  }
  return out;
}

const spawnedIds = (evs: SimEvent[]): EnemyId[] => evs.flatMap((e) => (e.type === 'enemy-spawned' ? [e.defId] : []));

describe('director', () => {
  it('escalates heat, HP, damage, budget and fire over the run', () => {
    for (const f of [DIRECTOR.budgetRate, DIRECTOR.fireRate, DIRECTOR.minAlive]) expect(f(12)).toBeGreaterThan(f(1));
    expect(DIRECTOR.hpScale(12, 1)).toBeGreaterThan(DIRECTOR.hpScale(1, 1));
    expect(DIRECTOR.damageScale(12, 1)).toBeGreaterThan(DIRECTOR.damageScale(1, 1));
    expect(DIRECTOR.hpScale(8, 1.55)).toBeGreaterThan(DIRECTOR.hpScale(8, 1));
    expect(DIRECTOR.heat(10, 1)).toBeGreaterThan(DIRECTOR.heat(1, 1));
  });

  it('opens with skiffs only and brings a mixed horde later', () => {
    const early = makeSim('mix-early');
    const first = spawnedIds(run(early, 50));
    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first)).toEqual(new Set(['skiff']));

    const late = makeSim('mix-late');
    late.debug.setTime(11 * 60);
    const evs = run(late, 45);
    const kinds = new Set(spawnedIds(evs));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    expect(spawnedIds(evs).length).toBeGreaterThan(first.length);
    expect(kinds.has('wraith')).toBe(false); // Sunward has no Gloam wraiths
    // Late spawns are tougher (heat-scaled HP).
    const skiff = late.state.enemies.find((e) => e.defId === 'skiff' && !e.elite);
    if (skiff) expect(skiff.maxHp).toBeGreaterThan(late.content.enemies.skiff.hp * 1.5);
  });

  it('sends Gloam wraiths only on the Gloam', () => {
    const sim = makeSim('gloam', 'the-gloam');
    sim.debug.setTime(150);
    expect(spawnedIds(run(sim, 90))).toContain('wraith');
  });

  it('warns 10 s before a boss and spawns it on schedule with scaled HP', () => {
    const sim = makeSim('boss-sched');
    sim.debug.setTime(288);
    const evs = run(sim, 14);
    const warn = evs.find((e) => e.type === 'boss-warning');
    expect(warn && warn.type === 'boss-warning' && warn.boss).toBe('iron-warden');
    const spawned = evs.find((e) => e.type === 'boss-spawned');
    expect(spawned && spawned.type === 'boss-spawned' && spawned.boss).toBe('iron-warden');
    const b = sim.state.bosses[0]!;
    expect(b.maxHp).toBeCloseTo(sim.content.bosses['iron-warden'].hp * DIRECTOR.bossHpScale(1, 0));
    expect(sim.state.director.activeBoss).toBe('iron-warden');
    expect(sim.state.director.nextBossIndex).toBe(1);
  });

  it('stages set pieces with director-event banners', () => {
    const sim = makeSim('events');
    run(sim, 1);
    const before = sim.state.enemies.length;
    startEvent(sim, 'ambush-ring');
    const ring = sim.state.enemies.slice(before);
    expect(ring.length).toBeGreaterThanOrEqual(8);
    expect(ring.every((e) => e.defId === 'skiff')).toBe(true);
    const p = sim.state.player;
    const angles = new Set(ring.map((e) => Math.round((Math.atan2(e.x - p.x, e.z - p.z) + Math.PI) / (Math.PI / 2)) % 4));
    expect(angles.size).toBeGreaterThanOrEqual(3); // from every side

    startEvent(sim, 'treasure-convoy');
    const convoy = sim.state.enemies.filter((e) => e.ai.convoy === 1);
    expect(convoy.length).toBeGreaterThan(0);
    expect(convoy.every((e) => e.defId === 'corsair-galleon')).toBe(true);

    startEvent(sim, 'storm-front');
    expect(sim.state.hazards.filter((h) => h.alive && h.kind === 'wave-front').length).toBeGreaterThan(5);
    const banners = sim.drainEvents().filter((e) => e.type === 'director-event');
    expect(banners.map((e) => e.type === 'director-event' && e.name)).toEqual(['Ambush Ring', 'Treasure Convoy', 'Storm Front']);
  });

  it('resolves telegraphed lightning: serial bump, event, damage to ships under it', () => {
    const sim = makeSim('lightning');
    const e = sim.spawnEnemy('brig', 150, 0)!;
    run(sim, 1 / 30);
    const serial = sim.state.sea.lightningSerial;
    expect(scheduleStrike(sim, e.x, e.z, 0.5)).toBe(true);
    expect(sim.state.telegraphs.some((t) => t.alive && t.shape === 'circle')).toBe(true);
    const hp = e.hp;
    const evs = run(sim, 0.8, 0);
    expect(sim.state.sea.lightningSerial).toBe(serial + 1);
    expect(evs.some((ev) => ev.type === 'lightning-strike')).toBe(true);
    expect(e.hp).toBeLessThan(hp);
  });

  it('keeps enemy volleys inside the fleet fire-control budget', () => {
    const sim = makeSim('fire-budget');
    sim.debug.setTime(8 * 60);
    for (let i = 0; i < 30; i++) sim.debug.spawnEnemy('brig', 1);
    const evs = run(sim, 60);
    const volleys = evs.filter((e) => e.type === 'enemy-fired').length;
    const budget = (DIRECTOR.fireRate(8) + DIRECTOR.fireRate(9)) / 2 * 60 + DIRECTOR.fireBank + 2;
    expect(volleys).toBeGreaterThan(5);
    expect(volleys).toBeLessThanOrEqual(budget * 2 /* cutters cost half a token */);
  });

  it('mans real fort towers (WORLD battery sites) and keeps the battery on land', () => {
    const world = new IslandField('bal-1', { sea: 'sunward-shallows' });
    const sim = new Sim({ seed: 'bal-1', shipId: 'sunlion', seaId: 'sunward-shallows', meta: defaultProfile(), world });
    sim.debug.god(true);
    const site = world.batterySitesNear(0, 0, 4000)[0]!;
    expect(site).toBeDefined();
    // Park the player in open water ~250 m from the tower.
    const p = sim.state.player;
    for (let a = 0; a < 64; a++) {
      const x = site.x + Math.sin(a) * 250, z = site.z + Math.cos(a) * 250;
      if (world.isWater(x, z, 30)) { p.x = x; p.z = z; break; }
    }
    sim.debug.setTime(250);
    run(sim, 0.5, 0);
    const forts = sim.state.enemies.filter((e) => e.defId === 'fort' && e.life === 'alive');
    expect(forts.length).toBeGreaterThan(0);
    const sites = world.batterySitesNear(p.x, p.z, 500);
    const fort = forts[0]!;
    expect(sites.some((st) => Math.hypot(st.x - fort.x, st.z - fort.z) < 0.01 && Math.abs(st.y - fort.y) < 0.01)).toBe(true);
    expect(world.isWater(fort.x, fort.z, 0)).toBe(false);
    const x = fort.x, z = fort.z;
    run(sim, 2, 0);
    expect(fort.x).toBe(x);
    expect(fort.z).toBe(z);
    // The hit circle reaches past the coastline so flat shots can land.
    expect(fort.radius).toBeGreaterThan(-world.shoreDistance(fort.x, fort.z, 120));
  });

  it('is deterministic for a seed', () => {
    const a = makeSim('det'), b = makeSim('det');
    run(a, 90); run(b, 90);
    expect(a.state.stats.kills).toBe(b.state.stats.kills);
    expect(a.state.enemies.length).toBe(b.state.enemies.length);
    expect(a.state.player.x).toBeCloseTo(b.state.player.x, 6);
  });
});

describe('bosses', () => {
  function bossSim(id: 'iron-warden' | 'tidewyrm' | 'sovereign', seed = `boss-${id}`): { sim: Sim; boss: BossState } {
    const sim = makeSim(seed);
    run(sim, 1 / 30);
    spawnBossAhead(sim, id, 0);
    return { sim, boss: sim.state.bosses[0]! };
  }

  it('Iron Warden: telegraphed volleys and barrages, plates off at 50% with a ram next', () => {
    const { sim, boss } = bossSim('iron-warden');
    const evs = run(sim, 40, 0.2);
    const attacks = new Set(evs.flatMap((e) => (e.type === 'boss-attack' ? [e.attack] : [])));
    expect([...attacks].some((a) => a === 'broadside-volley' || a === 'mortar-barrage' || a === 'summon-cutters')).toBe(true);
    const shapes = new Set(evs.flatMap((e) => (e.type === 'telegraph' ? [e.shape] : [])));
    expect(shapes.has('line') || shapes.has('circle')).toBe(true);
    expect(boss.armor).toBe(3);
    boss.hp = boss.maxHp * 0.49;
    const after = run(sim, 12, 0.2);
    expect(after.some((e) => e.type === 'boss-phase' && e.phase === 1)).toBe(true);
    expect(after.some((e) => e.type === 'boss-attack' && e.attack === 'plates-off')).toBe(true);
    expect(boss.phase).toBe(1);
    expect(boss.armor).toBe(0);
    expect(after.some((e) => e.type === 'boss-attack' && e.attack === 'ram-charge')).toBe(true);
  });

  it('Tidewyrm: submerges out of reach, then lunges along a telegraphed line', () => {
    const { sim, boss } = bossSim('tidewyrm');
    let sawSubmerged = false, immune = false;
    const evs: SimEvent[] = [];
    for (let i = 0; i < 60 * 60 && !(sawSubmerged && immune); i++) {
      if (sim.state.status !== 'running') sim.chooseCard(0);
      sim.step(1 / 60);
      evs.push(...sim.drainEvents());
      if (boss.submerged > 0.7) {
        sawSubmerged = true;
        const hp = boss.hp;
        immune = sim.damageTarget(boss, 500) === 0 && boss.hp === hp;
      }
    }
    expect(sawSubmerged).toBe(true);
    expect(immune).toBe(true);
    const more = run(sim, 8, 0.2);
    expect([...evs, ...more].some((e) => e.type === 'boss-attack' && e.attack === 'lunge-strike')).toBe(true);
    boss.hp = boss.maxHp * 0.45;
    const brood = run(sim, 12, 0.2);
    expect(brood.some((e) => e.type === 'boss-phase')).toBe(true);
    expect(brood.some((e) => e.type === 'enemy-spawned' && e.defId === 'wyrmling')).toBe(true);
  });

  it('the final boss ends the run with a victory; earlier bosses drop a boss chest', () => {
    const warden = bossSim('iron-warden', 'boss-drops');
    warden.sim.damageTarget(warden.boss, 1e7, { pierceArmor: true });
    expect(warden.sim.state.pickups.some((k) => k.alive && k.kind === 'chest' && k.value === 2)).toBe(true);
    expect(warden.sim.state.stats.bossesDefeated).toEqual(['iron-warden']);
    expect(warden.sim.state.status).toBe('running');

    const { sim, boss } = bossSim('sovereign', 'boss-final');
    sim.state.director.nextBossIndex = sim.content.seas['sunward-shallows'].bosses.length;
    const doubloons = sim.state.stats.doubloons;
    sim.damageTarget(boss, 1e7, { pierceArmor: true });
    expect(sim.state.stats.doubloons).toBeGreaterThan(doubloons);
    const evs = run(sim, 5);
    expect(evs.some((e) => e.type === 'run-ended' && e.outcome === 'victory')).toBe(true);
    expect(sim.state.status).toBe('victory');
    expect(sim.result()?.outcome).toBe('victory');
  });
});
