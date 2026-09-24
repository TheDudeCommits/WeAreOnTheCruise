/**
 * Iron Ram (CORE-owned): reinforces the prow. Rams (see collisions.ts) deal ×`ramMultiplier` damage plus the level
 * damage, knock the target back `knockback` metres, never hurt the rammer, and the level `cooldown` is the per-ship
 * re-ram cooldown.
 *  - A Spiked Hull: every `spikeTick` (0.3 s) ships touching the hull take ×`spikeDamage` 0.35 of the level damage.
 *  - B Shockwave Prow: rams release a shockwave (`shockRadius` 34 m, ×`shockDamage` 0.8, knockback 10).
 *  - ★ Iron Tusk: rams heal `healPct` (3%) of max hull and grant `iframes` (0.6 s) of invulnerability.
 */
import type { PlayerState, WeaponSlot } from '../../types';
import { keelDistance, targetable, type CoreSim } from '../core-runtime';
import { crit, CRIT, E, eff, ex, levelOf } from './common';

export function ironRamSlot(p: PlayerState): WeaponSlot | undefined {
  const list = p.weapons;
  for (let i = 0; i < list.length; i++) if (list[i]!.id === 'iron-ram') return list[i];
  return undefined;
}

export function updateIronRam(c: CoreSim, slot: WeaponSlot, rate: number): void {
  if (slot.branch !== 'A') return;
  slot.scratch.spike = (slot.scratch.spike ?? 0) - c.dt * rate;
  if (slot.scratch.spike > 0) return;
  const l = levelOf(c, slot);
  eff(c, l, 0, 0, 0);
  slot.scratch.spike = ex(l, 'spikeTick', 0.3);
  const p = c.state.player;
  if (p.submerged > 0.5 || p.airborne > 0.3) return;
  const core = c.core;
  const reach = ex(l, 'spikeReach', 3);
  const buf = core.bufW;
  const n = core.near(c.state, p.x, p.z, p.length * 0.5 + reach + 4, buf);
  const hw = p.beam * 0.5;
  for (let i = 0; i < n; i++) {
    const t = buf[i]!;
    if (!targetable(t)) continue;
    if (keelDistance(p, t.x, t.z) > hw + t.radius + reach) continue;
    const cm = crit(c);
    c.hitTarget(t, E.damage * ex(l, 'spikeDamage', 0.35) * cm, 'iron-ram', CRIT.on, 2, p.x, p.z, null, 0, 0, false);
  }
}
