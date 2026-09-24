/**
 * AI captains take damage (CAPTAINS-owned): enemy shots, mortar impacts, explosions, fire-ship blasts, enemy hazards
 * and hull contacts all reach captains through the small hooks listed below, with the player's hit rules (80% hull
 * hitbox, flat armour with a 25% floor). A captain at 0 hull sinks, emits 'captain-sunk' and sails back in after
 * CAPTAIN.respawn seconds (captains.ts).
 *
 * Hooks (minimal additive edits in CORE/META files):
 *   projectiles.ts  updateProjectiles → shotVsCaptains (flat enemy shots) · land → blastCaptains (enemy shells)
 *                   explode → blastCaptains (enemy explosions)
 *   hazards.ts      tickArea → areaVsCaptains · updateWhirlpool → whirlVsCaptains · updateShockwave → ringVsCaptains
 *                   updateWaveFront → frontVsCaptains
 *   ai.ts           detonate → fireBlastCaptains (fire-ship blast)
 *   collisions.ts   resolveCollisions → resolveCaptainCollisions (captains-collide.ts, contact damage)
 */
import { CAPTAIN } from '../content/captains';
import type { CaptainState, HazardState, ProjectileState } from '../types';
import type { SimContext } from './context';
import { captainRuntime } from './captains-runtime';

/** Incoming fire hits a captain's hull at 80% of its size, like the player's (core-runtime PLAYER_HITBOX). */
const HITBOX = 0.8;

/** Distance from (x, z) to the edge of a captain's hitbox (≤ 0 inside): keel segment + half-beam, scaled. */
export function captainHullEdge(k: CaptainState, x: number, z: number): number {
  const fx = -Math.sin(k.heading), fz = -Math.cos(k.heading);
  const half = Math.max(0, k.length * 0.5 - k.beam * 0.5) * HITBOX;
  const ax = k.x - fx * half, az = k.z - fz * half;
  const ex = fx * 2 * half, ez = fz * 2 * half;
  const len2 = ex * ex + ez * ez;
  let t = len2 > 1e-6 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0.5;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x - (ax + ex * t), dz = z - (az + ez * t);
  return Math.sqrt(dx * dx + dz * dz) - k.beam * 0.5 * HITBOX;
}

/** Applies armour and spawn protection; sinks the captain at 0. Returns the damage taken. */
export function hurtCaptain(c: SimContext, k: CaptainState, amount: number): number {
  if (!k.alive || !(amount > 0)) return 0;
  const ai = k.ai;
  if ((ai.grace ?? 0) > 0) return 0;
  const armor = c.content.ships[k.shipId].armor + k.level * CAPTAIN.armorPerLevel;
  const value = Math.max(amount * 0.25, amount - armor);
  k.hp -= value;
  k.hitFlash = 1;
  ai.sinceHit = 0;
  ai.dmgAcc = (ai.dmgAcc ?? 0) + value;
  ai.taken = (ai.taken ?? 0) + value;
  if (k.hp <= 0) sinkCaptain(c, k);
  return value;
}

/** Emits the summed 'damage' number for a captain (negative target id) and resets the sum. */
export function flushCaptainDamage(c: SimContext, k: CaptainState): void {
  const ai = k.ai;
  if (!(ai.dmgAcc! > 0)) return;
  c.emit({ type: 'damage', target: k.id, amount: ai.dmgAcc!, crit: false, x: k.x, y: 4, z: k.z });
  ai.dmgAcc = 0;
  ai.dmgT = CAPTAIN.damageTick;
}

function sinkCaptain(c: SimContext, k: CaptainState): void {
  const ai = k.ai;
  flushCaptainDamage(c, k);
  k.hp = 0;
  k.alive = false;
  k.respawn = CAPTAIN.respawn;
  k.statuses.length = 0;
  ai.mode = 0; ai.tgt = 0; ai.ripLeft = 0; ai.sinkT = 0; ai.sunk = (ai.sunk ?? 0) + 1;
  captainRuntime(c.state).sinkings++;
  c.emit({ type: 'captain-sunk', id: k.id, name: k.name, x: k.x, z: k.z });
}

