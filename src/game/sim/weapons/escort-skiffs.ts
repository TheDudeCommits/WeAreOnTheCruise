/**
 * Escort Skiffs (CORE-owned): small boats (HazardState kind 'escort-skiff', team 'player') orbit the ship
 * (`orbitGap` 18 m off the hull, `orbitSpeed` 0.75 rad/s) and each fires 'skiff-shot' projectiles at the nearest
 * ship in range on its own reload. `x/z` and `vx/vz` are kept current for SHIPS/FX (heading = velocity).
 *  - A +2 Skiffs: +`extraSkiffs` (2) boats.
 *  - B Fire Skiffs: every `kamikazeCooldown` (3.4 s) a skiff dashes (`dashSpeed` 48 m/s) into a ship and explodes
 *    (×`kamikazeDamage` 4, `blastArea` 14 m), then a new skiff launches after `respawn` (2.5 s).
 *  - ★ Armada: at least `armada` (8) escorts in a wider ring.
 */
import type { HazardState, WeaponLevelDef, WeaponSlot } from '../../types';
import { targetable, type CoreSim } from '../core-runtime';
import { explode } from '../projectiles';
import { areaMul } from '../stats';
import { AIM, crit, CRIT, E, eff, ex, lead, levelOf } from './common';

const MAX_SKIFFS = 12;
const IDX_KEYS = Array.from({ length: MAX_SKIFFS }, (_, i) => `h${i}`);
const ID_KEYS = Array.from({ length: MAX_SKIFFS }, (_, i) => `i${i}`);
const RESPAWN_KEYS = Array.from({ length: MAX_SKIFFS }, (_, i) => `r${i}`);

export function updateEscortSkiffs(c: CoreSim, slot: WeaponSlot, rate: number): void {
  const p = c.state.player;
  const list = c.state.hazards;
  const core = c.core;
  const l = levelOf(c, slot);
  eff(c, l, 14, 110, 0);
  let count = E.count + (slot.branch === 'A' ? ex(l, 'extraSkiffs', 2) : 0);
  if (slot.overdrive) count = Math.max(count, ex(l, 'armada', 8));
  count = Math.min(MAX_SKIFFS, count);
  const sc = slot.scratch;
  sc.orbit = ((sc.orbit ?? 0) + ex(l, 'orbitSpeed', 0.75) * c.dt) % (Math.PI * 2);
  const ring = p.length * 0.5 + ex(l, 'orbitGap', 18) + (slot.overdrive ? 8 : 0);
  for (let k = 0; k < MAX_SKIFFS; k++) {
    const ik = IDX_KEYS[k]!, dk = ID_KEYS[k]!, rk = RESPAWN_KEYS[k]!;
    const idx = sc[ik] ?? -1;
    let h: HazardState | undefined = idx >= 0 ? list[idx] : undefined;
    if (h && (!h.alive || h.id !== sc[dk] || h.kind !== 'escort-skiff')) h = undefined;
    if (k >= count) {
      if (h) h.alive = false;
      sc[ik] = -1;
      continue;
    }
    if (!h) {
      sc[rk] = (sc[rk] ?? 0) - c.dt;
      if (sc[rk] > 0 || !p.alive) continue;
      const a = sc.orbit + (k / count) * Math.PI * 2;
      const x = p.x + Math.sin(a) * p.beam, z = p.z + Math.cos(a) * p.beam;
      const ni = c.placeHazard('escort-skiff', 'player', x, z, 4, 1e9, E.damage, 0, p.vx, p.vz, 'escort-skiffs', true);
      if (ni < 0) continue;
      h = list[ni]!;
      sc[ik] = ni; sc[dk] = h.id;
      core.hTimer[ni] = E.cooldown * (0.3 + 0.7 * (k / count));
      core.hA[ni] = ex(l, 'kamikazeCooldown', 3.4) * (0.5 + 0.1 * k);
      core.hMode[ni] = 0;
      core.hTarget[ni] = null;
      updateSkiff(c, slot, l, h, ni, k, count, ring, rate);
      continue;
    }
    updateSkiff(c, slot, l, h, idx, k, count, ring, rate);
  }
}

