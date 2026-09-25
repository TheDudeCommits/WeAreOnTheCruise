/**
 * Rival captains (lead, 2026-09-25 — owner: "the AI captains play like rival players"). Tuning: CAPTAIN.rival.
 *
 *  - The player's shots, shells and rams hurt captains (projectiles.ts hitShips / explode, captains-collide.ts), at
 *    CAPTAIN.rival.playerDamageMul. Captains' own shots never hit each other.
 *  - Provocation: a captain the player knocks provokeShare of its hull off (the tally decays) turns hostile for
 *    `grudge` seconds, refreshed by every further hit: it hunts the player (captains-steer.ts), turns its broadside
 *    and bow chaser on the player (captains-guns.ts, team-'enemy' shots tagged with the captain's ref) and the
 *    player's auto-aim takes it as a target (broadside scanSides).
 *  - Opportunists: a captain near a badly holed player may turn on it (one hostile opportunist at a time).
 *  - Sinking a rival pays out XP coins, doubloons, a chest and a share of its bounty; it sails back in for revenge.
 *
 * Captain AI scratch used here: grudge (s left hostile) · provoke (player damage tally) · ramCd · revenge (1 = sails
 * back in hostile).
 */
import { CAPTAIN } from '../content/captains';
import type { CaptainState, ProjectileState } from '../types';
import { captainHullEdge, hurtCaptain } from './captains-damage';
import type { SimContext } from './context';
import { spillCoins } from './progression';

const R = CAPTAIN.rival;
const RETREAT = 2;

/** True while `k` is afloat and fighting the player. */
export const isHostile = (k: CaptainState): boolean => k.alive && (k.ai.grudge ?? 0) > 0;

/** Turns `k` on the player for at least `time` seconds (announced once per grudge). */
export function turnHostile(c: SimContext, k: CaptainState, reason: 'provoked' | 'opportunist' | 'revenge', time: number): void {
  const ai = k.ai;
  const was = (ai.grudge ?? 0) > 0;
  ai.grudge = Math.max(ai.grudge ?? 0, time);
  if (was) return;
  ai.tgt = 0; ai.tgtT = 0;
  c.emit({ type: 'captain-hostile', id: k.id, name: k.name, reason });
}

/** Damage from the player to a captain (already scaled by the player's stats). Returns the hull it took. */
export function playerHitCaptain(c: SimContext, k: CaptainState, amount: number): number {
  if (!k.alive || !(amount > 0)) return 0;
  const ai = k.ai;
  const dealt = hurtCaptain(c, k, amount * R.playerDamageMul, true);
  if (!(dealt > 0)) return 0;
  c.state.stats.damageDealt += dealt;
  if (!k.alive) { rewardRival(c, k); return dealt; }
  ai.provoke = (ai.provoke ?? 0) + dealt;
  if ((ai.grudge ?? 0) > 0) ai.grudge = Math.max(ai.grudge!, R.grudge);
  else if (ai.provoke >= k.maxHp * R.provokeShare) turnHostile(c, k, 'provoked', R.grudge);
  return dealt;
}

/** The player sank a rival: XP coins, doubloons, a chest and a share of its bounty; it will come back for revenge. */
function rewardRival(c: SimContext, k: CaptainState): void {
  const s = c.state;
  spillCoins(c, k.x, k.z, R.xp + R.xpPerLevel * k.level, k.length * 0.3);
  const coins = Math.max(3, Math.round(R.doubloons + R.doubloonsPerLevel * k.level));
  for (let i = 0; i < 3; i++) {
    const a = c.random() * Math.PI * 2, r = k.length * (0.2 + c.random() * 0.3);
    c.spawnPickup('doubloon', k.x + Math.sin(a) * r, k.z + Math.cos(a) * r, Math.round(coins / 3));
  }
  c.spawnPickup('chest', k.x, k.z, 1);
  const share = Math.round(k.bounty * R.bountyShare);
  k.bounty -= share;
  s.stats.bounty += share;
  k.ai.revenge = 1;
  k.ai.provoke = 0;
}

