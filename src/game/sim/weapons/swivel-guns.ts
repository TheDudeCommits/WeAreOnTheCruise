/**
 * Swivel Guns (CORE-owned): rapid 360° tracers at the nearest ships within ~90 m.
 *  - A Double Swivels: ×`swivelMul` (2) guns.
 *  - B Grapeshot: every gun fires a `pellets` (5) cone (±`cone` 0.2 rad, ×`pelletDamage` 0.45, ×0.75 range, knockback).
 *  - ★ Hailstorm: `hailDirections` (8) swivels also fire in every direction, rotating each volley.
 */
import type { WeaponSlot } from '../../types';
import type { CoreSim } from '../core-runtime';
import { AIM, anyNear, crit, CRIT, E, eff, ex, lead, levelOf, selectNearest, sideOf } from './common';

export function updateSwivelGuns(c: CoreSim, slot: WeaponSlot, rate: number): void {
  const p = c.state.player;
  const core = c.core;
  const l = levelOf(c, slot);
  eff(c, l, 0, 120, 0);
  const grape = slot.branch === 'B';
  const range = E.range * (grape ? 0.75 : 1);

  if (slot.overdrive) {
    slot.scratch.hail = (slot.scratch.hail ?? 0) - c.dt * rate;
    if (slot.scratch.hail <= 0) {
      if (!anyNear(c, E.range * 1.1, core.bufW2)) slot.scratch.hail = 0.15;
      else {
        const dirs = ex(l, 'hailDirections', 8);
        const rot = (slot.scratch.hailRot = ((slot.scratch.hailRot ?? 0) + 0.37) % (Math.PI * 2));
        const damage = E.damage * ex(l, 'hailDamage', 0.8);
        for (let k = 0; k < dirs; k++) {
          const a = rot + (k / dirs) * Math.PI * 2;
          const dx = Math.sin(a), dz = Math.cos(a);
          const ox = p.x + dx * p.beam * 0.5, oz = p.z + dz * p.beam * 0.5;
          if (grape) fireCone(c, ox, oz, dx, dz, 3, E.speed * 0.9, damage * ex(l, 'pelletDamage', 0.45) * 1.3, range, ex(l, 'cone', 0.2));
          else fireOne(c, ox, oz, dx, dz, E.speed, damage, range);
        }
        c.emit({ type: 'weapon-fired', weapon: 'swivel-guns', owner: 0, x: p.x, z: p.z, dirX: Math.sin(rot), dirZ: Math.cos(rot), count: dirs });
        slot.scratch.hail = E.cooldown * ex(l, 'hailRate', 1.5);
      }
    }
  }

  if (slot.cooldown > 0) return;
  const guns = Math.round(E.count * (slot.branch === 'A' ? ex(l, 'swivelMul', 2) : 1));
  const n = selectNearest(c, p.x, p.z, range, Math.min(guns, 16), core.bufW);
  if (n === 0) return;
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  let firstX = 0, firstZ = 0;
  for (let i = 0; i < guns; i++) {
    const t = core.sel[i % n]!;
    // Rail mount: the point on the rail nearest the target, jittered along the hull.
    const along = (c.random() - 0.5) * p.length * 0.6;
    const rx = t.x - p.x, rz = t.z - p.z;
    const rd = Math.sqrt(rx * rx + rz * rz) || 1;
    const ox = p.x + fx * along + (rx / rd) * p.beam * 0.5, oz = p.z + fz * along + (rz / rd) * p.beam * 0.5;
    lead(ox, oz, t, E.speed);
    let dx = AIM.x - ox, dz = AIM.z - oz;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= d; dz /= d;
    if (i === 0) { firstX = dx; firstZ = dz; }
    if (grape) fireCone(c, ox, oz, dx, dz, ex(l, 'pellets', 5), E.speed * 0.9, E.damage * ex(l, 'pelletDamage', 0.45), range, ex(l, 'cone', 0.2));
    else fireOne(c, ox, oz, dx, dz, E.speed, E.damage, range);
  }
  c.emit({ type: 'weapon-fired', weapon: 'swivel-guns', owner: 0, x: p.x, z: p.z, dirX: firstX, dirZ: firstZ, side: sideOf(c, firstX, firstZ), count: guns });
  slot.cooldown = E.cooldown;
}

function fireOne(c: CoreSim, x: number, z: number, dx: number, dz: number, speed: number, damage: number, range: number): void {
  const cm = crit(c);
  const idx = c.shoot('swivel-shot', 'player', x, 3.6, z, dx * speed, 0, dz * speed, damage * cm, 1.0, 0, range / speed, 'swivel-guns', CRIT.on, 0);
  if (idx >= 0) c.core.pKnock[idx] = 0.5;
}

function fireCone(c: CoreSim, x: number, z: number, dx: number, dz: number, pellets: number, speed: number, damage: number, range: number, cone: number): void {
  const base = Math.atan2(dx, dz);
  for (let k = 0; k < pellets; k++) {
    const a = base + (pellets > 1 ? (k / (pellets - 1) - 0.5) * 2 * cone : 0) + (c.random() - 0.5) * 0.04;
    const s = speed * (0.9 + c.random() * 0.2);
    const cm = crit(c);
    const idx = c.shoot('grapeshot', 'player', x, 3.4, z, Math.sin(a) * s, 0, Math.cos(a) * s, damage * cm, 0.9, 0, range / s, 'swivel-guns', CRIT.on, 0);
    if (idx >= 0) c.core.pKnock[idx] = 1.5;
  }
}
