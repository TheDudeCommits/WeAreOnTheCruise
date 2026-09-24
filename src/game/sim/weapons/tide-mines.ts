/**
 * Tide Mines (CORE-owned): drops drifting mines astern that arm after `armTime` (1 s) and blow when a ship comes
 * within `trigger` (8 m): level damage in the level area, knockback.
 *  - A Magnet Mines: armed mines drift toward ships within `magnetRange` (70 m) at up to `magnetSpeed` (10 m/s).
 *  - B Depth Charges: slow, huge blasts — ×`depthArea` 1.8 radius, ×`depthDamage` 1.6, a 0.55 s fuse, stun.
 *  - ★ Minefield: mines also seed themselves around the ship every `seedInterval` (0.7 s), up to `maxMines` (36).
 */
import type { WeaponLevelDef, WeaponSlot } from '../../types';
import { HF_DEPTH, HF_MAGNET, type CoreSim } from '../core-runtime';
import { cooldownMul } from '../stats';
import { anyNear, E, eff, ex, levelOf } from './common';

export function updateTideMines(c: CoreSim, slot: WeaponSlot, rate: number): void {
  const p = c.state.player;
  const core = c.core;
  const l = levelOf(c, slot);
  eff(c, l, 18, 0, 12);
  if (slot.overdrive) minefield(c, slot, l, rate);
  if (slot.cooldown > 0) return;
  if (!anyNear(c, 350, core.bufW)) return;
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const sternX = p.x - fx * (p.length * 0.5 + 6), sternZ = p.z - fz * (p.length * 0.5 + 6);
  let dropped = 0;
  for (let i = 0; i < E.count; i++) {
    const lateral = (i - (E.count - 1) / 2) * 10;
    const jx = (c.random() - 0.5) * 3, jz = (c.random() - 0.5) * 3;
    if (placeMine(c, slot, l, sternX + sx * lateral, sternZ + sz * lateral, p.vx * 0.2 + jx, p.vz * 0.2 + jz) >= 0) dropped++;
  }
  if (dropped === 0) return;
  c.emit({ type: 'weapon-fired', weapon: 'tide-mines', owner: 0, x: sternX, z: sternZ, dirX: -fx, dirZ: -fz, side: 'stern', count: dropped });
  slot.cooldown = E.cooldown;
}

function placeMine(c: CoreSim, slot: WeaponSlot, l: WeaponLevelDef, x: number, z: number, vx: number, vz: number): number {
  const core = c.core;
  const depth = slot.branch === 'B';
  const idx = c.placeHazard('mine', 'player', x, z, ex(l, 'trigger', 8), E.duration, E.damage, 0, vx, vz, 'tide-mines', false);
  if (idx < 0) return idx;
  core.hTimer[idx] = ex(l, 'armTime', 1) * (depth ? 1.5 : 1);
  core.hA[idx] = E.area * (depth ? ex(l, 'depthArea', 1.8) : 1);
  core.hB[idx] = E.damage * (depth ? ex(l, 'depthDamage', 1.6) : 1);
  core.hKnock[idx] = depth ? 10 : 6;
  if (slot.branch === 'A') {
    core.hFlags[idx] |= HF_MAGNET;
    core.hC[idx] = ex(l, 'magnetSpeed', 10);
    core.hD[idx] = ex(l, 'magnetRange', 70);
  } else if (depth) core.hFlags[idx] |= HF_DEPTH;
  return idx;
}

function minefield(c: CoreSim, slot: WeaponSlot, l: WeaponLevelDef, rate: number): void {
  const p = c.state.player;
  slot.scratch.seed = (slot.scratch.seed ?? 0) - c.dt * rate;
  if (slot.scratch.seed > 0) return;
  slot.scratch.seed = ex(l, 'seedInterval', 0.7) * cooldownMul(p.stats);
  const hazards = c.state.hazards;
  let mines = 0;
  for (let i = 0; i < hazards.length; i++) { const h = hazards[i]!; if (h.alive && h.kind === 'mine' && h.team === 'player') mines++; }
  if (mines >= ex(l, 'maxMines', 36)) return;
  const a = c.random() * Math.PI * 2, r = 30 + c.random() * 90;
  const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
  if (c.core.onLand(c, x, z)) return;
  placeMine(c, slot, l, x, z, (c.random() - 0.5) * 2, (c.random() - 0.5) * 2);
}
