/**
 * Visual ship frames for FX placement: origin, forward/starboard axes and muzzle height, read from
 * ShipServices.transform/anchor (the visual ship, including heave and heel) with RunState fallbacks.
 */
import * as THREE from 'three';
import type { BossState, CaptainState, EnemyState, RunState } from '../../game/types';
import type { ShipServices } from '../frame';

export class ShipFrame {
  x = 0; y = 0; z = 0;
  fx = 0; fz = -1;
  sx = 1; sz = 0;
  length = 20; beam = 7;
  /** Muzzle height (world Y) and lateral offset of the gun line. */
  gunY = 3; gunSide = 3.5;
  heading = 0;
  found = false;
}

const m = new THREE.Matrix4();
const v = new THREE.Vector3();

export function findShip(run: Readonly<RunState>, id: number): EnemyState | BossState | null {
  if (id < 0) return null; // AI captains: findCaptain
  const enemies = run.enemies;
  for (let i = 0; i < enemies.length; i++) if (enemies[i]!.id === id) return enemies[i]!;
  const bosses = run.bosses;
  for (let i = 0; i < bosses.length; i++) if (bosses[i]!.id === id) return bosses[i]!;
  return null;
}

/** AI captain by its (negative) ship ref (CAPTAINS). */
export function findCaptain(run: Readonly<RunState>, id: number): CaptainState | null {
  const list = run.captains;
  for (let i = 0; i < list.length; i++) if (list[i]!.id === id) return list[i]!;
  return null;
}

/** Fills `out` for ship `id` (0 = player, < 0 = AI captain). Returns false if the ship is unknown to both sim and render. */
export function shipFrame(run: Readonly<RunState>, ships: ShipServices | null, id: number, out: ShipFrame, waterY: (x: number, z: number) => number): boolean {
  let body: { x: number; z: number; heading: number; length: number; beam: number } | null = null;
  if (id === 0) body = run.player;
  else if (id < 0) body = findCaptain(run, id);
  else body = findShip(run, id);
  if (body) { out.length = body.length; out.beam = body.beam; out.heading = body.heading; }
  if (ships && ships.transform(id, m)) {
    const e = m.elements;
    out.x = e[12]!; out.y = e[13]!; out.z = e[14]!;
    let sx = e[0]!, sz = e[2]!;
    let l = Math.hypot(sx, sz) || 1; sx /= l; sz /= l;
    let fx = -e[8]!, fz = -e[10]!;
    l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    out.sx = sx; out.sz = sz; out.fx = fx; out.fz = fz;
    if (!body) { out.heading = Math.atan2(-fx, -fz); }
    out.found = true;
  } else if (body) {
    out.x = body.x; out.z = body.z; out.y = waterY(body.x, body.z);
    out.fx = -Math.sin(body.heading); out.fz = -Math.cos(body.heading);
    out.sx = Math.cos(body.heading); out.sz = -Math.sin(body.heading);
    out.found = true;
  } else {
    out.found = false;
    return false;
  }
  // Gun line: prefer the SHIPS anchor (real gun ports), keep it outside the hull.
  const deck = out.y + Math.max(2.4, Math.min(6, out.length * 0.09));
  out.gunY = deck;
  // Enemy "beam" is the collision diameter; hulls are narrower (≈ 0.3 × length).
  out.gunSide = Math.min(out.beam * 0.5, out.length * (id === 0 ? 0.25 : 0.16)) + 0.6;
  if (ships && ships.anchor(id, 'starboard', v)) {
    const lateral = (v.x - out.x) * out.sx + (v.z - out.z) * out.sz;
    if (lateral > out.gunSide * 0.7 && lateral < out.gunSide * 2) out.gunSide = lateral + 0.4;
    if (v.y > out.y + 0.8 && v.y < out.y + out.length * 0.3) out.gunY = v.y;
  }
  return true;
}
