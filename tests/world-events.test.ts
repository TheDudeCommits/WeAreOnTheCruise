import { describe, expect, it } from 'vitest';
import { DIRECTOR_EVENTS, EVENT_TUNING, type DirectorEventId } from '../src/game/content/director';
import type { SeaId } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { Sim } from '../src/game/sim/Sim';
import { startEvent } from '../src/game/sim/director';
import { activeWorldEvent, eventWeight } from '../src/game/sim/world-events';
import type { EnemyState, SimEvent } from '../src/game/types';
import { IslandField } from '../src/world/IslandField';

/** A god-mode run at `minute`; the director's own event draws are held off unless `director` is set. */
function makeSim(seed: string, sea: SeaId = 'sunward-shallows', minute = 6, director = false): Sim {
  const sim = new Sim({ seed, shipId: 'sunlion', seaId: sea, meta: defaultProfile(), world: new IslandField(seed, { sea }) });
  sim.debug.god(true);
  sim.debug.setTime(minute * 60);
  if (!director) sim.state.director.scratch.nextEvent = 1e9;
  return sim;
}

/** Runs `seconds` of sim time (cards auto-picked) and returns every event. */
function run(sim: Sim, seconds: number, steer = 0): SimEvent[] {
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

const phases = (evs: SimEvent[], id: string): string[] =>
  evs.flatMap((e) => (e.type === 'world-event' && e.id === id ? [e.phase] : []));

const alive = (sim: Sim, defId: string): EnemyState[] => sim.state.enemies.filter((e) => e.defId === defId && e.life === 'alive');

const EVENT_IDS: DirectorEventId[] = [
  'kraken-rising', 'rogue-wave', 'maelstrom', 'admiralty-blockade', 'ghost-fleet', 'volcanic-eruption', 'sunken-treasure', 'bounty-contract',
];

describe('world events', () => {
  it('every set piece starts, publishes worldEvent and a start phase', () => {
    for (const id of EVENT_IDS) {
      const sim = makeSim(`start-${id}`, id === 'ghost-fleet' ? 'the-gloam' : 'sunward-shallows');
      sim.debug.spawnEnemy('skiff', 6);
      run(sim, 0.5);
      startEvent(sim, id);
      const evs = run(sim, 0.2);
      const ev = sim.state.worldEvent;
      expect(ev?.id, id).toBe(id);
      expect(ev!.name).toBe(DIRECTOR_EVENTS[id].name);
      expect(ev!.duration).toBeGreaterThan(10);
      expect(phases(evs, id)[0], id).toBe('start');
      expect(evs.some((e) => e.type === 'director-event' && e.name === DIRECTOR_EVENTS[id].name), id).toBe(true);
      expect(activeWorldEvent(sim)).toBe(id);
    }
  });

  it('kraken: arms ring the ship, attack, and sinking them all pays out', () => {
    const sim = makeSim('kraken');
    run(sim, 0.5);
    startEvent(sim, 'kraken-rising');
    const arms = alive(sim, 'kraken-arm');
    expect(arms.length).toBeGreaterThanOrEqual(5);
    const p = sim.state.player;
    for (const a of arms) expect(Math.hypot(a.x - p.x, a.z - p.z)).toBeGreaterThan(40);
    expect(sim.state.worldEvent!.goal).toBe(arms.length);
    // They rise hidden, surface, then start telegraphing.
    expect(arms.every((a) => a.hidden > 0.5)).toBe(true);
    const evs = run(sim, 6);
    expect(arms.every((a) => a.hidden === 0)).toBe(true);
    expect(evs.some((e) => e.type === 'telegraph')).toBe(true);
    for (const a of arms) sim.damageTarget(a, 1e6, { pierceArmor: true });
    const after = run(sim, 0.5);
    expect(phases(after, 'kraken-rising')).toContain('success');
    expect(sim.state.worldEvent!.progress).toBe(arms.length);
    // The payout chest spawns (the pickup magnet may already have hauled it aboard).
    expect(after.some((e) => e.type === 'pickup-spawned' && e.kind === 'chest') || sim.state.pickups.some((k) => k.alive && k.kind === 'chest')).toBe(true);
    const end = run(sim, EVENT_TUNING.linger + 0.2);
    expect(phases(end, 'kraken-rising')).toContain('end');
    expect(sim.state.worldEvent).toBeNull();
    expect(sim.state.enemies.some((e) => e.defId === 'kraken-arm')).toBe(false);
  });

  it('kraken: running out the clock fails and the arms sink back', () => {
    const sim = makeSim('kraken-fail');
    run(sim, 0.5);
    startEvent(sim, 'kraken-rising');
    const evs = run(sim, DIRECTOR_EVENTS['kraken-rising'].duration + 4);
    expect(phases(evs, 'kraken-rising')).toEqual(['start', 'fail', 'end']);
    expect(sim.state.enemies.some((e) => e.defId === 'kraken-arm')).toBe(false);
  });

  it('rogue wave: hits ships in its path and rides with a boost', () => {
    const sim = makeSim('wave');
    run(sim, 0.5);
    startEvent(sim, 'rogue-wave');
    const wave = sim.state.hazards.find((h) => h.alive && h.kind === 'rogue-wave')!;
    expect(wave).toBeTruthy();
    const x0 = wave.x, z0 = wave.z;
    // A brig halfway along the wave's path.
    const p = sim.state.player;
    const brig = sim.spawnEnemy('brig', (x0 + p.x) / 2, (z0 + p.z) / 2)!;
    const hp = brig.hp;
    const hp0 = p.hp;
    run(sim, 4);
    expect(Math.hypot(wave.x - x0, wave.z - z0)).toBeGreaterThan(60);
    sim.debug.god(false);
    const evs = run(sim, 12);
    expect(brig.hp).toBeLessThan(hp);
    expect(evs.some((e) => e.type === 'player-hit')).toBe(true);
    expect(p.hp).toBeLessThan(hp0);
    // Ride the next one: boost as it arrives.
    const sim2 = makeSim('wave');
    run(sim2, 0.5);
    startEvent(sim2, 'rogue-wave');
    const w2 = sim2.state.hazards.find((h) => h.alive && h.kind === 'rogue-wave')!;
    const p2 = sim2.state.player;
    let rode = false;
    for (let i = 0; i < 60 * 20 && !rode; i++) {
      const along = (p2.x - w2.x) * (w2.vx / 24) + (p2.z - w2.z) * (w2.vz / 24);
      if (along < 30 && along > 0) sim2.press('boost');
      sim2.step(1 / 60);
      sim2.drainEvents();
      rode = (sim2.state.worldEvent?.progress ?? 0) > 0;
    }
    expect(rode).toBe(true);
  });

  it('maelstrom: drags ships toward its eye and counts ships it swallows', () => {
    const sim = makeSim('mael');
    run(sim, 0.5);
    startEvent(sim, 'maelstrom');
    const m = sim.state.hazards.find((h) => h.alive && h.kind === 'maelstrom')!;
    expect(m).toBeTruthy();
    const e = sim.spawnEnemy('skiff', m.x + 90, m.z)!;
    sim.applyStatus(e, 'stunned', 10); // adrift: only the current moves it
    const d0 = Math.hypot(e.x - m.x, e.z - m.z);
    run(sim, 5);
    if (e.life === 'alive') expect(Math.hypot(e.x - m.x, e.z - m.z)).toBeLessThan(d0);
    // Ships killed in its heart feed it.
    for (let k = 0; k < 3; k++) {
      const s = sim.spawnEnemy('skiff', m.x + 10 + k, m.z)!;
      sim.damageTarget(s, 1e6, { pierceArmor: true });
    }
    run(sim, 0.2);
    expect(sim.state.worldEvent!.progress).toBeGreaterThanOrEqual(3);
    const evs = run(sim, EVENT_TUNING.maelstromDuration + 3);
    expect(phases(evs, 'maelstrom')).toContain('end');
    expect(sim.state.hazards.some((h) => h.alive && h.kind === 'maelstrom')).toBe(false);
  });

  it('blockade: a flagship leads a frigate line; sinking it breaks the line', () => {
    const sim = makeSim('blockade', 'sunward-shallows', 8);
    run(sim, 0.5);
    // Only the blockade's own ships (the director's regular frigates sail in their own lines at minute 8).
    const before = new Set(sim.state.enemies.map((e) => e.id));
    startEvent(sim, 'admiralty-blockade');
    const flag = alive(sim, 'man-o-war').filter((e) => !before.has(e.id))[0]!;
    expect(flag).toBeTruthy();
    expect(flag.title).toMatch(/^Flagship /);
    const frigates = alive(sim, 'frigate').filter((e) => !before.has(e.id));
    expect(frigates.length).toBeGreaterThanOrEqual(3);
    expect(frigates.every((f) => f.ai.leader === flag.id)).toBe(true);
    sim.damageTarget(flag, 1e7, { pierceArmor: true });
    const evs = run(sim, 0.5);
    expect(phases(evs, 'admiralty-blockade')).toContain('success');
    expect(sim.state.pickups.some((k) => k.alive && k.kind === 'chest')).toBe(true);
  });

  it('ghost fleet: only at night or in the Gloam; sinking the galleons wins', () => {
    const day = makeSim('ghost-day', 'sunward-shallows', 2);
    run(day, 0.5);
    expect(eventWeight(day, 'ghost-fleet', 1, 2)).toBe(0);
    const sim = makeSim('ghost', 'the-gloam', 3);
    run(sim, 0.5);
    expect(eventWeight(sim, 'ghost-fleet', 1, 3)).toBeGreaterThan(1);
    startEvent(sim, 'ghost-fleet');
    const goal = sim.state.worldEvent!.goal!;
    expect(goal).toBeGreaterThanOrEqual(2);
    run(sim, 3);
    const galleons = alive(sim, 'drowned-galleon');
    expect(galleons.length).toBe(goal);
    expect(galleons.every((g) => g.hidden < 0.05)).toBe(true);
    for (const g of galleons) sim.damageTarget(g, 1e7, { pierceArmor: true });
    const evs = run(sim, 0.5);
    expect(phases(evs, 'ghost-fleet')).toContain('success');
  });

  it('eruption: lava bombs land on telegraphed circles, leave fire, and gold pays', () => {
    const sim = makeSim('erupt');
    run(sim, 0.5);
    startEvent(sim, 'volcanic-eruption');
    const evs = run(sim, 8);
    expect(sim.state.hazards.some((h) => h.alive && h.kind === 'lava-bomb')).toBe(true);
    expect(evs.filter((e) => e.type === 'telegraph' && e.shape === 'circle').length).toBeGreaterThan(5);
    expect(evs.some((e) => e.type === 'explosion' && e.kind === 'fire')).toBe(true);
    expect(evs.some((e) => e.type === 'hazard-spawned' && e.kind === 'fire-patch')).toBe(true);
    const rest = run(sim, EVENT_TUNING.eruptionDuration);
    expect(phases(rest, 'volcanic-eruption')).toContain('success');
    expect([...evs, ...rest].some((e) => e.type === 'pickup-spawned' && e.kind === 'doubloon')).toBe(true);
  });

  it('sunken treasure: holding the site digs up a big chest', () => {
    const sim = makeSim('treasure');
    run(sim, 0.5);
    startEvent(sim, 'sunken-treasure');
    const ev = sim.state.worldEvent!;
    expect(ev.goal).toBe(EVENT_TUNING.treasureDig(6));
    // Outside: nothing happens.
    run(sim, 2);
    expect(ev.progress).toBe(0);
    let spawned = 0, bigChest = false, success = false;
    for (let t = 0; t < ev.goal! + 2 && sim.state.worldEvent; t += 0.5) {
      sim.debug.teleport(ev.x!, ev.z!);
      const evs = run(sim, 0.5);
      spawned += evs.filter((e) => e.type === 'enemy-spawned').length;
      bigChest ||= evs.some((e) => e.type === 'pickup-spawned' && e.kind === 'chest' && e.value === 2);
      success ||= phases(evs, 'sunken-treasure').includes('success');
    }
    expect(spawned).toBeGreaterThan(0);
    expect(bigChest).toBe(true);
    expect(success).toBe(true);
  });

  it('bounty contract: posts the commonest class and counts its sinkings', () => {
    const sim = makeSim('bounty', 'sunward-shallows', 3);
    sim.debug.spawnEnemy('cutter', 14);
    run(sim, 0.2);
    startEvent(sim, 'bounty-contract');
    const ev = sim.state.worldEvent!;
    expect(ev.goal).toBeGreaterThanOrEqual(3);
    run(sim, 0.1);
    const marked = sim.state.enemies.filter((e) => e.life === 'alive' && e.ai.bmk === 1);
    expect(marked.length).toBeGreaterThanOrEqual(3);
    const target = marked[0]!.defId;
    expect(ev.text).toContain(sim.content.enemies[target].name);
    expect(marked.every((e) => e.defId === target)).toBe(true);
    const evs: SimEvent[] = [];
    for (let guard = 0; guard < 60 && sim.state.worldEvent?.id === 'bounty-contract' && !phases(evs, 'bounty-contract').includes('success'); guard++) {
      const t = alive(sim, target)[0];
      if (!t) { sim.debug.spawnEnemy(target, 2); evs.push(...run(sim, 0.1)); continue; }
      sim.damageTarget(t, 1e6, { pierceArmor: true });
      evs.push(...run(sim, 0.1));
    }
    expect(phases(evs, 'bounty-contract')).toContain('success');
    expect(evs.some((e) => e.type === 'pickup-spawned' && e.kind === 'chest')).toBe(true);
  });

  it('cadence: events every 35-60 s after minute 1, one at a time, a lull after each, none into a boss', () => {
    const sim = makeSim('cadence', 'stormwrack-reach', 0, true);
    const starts: { t: number; id: DirectorEventId }[] = [];
    let active = 0, maxActive = 0;
    sim.setInput({ steer: 0.25 });
    let guard = 0;
    const firstBoss = sim.content.seas['stormwrack-reach'].bosses[0]!.at;
    while (sim.state.time < firstBoss - 1 && guard++ < firstBoss * 70) {
      if (sim.state.status === 'levelup' || sim.state.status === 'chest') sim.chooseCard(0);
      sim.step(1 / 60);
      for (const e of sim.drainEvents()) {
        if (e.type === 'director-event') {
          const def = Object.values(DIRECTOR_EVENTS).find((d) => d.name === e.name);
          if (def) starts.push({ t: sim.state.time, id: def.id });
        }
        if (e.type === 'world-event' && e.phase === 'start') active++;
        if (e.type === 'world-event' && e.phase === 'end') active--;
        maxActive = Math.max(maxActive, active);
      }
    }
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts[0]!.t).toBeGreaterThanOrEqual(59);
    for (let i = 1; i < starts.length; i++) expect(starts[i]!.t - starts[i - 1]!.t).toBeGreaterThanOrEqual(35);
    expect(maxActive).toBeLessThanOrEqual(1);
    // The Iron Warden arrives on the run clock (3:00): no set piece may still be running then.
    for (const s of starts) if (EVENT_IDS.includes(s.id)) expect(s.t + DIRECTOR_EVENTS[s.id].duration).toBeLessThanOrEqual(firstBoss);
  });

  it("mirrors META's treasure convoy on the tracker", () => {
    const sim = makeSim('convoy-track', 'sunward-shallows', 4);
    run(sim, 0.5);
    startEvent(sim, 'treasure-convoy');
    const evs = run(sim, 0.2);
    expect(phases(evs, 'treasure-convoy')[0]).toBe('start');
    const ev = sim.state.worldEvent!;
    const convoy = sim.state.enemies.filter((e) => e.life === 'alive' && e.ai.convoy === 1);
    expect(ev.goal).toBe(convoy.length);
    for (const e of convoy) sim.damageTarget(e, 1e7, { pierceArmor: true });
    const after = run(sim, EVENT_TUNING.linger + 0.5);
    expect(phases(after, 'treasure-convoy')).toEqual(['success', 'end']);
    expect(sim.state.worldEvent).toBeNull();
  });

  it('points of interest: trade winds carry ships, salvage pays, beacons bless', () => {
    const sim = makeSim('poi', 'sunward-shallows', 2);
    const evs = run(sim, EVENT_TUNING.poiFirst + 45, 0.2);
    const spawned = new Set(evs.flatMap((e) => (e.type === 'hazard-spawned' ? [e.kind] : [])));
    expect(spawned.has('trade-wind')).toBe(true);
    expect(spawned.has('salvage')).toBe(true);
    // Salvage: sail over it.
    const salvage = sim.state.hazards.find((h) => h.alive && h.kind === 'salvage');
    if (salvage) {
      sim.debug.teleport(salvage.x, salvage.z);
      const got = run(sim, 0.2);
      expect(got.some((e) => e.type === 'hazard-triggered' && e.kind === 'salvage')).toBe(true);
      expect(got.some((e) => e.type === 'pickup-spawned' && e.kind.startsWith('xp-'))).toBe(true);
    }
    // Trade wind: an idle ship in a patch drifts with the current.
    const lane = sim.spawnHazard({ kind: 'trade-wind', team: 'player', x: sim.state.player.x + 400, z: sim.state.player.z, radius: 34, ttl: 30, damage: 0, vx: 8, vz: 0 })!;
    run(sim, 2.2);
    sim.debug.teleport(lane.x, lane.z, 0);
    sim.state.player.gear = 0;
    const x0 = sim.state.player.x;
    run(sim, 1);
    expect(sim.state.player.x - x0).toBeGreaterThan(5);
    // Beacon: sailing through blesses the ship.
    const p = sim.state.player;
    sim.spawnHazard({ kind: 'beacon', team: 'player', x: p.x, z: p.z, radius: 22, ttl: 30, damage: 0 });
    const blessed = run(sim, 0.2);
    expect(p.statuses.some((st) => st.kind === 'frenzy' && st.time > 0)).toBe(true);
    expect(blessed.some((e) => e.type === 'director-event' && e.name === "Keeper's Blessing")).toBe(true);
  });

  it('stays deterministic through a set piece', () => {
    const play = (): string => {
      const sim = makeSim('det-events');
      sim.debug.spawnEnemy('skiff', 8);
      run(sim, 0.5, 0.2);
      startEvent(sim, 'kraken-rising');
      run(sim, 8, 0.3);
      startEvent(sim, 'volcanic-eruption');
      run(sim, 6, -0.2);
      return JSON.stringify(sim.state);
    };
    expect(play()).toBe(play());
  });
});
