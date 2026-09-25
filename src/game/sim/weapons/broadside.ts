/**
 * Broadside Battery (CORE-owned).
 *  - Auto: when a ship is within ±40° of either beam and in range, that side's guns ripple-fire bow → stern
 *    (≈50 ms apart) toward the target's lead point. Rival captains are only auto-targeted while hostile.
 *    (Hand-aimed Full Broadsides and stray shots hit any captain — captains-rival.ts.) Guns per side = ship.broadsideGuns + level growth + Amount.
 *  - A Chain Shot: wide balls that slow (40%, `slow`/`slowTime`). B Heavy Shot: pierce (`pierce` 1) + knockback (6 m).
 *  - ★ Rolling Thunder: both batteries walk bow → stern continuously while anything is in range (±60° aim arc).
 *  - Full Broadside (Q / LMB): the side facing the aim point fires every gun +2 at ×2 power, aimed at the cursor.
 *  - Sunfire Barrage / Kitchen Inferno ultimates drive both batteries continuously with burning rounds.
 */
import type { ProjectileKind } from '../../ids';
import type { WeaponSlot } from '../../types';
import type { Target } from '../context';
import { isHostile } from '../captains-rival';
import { clamp, GUN_QUEUE, PF_AIMED, PF_BURN, PF_SLOW, acquirable, type CoreSim } from '../core-runtime';
import { ULTIMATES } from '../core-skills';
import { cooldownMul, damageMul, extraAmount, projectileSpeedMul, rangeMul } from '../stats';
import { AIM, crit, CRIT, DEG, ex, lead, levelOf } from './common';

const KINDS: readonly ProjectileKind[] = ['cannonball', 'chain-shot', 'heavy-shot'];
const AUTO_ARC = 40 * DEG;
const WIDE_ARC = 60 * DEG;
const MANUAL_ARC = 35 * DEG;
const RIPPLE = 0.05;
const MANUAL_RIPPLE = 0.035;

const SPEC = {
  guns: 0, damage: 0, speed: 0, radius: 0, pierce: 0, knock: 0, ttl: 0, kind: 0, flags: 0,
  slowMag: 0, slowTime: 0, burn: 0, range: 0, cooldown: 0, recoil: 0,
};

function buildSpec(c: CoreSim, slot: WeaponSlot | undefined, power: number, burnFraction: number): typeof SPEC {
  const p = c.state.player;
  const ship = c.content.ships[p.shipId];
  const def = c.content.weapons.broadside;
  const base = def.levels[0]!;
  const l = slot ? levelOf(c, slot) : base;
  const branch = slot?.branch;
  SPEC.guns = Math.max(1, ship.broadsideGuns + (l.count - base.count) + extraAmount(p.stats));
  SPEC.kind = branch === 'A' ? 1 : branch === 'B' ? 2 : 0;
  const branchMul = branch === 'A' ? ex(l, 'chainDamage', 0.9) : branch === 'B' ? ex(l, 'heavyDamage', 1.15) : 1;
  SPEC.damage = l.damage * damageMul(p.stats) * power * branchMul;
  SPEC.speed = (l.speed ?? 95) * projectileSpeedMul(p.stats) * (branch === 'B' ? 0.92 : 1);
  SPEC.range = l.range * rangeMul(p.stats);
  SPEC.ttl = SPEC.range / SPEC.speed;
  SPEC.radius = branch === 'A' ? 2.3 : branch === 'B' ? 1.9 : 1.6;
  SPEC.pierce = branch === 'B' ? ex(l, 'pierce', 1) : 0;
  SPEC.knock = branch === 'B' ? ex(l, 'knockback', 6) : 1;
  SPEC.flags = (branch === 'A' ? PF_SLOW : 0) | (burnFraction > 0 ? PF_BURN : 0);
  SPEC.slowMag = ex(l, 'slow', 0.4);
  SPEC.slowTime = ex(l, 'slowTime', 2);
  SPEC.burn = burnFraction * SPEC.damage;
  SPEC.cooldown = l.cooldown * cooldownMul(p.stats);
  SPEC.recoil = 0.012 / Math.sqrt(Math.sqrt(ship.mass / 600));
  return SPEC;
}

type Mark = Pick<Target, 'x' | 'z' | 'vx' | 'vz'>;
const SCAN = { port: null as Mark | null, star: null as Mark | null, any: false };

function scanSides(c: CoreSim, range: number, arc: number): void {
  const p = c.state.player;
  const buf = c.core.bufW;
  const n = c.core.near(c.state, p.x, p.z, range, buf);
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const sinArc = Math.sin(arc);
  let portD = Infinity, starD = Infinity;
  SCAN.port = null; SCAN.star = null; SCAN.any = false;
  for (let i = 0; i < n; i++) {
    const t = buf[i]!;
    if (!acquirable(t)) continue;
    SCAN.any = true;
    const dx = t.x - p.x, dz = t.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-3) continue;
    if (Math.abs((dx * fx + dz * fz) / d) > sinArc) continue;
    if (dx * sx + dz * sz >= 0) { if (d < starD) { starD = d; SCAN.star = t; } }
    else if (d < portD) { portD = d; SCAN.port = t; }
  }
  // Rivals: a captain fighting the player is fair game for the batteries.
  const caps = c.state.captains;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (!isHostile(k)) continue;
    const dx = k.x - p.x, dz = k.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-3 || d - k.radius > range) continue;
    SCAN.any = true;
    if (Math.abs((dx * fx + dz * fz) / d) > sinArc) continue;
    if (dx * sx + dz * sz >= 0) { if (d < starD) { starD = d; SCAN.star = k; } }
    else if (d < portD) { portD = d; SCAN.port = k; }
  }
}

