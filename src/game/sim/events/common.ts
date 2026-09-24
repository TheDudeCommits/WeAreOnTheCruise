/**
 * Shared set-piece helpers (EVENTS): public state and verdicts, payouts, area damage that hurts both sides, event
 * spawns and open-water placement. Allocation-free on the per-tick paths (reused option objects).
 */
import { SOFT_ENEMY_CAP } from '../../constants';
import { DIRECTOR_EVENTS, EVENT_TUNING, type DirectorEventId } from '../../content/director';
import { COIN_TIERS } from '../../content/rewards';
import type { EnemyId, PickupKind, StatusKind } from '../../ids';
import type { EnemyState, WorldEventState } from '../../types';
import type { DamageOpts, SimContext, Target } from '../context';
import { hullEdge } from '../core-runtime';
import { bossDamage, enemyHpScale, spawnScaled } from '../meta-spawn';
import { TAU, headingTo, openWaterNear } from '../meta-steer';
import { OUTCOME_FAIL, OUTCOME_NONE, OUTCOME_SUCCESS, type EventRuntime } from './runtime';

// ───────────────────────── Public state and verdicts ─────────────────────────

/** A fresh public state for the HUD tracker, minimap ring and effects. */
export function openEvent(id: DirectorEventId, text: string, duration: number, goal?: number): WorldEventState {
  const ev: WorldEventState = { id, name: DIRECTOR_EVENTS[id].name, text, time: 0, duration };
  if (goal !== undefined) { ev.progress = 0; ev.goal = goal; }
  return ev;
}

/** Sets the event's world anchor (minimap ring, markers, effects). */
export function anchor(ev: WorldEventState, x: number, z: number, radius: number): void {
  ev.x = x; ev.z = z; ev.radius = radius;
}

/**
 * Decides the objective: 'world-event' success/fail for the tracker flourish plus a director-event banner. The set
 * piece may keep running physically (a wave still rolling) until its handler calls complete().
 */
export function resolve(c: SimContext, rt: EventRuntime, outcome: number, banner: string, text: string): void {
  if (rt.outcome !== OUTCOME_NONE || !rt.ev) return;
  rt.outcome = outcome;
  rt.outcomeAt = rt.t;
  const ev = rt.ev;
  if (outcome !== OUTCOME_SUCCESS && outcome !== OUTCOME_FAIL) return;
  c.emit({ type: 'world-event', id: ev.id, phase: outcome === OUTCOME_SUCCESS ? 'success' : 'fail', name: ev.name, text, x: ev.x, z: ev.z });
  if (banner) c.emit({ type: 'director-event', name: banner, text });
}

export const succeeded = (rt: EventRuntime): boolean => rt.outcome === OUTCOME_SUCCESS;
export const undecided = (rt: EventRuntime): boolean => rt.outcome === OUTCOME_NONE;

// ───────────────────────── Payouts ─────────────────────────

/** Spills `value` XP as gold/silver/copper treasure around (x, z). */
export function spillTreasure(c: SimContext, x: number, z: number, value: number, spread: number, maxPieces = 6): void {
  let v = value, pieces = 0;
  while (v > 1e-6 && pieces < maxPieces) {
    let amount: number;
    if (pieces === maxPieces - 1) amount = v;
    else if (v >= COIN_TIERS.gold) amount = COIN_TIERS.gold;
    else if (v >= COIN_TIERS.silver) amount = COIN_TIERS.silver;
    else amount = Math.min(1, v);
    const kind: PickupKind = amount >= COIN_TIERS.gold ? 'xp-gold' : amount >= COIN_TIERS.silver ? 'xp-silver' : 'xp-copper';
    const a = c.random() * TAU, r = pieces === 0 ? 0 : spread * (0.4 + c.random() * 0.6);
    c.spawnPickup(kind, x + Math.sin(a) * r, z + Math.cos(a) * r, amount);
    v -= amount;
    pieces++;
  }
}

/** Doubloons in a few pieces around (x, z). */
export function spillDoubloons(c: SimContext, x: number, z: number, total: number, spread: number): void {
  if (total <= 0) return;
  const pieces = Math.max(1, Math.min(4, Math.round(total / 4)));
  const each = Math.max(1, Math.round(total / pieces));
  for (let k = 0; k < pieces; k++) {
    const a = c.random() * TAU, r = spread * (0.3 + c.random() * 0.7);
    c.spawnPickup('doubloon', x + Math.sin(a) * r, z + Math.cos(a) * r, each);
  }
}

