/**
 * Ship ↔ island and ship ↔ ship contacts (CORE-owned).
 *
 * The player's hull is a capsule (keel segment + half-beam), tested as bow / midship / stern circles against
 * islands: the hull is pushed out, bounces (restitution 0.3), scrapes (tangential loss), yaws around the contact
 * (a glancing bow hit swings the bow off the rock) and emits 'collision'; impacts above 8 m/s hurt a little.
 *
 * Ship contacts use the capsule against each ship circle with a capped mass ratio (bosses do not budge).
 * A ram = the player driving bow-first into a ship at > 4 m/s (any contact during Ramming Speed): damage from
 * closing speed and hull mass (× Iron Ram, × Ramming Speed, × ramDamage stat), knockback, 'ram' + 'collision'
 * events, and recoil damage to the rammer unless Iron Ram / Ramming Speed. Other contacts deal the ship's
 * contactDamage to the player. Each ship has a contact cooldown (ai.contactCd; Iron Ram's level cooldown).
 */
import type { BossState, EnemyState, PlayerState } from '../types';
import type { Target } from './context';
import { CLOSEST, clamp, isBoss, keelDistance, statusOf, type CoreSim } from './core-runtime';
import { spawnShockwave, ULTIMATES } from './core-skills';
import { areaMul, damageMul, ramMul } from './stats';
import { crit, CRIT, ex, levelOf } from './weapons/common';
import { ironRamSlot } from './weapons/iron-ram';

/** Ram damage per (m/s of closing speed × √tonnes). */
export const RAM_K = 0.1;
const RESTITUTION = 0.3;
const HARD_IMPACT = 8;

export function resolveCollisions(c: CoreSim): void {
  const p = c.state.player;
  const core = c.core;
  if (core.islandCd > 0) core.islandCd = Math.max(0, core.islandCd - c.dt);
  if (p.alive && p.airborne < 0.3) {
    islandsVsPlayer(c, p);
    if (p.submerged < 0.5) shipsVsPlayer(c, p);
  }
  // Enemies and bosses: contact cooldowns, pushed out of islands.
  const enemies = c.state.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]!;
    if (e.life !== 'alive') continue;
    if (e.ai.contactCd > 0) e.ai.contactCd -= c.dt;
    pushOutOfIslands(c, e);
  }
  const bosses = c.state.bosses;
  for (let i = 0; i < bosses.length; i++) {
    const b = bosses[i]!;
    if (b.life !== 'alive') continue;
    if (b.ai.contactCd > 0) b.ai.contactCd -= c.dt;
    if (b.submerged < 0.5) pushOutOfIslands(c, b);
  }
}

function pushOutOfIslands(c: CoreSim, t: EnemyState | BossState): void {
  if (!c.core.nearIsland(t.x, t.z, t.radius)) return;
  const hit = c.world.collideCircle(t.x, t.z, t.radius);
  if (!hit.hit) return;
  t.x += hit.nx * hit.depth; t.z += hit.nz * hit.depth;
  const vn = t.vx * hit.nx + t.vz * hit.nz;
  if (vn < 0) { t.vx -= vn * hit.nx; t.vz -= vn * hit.nz; }
}

function islandsVsPlayer(c: CoreSim, p: PlayerState): void {
  const core = c.core;
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const half = Math.max(0, p.length * 0.5 - p.beam * 0.5);
  const r = p.beam * 0.5 + 0.5;
  if (!core.nearIsland(p.x, p.z, half + r)) return;
  let impact = 0, hitX = 0, hitZ = 0;
  const inertia = (p.length * p.length) / 12;
  for (let k = -1; k <= 1; k++) {
    const offX = fx * half * k, offZ = fz * half * k;
    const cx = p.x + offX, cz = p.z + offZ;
    const hit = c.world.collideCircle(cx, cz, r);
    if (!hit.hit) continue;
    p.x += hit.nx * hit.depth; p.z += hit.nz * hit.depth;
    const vn = p.vx * hit.nx + p.vz * hit.nz;
    if (vn >= 0) continue;
    // Bounce + scrape.
    const jx = -(1 + RESTITUTION) * vn * hit.nx, jz = -(1 + RESTITUTION) * vn * hit.nz;
    p.vx += jx; p.vz += jz;
    const tx = -hit.nz, tz = hit.nx, vt = p.vx * tx + p.vz * tz;
    p.vx -= vt * 0.12 * tx; p.vz -= vt * 0.12 * tz;
    // Torque about the hull centre: τ = r × J (a bow strike swings the bow away from the rock).
    p.yawRate += ((offZ * jx - offX * jz) / Math.max(1, inertia)) * 0.35;
    if (-vn > impact) { impact = -vn; hitX = cx - hit.nx * r; hitZ = cz - hit.nz * r; }
  }
  if (impact <= 0) return;
  p.speed = p.vx * fx + p.vz * fz;
  if (impact > 2 && core.islandCd <= 0) {
    core.islandCd = 0.35;
    c.emit({ type: 'collision', a: 0, b: 'island', x: hitX, z: hitZ, impulse: impact });
    core.kickPitch(-Math.min(0.3, impact * 0.015));
    core.kickRoll((c.random() - 0.5) * Math.min(0.3, impact * 0.02));
    if (impact > HARD_IMPACT) c.hurtPlayer((impact - 6) * 1.6, hitX, hitZ, undefined, 'contact');
  }
}

function massOf(c: CoreSim, t: Target): number {
  if (isBoss(t)) return c.content.bosses[t.defId].mass;
  const def = c.content.enemies[t.defId];
  return (def?.mass ?? 250) * (t.elite ? 1.6 : 1);
}