/** Per tick for an afloat captain (captains.ts): grudge countdown, provocation decay, opportunists. */
export function updateRivalry(c: SimContext, k: CaptainState): void {
  const ai = k.ai, dt = c.dt, p = c.state.player;
  ai.ramCd = Math.max(0, (ai.ramCd ?? 0) - dt);
  if ((ai.provoke ?? 0) > 0) ai.provoke = Math.max(0, ai.provoke! - k.maxHp * R.provokeDecay * dt);
  if ((ai.grudge ?? 0) > 0) {
    ai.grudge = p.alive ? ai.grudge! - dt : 0;
    if (ai.grudge <= 0) { ai.grudge = 0; ai.tgtT = 0; c.emit({ type: 'captain-calm', id: k.id, name: k.name }); }
    return;
  }
  if (!p.alive || p.hp > p.maxHp * R.opportunistHull || ai.mode === RETREAT || (ai.grace ?? 0) > 0) return;
  const caps = c.state.captains;
  for (let i = 0; i < caps.length; i++) if (caps[i] !== k && isHostile(caps[i]!)) return;
  if (Math.hypot(p.x - k.x, p.z - k.z) > R.opportunistRange) return;
  if (c.random() < R.opportunist * dt) turnHostile(c, k, 'opportunist', R.grudge);
}

/** A sunk captain sails back in: hostile for a while if the player sank it. */
export function onCaptainRespawn(c: SimContext, k: CaptainState): void {
  k.ai.grudge = 0; k.ai.provoke = 0;
  if (k.ai.revenge === 1) { k.ai.revenge = 0; turnHostile(c, k, 'revenge', R.revenge); }
}

/**
 * A player projectile's swept segment (x0,z0) → (pr.x,pr.z) against the captains. Returns the first captain it
 * touches (not yet in pr.hits), or null.
 */
export function captainInPath(c: SimContext, pr: ProjectileState, x0: number, z0: number): CaptainState | null {
  const caps = c.state.captains;
  const sx = pr.x - x0, sz = pr.z - z0, seg2 = sx * sx + sz * sz;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (!k.alive || (k.ai.fade ?? 99) < 0.6) continue;
    if (pr.hits.length > 0 && pr.hits.includes(k.id)) continue;
    let u = seg2 > 1e-9 ? ((k.x - x0) * sx + (k.z - z0) * sz) / seg2 : 1;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = x0 + sx * u, qz = z0 + sz * u;
    const dx = qx - k.x, dz = qz - k.z, reach = k.length * 0.5 + pr.radius + 2;
    if (dx * dx + dz * dz > reach * reach) continue;
    if (captainHullEdge(k, qx, qz) <= pr.radius) return k;
  }
  return null;
}

/** A player blast at (x, z): falloff like CORE's explode (100% at the centre → 50% at the rim, to the hull edge). */
export function playerBlastCaptains(c: SimContext, x: number, z: number, radius: number, damage: number): void {
  const caps = c.state.captains;
  if (caps.length === 0 || !(damage > 0)) return;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (!k.alive) continue;
    const edge = captainHullEdge(k, x, z);
    if (edge > radius) continue;
    playerHitCaptain(c, k, damage * (1 - 0.5 * Math.min(1, Math.max(0, edge) / Math.max(1, radius))));
  }
}

/** The player's hull ramming a captain at `closing` m/s (captains-collide.ts). */
export function playerRamCaptain(c: SimContext, k: CaptainState, closing: number): void {
  if (closing < 4 || (k.ai.ramCd ?? 0) > 0) return;
  k.ai.ramCd = R.ramCooldown;
  const mass = c.content.ships[c.state.player.shipId].mass;
  playerHitCaptain(c, k, R.ram * closing * Math.sqrt(mass / 600));
}