/** A set piece's reward: XP treasure (minute-scaled × `xpMul`), doubloons, an optional chest and bounty. */
export function payout(c: SimContext, x: number, z: number, doubloons: number, chest: 0 | 1 | 2, xpMul = 1, spread = 16): void {
  const minute = c.state.time / 60;
  spillTreasure(c, x, z, EVENT_TUNING.rewardXp(minute) * xpMul, spread);
  spillDoubloons(c, x, z, doubloons, spread * 1.2);
  if (chest > 0) c.spawnPickup('chest', x, z, chest);
  c.state.stats.bounty += Math.round(EVENT_TUNING.successBounty * c.state.director.heat);
}

// ───────────────────────── Damage (both sides) ─────────────────────────

export interface BlastOpts {
  /** Metres of knockback for ships (bosses never move). */
  knock?: number;
  /** Status for ships hit (e.g. stunned 1 s). */
  status?: StatusKind;
  statusTime?: number;
  /** Burning damage per second for 3 s on everything hit (player included). */
  burn?: number;
  /** Share of `shipDamage` bosses take (default 0.25). */
  bossMul?: number;
  /** Never hurts this class (the kraken's own arms). */
  skip?: EnemyId;
}

const NO_BLAST: BlastOpts = {};
const DMG: DamageOpts = {};
const DMG_STATUS = { kind: 'stunned' as StatusKind, time: 0, magnitude: 1 };

/** Player damage for set pieces: boss-scaled (the fleet's damage curve at half strength). */
export const eventPlayerDamage = (c: SimContext, base: number): number => bossDamage(c, base);
/** Ship damage for set pieces: grows with enemy HP so a slam stays a slam all run. */
export const eventShipDamage = (c: SimContext, base: number): number => base * enemyHpScale(c);

/** Hurts the player if its hull touches the circle. Returns true on a hit. */
export function hurtPlayerIn(c: SimContext, x: number, z: number, radius: number, damage: number, burn = 0): boolean {
  const p = c.state.player;
  if (!p.alive || damage <= 0 || hullEdge(p, x, z) > radius) return false;
  c.damagePlayer(damage, { x, z, kind: 'hazard' });
  if (burn > 0 && p.airborne < 0.2 && p.submerged < 0.5) c.applyStatus(p, 'burning', 3, burn);
  return true;
}

/** Damages one ship with the blast options. */
export function hurtShip(c: SimContext, t: Target, damage: number, fromX: number, fromZ: number, o: BlastOpts = NO_BLAST): void {
  const boss = 'phase' in t;
  DMG.knockback = boss ? 0 : o.knock ?? 0;
  DMG.fromX = fromX; DMG.fromZ = fromZ;
  if (o.status && !boss) { DMG_STATUS.kind = o.status; DMG_STATUS.time = o.statusTime ?? 1; DMG.status = DMG_STATUS; } else DMG.status = undefined;
  c.damageTarget(t, damage * (boss ? o.bossMul ?? 0.25 : 1), DMG);
  if (o.burn && t.life === 'alive') c.applyStatus(t, 'burning', 3, o.burn * (boss ? 0.25 : 1));
}

/** Damages the player and every ship touching the circle. Returns the number of ships hit. */
export function blastCircle(c: SimContext, rt: EventRuntime, x: number, z: number, radius: number, playerDamage: number, shipDamage: number, o: BlastOpts = NO_BLAST): number {
  hurtPlayerIn(c, x, z, radius, playerDamage, o.burn ?? 0);
  if (shipDamage <= 0) return 0;
  const near = c.targetsNear(x, z, radius, rt.targets);
  let hits = 0;
  for (let i = 0; i < near.length; i++) {
    const t = near[i]!;
    if (t.life !== 'alive' || (o.skip && !('phase' in t) && t.defId === o.skip)) continue;
    const dx = t.x - x, dz = t.z - z, rr = radius + t.radius * 0.7;
    if (dx * dx + dz * dz > rr * rr) continue;
    hurtShip(c, t, shipDamage, x, z, o);
    hits++;
  }
  return hits;
}

/**
 * Damages everything in a strip starting at (x, z) along heading `angle` (forward = (−sin, −cos)), `length` long and
 * `halfWidth` to each side. Returns the number of ships hit.
 */
