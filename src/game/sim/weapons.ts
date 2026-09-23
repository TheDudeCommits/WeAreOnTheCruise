/**
 * Player weapon behaviours (CORE-owned). Skeleton implements the Broadside Battery (auto + manual full volley).
 * TODO(CORE): implement every weapon in docs/overhaul-v2/DESIGN.md §4 with branches and overdrives.
 */
import type { WeaponId } from '../ids';
import type { WeaponSlot } from '../types';
import type { SimContext, Target } from './context';
import { cooldownMul, damageMul, extraAmount, projectileSpeedMul, rangeMul, rollCrit } from './stats';

const scratchTargets: Target[] = [];

type WeaponBehavior = (c: SimContext, slot: WeaponSlot) => void;

const BEHAVIORS: Partial<Record<WeaponId, WeaponBehavior>> = {
  broadside: fireBroadside,
};

export function updateWeapons(c: SimContext): void {
  const p = c.state.player;
  if (!p.alive || p.submerged > 0.5) return;
  for (const slot of p.weapons) {
    slot.cooldown -= c.dt;
    const behavior = BEHAVIORS[slot.id];
    if (behavior) behavior(c, slot);
  }
  // Manual full broadside (Q / LMB): fires the battery on the side facing the aim point.
  const sk = p.skills.broadside;
  if ((c.actions.has('broadside') || c.input.broadsideHeld) && sk.cooldown <= 0) {
    const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
    const side = (p.aimX - p.x) * sx + (p.aimZ - p.z) * sz >= 0 ? 1 : -1;
    volley(c, p.weapons.find((w) => w.id === 'broadside') ?? p.weapons[0]!, side, 2, true);
    sk.cooldownMax = 8; sk.cooldown = 8;
    c.requestTimeScale(0.35, 0.12);
  }
}

function levelDef(c: SimContext, slot: WeaponSlot) {
  const def = c.content.weapons[slot.id];
  return def.levels[Math.min(def.levels.length, Math.max(1, slot.level)) - 1]!;
}

function fireBroadside(c: SimContext, slot: WeaponSlot): void {
  if (slot.cooldown > 0) return;
  const p = c.state.player;
  const lvl = levelDef(c, slot);
  const range = lvl.range * rangeMul(p.stats);
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  let port = false, starboard = false;
  for (const t of c.targetsNear(p.x, p.z, range, scratchTargets)) {
    const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1;
    const along = (dx * fx + dz * fz) / d;
    if (Math.abs(along) > Math.sin((40 * Math.PI) / 180)) continue; // outside ±40° of the beam
    if (dx * sx + dz * sz >= 0) starboard = true; else port = true;
  }
  if (!port && !starboard) return;
  if (starboard) volley(c, slot, 1, 1, false);
  if (port) volley(c, slot, -1, 1, false);
  slot.cooldown = lvl.cooldown * cooldownMul(p.stats);
}

/** Fires one side (+1 starboard, −1 port). `power` multiplies damage (manual volley = 2). */
function volley(c: SimContext, slot: WeaponSlot, side: 1 | -1, power: number, manual: boolean): void {
  const p = c.state.player;
  const lvl = levelDef(c, slot);
  const guns = lvl.count + extraAmount(p.stats) + (manual ? 1 : 0);
  const sx = Math.cos(p.heading) * side, sz = -Math.sin(p.heading) * side;
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const speed = (lvl.speed ?? 95) * projectileSpeedMul(p.stats);
  const range = lvl.range * rangeMul(p.stats);
  for (let i = 0; i < guns; i++) {
    const along = guns > 1 ? (i / (guns - 1) - 0.5) * p.length * 0.6 : 0;
    const spread = (c.random() - 0.5) * 0.08;
    const dirX = sx + fx * spread, dirZ = sz + fz * spread;
    const { crit, multiplier } = rollCrit(p.stats, c.random);
    c.spawnProjectile({
      kind: slot.branch === 'A' ? 'chain-shot' : slot.branch === 'B' ? 'heavy-shot' : 'cannonball', team: 'player', weapon: 'broadside',
      x: p.x + fx * along + sx * p.beam * 0.5, y: 3, z: p.z + fz * along + sz * p.beam * 0.5,
      vx: dirX * speed + p.vx, vy: 0, vz: dirZ * speed + p.vz,
      damage: lvl.damage * damageMul(p.stats) * multiplier * power, crit, radius: 1.6,
      pierce: slot.branch === 'B' ? 1 : 0, ttl: range / speed,
    });
  }
  c.emit({ type: 'weapon-fired', weapon: 'broadside', owner: 0, x: p.x, z: p.z, dirX: sx, dirZ: sz, side: side > 0 ? 'starboard' : 'port', count: guns });
}
