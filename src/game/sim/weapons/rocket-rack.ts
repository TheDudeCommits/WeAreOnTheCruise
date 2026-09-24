/**
 * Rocket Rack (CORE-owned): a fanned volley of homing rockets (turn rate `turnRate` 3.4 rad/s) spread over the
 * nearest ships; each explodes in a small blast on contact (or at the end of its fuel).
 *  - A Swarm: ×`swarmMul` (2) rockets, ×`swarmDamage` 0.6 damage, ×0.6 blast.
 *  - B Big Bertha: ÷`berthaDiv` (2) rockets, ×`berthaDamage` 2.6 damage, ×2.2 blast, heavy knockback.
 *  - ★ Skyburst: every blast scatters `sparks` (6) burning sparks (×`sparkDamage` 0.35).
 */
import type { WeaponSlot } from '../../types';
import { PF_BIG, PF_SPARKS, type CoreSim } from '../core-runtime';
import { crit, CRIT, E, eff, ex, levelOf, selectNearest } from './common';

export function updateRocketRack(c: CoreSim, slot: WeaponSlot): void {
  const p = c.state.player;
  const core = c.core;
  if (slot.cooldown > 0) return;
  const l = levelOf(c, slot);
  eff(c, l, 8, 70, 0);
  const swarm = slot.branch === 'A', bertha = slot.branch === 'B';
  let rockets = E.count;
  if (swarm) rockets = Math.round(rockets * ex(l, 'swarmMul', 2));
  if (bertha) rockets = Math.max(1, Math.ceil(rockets / ex(l, 'berthaDiv', 2)));
  const n = selectNearest(c, p.x, p.z, E.range, Math.min(16, rockets), core.bufW);
  if (n === 0) return;
  const damage = E.damage * (swarm ? ex(l, 'swarmDamage', 0.6) : bertha ? ex(l, 'berthaDamage', 2.6) : 1);
  const area = E.area * (swarm ? 0.6 : bertha ? 2.2 : 1);
  const speed = E.speed * (bertha ? 0.8 : 1);
  const turn = ex(l, 'turnRate', 3.4) * (bertha ? 0.7 : 1);
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const first = core.sel[0]!;
  const base = Math.atan2(first.x - p.x, first.z - p.z);
  for (let i = 0; i < rockets; i++) {
    const t = core.sel[i % n]!;
    const fan = rockets > 1 ? (i / (rockets - 1) - 0.5) * 1.8 : 0;
    const a = base + fan;
    const along = (c.random() - 0.5) * p.length * 0.3, lat = (c.random() - 0.5) * p.beam * 0.5;
    const x = p.x + fx * along + sx * lat, z = p.z + fz * along + sz * lat;
    const v0 = speed * 0.55;
    const cm = crit(c);
    const idx = c.shoot('rocket', 'player', x, 5, z, Math.sin(a) * v0, 0, Math.cos(a) * v0, damage * cm, bertha ? 2.2 : 1.4, 0, 4.5, 'rocket-rack', CRIT.on, area);
    if (idx < 0) continue;
    core.pTurn[idx] = turn;
    core.pSpeed[idx] = speed;
    core.pTarget[idx] = t;
    c.state.projectiles[idx]!.target = t.id;
    core.pKnock[idx] = bertha ? 9 : 1.5;
    if (bertha) core.pFlags[idx] |= PF_BIG;
    if (slot.overdrive) { core.pFlags[idx] |= PF_SPARKS; core.pA[idx] = ex(l, 'sparks', 6); core.pB[idx] = ex(l, 'sparkDamage', 0.35); }
  }
  c.emit({ type: 'weapon-fired', weapon: 'rocket-rack', owner: 0, x: p.x, z: p.z, dirX: Math.sin(base), dirZ: Math.cos(base), count: rockets });
  slot.cooldown = E.cooldown;
}
