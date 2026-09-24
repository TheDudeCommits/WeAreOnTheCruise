/**
 * Shared weapon helpers (CORE-owned): level lookup, effective stats, crit rolls, lead aiming, target selection,
 * cluster finding and ballistic shells. Module-level scratch objects keep the hot paths allocation-free; they are
 * only valid until the next call (weapons run one at a time).
 *
 * Branch / overdrive parameters read optional `extra` keys from the content level table (META tunes them) and
 * fall back to the documented defaults, e.g. `ex(level, 'bomblets', 3)`.
 */
import type { WeaponLevelDef, WeaponSlot } from '../../types';
import type { Target } from '../context';
import { GRAVITY, acquirable, type CoreSim } from '../core-runtime';
import {
  areaMul, cooldownMul, critChance, critMultiplier, damageMul, durationMul, extraAmount, projectileSpeedMul, rangeMul,
} from '../stats';
import type { ProjectileKind, WeaponId } from '../../ids';

export const DEG = Math.PI / 180;

export function levelOf(c: CoreSim, slot: WeaponSlot): WeaponLevelDef {
  const levels = c.content.weapons[slot.id].levels;
  const i = Math.min(levels.length, Math.max(1, slot.level)) - 1;
  return levels[i]!;
}

/** Optional per-level tuning parameter from content (`extra`), with a default. */
export function ex(l: WeaponLevelDef, key: string, fallback: number): number {
  const v = l.extra?.[key];
  return v === undefined ? fallback : v;
}

/** Effective stats for the weapon being updated (valid until the next `eff` call). */
export const E = { damage: 0, cooldown: 0, range: 0, area: 0, speed: 0, duration: 0, count: 0 };

export function eff(c: CoreSim, l: WeaponLevelDef, defArea: number, defSpeed: number, defDuration: number): typeof E {
  const s = c.state.player.stats;
  E.damage = l.damage * damageMul(s);
  E.cooldown = l.cooldown * cooldownMul(s);
  E.range = l.range * rangeMul(s);
  E.area = (l.area ?? defArea) * areaMul(s);
  E.speed = (l.speed ?? defSpeed) * projectileSpeedMul(s);
  E.duration = (l.duration ?? defDuration) * durationMul(s);
  E.count = Math.max(1, l.count + extraAmount(s));
  return E;
}

/** Crit roll with the player's stats (allocation-free twin of stats.rollCrit). */
export const CRIT = { on: false };
export function crit(c: CoreSim): number {
  const s = c.state.player.stats;
  CRIT.on = c.random() < critChance(s);
  return CRIT.on ? critMultiplier(s) : 1;
}

/** Intercept point for a shot of `speed` from (sx,sz) at a target moving with its current velocity. */
export const AIM = { x: 0, z: 0, t: 0 };
export function lead(sx: number, sz: number, t: Target, speed: number): typeof AIM {
  let tx = t.x, tz = t.z, time = 0;
  for (let i = 0; i < 2; i++) {
    const dx = tx - sx, dz = tz - sz;
    time = Math.sqrt(dx * dx + dz * dz) / Math.max(1, speed);
    if (time > 3) time = 3;
    tx = t.x + t.vx * time; tz = t.z + t.vz * time;
  }
  AIM.x = tx; AIM.z = tz; AIM.t = time;
  return AIM;
}

function insertSel(c: CoreSim, t: Target, d: number, count: number, k: number): number {
  const sel = c.core.sel, selD = c.core.selD;
  if (count === k && d >= selD[k - 1]!) return count;
  let i = count < k ? count : k - 1;
  while (i > 0 && selD[i - 1]! > d) { sel[i] = sel[i - 1]!; selD[i] = selD[i - 1]!; i--; }
  sel[i] = t; selD[i] = d;
  return count < k ? count + 1 : count;
}

/** The `k` nearest targetable ships (sorted) into core.sel; returns how many. */
export function selectNearest(c: CoreSim, x: number, z: number, radius: number, k: number, buf: Target[]): number {
  k = Math.min(k, c.core.sel.length);
  const n = c.core.near(c.state, x, z, radius, buf);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const t = buf[i]!;
    if (!acquirable(t)) continue;
    const dx = t.x - x, dz = t.z - z;
    count = insertSel(c, t, dx * dx + dz * dz, count, k);
  }
  return count;
}