/** A flat enemy shot against every captain (projectiles.ts). Returns true when the shot is spent. */
export function shotVsCaptains(c: SimContext, pr: ProjectileState): boolean {
  const caps = c.state.captains;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (!k.alive) continue;
    const dx = pr.x - k.x, dz = pr.z - k.z, reach = k.length * 0.5 + pr.radius + 2;
    if (dx * dx + dz * dz > reach * reach || captainHullEdge(k, pr.x, pr.z) > pr.radius) continue;
    const dealt = hurtCaptain(c, k, pr.damage);
    c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: pr.y, z: pr.z, target: 'ship', targetId: k.id, damage: dealt, crit: false });
    if (pr.area > 0) c.emit({ type: 'explosion', x: pr.x, z: pr.z, radius: pr.area, kind: 'medium', team: pr.team });
    pr.alive = false;
    return true;
  }
  return false;
}

/** An enemy blast (mortar shell landing, explosion) against every captain: full damage inside the radius. */
export function blastCaptains(c: SimContext, x: number, z: number, radius: number, damage: number): void {
  const caps = c.state.captains;
  if (caps.length === 0 || !(damage > 0)) return;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (k.alive && captainHullEdge(k, x, z) <= radius) hurtCaptain(c, k, damage);
  }
}

/** Fire-ship blast (ai.ts detonate): the player's falloff (100% at the centre → 60% at the reach). */
export function fireBlastCaptains(c: SimContext, x: number, z: number, radius: number, damage: number): void {
  const caps = c.state.captains;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (!k.alive) continue;
    const d = Math.hypot(k.x - x, k.z - z), reach = radius + k.radius * 0.5;
    if (d <= reach) hurtCaptain(c, k, damage * (1 - 0.4 * Math.min(1, d / reach)));
  }
}

/** Enemy area hazard tick (fire patches, burning wrecks). */
export function areaVsCaptains(c: SimContext, h: HazardState): void {
  blastCaptains(c, h.x, h.z, h.radius, h.damage);
}

/** Enemy whirlpool: pulls captains toward its centre and grinds them on each tick. */
export function whirlVsCaptains(c: SimContext, h: HazardState, pull: number, grind: boolean): void {
  const caps = c.state.captains;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (!k.alive) continue;
    const dx = h.x - k.x, dz = h.z - k.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d >= h.radius || d < 1e-3) continue;
    k.vx += (dx / d) * pull * 0.6 * c.dt; k.vz += (dz / d) * pull * 0.6 * c.dt;
    if (grind) hurtCaptain(c, k, h.damage);
  }
}

/** Enemy shockwave ring (radius `cur` this tick): hits each captain once per hazard (`hits` holds ship refs). */
export function ringVsCaptains(c: SimContext, h: HazardState, cur: number, hits: number[]): void {
  const caps = c.state.captains;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (!k.alive || hits.includes(k.id) || captainHullEdge(k, h.x, h.z) > cur) continue;
    hits.push(k.id);
    hurtCaptain(c, k, h.damage);
  }
}

/** Enemy wave front (rogue waves, boss slam waves): hits each captain once and carries it along. */
export function frontVsCaptains(c: SimContext, h: HazardState, dirX: number, dirZ: number, band: number, speed: number, hits: number[]): void {
  const caps = c.state.captains;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (!k.alive) continue;
    const rx = k.x - h.x, rz = k.z - h.z;
    if (Math.abs(rx * dirX + rz * dirZ) > band + k.beam || Math.abs(rx * dirZ - rz * dirX) > h.radius + k.length * 0.5) continue;
    if (!hits.includes(k.id)) { hits.push(k.id); hurtCaptain(c, k, h.damage); }
    k.vx += dirX * speed * 0.5 * c.dt; k.vz += dirZ * speed * 0.5 * c.dt;
  }
}