/** Gun angle off the beam (positive toward the bow) that points `side`'s guns at the target's lead point. */
function aimAngle(c: CoreSim, t: Mark, side: number, speed: number, arc: number): number {
  const p = c.state.player;
  lead(p.x, p.z, t, speed);
  const ux = AIM.x - p.x, uz = AIM.z - p.z;
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const bx = Math.cos(p.heading) * side, bz = -Math.sin(p.heading) * side;
  return clamp(Math.atan2(ux * fx + uz * fz, ux * bx + uz * bz), -arc, arc);
}

const gunAlong = (i: number, guns: number): number => (guns <= 1 ? 0 : 0.32 - (0.64 * i) / (guns - 1));

function queueGun(c: CoreSim, delay: number, side: number, along: number, angle: number, s: typeof SPEC, recoil: number): void {
  const q = c.core;
  if (q.gunCount >= GUN_QUEUE) return;
  const i = q.gunCount++;
  q.gunT[i] = delay; q.gunSide[i] = side; q.gunAlong[i] = along; q.gunAngle[i] = angle;
  q.gunDamage[i] = s.damage; q.gunSpeed[i] = s.speed; q.gunRadius[i] = s.radius; q.gunPierce[i] = s.pierce;
  q.gunKnock[i] = s.knock; q.gunTtl[i] = s.ttl; q.gunKind[i] = s.kind; q.gunFlags[i] = s.flags;
  q.gunSlowMag[i] = s.slowMag; q.gunSlowTime[i] = s.slowTime; q.gunBurn[i] = s.burn; q.gunRecoil[i] = recoil;
}

function fireGun(
  c: CoreSim, side: number, along: number, angle: number, damage: number, speed: number, radius: number, pierce: number,
  knock: number, ttl: number, kind: number, flags: number, slowMag: number, slowTime: number, burn: number, recoil: number,
): void {
  const p = c.state.player;
  const core = c.core;
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const bx = Math.cos(p.heading) * side, bz = -Math.sin(p.heading) * side;
  const a = angle + (c.random() - 0.5) * 0.05;
  const ca = Math.cos(a), sa = Math.sin(a);
  const dirX = bx * ca + fx * sa, dirZ = bz * ca + fz * sa;
  const x = p.x + fx * along * p.length + bx * p.beam * 0.5;
  const z = p.z + fz * along * p.length + bz * p.beam * 0.5;
  const cm = crit(c);
  const idx = c.shoot(KINDS[kind]!, 'player', x, 3.2, z, dirX * speed, 0, dirZ * speed, damage * cm, radius, pierce, ttl, 'broadside', CRIT.on, 0);
  if (idx >= 0) {
    core.pFlags[idx] = flags; core.pKnock[idx] = knock;
    core.pSlowMag[idx] = slowMag; core.pSlowTime[idx] = slowTime; core.pBurn[idx] = burn;
  }
  c.emit({ type: 'weapon-fired', weapon: 'broadside', owner: 0, x, z, dirX, dirZ, side: side > 0 ? 'starboard' : 'port', count: 1 });
  core.kickRoll(side * recoil);
}

function fireSpecNow(c: CoreSim, side: number, along: number, angle: number, s: typeof SPEC): void {
  fireGun(c, side, along, angle, s.damage, s.speed, s.radius, s.pierce, s.knock, s.ttl, s.kind, s.flags, s.slowMag, s.slowTime, s.burn, s.recoil);
}

export function updateBroadside(c: CoreSim, slot: WeaponSlot): void {
  const core = c.core;
  if (core.sunfire > 0 || core.inferno > 0) return; // the ultimate drives the batteries
  if (slot.cooldown > 0) return;
  const s = buildSpec(c, slot, 1, 0);
  if (slot.overdrive) {
    // Rolling Thunder: one gun per side per step, walking bow → stern, continuously.
    scanSides(c, s.range, WIDE_ARC);
    if (!SCAN.any) { slot.cooldown = 0.1; return; }
    const k = (slot.scratch.rip ?? 0) % s.guns;
    const along = gunAlong(k, s.guns);
    fireSpecNow(c, 1, along, SCAN.star ? aimAngle(c, SCAN.star, 1, s.speed, WIDE_ARC) : 0, s);
    fireSpecNow(c, -1, along, SCAN.port ? aimAngle(c, SCAN.port, -1, s.speed, WIDE_ARC) : 0, s);
    slot.scratch.rip = k + 1;
    slot.cooldown = s.cooldown / s.guns;
    return;
  }
  scanSides(c, s.range, AUTO_ARC);
  if (!SCAN.star && !SCAN.port) return;
  for (let side = -1; side <= 1; side += 2) {
    const t = side > 0 ? SCAN.star : SCAN.port;
    if (!t) continue;
    const angle = aimAngle(c, t, side, s.speed, AUTO_ARC);
    for (let i = 0; i < s.guns; i++) queueGun(c, i * RIPPLE, side, gunAlong(i, s.guns), angle, s, s.recoil);
  }
  slot.cooldown = s.cooldown;
}