export function blastLine(c: SimContext, rt: EventRuntime, x: number, z: number, angle: number, length: number, halfWidth: number,
  playerDamage: number, shipDamage: number, o: BlastOpts = NO_BLAST): number {
  const dx = -Math.sin(angle), dz = -Math.cos(angle);
  const p = c.state.player;
  if (playerDamage > 0 && p.alive) {
    const rx = p.x - x, rz = p.z - z;
    const along = rx * dx + rz * dz, lat = Math.abs(rx * dz - rz * dx);
    if (along > -p.beam && along < length + p.beam && lat < halfWidth + p.beam * 0.6) {
      c.damagePlayer(playerDamage, { x: x + dx * Math.max(0, Math.min(length, along)), z: z + dz * Math.max(0, Math.min(length, along)), kind: 'hazard' });
    }
  }
  if (shipDamage <= 0) return 0;
  const mx = x + dx * length * 0.5, mz = z + dz * length * 0.5;
  const near = c.targetsNear(mx, mz, length * 0.5 + halfWidth, rt.targets);
  let hits = 0;
  for (let i = 0; i < near.length; i++) {
    const t = near[i]!;
    if (t.life !== 'alive' || (o.skip && !('phase' in t) && t.defId === o.skip)) continue;
    const rx = t.x - x, rz = t.z - z;
    const along = rx * dx + rz * dz, lat = Math.abs(rx * dz - rz * dx);
    if (along < -t.radius || along > length + t.radius || lat > halfWidth + t.radius * 0.7) continue;
    hurtShip(c, t, shipDamage, t.x - dz * (rx * dz - rz * dx > 0 ? 1 : -1), t.z + dx * (rx * dz - rz * dx > 0 ? 1 : -1), o);
    hits++;
  }
  return hits;
}

// ───────────────────────── Spawns and placement ─────────────────────────

/** Event spawns stop a little above the soft cap (META's director uses the same headroom). */
const EVENT_CAP = SOFT_ENEMY_CAP + 18;

export interface EventSpawnOpts { heading?: number; hpMul?: number; elite?: boolean; margin?: number; force?: boolean }
const NO_SPAWN: EventSpawnOpts = {};

/** Spawns a heat-scaled enemy in open water near (x, z), facing the player unless told otherwise. */
export function eventSpawn(c: SimContext, id: EnemyId, x: number, z: number, o: EventSpawnOpts = NO_SPAWN): EnemyState | null {
  if (!o.force && c.state.enemies.length >= EVENT_CAP) return null;
  const def = c.content.enemies[id];
  if (!def) return null;
  const spot = openWaterNear(c, x, z, def.radius + (o.margin ?? 5), 4);
  if (!spot) return null;
  const sx = spot.x, sz = spot.z;
  const p = c.state.player;
  return spawnScaled(c, id, sx, sz, { heading: o.heading ?? headingTo(p.x - sx, p.z - sz), hpMul: o.hpMul, elite: o.elite });
}

const SPOT = { x: 0, z: 0 };

/**
 * An open-water point `dist` m from (x, z), trying `tries` bearings around `bearing` (±spread, widening). Uses the
 * heading convention (forward = (−sin, −cos)). Returns null when every candidate is crowded by land.
 */
export function openSpot(c: SimContext, x: number, z: number, bearing: number, dist: number, margin: number, spread = 1.2, tries = 10): typeof SPOT | null {
  for (let k = 0; k < tries; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const a = bearing + side * Math.ceil(k / 2) * (spread / Math.max(1, tries / 2));
    const r = dist * (1 + (k % 3) * 0.08);
    const px = x - Math.sin(a) * r, pz = z - Math.cos(a) * r;
    if (c.world.isWater(px, pz, margin)) { SPOT.x = px; SPOT.z = pz; return SPOT; }
  }
  return null;
}

/** The player's bearing of travel (its heading when under way, else a random one). */
export function travelBearing(c: SimContext): number {
  const p = c.state.player;
  return p.speed > 3 ? p.heading : c.random() * TAU;
}

/** Counts the event's live enemies whose id is in `ids[0..n)`. */
export function countAlive(c: SimContext, ids: Int32Array, n: number): number {
  let alive = 0;
  for (let i = 0; i < n; i++) {
    const t = c.findTarget(ids[i]!);
    if (t && t.life === 'alive') alive++;
  }
  return alive;
}
