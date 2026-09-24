/**
 * AI captains' hull contacts (CAPTAINS-owned), called at the end of CORE's resolveCollisions:
 *  - islands: the hull (a row of circles along the keel) is pushed out of land and loses its inward velocity;
 *  - the player: captains always yield (the player's handling is never disturbed by an ally);
 *  - other captains: pushed apart evenly;
 *  - enemies: pushed apart by a capped mass ratio; a touching enemy deals its contact damage (scaled by how hard it
 *    hit, once per enemy contact cooldown), glances off and takes a little crush credited to the captain;
 *  - bosses: the captain is pushed out (bosses never budge).
 */
import { CAPTAIN } from '../content/captains';
import type { CaptainState } from '../types';
import { captainHit } from './captains-credit';
import { hurtCaptain } from './captains-damage';
import { CLOSEST, isBoss, keelDistance, type CoreSim } from './core-runtime';
import { enemyContactDamage } from './meta-spawn';

const RAM_K = 0.1;
const MAX_CIRCLES = 6;
const CX = new Float64Array(MAX_CIRCLES);
const CZ = new Float64Array(MAX_CIRCLES);
const AX = new Float64Array(MAX_CIRCLES);
const AZ = new Float64Array(MAX_CIRCLES);

/** Circles along a captain's keel (bow → stern) into CX/CZ; returns the count. Radius = beam/2 + 0.5. */
function keelCircles(k: CaptainState): number {
  const r = k.beam * 0.5 + 0.5;
  const half = Math.max(0, k.length * 0.5 - k.beam * 0.5);
  const n = Math.max(3, Math.min(MAX_CIRCLES, Math.ceil((2 * half) / (r * 1.5)) + 1));
  const fx = -Math.sin(k.heading), fz = -Math.cos(k.heading);
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : 1 - (2 * i) / (n - 1);
    CX[i] = k.x + fx * half * u; CZ[i] = k.z + fz * half * u;
  }
  return n;
}

export function resolveCaptainCollisions(c: CoreSim): void {
  const caps = c.state.captains;
  if (caps.length === 0) return;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (!k.alive) continue;
    islands(c, k);
    player(c, k);
    ships(c, k);
  }
  for (let i = 0; i < caps.length; i++) {
    const a = caps[i]!;
    if (!a.alive) continue;
    for (let j = i + 1; j < caps.length; j++) {
      const b = caps[j]!;
      if (b.alive) captains(a, b);
    }
  }
}

function islands(c: CoreSim, k: CaptainState): void {
  const r = k.beam * 0.5 + 0.5;
  if (!c.core.nearIsland(k.x, k.z, k.length * 0.5 + r)) return;
  const n = keelCircles(k);
  for (let i = 0; i < n; i++) {
    const hit = c.world.collideCircle(CX[i]!, CZ[i]!, r);
    if (!hit.hit) continue;
    k.x += hit.nx * hit.depth; k.z += hit.nz * hit.depth;
    for (let j = 0; j < n; j++) { CX[j] = CX[j]! + hit.nx * hit.depth; CZ[j] = CZ[j]! + hit.nz * hit.depth; }
    const vn = k.vx * hit.nx + k.vz * hit.nz;
    if (vn < 0) { k.vx -= vn * hit.nx; k.vz -= vn * hit.nz; k.speed *= 0.9; }
  }
}

function player(c: CoreSim, k: CaptainState): void {
  const p = c.state.player;
  if (!p.alive || p.airborne > 0.3 || p.submerged > 0.5) return;
  const dx = k.x - p.x, dz = k.z - p.z, reach = (k.length + p.length) * 0.5 + 4;
  if (dx * dx + dz * dz > reach * reach) return;
  const r = k.beam * 0.5 + 0.5;
  const n = keelCircles(k);
  for (let i = 0; i < n; i++) {
    const d = keelDistance(p, CX[i]!, CZ[i]!);
    const overlap = p.beam * 0.5 + r - d;
    if (overlap <= 0) continue;
    let nx = 1, nz = 0;
    if (d > 1e-4) { nx = (CX[i]! - CLOSEST.x) / d; nz = (CZ[i]! - CLOSEST.z) / d; }
    k.x += nx * overlap; k.z += nz * overlap;
    const vn = (k.vx - p.vx) * nx + (k.vz - p.vz) * nz;
    if (vn < 0) { k.vx -= vn * nx; k.vz -= vn * nz; }
  }
}