/** Like selectNearest, restricted to a cone around (fx,fz) with half-angle acos(cosCone). */
export function selectCone(
  c: CoreSim, x: number, z: number, radius: number, fx: number, fz: number, cosCone: number, k: number, buf: Target[],
): number {
  k = Math.min(k, c.core.sel.length);
  const n = c.core.near(c.state, x, z, radius, buf);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const t = buf[i]!;
    if (!acquirable(t)) continue;
    const dx = t.x - x, dz = t.z - z, d2 = dx * dx + dz * dz;
    const d = Math.sqrt(d2);
    if (d > 1e-3 && (dx * fx + dz * fz) / d < cosCone) continue;
    count = insertSel(c, t, d2, count, k);
  }
  return count;
}

/** Chosen cluster centres (for spreading multi-shot area weapons over several clusters). */
const CHOSEN_X = new Float64Array(32);
const CHOSEN_Z = new Float64Array(32);
let chosenCount = 0;
export function resetChosen(): void { chosenCount = 0; }
export function addChosen(x: number, z: number): void {
  if (chosenCount < CHOSEN_X.length) { CHOSEN_X[chosenCount] = x; CHOSEN_Z[chosenCount] = z; chosenCount++; }
}

/**
 * Index (into buf[0..n)) of the targetable ship with the most neighbours within `radius`, skipping ships within
 * `exclude` metres of an already chosen centre. Samples at most 24 candidates. −1 when nothing qualifies.
 */
export function densest(buf: Target[], n: number, radius: number, exclude: number, minX = 0, minZ = 0, minD = 0): number {
  let best = -1, bestScore = -1;
  const stride = n > 24 ? n / 24 : 1;
  const r2 = radius * radius, e2 = exclude * exclude, m2 = minD * minD;
  for (let s = 0; s < n && s < 24; s++) {
    const i = Math.floor(s * stride);
    const t = buf[i]!;
    if (!acquirable(t)) continue;
    if (m2 > 0) { const ax = t.x - minX, az = t.z - minZ; if (ax * ax + az * az < m2) continue; }
    let skip = false;
    for (let k = 0; k < chosenCount; k++) {
      const dx = t.x - CHOSEN_X[k]!, dz = t.z - CHOSEN_Z[k]!;
      if (dx * dx + dz * dz < e2) { skip = true; break; }
    }
    if (skip) continue;
    let score = 0;
    for (let j = 0; j < n; j++) {
      const o = buf[j]!;
      const dx = o.x - t.x, dz = o.z - t.z;
      if (dx * dx + dz * dz <= r2) score += o.life === 'alive' ? 1 : 0;
    }
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/** Spawns a player ballistic shell that lands on (tx,tz) after `flight` seconds. Returns the pool index. */
export function lobShell(
  c: CoreSim, kind: ProjectileKind, fromX: number, fromZ: number, y0: number, tx: number, tz: number, flight: number,
  damage: number, area: number, weapon: WeaponId | undefined, critOn: boolean,
): number {
  const T = Math.max(0.3, flight);
  const vx = (tx - fromX) / T, vz = (tz - fromZ) / T;
  const vy = (0.5 * GRAVITY * T * T - y0) / T;
  return c.shoot(kind, 'player', fromX, y0, fromZ, vx, vy, vz, damage, 1.6, 0, T + 2, weapon, critOn, area);
}

/** Which side of the player a direction points to (for 'weapon-fired'.side). */
export function sideOf(c: CoreSim, dx: number, dz: number): 'port' | 'starboard' | 'bow' | 'stern' {
  const p = c.state.player;
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const along = dx * fx + dz * fz, lat = dx * sx + dz * sz;
  if (Math.abs(along) > Math.abs(lat)) return along > 0 ? 'bow' : 'stern';
  return lat > 0 ? 'starboard' : 'port';
}

/** True if any targetable ship is within `radius` of the player. */
export function anyNear(c: CoreSim, radius: number, buf: Target[]): boolean {
  const p = c.state.player;
  const n = c.core.near(c.state, p.x, p.z, radius, buf);
  for (let i = 0; i < n; i++) if (acquirable(buf[i]!)) return true;
  return false;
}
