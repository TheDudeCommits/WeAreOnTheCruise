/**
 * Fire Barrels (CORE-owned): drops burning barrels astern. A barrel ignites into a fire patch when a ship touches
 * it or when its fuse (`fuse` 3.5 s) runs out; ignition bursts for ×`burstDamage` 2 and the patch ticks the level
 * damage every 0.5 s (burning ships keep smouldering).
 *  - A Barrel Chains: each drop is a chain of `chain` (3) barrels, `chainGap` (9 m) apart.
 *  - B Powder Kegs: kegs explode on contact (×`kegDamage` 4, ×`kegArea` 1.3 radius, knockback).
 *  - ★ Sea of Fire: the whole wake burns (a patch every `wakeInterval` 0.3 s while under way).
 */
import type { WeaponSlot } from '../../types';
import { HF_BURN, type CoreSim } from '../core-runtime';
import { anyNear, E, eff, ex, levelOf } from './common';

export function updateFireBarrels(c: CoreSim, slot: WeaponSlot, rate: number): void {
  const p = c.state.player;
  const core = c.core;
  const l = levelOf(c, slot);
  eff(c, l, 12, 0, 4);
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const sternX = p.x - fx * p.length * 0.5, sternZ = p.z - fz * p.length * 0.5;

  if (slot.overdrive) {
    slot.scratch.wake = (slot.scratch.wake ?? 0) - c.dt * rate;
    if (slot.scratch.wake <= 0) {
      slot.scratch.wake = ex(l, 'wakeInterval', 0.3);
      if (Math.abs(p.speed) > 3 && anyNear(c, 320, core.bufW2)) {
        const idx = c.placeHazard('fire-patch', 'player', sternX - fx * 4, sternZ - fz * 4, E.area * ex(l, 'wakeArea', 0.75),
          E.duration * ex(l, 'wakeDuration', 1), E.damage * ex(l, 'wakeDamage', 0.6), 0.5, 0, 0, 'fire-barrels', true);
        if (idx >= 0) { core.hFlags[idx] = HF_BURN; core.hA[idx] = E.damage * 0.5; }
      }
    }
  }

  if (slot.cooldown > 0) return;
  if (!anyNear(c, 320, core.bufW)) return;
  const kegs = slot.branch === 'B';
  const chain = slot.branch === 'A' ? ex(l, 'chain', 3) : 1;
  const gap = ex(l, 'chainGap', 9);
  const fuse = ex(l, 'fuse', 3.5);
  let dropped = 0;
  for (let i = 0; i < E.count; i++) {
    const lateral = (i - (E.count - 1) / 2) * 8;
    for (let j = 0; j < chain; j++) {
      const back = 6 + j * gap;
      const x = sternX - fx * back + sx * lateral, z = sternZ - fz * back + sz * lateral;
      const idx = c.placeHazard(kegs ? 'powder-keg' : 'barrel', 'player', x, z, ex(l, 'trigger', 4), fuse + j * 0.15, E.damage, 0,
        p.vx * 0.12, p.vz * 0.12, 'fire-barrels', false);
      if (idx < 0) continue;
      core.hTimer[idx] = 0.35; // arming delay
      if (kegs) {
        core.hA[idx] = E.area * ex(l, 'kegArea', 1.3);
        core.hB[idx] = E.damage * ex(l, 'kegDamage', 4);
        core.hKnock[idx] = ex(l, 'knockback', 8);
      } else {
        core.hA[idx] = E.area;
        core.hB[idx] = E.duration;
        core.hC[idx] = E.damage;
        core.hD[idx] = E.damage * ex(l, 'burstDamage', 2);
      }
      dropped++;
    }
  }
  if (dropped === 0) return;
  c.emit({ type: 'weapon-fired', weapon: 'fire-barrels', owner: 0, x: sternX, z: sternZ, dirX: -fx, dirZ: -fz, side: 'stern', count: dropped });
  slot.cooldown = E.cooldown;
}