function contactDamageOf(c: CoreSim, t: Target): number {
  if (isBoss(t)) return c.content.bosses[t.defId].contactDamage;
  return c.content.enemies[t.defId]?.contactDamage ?? 0;
}

function shipsVsPlayer(c: CoreSim, p: PlayerState): void {
  const core = c.core;
  const hw = p.beam * 0.5;
  const buf = core.bufC;
  const n = core.near(c.state, p.x, p.z, p.length * 0.5 + 2, buf);
  if (n === 0) return;
  const massP = c.content.ships[p.shipId].mass;
  const slot = ironRamSlot(p);
  const ramming = core.rammingSpeed > 0;
  for (let j = 0; j < n; j++) {
    const t = buf[j]!;
    if (t.life !== 'alive') continue;
    const d = keelDistance(p, t.x, t.z);
    const overlap = hw + t.radius - d;
    if (overlap <= 0) continue;
    const cx = CLOSEST.x, cz = CLOSEST.z, along = CLOSEST.t;
    const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
    let nx: number, nz: number;
    if (d > 1e-4) { nx = (t.x - cx) / d; nz = (t.z - cz) / d; } else { nx = fx; nz = fz; }
    const boss = isBoss(t);
    const massT = massOf(c, t);
    const shareP = boss ? 1 : clamp(massT / (massP + massT), 0.12, 0.88);
    p.x -= nx * overlap * shareP; p.z -= nz * overlap * shareP;
    if (!boss) { t.x += nx * overlap * (1 - shareP); t.z += nz * overlap * (1 - shareP); }
    const vpn = p.vx * nx + p.vz * nz;
    const closing = vpn - (t.vx * nx + t.vz * nz);
    if (closing > 0) {
      const dv = closing * (boss ? 1.1 : clamp(massT / (massP + massT), 0.1, 0.9)) * (ramming ? 0.35 : 1);
      p.vx -= nx * dv; p.vz -= nz * dv;
    }
    if ((t.ai.contactCd ?? 0) > 0) continue;
    const bowOn = along > 0.72 || fx * nx + fz * nz > 0.6;
    const isRam = (vpn > 4 && bowOn) || (ramming && closing > 2);
    if (isRam) ram(c, p, t, vpn, nx, nz, cx + nx * hw, cz + nz * hw, massP, massT);
    else {
      if (closing > 2) c.emit({ type: 'collision', a: 0, b: t.id, x: cx + nx * hw, z: cz + nz * hw, impulse: closing });
      // Grinding bow-first with an iron prow (or during Ramming Speed) does not hurt the player.
      const armouredBow = ramming || (slot !== undefined && bowOn);
      const dmg = contactDamageOf(c, t);
      if (dmg > 0 && !armouredBow) c.hurtPlayer(dmg, t.x, t.z, t.id, boss ? 'boss' : 'contact');
    }
    t.ai.contactCd = ramming ? 0.3 : slot ? levelOf(c, slot).cooldown : 0.6;
  }
}

function ram(c: CoreSim, p: PlayerState, t: Target, vpn: number, nx: number, nz: number, x: number, z: number, massP: number, massT: number): void {
  const core = c.core;
  const slot = ironRamSlot(p);
  const l = slot ? levelOf(c, slot) : undefined;
  const ramming = core.rammingSpeed > 0;
  const rs = ULTIMATES['ramming-speed'];
  const mult = (l ? ex(l, 'ramMultiplier', 2) : 1) * (ramming ? rs.ram : 1);
  let damage = RAM_K * vpn * Math.sqrt(massP) * mult * ramMul(p.stats);
  if (l) damage += l.damage * damageMul(p.stats) * Math.min(1, vpn / 12);
  const cm = l ? crit(c) : 1;
  const critOn = !!l && CRIT.on;
  const knock = (l ? ex(l, 'knockback', 8) : 5) * (ramming ? rs.knockback : 1) * clamp(vpn / 15, 0.5, 1.5);
  const dealt = c.hitTarget(t, damage * cm, l ? 'iron-ram' : undefined, critOn, knock, p.x, p.z, null, 0, 0, false);
  c.emit({ type: 'ram', attacker: 0, target: t.id, damage: dealt, x, z });
  c.emit({ type: 'collision', a: 0, b: t.id, x, z, impulse: vpn });
  core.kickPitch(-Math.min(0.25, vpn * 0.012));
  core.kickRoll((nx * Math.cos(p.heading) - nz * Math.sin(p.heading)) * Math.min(0.15, vpn * 0.006));
  // The rammer feels it too, unless the prow is armoured for it.
  if (!l && !ramming && p.invulnerable <= 0 && !statusOf(p.statuses, 'invulnerable')) {
    const recoil = Math.min(p.maxHp * 0.06, dealt * 0.15 + contactDamageOf(c, t) * 0.5 * clamp(massT / (massP + massT) * 2, 0.2, 1));
    if (recoil > 0) c.hurtPlayer(recoil, x, z, t.id, 'contact');
  }
  if (l && slot) {
    if (slot.branch === 'B') {
      spawnShockwave(c, x, z, ex(l, 'shockRadius', 34) * areaMul(p.stats), l.damage * damageMul(p.stats) * ex(l, 'shockDamage', 0.8),
        ex(l, 'shockKnockback', 10), 0.35, 0, 0, 0, 'iron-ram');
    }
    if (slot.overdrive) {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * ex(l, 'healPct', 0.03));
      const iframes = ex(l, 'iframes', 0.6);
      p.invulnerable = Math.max(p.invulnerable, iframes);
      c.applyStatus(p, 'invulnerable', iframes, 1);
    }
  }
  if (ramming || vpn > 14) c.requestTimeScale(0.55, 0.06);
}