function updateSkiff(
  c: CoreSim, slot: WeaponSlot, l: WeaponLevelDef, h: HazardState, i: number, k: number, count: number, ring: number, rate: number,
): void {
  const p = c.state.player;
  const core = c.core;
  const dt = c.dt;
  h.damage = E.damage;
  if (core.hMode[i] === 1) {
    const t = core.hTarget[i];
    core.hB[i] = core.hB[i]! - dt;
    if (!t || !targetable(t) || core.hB[i]! <= 0) { core.hMode[i] = 0; core.hTarget[i] = null; }
    else {
      const dx = t.x - h.x, dz = t.z - h.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
      const speed = ex(l, 'dashSpeed', 48);
      h.vx += ((dx / d) * speed - h.vx) * Math.min(1, dt * 8);
      h.vz += ((dz / d) * speed - h.vz) * Math.min(1, dt * 8);
      h.x += h.vx * dt; h.z += h.vz * dt;
      if (d <= t.radius + 3) {
        const cm = crit(c);
        explode(c, h.x, h.z, ex(l, 'blastArea', 14) * areaMul(p.stats), E.damage * ex(l, 'kamikazeDamage', 4) * cm, 'player',
          'escort-skiffs', CRIT.on, 5, 'fire', null, 0, 0);
        c.emit({ type: 'hazard-triggered', id: h.id, kind: 'escort-skiff', x: h.x, z: h.z, radius: h.radius });
        h.alive = false;
        slot.scratch[RESPAWN_KEYS[k]!] = ex(l, 'respawn', 2.5);
      }
      return;
    }
  }
  // Orbit station (world-space ring around the ship), smoothed so the boats swing rather than snap.
  const a = (slot.scratch.orbit ?? 0) + (k / count) * Math.PI * 2;
  const tx = p.x + Math.sin(a) * ring, tz = p.z + Math.cos(a) * ring;
  const dx = tx - h.x, dz = tz - h.z;
  const maxV = Math.sqrt(p.vx * p.vx + p.vz * p.vz) + 35;
  let vx = dx * 3 + p.vx, vz = dz * 3 + p.vz;
  const v = Math.sqrt(vx * vx + vz * vz);
  if (v > maxV) { vx *= maxV / v; vz *= maxV / v; }
  h.vx += (vx - h.vx) * Math.min(1, dt * 6);
  h.vz += (vz - h.vz) * Math.min(1, dt * 6);
  h.x += h.vx * dt; h.z += h.vz * dt;

  core.hTimer[i] = core.hTimer[i]! - dt * rate;
  if (core.hTimer[i]! <= 0) {
    const t = core.nearest(c.state, h.x, h.z, E.range, core.bufW2);
    if (!t) core.hTimer[i] = 0.2;
    else {
      lead(h.x, h.z, t, E.speed);
      let sx = AIM.x - h.x, sz = AIM.z - h.z;
      const d = Math.sqrt(sx * sx + sz * sz) || 1;
      sx /= d; sz /= d;
      const cm = crit(c);
      const idx = c.shoot('skiff-shot', 'player', h.x, 2.2, h.z, sx * E.speed, 0, sz * E.speed, E.damage * cm, 1.1, 0, (E.range * 1.1) / E.speed, 'escort-skiffs', CRIT.on, 0);
      if (idx >= 0) core.pKnock[idx] = 0.5;
      c.emit({ type: 'weapon-fired', weapon: 'escort-skiffs', owner: 0, x: h.x, z: h.z, dirX: sx, dirZ: sz, count: 1 });
      core.hTimer[i] = E.cooldown * (0.9 + 0.2 * c.random());
    }
  }
  if (slot.branch === 'B') {
    core.hA[i] = core.hA[i]! - dt * rate;
    if (core.hA[i]! <= 0) {
      const t = core.nearest(c.state, h.x, h.z, E.range, core.bufW2);
      if (!t) core.hA[i] = 0.5;
      else {
        core.hMode[i] = 1; core.hTarget[i] = t; core.hB[i] = 3;
        core.hA[i] = ex(l, 'kamikazeCooldown', 3.4);
      }
    }
  }
}
