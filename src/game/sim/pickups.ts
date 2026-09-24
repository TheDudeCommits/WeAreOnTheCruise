/**
 * Treasure magnet + collection (CORE-owned). Collection effects are META's (progression.onPickupCollected).
 *
 * Feel: inside the pickup radius (ship × pickupRadius stat) a pickup is magnetised: it pops outward for a beat,
 * then accelerates into the hull (pull speed grows with time and distance, and always outruns the ship). A pickup is
 * collected when it touches the hull capsule. When loose XP piles up, nearby coins merge (copper → silver → gold).
 */
import type { PickupKind } from '../ids';
import type { PickupState } from '../types';
import { keelDistance, type CoreSim } from './core-runtime';
import { onPickupCollected } from './progression';
import { pickupMul } from './stats';

const POP_SPEED = -9;
const PULL_ACCEL = 170;
const MERGE_THRESHOLD = 300;
const MERGE_CELL = 18;
const MERGE_BITS = 10;
const XP_KIND: Readonly<Record<PickupKind, boolean>> = {
  'xp-copper': true, 'xp-silver': true, 'xp-gold': true, doubloon: false, repair: false, compass: false, 'powder-keg': false, chest: false,
};

const mergeKey = new Int32Array(1 << MERGE_BITS);
const mergeIdx = new Int32Array(1 << MERGE_BITS);
const mergeStamp = new Int32Array(1 << MERGE_BITS);
let stamp = 0;

export function updatePickups(c: CoreSim): void {
  const p = c.state.player;
  if (!p.alive) return;
  const core = c.core;
  const dt = c.dt;
  const list = c.state.pickups;
  const ship = c.content.ships[p.shipId];
  const radius = ship.pickupRadius * pickupMul(p.stats);
  const collect = p.beam * 0.5 + 3;
  const shipSpeed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  let xpAlive = 0;
  for (let i = 0; i < list.length; i++) {
    const k = list[i]!;
    if (!k.alive) continue;
    k.age += dt;
    let dx = p.x - k.x, dz = p.z - k.z;
    let d = Math.sqrt(dx * dx + dz * dz);
    if (!k.magnet && d < radius) { k.magnet = true; core.kSpeed[i] = POP_SPEED; }
    if (k.magnet) {
      const maxV = 60 + shipSpeed * 1.4 + d * 0.6;
      const v = Math.min(maxV, core.kSpeed[i]! + (PULL_ACCEL + k.age * 20) * dt);
      core.kSpeed[i] = v;
      if (d > 1e-3) {
        const step = v > 0 ? Math.min(d, v * dt) : v * dt;
        k.x += (dx / d) * step; k.z += (dz / d) * step;
        dx = p.x - k.x; dz = p.z - k.z; d = Math.sqrt(dx * dx + dz * dz);
      }
    }
    if (d < p.length && keelDistance(p, k.x, k.z) <= collect) {
      k.alive = false;
      c.emit({ type: 'pickup-collected', id: k.id, kind: k.kind, x: k.x, z: k.z, value: k.value });
      onPickupCollected(c, k);
      continue;
    }
    if (XP_KIND[k.kind]) {
      if (!k.magnet && k.age > 90) { k.alive = false; continue; }
      xpAlive++;
    }
  }
  if (xpAlive > MERGE_THRESHOLD && c.state.tick % 30 === 0) mergeLooseXp(list);
}

function xpKindFor(value: number): PickupKind {
  return value >= 25 ? 'xp-gold' : value >= 5 ? 'xp-silver' : 'xp-copper';
}

/** Merges loose (non-magnetised) XP pickups that share an 18 m cell into one coin/bar. */
function mergeLooseXp(list: PickupState[]): void {
  stamp++;
  const mask = (1 << MERGE_BITS) - 1;
  for (let i = 0; i < list.length; i++) {
    const k = list[i]!;
    if (!k.alive || k.magnet || !XP_KIND[k.kind]) continue;
    const cx = Math.floor(k.x / MERGE_CELL), cz = Math.floor(k.z / MERGE_CELL);
    const key = Math.imul(cx, 0x8da6b343) ^ Math.imul(cz, 0xd8163841);
    const h = key & mask;
    if (mergeStamp[h] !== stamp) { mergeStamp[h] = stamp; mergeKey[h] = key; mergeIdx[h] = i; continue; }
    if (mergeKey[h] !== key) continue;
    const into = list[mergeIdx[h]!]!;
    into.value += k.value;
    into.kind = xpKindFor(into.value);
    k.alive = false;
  }
}