/** Sunfire Barrage / Kitchen Inferno: both batteries fire continuously with burning rounds. */
export function updateUltBroadsides(c: CoreSim, rate: number): void {
  const core = c.core;
  if (core.sunfire <= 0 && core.inferno <= 0) return;
  const sun = core.sunfire > 0;
  const tuning = sun ? ULTIMATES['sunfire-barrage'] : ULTIMATES['kitchen-inferno'];
  core.ultGunT -= c.dt * rate;
  if (core.ultGunT > 0) return;
  const slot = c.state.player.weapons.find(isBroadside);
  const s = buildSpec(c, slot, 1, tuning.burn);
  scanSides(c, s.range, WIDE_ARC);
  const k = core.ultGunCursor % s.guns;
  const along = gunAlong(k, s.guns);
  fireSpecNow(c, 1, along, SCAN.star ? aimAngle(c, SCAN.star, 1, s.speed, WIDE_ARC) : 0, s);
  fireSpecNow(c, -1, along, SCAN.port ? aimAngle(c, SCAN.port, -1, s.speed, WIDE_ARC) : 0, s);
  core.ultGunCursor = k + 1;
  core.ultGunT = Math.max(core.ultGunT, -c.dt) + s.cooldown / s.guns / tuning.rate;
}

const isBroadside = (w: WeaponSlot): boolean => w.id === 'broadside';

/** Manual Full Broadside: every gun on the side facing the aim point, +2 guns, ×2 power, aimed at the cursor. */
export function fireFullBroadside(c: CoreSim): void {
  const p = c.state.player;
  const core = c.core;
  const slot = p.weapons.find(isBroadside);
  const s = buildSpec(c, slot, 2, core.sunfire > 0 ? ULTIMATES['sunfire-barrage'].burn : 0);
  s.flags |= PF_AIMED; // hand-aimed: may pick a fight with a rival captain
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const ux = p.aimX - p.x, uz = p.aimZ - p.z;
  const side = ux * sx + uz * sz >= 0 ? 1 : -1;
  const angle = clamp(Math.atan2(ux * fx + uz * fz, (ux * sx + uz * sz) * side), -MANUAL_ARC, MANUAL_ARC);
  const guns = s.guns + 2;
  const recoil = s.recoil * 2.2;
  for (let i = 0; i < guns; i++) queueGun(c, i * MANUAL_RIPPLE, side, gunAlong(i, guns), angle, s, recoil);
  core.kickRoll(side * 0.05);
  c.requestTimeScale(0.4, 0.22);
}

/** Fires queued ripple shots whose delay has elapsed (guns stay fixed to the hull, so a turning ship sprays). */
export function updateGunQueue(c: CoreSim): void {
  const q = c.core;
  if (!c.state.player.alive) { q.gunCount = 0; return; }
  const dt = c.dt;
  let i = 0;
  while (i < q.gunCount) {
    q.gunT[i] -= dt;
    if (q.gunT[i]! > 0) { i++; continue; }
    fireGun(c, q.gunSide[i]!, q.gunAlong[i]!, q.gunAngle[i]!, q.gunDamage[i]!, q.gunSpeed[i]!, q.gunRadius[i]!, q.gunPierce[i]!,
      q.gunKnock[i]!, q.gunTtl[i]!, q.gunKind[i]!, q.gunFlags[i]!, q.gunSlowMag[i]!, q.gunSlowTime[i]!, q.gunBurn[i]!, q.gunRecoil[i]!);
    const last = --q.gunCount;
    if (i !== last) {
      q.gunT[i] = q.gunT[last]!; q.gunSide[i] = q.gunSide[last]!; q.gunAlong[i] = q.gunAlong[last]!; q.gunAngle[i] = q.gunAngle[last]!;
      q.gunDamage[i] = q.gunDamage[last]!; q.gunSpeed[i] = q.gunSpeed[last]!; q.gunRadius[i] = q.gunRadius[last]!;
      q.gunPierce[i] = q.gunPierce[last]!; q.gunKnock[i] = q.gunKnock[last]!; q.gunTtl[i] = q.gunTtl[last]!;
      q.gunKind[i] = q.gunKind[last]!; q.gunFlags[i] = q.gunFlags[last]!; q.gunSlowMag[i] = q.gunSlowMag[last]!;
      q.gunSlowTime[i] = q.gunSlowTime[last]!; q.gunBurn[i] = q.gunBurn[last]!; q.gunRecoil[i] = q.gunRecoil[last]!;
      // The moved entry has not been advanced this tick yet; the loop re-examines index i.
    }
  }
}
