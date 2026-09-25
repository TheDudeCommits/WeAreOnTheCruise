/**
 * AI captains' guns (CAPTAINS-owned). Auto-firing like the player's: a broadside ripples bow → stern at enemies
 * within ±40° of either beam; captains of level CAPTAIN.chaser.level add a bow chaser, and of level
 * CAPTAIN.mortar.level a stern mortar. Every shot is a team-'player' CORE projectile tagged with the captain's ship
 * ref in `core.pFrom` (projectiles.ts routes its hits to captains-credit.ts) and announced with 'weapon-fired'
 * (owner = captain id) for muzzle flashes, smoke and audio. Side convention here: +1 starboard, −1 port (CORE's).
 * A hostile rival (captains-rival.ts) turns its broadside and bow chaser on the player: those shots are team 'enemy'
 * (they hit the player, never captains) at CAPTAIN.rival.damageToPlayer, still tagged with the captain's ref.
 */
import { CAPTAIN } from '../content/captains';
import type { CaptainState } from '../types';
import type { Target } from './context';
import { isHostile } from './captains-rival';
import { acquirable, type CoreSim } from './core-runtime';
import { lobShell } from './weapons/common';

const DEG = Math.PI / 180;
const B = CAPTAIN.broadside;
const ARC = B.arcDeg * DEG;
const SIN_ARC = Math.sin(ARC);
const CHASER_COS = Math.cos(CAPTAIN.chaser.coneDeg * DEG);

/** Damage multiplier for a captain of `level`. */
export const captainDamageMul = (level: number): number => CAPTAIN.damageMul * (1 + CAPTAIN.damagePerLevel * (level - 1));

export function broadsideRange(k: CaptainState): number {
  return B.range + B.rangePerLevel * (k.level - 1);
}

export function broadsideGuns(c: CoreSim, k: CaptainState): number {
  return Math.min(B.maxGuns, c.content.ships[k.shipId].broadsideGuns + Math.floor((k.level - 1) / B.gunsPerLevels));
}

/** Anything the guns can lead: an enemy, a boss or (for a hostile rival) the player. */
type Mark = { x: number; z: number; vx: number; vz: number; radius: number };
const SCAN = { star: null as Mark | null, port: null as Mark | null, starFoe: false, portFoe: false };

function scanBeams(c: CoreSim, k: CaptainState, range: number): void {
  const fx = -Math.sin(k.heading), fz = -Math.cos(k.heading);
  const sx = Math.cos(k.heading), sz = -Math.sin(k.heading);
  let starD = Infinity, portD = Infinity;
  SCAN.star = null; SCAN.port = null;
  const enemies = c.state.enemies, bosses = c.state.bosses;
  for (let i = 0; i < enemies.length + bosses.length; i++) {
    const t: Target = i < enemies.length ? enemies[i]! : bosses[i - enemies.length]!;
    if (!acquirable(t)) continue;
    const dx = t.x - k.x, dz = t.z - k.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-3 || d - t.radius > range) continue;
    if (Math.abs((dx * fx + dz * fz) / d) > SIN_ARC) continue;
    if (dx * sx + dz * sz >= 0) { if (d < starD) { starD = d; SCAN.star = t; } }
    else if (d < portD) { portD = d; SCAN.port = t; }
  }
  // A hostile rival prefers the player on whichever beam it lies.
  SCAN.starFoe = false; SCAN.portFoe = false;
  const p = c.state.player;
  if (isHostile(k) && p.alive && p.submerged < 0.5 && p.airborne < 0.2) {
    const dx = p.x - k.x, dz = p.z - k.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1e-3 && d - p.radius <= range && Math.abs((dx * fx + dz * fz) / d) <= SIN_ARC) {
      if (dx * sx + dz * sz >= 0) { SCAN.star = p; SCAN.starFoe = true; } else { SCAN.port = p; SCAN.portFoe = true; }
    }
  }
}

/** Lead point of a target for a shot of `speed` from (sx, sz). */
const AIM = { x: 0, z: 0 };
function lead(sx: number, sz: number, t: Mark, speed: number): typeof AIM {
  let tx = t.x, tz = t.z;
  for (let i = 0; i < 2; i++) {
    const time = Math.min(3, Math.hypot(tx - sx, tz - sz) / Math.max(1, speed));
    tx = t.x + t.vx * time; tz = t.z + t.vz * time;
  }
  AIM.x = tx; AIM.z = tz;
  return AIM;
}