function ships(c: CoreSim, k: CaptainState): void {
  const core = c.core;
  const r = k.beam * 0.5 + 0.5;
  const massK = c.content.ships[k.shipId].mass;
  const n = keelCircles(k);
  const buf = core.bufC;
  for (let i = 0; i < n; i++) {
    const cx = CX[i]!, cz = CZ[i]!;
    const m = core.near(c.state, cx, cz, r + 2, buf);
    for (let j = 0; j < m; j++) {
      const t = buf[j]!;
      if (t.life !== 'alive') continue;
      const boss = isBoss(t);
      if (boss ? t.submerged > 0.5 : t.hidden >= 1) continue;
      const dx = cx - t.x, dz = cz - t.z, d = Math.sqrt(dx * dx + dz * dz);
      const overlap = r + t.radius - d;
      if (overlap <= 0) continue;
      let nx = 1, nz = 0;
      if (d > 1e-4) { nx = dx / d; nz = dz / d; }
      if (boss) { k.x += nx * overlap; k.z += nz * overlap; continue; }
      const def = c.content.enemies[t.defId];
      const massT = (def?.mass ?? 250) * (t.elite ? 1.6 : 1);
      const shareK = Math.min(0.88, Math.max(0.12, massT / (massK + massT)));
      k.x += nx * overlap * shareK; k.z += nz * overlap * shareK;
      t.x -= nx * overlap * (1 - shareK); t.z -= nz * overlap * (1 - shareK);
      // Closing speed of the enemy toward the captain along the contact normal (n points enemy → captain).
      const closing = (t.vx - k.vx) * nx + (t.vz - k.vz) * nz;
      if ((t.ai.contactCd ?? 0) > 0) continue;
      const hit = Math.max(0, closing);
      const dmg = enemyContactDamage(c, t) * Math.min(1.2, Math.max(0.4, 0.4 + (0.6 * hit) / Math.max(4, def?.speed ?? 12)));
      if (dmg > 0) hurtCaptain(c, k, dmg);
      core.push(c, t, -nx, -nz, CAPTAIN.contactBounce * (0.6 + Math.min(1, hit / 10)));
      if (hit > 3) captainHit(c, k.id, t, RAM_K * CAPTAIN.contactCrush * hit * Math.sqrt(massK), false, 0, k.x, k.z);
      t.ai.contactCd = 0.6;
      if (!k.alive) return;
    }
  }
}

function captains(a: CaptainState, b: CaptainState): void {
  const dx = a.x - b.x, dz = a.z - b.z, reach = (a.length + b.length) * 0.5 + 2;
  if (dx * dx + dz * dz > reach * reach) return;
  const n = keelCircles(a);
  const ra = a.beam * 0.5 + 0.5, rb = b.beam * 0.5 + 0.5;
  for (let i = 0; i < n; i++) { AX[i] = CX[i]!; AZ[i] = CZ[i]!; }
  const m = keelCircles(b);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const ddx = AX[i]! - CX[j]!, ddz = AZ[i]! - CZ[j]!, d = Math.sqrt(ddx * ddx + ddz * ddz);
      const overlap = ra + rb - d;
      if (overlap <= 0) continue;
      const nx = d > 1e-4 ? ddx / d : 1, nz = d > 1e-4 ? ddz / d : 0;
      a.x += nx * overlap * 0.5; a.z += nz * overlap * 0.5;
      b.x -= nx * overlap * 0.5; b.z -= nz * overlap * 0.5;
      return;
    }
  }
}
