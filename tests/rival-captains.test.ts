import { describe, expect, it } from 'vitest';
import { CAPTAIN } from '../src/game/content/captains';
import { defaultProfile } from '../src/game/meta/save';
import { configureCaptains } from '../src/game/sim/captains';
import { isHostile, playerHitCaptain } from '../src/game/sim/captains-rival';
import type { SimContext } from '../src/game/sim/context';
import { Sim } from '../src/game/sim/Sim';
import type { CaptainState, CircleHit, IslandDef, SimEvent, WorldQuery } from '../src/game/types';

function openSea(): WorldQuery {
  return {
    seed: 'open',
    islandsNear: (_x, _z, _r, out: IslandDef[] = []) => { out.length = 0; return out; },
    collideCircle: (): CircleHit => ({ hit: false, nx: 0, nz: 0, depth: 0 }),
    isWater: () => true,
    shoreDistance: (_x, _z, max) => max,
  };
}

/** A sim with one AI captain afloat and the fleet cleared every tick. */
function withCaptain(seed = 'rival'): { sim: Sim; k: CaptainState; events: SimEvent[]; step: (seconds: number, each?: () => void) => void } {
  const sim = new Sim({ seed, shipId: 'sunlion', seaId: 'sunward-shallows', meta: defaultProfile(), world: openSea() });
  sim.debug.god(true);
  sim.state.player.weapons.length = 0;
  configureCaptains(sim.state, 1);
  const events: SimEvent[] = [];
  const step = (seconds: number, each?: () => void): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      for (const e of sim.state.enemies) e.life = 'dead';
      each?.();
      sim.stepTicks(1);
      while (sim.state.status === 'levelup') sim.chooseCard(0);
      for (const e of sim.drainEvents()) events.push(e);
    }
  };
  step(CAPTAIN.joinAt[0]! + 3);
  const k = sim.state.captains[0]!;
  return { sim, k, events, step };
}

const ctx = (sim: Sim): SimContext => sim as unknown as SimContext;

describe('rival captains', () => {
  it('take the player\'s damage, and turn hostile once provoked', () => {
    const { sim, k, events, step } = withCaptain();
    expect(k.alive).toBe(true);
    const hp0 = k.hp;
    const dealt = playerHitCaptain(ctx(sim), k, 10);
    expect(dealt).toBeGreaterThan(0);
    expect(k.hp).toBeLessThan(hp0);
    expect(isHostile(k)).toBe(false); // a stray hit is not a declaration of war
    playerHitCaptain(ctx(sim), k, k.maxHp * 0.5);
    expect(isHostile(k)).toBe(true);
    step(0.1);
    expect(events.some((e) => e.type === 'captain-hostile' && e.id === k.id && e.reason === 'provoked')).toBe(true);
  });

  it('a hostile captain fires team-enemy shots at the player, and calms down after its grudge', () => {
    const { sim, k, events, step } = withCaptain('rival-fire');
    playerHitCaptain(ctx(sim), k, k.maxHp * 0.5);
    const p = sim.state.player;
    let enemyShots = 0;
    // Park the captain 90 m off the player's starboard beam, broadside-on.
    step(3, () => {
      k.x = p.x + Math.cos(p.heading) * 90; k.z = p.z - Math.sin(p.heading) * 90; k.heading = p.heading; k.vx = 0; k.vz = 0; k.speed = 0;
      for (const pr of sim.state.projectiles) if (pr.alive && pr.team === 'enemy' && pr.kind === 'cannonball') enemyShots++;
    });
    expect(enemyShots).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'player-hit' && (e.source ?? 0) < 0)).toBe(true);
    step(CAPTAIN.rival.grudge + 1, () => { k.x = p.x + 400; k.z = p.z; });
    expect(isHostile(k)).toBe(false);
    expect(events.some((e) => e.type === 'captain-calm' && e.id === k.id)).toBe(true);
  });

  it('sinking a rival pays out and (when it holds a grudge) it sails back in for revenge', () => {
    const { sim, k, events, step } = withCaptain('rival-sink');
    k.bounty = 1000;
    const bounty0 = sim.state.stats.bounty;
    const chests0 = sim.state.pickups.filter((q) => q.alive && q.kind === 'chest').length;
    playerHitCaptain(ctx(sim), k, 1e6);
    expect(k.alive).toBe(false);
    expect(sim.state.stats.bounty).toBe(bounty0 + Math.round(1000 * CAPTAIN.rival.bountyShare));
    expect(sim.state.pickups.filter((q) => q.alive && q.kind === 'chest').length).toBe(chests0 + 1);
    step(0.1);
    expect(events.some((e) => e.type === 'captain-sunk' && e.id === k.id && e.byPlayer === true)).toBe(true);
    k.ai.revenge = 1; // CAPTAIN.rival.revengeChance
    step(CAPTAIN.respawn + 1);
    expect(k.alive).toBe(true);
    expect(isHostile(k)).toBe(true);
    expect(events.some((e) => e.type === 'captain-hostile' && e.id === k.id && e.reason === 'revenge')).toBe(true);
  });

  it('the player\'s broadside hits a hostile captain alongside', () => {
    const { sim, k, step } = withCaptain('rival-broadside');
    sim.debug.giveWeapon('broadside', 3);
    playerHitCaptain(ctx(sim), k, k.maxHp * 0.5);
    expect(isHostile(k)).toBe(true);
    k.hp = k.maxHp;
    const p = sim.state.player;
    step(4, () => {
      k.x = p.x - Math.cos(p.heading) * 80; k.z = p.z + Math.sin(p.heading) * 80; k.heading = p.heading; k.vx = 0; k.vz = 0; k.speed = 0;
      k.ai.grudge = CAPTAIN.rival.grudge;
    });
    expect(k.hp).toBeLessThan(k.maxHp);
  });

  it('stray auto-fire passes through a captain that is not fighting the player', () => {
    const { sim, k, step } = withCaptain('rival-stray');
    sim.debug.giveWeapon('broadside', 3);
    const p = sim.state.player;
    // An enemy dummy right behind the captain on the player's beam: the auto broadside fires through the captain.
    const e = sim.spawnEnemy('brig', 0, 0)!;
    const hp0 = k.maxHp;
    let fired = 0, playerHits = 0;
    for (let i = 0; i < 4 * 60; i++) {
      k.x = p.x - Math.cos(p.heading) * 70; k.z = p.z + Math.sin(p.heading) * 70; k.heading = p.heading; k.vx = 0; k.vz = 0; k.speed = 0; k.hp = hp0;
      e.x = p.x - Math.cos(p.heading) * 110; e.z = p.z + Math.sin(p.heading) * 110; e.vx = 0; e.vz = 0; e.hp = 1e7; e.maxHp = 1e7; e.attackCooldown = 1e9; e.life = 'alive';
      for (const o of sim.state.enemies) if (o !== e) o.life = 'dead';
      sim.stepTicks(1);
      while (sim.state.status === 'levelup') sim.chooseCard(0);
      for (const ev of sim.drainEvents()) {
        if (ev.type === 'weapon-fired' && ev.owner === 0) fired++;
        if (ev.type === 'projectile-hit' && ev.team === 'player' && ev.targetId === k.id) playerHits++;
      }
    }
    expect(playerHits).toBe(0);
    expect(fired).toBeGreaterThan(0);
    expect(isHostile(k)).toBe(false);
  });
});