/** Runs one captain's guns for this tick. */
export function updateCaptainGuns(c: CoreSim, k: CaptainState): void {
  const ai = k.ai, dt = c.dt;
  ai.reloadP = (ai.reloadP ?? 0) - dt;
  ai.reloadS = (ai.reloadS ?? 0) - dt;
  ai.chaserCd = (ai.chaserCd ?? 1) - dt;
  ai.mortarCd = (ai.mortarCd ?? 2) - dt;
  if ((ai.ripLeft ?? 0) > 0) ripple(c, k);
  const speed = B.speed + k.level;
  const range = broadsideRange(k);
  if ((ai.ripLeft ?? 0) <= 0 && (ai.reloadS <= 0 || ai.reloadP <= 0)) {
    scanBeams(c, k, range);
    const side = SCAN.star && ai.reloadS <= 0 ? 1 : SCAN.port && ai.reloadP <= 0 ? -1 : 0;
    if (side !== 0) {
      const t = (side > 0 ? SCAN.star : SCAN.port)!;
      lead(k.x, k.z, t, speed);
      const ux = AIM.x - k.x, uz = AIM.z - k.z;
      const fx = -Math.sin(k.heading), fz = -Math.cos(k.heading);
      const bx = Math.cos(k.heading) * side, bz = -Math.sin(k.heading) * side;
      const angle = Math.atan2(ux * fx + uz * fz, ux * bx + uz * bz);
      ai.ripSide = side; ai.ripAngle = Math.max(-ARC, Math.min(ARC, angle));
      ai.ripFoe = (side > 0 ? SCAN.starFoe : SCAN.portFoe) ? 1 : 0;
      ai.ripGuns = broadsideGuns(c, k); ai.ripIdx = 0; ai.ripLeft = ai.ripGuns; ai.ripNext = 0;
      const reload = B.cooldown * (1 - Math.min(0.3, 0.012 * (k.level - 1)));
      if (side > 0) ai.reloadS = reload; else ai.reloadP = reload;
      ripple(c, k);
    }
  }
  if (k.level >= CAPTAIN.chaser.level && ai.chaserCd <= 0) chaser(c, k);
  if (k.level >= CAPTAIN.mortar.level && ai.mortarCd <= 0) mortar(c, k);
}

/** Fires the guns of the running volley whose ripple delay has come (≈50 ms apart, bow → stern). */
function ripple(c: CoreSim, k: CaptainState): void {
  const ai = k.ai;
  ai.ripNext = (ai.ripNext ?? 0) - c.dt;
  while ((ai.ripLeft ?? 0) > 0 && ai.ripNext <= 0) {
    fireGun(c, k, ai.ripSide!, ai.ripIdx!, ai.ripGuns!, ai.ripAngle!);
    ai.ripIdx = ai.ripIdx! + 1;
    ai.ripLeft = ai.ripLeft! - 1;
    ai.ripNext += B.ripple;
  }
}

function crit(c: CoreSim): number { return c.random() < CAPTAIN.critChance ? CAPTAIN.critMul : 1; }

function fireGun(c: CoreSim, k: CaptainState, side: number, i: number, guns: number, angle: number): void {
  const core = c.core;
  const fx = -Math.sin(k.heading), fz = -Math.cos(k.heading);
  const bx = Math.cos(k.heading) * side, bz = -Math.sin(k.heading) * side;
  const a = angle + (c.random() - 0.5) * 0.06;
  const ca = Math.cos(a), sa = Math.sin(a);
  const dirX = bx * ca + fx * sa, dirZ = bz * ca + fz * sa;
  const along = guns <= 1 ? 0 : 0.32 - (0.64 * i) / (guns - 1);
  const x = k.x + fx * along * k.length + bx * k.beam * 0.5;
  const z = k.z + fz * along * k.length + bz * k.beam * 0.5;
  const speed = B.speed + k.level;
  const cm = crit(c);
  const foe = k.ai.ripFoe === 1;
  const damage = B.damage * captainDamageMul(k.level) * cm * (foe ? CAPTAIN.rival.damageToPlayer : 1);
  const idx = c.shoot('cannonball', foe ? 'enemy' : 'player', x, 3.2, z, dirX * speed, 0, dirZ * speed, damage, 1.6, 0, broadsideRange(k) / speed, undefined, cm > 1, 0);
  if (idx >= 0) { core.pFrom[idx] = k.id; core.pKnock[idx] = 1; }
  c.emit({ type: 'weapon-fired', weapon: 'broadside', owner: k.id, x, z, dirX, dirZ, side: side > 0 ? 'starboard' : 'port', count: 1 });
  k.roll += side * 0.006;
}

