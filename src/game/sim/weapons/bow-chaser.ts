/**
 * Bow Chaser (CORE-owned): long-range shots at ships ahead (±25°, `cone`).
 *  - A Twin Chasers: +`twin` (1) guns, each on a different target in the cone.
 *  - B Longtom: faster (×1.25), longer (`longtomRange` ×1.2) shots that pierce everything (`pierce` 99).
 *  - ★ Lance of Dawn: every `lanceCooldown` (2.7 s) a searing lance (×`lanceDamage` 3, burning, infinite pierce,
 *    ignores islands) at the nearest ship in a wider cone.
 */
import type { WeaponSlot } from '../../types';
import { PF_BURN, type CoreSim } from '../core-runtime';
import { cooldownMul } from '../stats';
import { AIM, crit, CRIT, DEG, E, eff, ex, lead, levelOf, selectCone } from './common';

export function updateBowChaser(c: CoreSim, slot: WeaponSlot, rate: number): void {
  const p = c.state.player;
  const core = c.core;
  const l = levelOf(c, slot);
  eff(c, l, 0, 150, 0);
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const bowX = p.x + fx * p.length * 0.5, bowZ = p.z + fz * p.length * 0.5;
  const cone = ex(l, 'cone', 25) * DEG;

  if (slot.overdrive) {
    slot.scratch.lance = (slot.scratch.lance ?? 1) - c.dt * rate;
    if (slot.scratch.lance <= 0) {
      const range = E.range * ex(l, 'lanceRange', 1.5);
      const n = selectCone(c, bowX, bowZ, range, fx, fz, Math.cos(cone * 1.4), 1, core.bufW);
      if (n === 0) slot.scratch.lance = 0.2;
      else {
        const speed = 320 * (E.speed / Math.max(1, l.speed ?? 150));
        lead(bowX, bowZ, core.sel[0]!, speed);
        let dx = AIM.x - bowX, dz = AIM.z - bowZ;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        dx /= d; dz /= d;
        const cm = crit(c);
        const idx = c.shoot('lance', 'player', bowX, 3.5, bowZ, dx * speed, 0, dz * speed, E.damage * ex(l, 'lanceDamage', 3) * cm,
          3.2, 999, range / speed, 'bow-chaser', CRIT.on, 0);
        if (idx >= 0) { core.pFlags[idx] = PF_BURN; core.pBurn[idx] = E.damage * 0.3; core.pKnock[idx] = 4; }
        c.emit({ type: 'weapon-fired', weapon: 'bow-chaser', owner: 0, x: bowX, z: bowZ, dirX: dx, dirZ: dz, side: 'bow', count: 1 });
        core.kickPitch(0.08);
        slot.scratch.lance = ex(l, 'lanceCooldown', 2.7) * cooldownMul(p.stats);
      }
    }
  }

  if (slot.cooldown > 0) return;
  const longtom = slot.branch === 'B';
  const range = E.range * (longtom ? ex(l, 'longtomRange', 1.2) : 1);
  const n = selectCone(c, bowX, bowZ, range, fx, fz, Math.cos(cone), 8, core.bufW);
  if (n === 0) return;
  const shots = E.count + (slot.branch === 'A' ? ex(l, 'twin', 1) : 0);
  const speed = E.speed * (longtom ? 1.25 : 1);
  const damage = E.damage * (longtom ? ex(l, 'longtomDamage', 1.1) : 1);
  const pierce = longtom ? ex(l, 'pierce', 99) : 0;
  const radius = longtom ? 1.8 : 1.4;
  let fdx = fx, fdz = fz;
  for (let i = 0; i < shots; i++) {
    const t = slot.branch === 'A' ? core.sel[i % n]! : core.sel[0]!;
    const off = (i - (shots - 1) / 2) * 1.6;
    const ox = bowX + sx * off, oz = bowZ + sz * off;
    lead(ox, oz, t, speed);
    let dx = AIM.x - ox, dz = AIM.z - oz;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= d; dz /= d;
    if (i === 0) { fdx = dx; fdz = dz; }
    const cm = crit(c);
    const idx = c.shoot('chaser-shot', 'player', ox, 3.4, oz, dx * speed, 0, dz * speed, damage * cm, radius, pierce, range / speed, 'bow-chaser', CRIT.on, 0);
    if (idx >= 0) core.pKnock[idx] = longtom ? 3 : 1.5;
  }
  c.emit({ type: 'weapon-fired', weapon: 'bow-chaser', owner: 0, x: bowX, z: bowZ, dirX: fdx, dirZ: fdz, side: 'bow', count: shots });
  core.kickPitch(0.03);
  slot.cooldown = E.cooldown;
}
