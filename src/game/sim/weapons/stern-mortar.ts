/**
 * Stern Mortar (CORE-owned): lobs shells at the densest cluster between `minRange` (90 m) and range.
 * Extra shells go to the next-densest clusters (or scatter around the first).
 *  - A Cluster Shells: each shell bursts into `bomblets` (3) bomblets (×`bombletDamage` 0.45, ×`bombletArea` 0.55).
 *  - B Firepots: each shell leaves a fire patch (`fireDuration` 4 s, ×`fireDamage` 0.25 per tick, ×`fireArea` 0.8).
 *  - ★ Meteor Rain: shells keep falling from the sky around the ship (`meteorInterval` 0.19 s, ×`meteorDamage` 0.7).
 */
import type { WeaponLevelDef, WeaponSlot } from '../../types';
import { GRAVITY, PF_CLUSTER, PF_FIREPOT, type CoreSim } from '../core-runtime';
import { cooldownMul, durationMul } from '../stats';
import { addChosen, crit, CRIT, densest, E, eff, ex, levelOf, lobShell, resetChosen } from './common';

export function updateSternMortar(c: CoreSim, slot: WeaponSlot, rate: number): void {
  const p = c.state.player;
  const core = c.core;
  const l = levelOf(c, slot);
  eff(c, l, 16, 60, 0);
  const minR = ex(l, 'minRange', 90), maxR = E.range;
  if (slot.overdrive) meteorRain(c, slot, l, rate, maxR);
  if (slot.cooldown > 0) return;

  // Candidates in the firing ring.
  const buf = core.bufW;
  const n = core.near(c.state, p.x, p.z, maxR, buf);
  if (n === 0) return;
  const sternX = p.x + Math.sin(p.heading) * p.length * 0.45, sternZ = p.z + Math.cos(p.heading) * p.length * 0.45;
  const shells = E.count;
  resetChosen();
  let fired = 0, dirX = 0, dirZ = 0;
  let lastX = 0, lastZ = 0;
  for (let s = 0; s < shells; s++) {
    const idx = densest(buf, n, E.area, E.area * 1.2, p.x, p.z, minR);
    let tx: number, tz: number, T: number;
    if (idx >= 0) {
      const t = buf[idx]!;
      const d = Math.hypot(t.x - sternX, t.z - sternZ);
      T = Math.min(3, Math.max(1.2, d / E.speed));
      tx = AIM_X(t.x, t.vx, T); tz = AIM_X(t.z, t.vz, T);
      addChosen(t.x, t.z);
    } else if (fired > 0) {
      const a = c.random() * Math.PI * 2, r = (0.3 + c.random() * 0.5) * E.area;
      tx = lastX + Math.sin(a) * r; tz = lastZ + Math.cos(a) * r;
      T = Math.min(3, Math.max(1.2, Math.hypot(tx - sternX, tz - sternZ) / E.speed));
    } else break;
    fireShell(c, slot, l, sternX, sternZ, 5, tx, tz, T, E.damage, E.area);
    if (fired === 0) { const d = Math.hypot(tx - p.x, tz - p.z) || 1; dirX = (tx - p.x) / d; dirZ = (tz - p.z) / d; }
    lastX = tx; lastZ = tz;
    fired++;
  }
  if (fired === 0) return;
  c.emit({ type: 'weapon-fired', weapon: 'stern-mortar', owner: 0, x: sternX, z: sternZ, dirX, dirZ, side: 'stern', count: fired });
  core.kickPitch(-0.05);
  slot.cooldown = E.cooldown;
}

const AIM_X = (pos: number, vel: number, t: number): number => pos + vel * t;

function fireShell(
  c: CoreSim, slot: WeaponSlot, l: WeaponLevelDef, fromX: number, fromZ: number, y0: number, tx: number, tz: number, T: number,
  damage: number, area: number,
): number {
  const core = c.core;
  const cm = crit(c);
  const idx = lobShell(c, 'mortar-shell', fromX, fromZ, y0, tx, tz, T, damage * cm, area, 'stern-mortar', CRIT.on);
  if (idx < 0) return idx;
  core.pKnock[idx] = ex(l, 'knockback', 3);
  if (slot.branch === 'A') {
    core.pFlags[idx] |= PF_CLUSTER;
    core.pA[idx] = ex(l, 'bomblets', 3); core.pB[idx] = ex(l, 'bombletDamage', 0.45); core.pC[idx] = ex(l, 'bombletArea', 0.55);
  } else if (slot.branch === 'B') {
    core.pFlags[idx] |= PF_FIREPOT;
    core.pA[idx] = ex(l, 'fireDuration', 4) * durationMul(c.state.player.stats);
    core.pB[idx] = ex(l, 'fireDamage', 0.25); core.pC[idx] = ex(l, 'fireArea', 0.8);
  }
  return idx;
}

/** ★ Meteor Rain: shells drop from the sky onto ships (70%) or open water (30%) around the ship. */
function meteorRain(c: CoreSim, slot: WeaponSlot, l: WeaponLevelDef, rate: number, maxR: number): void {
  const p = c.state.player;
  const core = c.core;
  slot.scratch.meteor = (slot.scratch.meteor ?? 0) - c.dt * rate;
  if (slot.scratch.meteor > 0) return;
  const buf = core.bufW2;
  const n = core.near(c.state, p.x, p.z, maxR, buf);
  if (n === 0) { slot.scratch.meteor = 0.25; return; }
  const interval = ex(l, 'meteorInterval', 0.19) * cooldownMul(p.stats);
  const damage = E.damage * ex(l, 'meteorDamage', 0.7), area = E.area * 0.8;
  const fall = 45, y0 = 90;
  const T = (-fall + Math.sqrt(fall * fall + 2 * GRAVITY * y0)) / GRAVITY;
  for (let guard = 0; guard < 3 && slot.scratch.meteor <= 0; guard++) {
    slot.scratch.meteor += interval;
    let tx: number, tz: number;
    if (c.random() < 0.7) {
      const t = buf[Math.floor(c.random() * n)]!;
      tx = t.x + t.vx * T; tz = t.z + t.vz * T;
    } else {
      const a = c.random() * Math.PI * 2, r = 35 + c.random() * (maxR * 0.8 - 35);
      tx = p.x + Math.sin(a) * r; tz = p.z + Math.cos(a) * r;
    }
    const drift = c.random() * Math.PI * 2;
    const vx = Math.sin(drift) * 10, vz = Math.cos(drift) * 10;
    const cm = crit(c);
    const idx = c.shoot('mortar-shell', 'player', tx - vx * T, y0, tz - vz * T, vx, -fall, vz, damage * cm, 1.8, 0, T + 2, 'stern-mortar', CRIT.on, area);
    if (idx < 0) continue;
    core.pKnock[idx] = ex(l, 'knockback', 3);
    if (slot.branch === 'A') {
      core.pFlags[idx] |= PF_CLUSTER;
      core.pA[idx] = ex(l, 'bomblets', 3); core.pB[idx] = ex(l, 'bombletDamage', 0.45); core.pC[idx] = ex(l, 'bombletArea', 0.55);
    } else if (slot.branch === 'B') {
      core.pFlags[idx] |= PF_FIREPOT;
      core.pA[idx] = ex(l, 'fireDuration', 4) * durationMul(p.stats) * 0.6;
      core.pB[idx] = ex(l, 'fireDamage', 0.25); core.pC[idx] = ex(l, 'fireArea', 0.8) * 0.8;
    }
  }
}
