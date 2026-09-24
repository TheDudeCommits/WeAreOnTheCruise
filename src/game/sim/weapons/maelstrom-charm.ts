/**
 * Maelstrom Charm (CORE-owned): opens whirlpools (HazardState 'whirlpool') under the densest clusters in range.
 * A whirlpool drags ships toward its centre (`pull` 10 m/s at the rim, mass-scaled), swirls them (`swirl` 7 m/s)
 * and grinds the level damage every `tick` (0.5 s).
 *  - A Twin Vortex: +`twin` (1) whirlpool on another cluster.
 *  - B Riptide: ×`riptideArea` 1.5 radius, ×`riptideDuration` 1.6 duration, ×1.3 pull.
 *  - ★ Maelstrom: a vast whirlpool (×`maelstromArea` 2.4) follows the ship; ships are dragged onto a grinding ring
 *    `eye` (30 m) off the hull and ground for ×`maelstromDamage` 0.8 per tick.
 */
import type { WeaponLevelDef, WeaponSlot } from '../../types';
import { HF_FOLLOW, HF_RING, type CoreSim } from '../core-runtime';
import { addChosen, densest, E, eff, ex, levelOf, resetChosen } from './common';

export function updateMaelstrom(c: CoreSim, slot: WeaponSlot): void {
  const p = c.state.player;
  const core = c.core;
  const l = levelOf(c, slot);
  eff(c, l, 28, 0, 4);
  if (slot.overdrive) ensureMaelstrom(c, slot, l);
  if (slot.cooldown > 0) return;
  const buf = core.bufW;
  const n = core.near(c.state, p.x, p.z, E.range, buf);
  if (n === 0) return;
  const riptide = slot.branch === 'B';
  const count = E.count + (slot.branch === 'A' ? ex(l, 'twin', 1) : 0);
  const radius = E.area * (riptide ? ex(l, 'riptideArea', 1.5) : 1);
  const ttl = E.duration * (riptide ? ex(l, 'riptideDuration', 1.6) : 1);
  const pull = ex(l, 'pull', 10) * (riptide ? 1.3 : 1);
  const swirl = ex(l, 'swirl', 7);
  resetChosen();
  let spawned = 0, dirX = 0, dirZ = 0;
  for (let s = 0; s < count; s++) {
    const i = densest(buf, n, radius, radius * 1.5);
    if (i < 0) break;
    const t = buf[i]!;
    addChosen(t.x, t.z);
    const x = t.x + t.vx * 0.5, z = t.z + t.vz * 0.5;
    const idx = c.placeHazard('whirlpool', 'player', x, z, radius, ttl, E.damage, ex(l, 'tick', 0.5), 0, 0, 'maelstrom-charm', true);
    if (idx < 0) continue;
    core.hA[idx] = pull; core.hB[idx] = swirl; core.hC[idx] = 0;
    if (spawned === 0) { const d = Math.hypot(x - p.x, z - p.z) || 1; dirX = (x - p.x) / d; dirZ = (z - p.z) / d; }
    spawned++;
  }
  if (spawned === 0) return;
  c.emit({ type: 'weapon-fired', weapon: 'maelstrom-charm', owner: 0, x: p.x, z: p.z, dirX, dirZ, count: spawned });
  slot.cooldown = E.cooldown;
}

function ensureMaelstrom(c: CoreSim, slot: WeaponSlot, l: WeaponLevelDef): void {
  const p = c.state.player;
  const core = c.core;
  const list = c.state.hazards;
  const idx = slot.scratch.mIdx ?? -1;
  let i = idx;
  let h = idx >= 0 ? list[idx] : undefined;
  if (!h || !h.alive || h.id !== slot.scratch.mId || h.kind !== 'whirlpool') {
    i = c.placeHazard('whirlpool', 'player', p.x, p.z, E.area * 2.4, 1e9, 0, 0.5, 0, 0, 'maelstrom-charm', true);
    if (i < 0) return;
    h = list[i]!;
    slot.scratch.mIdx = i; slot.scratch.mId = h.id;
    core.hFlags[i] = HF_FOLLOW | HF_RING;
  }
  h.radius = E.area * ex(l, 'maelstromArea', 2.4);
  h.damage = E.damage * ex(l, 'maelstromDamage', 0.8);
  h.tick = ex(l, 'tick', 0.5);
  core.hA[i] = ex(l, 'pull', 10) * 1.2;
  core.hB[i] = ex(l, 'swirl', 7) * 1.6;
  core.hC[i] = p.length * 0.5 + ex(l, 'eye', 30);
}
