/**
 * Named bounty captains (FOES-owned): rare named elites with two affixes, heavier hulls and a title (EnemyState.title,
 * shown on nameplates, markers and the minimap). A 'director-event' banner announces them; sinking one pays a big
 * bounty, doubloons and upgrades its elite chest to a captain's chest (boss-size rewards). At most one sails at a time.
 */
import { NAMED_CAPTAINS as N } from '../content/enemies';
import { DIRECTOR } from '../content/director';
import type { EnemyId } from '../ids';
import type { EnemyState, RunState } from '../types';
import type { SimContext } from './context';
import { forceNextAffixCount, foesQa } from './affixes';
import { enemyHpScale, spawnScaled } from './meta-spawn';
import { TAU, fwdX, fwdZ, headingTo, openWaterNear, rand } from './meta-steer';

interface BountyRuntime { next: number; count: number; aliveId: number; used: number; chestX: number; chestZ: number; chestT: number }
const STORES = new WeakMap<RunState, BountyRuntime>();

function runtime(c: SimContext): BountyRuntime {
  let rt = STORES.get(c.state);
  if (!rt) { rt = { next: 0, count: 0, aliveId: 0, used: 0, chestX: 0, chestZ: 0, chestT: -1 }; STORES.set(c.state, rt); }
  return rt;
}

export function updateNamedCaptains(c: SimContext): void {
  const s = c.state;
  const rt = runtime(c);
  const q = foesQa();
  if (q) (q as { spawnNamed?: (id: EnemyId, x: number, z: number) => EnemyState | null }).spawnNamed = (id, x, z) => spawnNamed(c, id, x, z);
  upgradeChest(c, rt);
  if (rt.next === 0) rt.next = rand(c, N.first[0], N.first[1]);
  if (s.time < rt.next || rt.count >= N.max) return;
  const d = s.director;
  const sea = c.content.seas[s.seaId];
  const nextBoss = sea.bosses[d.nextBossIndex];
  const alive = rt.aliveId ? c.findTarget(rt.aliveId) : undefined;
  if (!s.player.alive || d.activeBoss || d.bossWarning || (nextBoss && nextBoss.at - s.time < 40) || (alive && alive.life === 'alive')) {
    rt.next = s.time + 10;
    return;
  }
  const e = spawnNamed(c);
  rt.next = s.time + (e ? rand(c, N.gap[0], N.gap[1]) : 10);
}

/** Picks a class for this sea and minute (bigger ships later), or uses `id`. */
function pickClass(c: SimContext): EnemyId | null {
  const s = c.state;
  const minute = s.time / 60;
  const sea = c.content.seas[s.seaId];
  let total = 0;
  const pool: [EnemyId, number][] = [];
  for (const faction of sea.enemyFactions) {
    for (const [id, from] of N.classes[faction] ?? []) {
      if (from > minute) continue;
      const w = 1 + from;
      pool.push([id, w]);
      total += w;
    }
  }
  if (total <= 0) return null;
  let r = c.random() * total;
  for (const [id, w] of pool) { r -= w; if (r <= 0) return id; }
  return pool[pool.length - 1]![0];
}

function pickName(c: SimContext, faction: string, rt: BountyRuntime): string {
  const names = N.names[faction] ?? N.names.corsair!;
  const offset = faction === 'admiralty' ? 8 : faction === 'wraith' ? 16 : 0;
  let pick = Math.floor(c.random() * names.length);
  for (let k = 0; k < names.length; k++) {
    const i = (pick + k) % names.length;
    if (!(rt.used & (1 << (offset + i)))) { pick = i; break; }
  }
  rt.used |= 1 << (offset + pick);
  return names[pick]!;
}

/** Spawns a named captain (and escorts) on the spawn ring ahead of the player, or at (x, z) for QA. */
export function spawnNamed(c: SimContext, forced?: EnemyId, fx?: number, fz?: number): EnemyState | null {
  const s = c.state, p = s.player;
  const rt = runtime(c);
  const id = forced ?? pickClass(c);
  if (!id) return null;
  const def = c.content.enemies[id];
  let x = fx ?? 0, z = fz ?? 0;
  if (fx === undefined || fz === undefined) {
    let ok = false;
    for (let tries = 0; tries < 10 && !ok; tries++) {
      const a = p.speed > 4 ? p.heading + (c.random() - 0.5) * 2.2 : c.random() * TAU;
      const r = rand(c, 290, 360);
      const spot = openWaterNear(c, p.x + fwdX(a) * r, p.z + fwdZ(a) * r, def.radius + 10, 3);
      if (spot) { x = spot.x; z = spot.z; ok = true; }
    }
    if (!ok) return null;
  }
  const minute = s.time / 60;
  const difficulty = c.content.seas[s.seaId].difficulty;
  const target = N.baseHp * (1 + N.perMinute * minute) * (1 + (difficulty - 1) * 0.5);
  const eliteHp = def.hp * enemyHpScale(c) * DIRECTOR.eliteHp;
  const hpMul = Math.min(3, Math.max(1.5, target / Math.max(1, eliteHp)));
  forceNextAffixCount(c, 2);
  const e = spawnScaled(c, id, x, z, { elite: true, heading: headingTo(p.x - x, p.z - z), hpMul });
  if (!e) { forceNextAffixCount(c, 0); return null; }
  e.title = pickName(c, def.faction, rt);
  rt.aliveId = e.id;
  rt.count++;
  // Escorts sail in with the captain.
  const [escort, n] = N.escorts[def.faction] ?? N.escorts.corsair!;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + c.random() * 0.6, r = def.radius + 22;
    const spot = openWaterNear(c, x + Math.sin(a) * r, z + Math.cos(a) * r, 8, 3);
    if (spot) spawnScaled(c, escort, spot.x, spot.z, { heading: headingTo(p.x - spot.x, p.z - spot.z) });
  }
  const bounty = Math.round(N.bounty * s.director.heat);
  c.emit({ type: 'director-event', name: `Bounty: ${e.title}`, text: `A wanted ${def.name} sails in, ${bounty} bounty on the hull. Sink it for a captain's chest!` });
  return e;
}

/** Called from onAffixDeath when a named captain sinks: bounty, doubloons, and the captain's chest. */
export function onNamedDeath(c: SimContext, e: EnemyState): void {
  const s = c.state;
  const rt = runtime(c);
  const bounty = Math.round(N.bounty * s.director.heat);
  s.stats.bounty += bounty;
  for (let k = 0; k < 3; k++) {
    const a = c.random() * TAU, r = e.radius * (0.5 + c.random());
    c.spawnPickup('doubloon', e.x + Math.sin(a) * r, e.z + Math.cos(a) * r, Math.round(N.doubloons / 3));
  }
  // progression drops the elite chest right after this hook: upgrade it on the next tick.
  rt.chestX = e.x; rt.chestZ = e.z; rt.chestT = s.time;
  if (rt.aliveId === e.id) rt.aliveId = 0;
  c.emit({ type: 'director-event', name: 'Bounty Claimed', text: `${e.title} is sunk. +${bounty} bounty and a captain's chest!` });
}

function upgradeChest(c: SimContext, rt: BountyRuntime): void {
  if (rt.chestT < 0) return;
  for (const k of c.state.pickups) {
    if (!k.alive || k.kind !== 'chest' || k.value >= 2) continue;
    if (Math.abs(k.x - rt.chestX) < 1 && Math.abs(k.z - rt.chestZ) < 1) { k.value = 2; rt.chestT = -1; return; }
  }
  if (c.state.time - rt.chestT > 1) rt.chestT = -1;
}