/** Bow chaser: the nearest enemy within ±25° of the bow. */
function chaser(c: CoreSim, k: CaptainState): void {
  const C = CAPTAIN.chaser;
  const fx = -Math.sin(k.heading), fz = -Math.cos(k.heading);
  const bowX = k.x + fx * k.length * 0.5, bowZ = k.z + fz * k.length * 0.5;
  let best: Mark | null = null, bestD = Infinity, foe = false;
  const p = c.state.player;
  if (isHostile(k) && p.alive && p.submerged < 0.5 && p.airborne < 0.2) {
    const dx = p.x - bowX, dz = p.z - bowZ, d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1e-3 && d - p.radius <= C.range && (dx * fx + dz * fz) / d >= CHASER_COS) { best = p; foe = true; }
  }
  const list = c.state.enemies, bosses = c.state.bosses;
  for (let i = 0; !foe && i < list.length + bosses.length; i++) {
    const t: Target = i < list.length ? list[i]! : bosses[i - list.length]!;
    if (!acquirable(t)) continue;
    const dx = t.x - bowX, dz = t.z - bowZ, d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-3 || d - t.radius > C.range || (dx * fx + dz * fz) / d < CHASER_COS) continue;
    if (d < bestD) { bestD = d; best = t; }
  }
  if (!best) { k.ai.chaserCd = 0.25; return; }
  lead(bowX, bowZ, best, C.speed);
  let dx = AIM.x - bowX, dz = AIM.z - bowZ;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d;
  const cm = crit(c);
  const idx = c.shoot('chaser-shot', foe ? 'enemy' : 'player', bowX, 3.4, bowZ, dx * C.speed, 0, dz * C.speed,
    C.damage * captainDamageMul(k.level) * cm * (foe ? CAPTAIN.rival.damageToPlayer : 1), 1.4, 0, C.range / C.speed, undefined, cm > 1, 0);
  if (idx >= 0) { c.core.pFrom[idx] = k.id; c.core.pKnock[idx] = 1.5; }
  c.emit({ type: 'weapon-fired', weapon: 'bow-chaser', owner: k.id, x: bowX, z: bowZ, dirX: dx, dirZ: dz, side: 'bow', count: 1 });
  k.ai.chaserCd = C.cooldown;
}

/** Stern mortar: shells into the thickest knot of enemies between minRange and range. */
function mortar(c: CoreSim, k: CaptainState): void {
  const M = CAPTAIN.mortar;
  const enemies = c.state.enemies;
  const n = enemies.length;
  const stride = n > 24 ? n / 24 : 1;
  let best: Target | null = null, bestScore = 0;
  const r2 = M.area * M.area;
  for (let s = 0; s < n && s < 24; s++) {
    const t = enemies[Math.floor(s * stride)]!;
    if (!acquirable(t)) continue;
    const d = Math.hypot(t.x - k.x, t.z - k.z);
    if (d < M.minRange || d > M.range) continue;
    let score = 0;
    for (let j = 0; j < n; j++) {
      const o = enemies[j]!;
      if (o.life !== 'alive') continue;
      const dx = o.x - t.x, dz = o.z - t.z;
      if (dx * dx + dz * dz <= r2) score++;
    }
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (!best) { k.ai.mortarCd = 0.5; return; }
  const t: Target = best;
  const sx = k.x + Math.sin(k.heading) * k.length * 0.45, sz = k.z + Math.cos(k.heading) * k.length * 0.45;
  const shells = k.level >= M.twinLevel ? 2 : 1;
  let dirX = 0, dirZ = 0;
  for (let i = 0; i < shells; i++) {
    const T = Math.min(M.flightMax, Math.max(M.flightMin, Math.hypot(t.x - sx, t.z - sz) / 60));
    const a = c.random() * Math.PI * 2, r = i === 0 ? 0 : M.area * (0.4 + c.random() * 0.5);
    const tx = t.x + t.vx * T + Math.sin(a) * r, tz = t.z + t.vz * T + Math.cos(a) * r;
    const cm = crit(c);
    const idx = lobShell(c, 'mortar-shell', sx, sz, 5, tx, tz, T, M.damage * captainDamageMul(k.level) * cm, M.area, undefined, cm > 1);
    if (idx >= 0) { c.core.pFrom[idx] = k.id; c.core.pKnock[idx] = 3; }
    if (i === 0) { const d = Math.hypot(tx - sx, tz - sz) || 1; dirX = (tx - sx) / d; dirZ = (tz - sz) / d; }
  }
  c.emit({ type: 'weapon-fired', weapon: 'stern-mortar', owner: k.id, x: sx, z: sz, dirX, dirZ, side: 'stern', count: shells });
  k.ai.mortarCd = M.cooldown;
}
