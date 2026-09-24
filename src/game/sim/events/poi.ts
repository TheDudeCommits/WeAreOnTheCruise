/**
 * Points of interest (EVENTS): small, optional things out on the water between set pieces.
 *  - Trade-wind lanes ('trade-wind' patches in a row): a current that carries every ship along it; sailing WITH it
 *    also builds real hull speed (up to TRADE_CAP × top speed) that the ship keeps after leaving.
 *  - Lighthouse beacons ('beacon'): a signal ring off the shore of a lighthouse island in reach (once per island per
 *    run); sailing through it grants the keeper's blessing: faster guns (frenzy) and a light shield for a while.
 *  - Floating salvage ('salvage'): wreckage adrift; sail over it to haul up treasure (sometimes doubloons or a crate).
 * Everything here is deterministic (c.random) and runs every director tick from updateWorldEvents.
 */
import { EVENT_TUNING } from '../../content/director';
import type { HazardState } from '../../types';
import type { SimContext } from '../context';
import { hullEdge } from '../core-runtime';
import { fwdX, fwdZ, openWaterNear, rand } from '../meta-steer';
import { speedMul } from '../stats';
import { openSpot, spillDoubloons, spillTreasure, travelBearing } from './common';
import type { EventRuntime } from './runtime';

class PoiState {
  init = false;
  nextWind = 0;
  nextSalvage = 0;
  readonly usedBeacons = new Set<string>();
}

const state = (rt: EventRuntime): PoiState => rt.slot('poi', () => new PoiState());

export function updatePois(c: SimContext, rt: EventRuntime): void {
  const s = c.state;
  const p = s.player;
  const ps = state(rt);
  if (!ps.init) {
    ps.init = true;
    ps.nextWind = s.time + EVENT_TUNING.poiFirst;
    ps.nextSalvage = s.time + EVENT_TUNING.poiFirst * 0.6;
  }
  if (p.alive) {
    if (s.time >= ps.nextWind) { ps.nextWind = s.time + rand(c, EVENT_TUNING.tradeWindEvery[0], EVENT_TUNING.tradeWindEvery[1]); spawnLane(c); }
    if (s.time >= ps.nextSalvage) { ps.nextSalvage = s.time + rand(c, EVENT_TUNING.salvageEvery[0], EVENT_TUNING.salvageEvery[1]); spawnSalvage(c); }
    if (s.tick % 60 === 0) checkBeacons(c, rt, ps);
  }
  const hazards = s.hazards;
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i]!;
    if (!h.alive) continue;
    if (h.kind === 'trade-wind') current(c, rt, h);
    else if (h.kind === 'salvage') salvage(c, h);
    else if (h.kind === 'beacon') beacon(c, h);
  }
}

// ───────────────────────── Trade winds ─────────────────────────

function spawnLane(c: SimContext): void {
  const p = c.state.player;
  const b = travelBearing(c);
  const spot = openSpot(c, p.x, p.z, b + rand(c, -0.7, 0.7), 170, 40, 1.4, 8);
  if (!spot) return;
  const cx = spot.x, cz = spot.z;
  // The current runs across or along the ship's course, never straight at it.
  const flow = b + (c.random() < 0.5 ? 1 : -1) * rand(c, 0.35, 1.3);
  const fx = fwdX(flow), fz = fwdZ(flow);
  const n = EVENT_TUNING.tradeWindPatches, r = EVENT_TUNING.tradeWindRadius, v = EVENT_TUNING.tradeWindSpeed;
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * r * 1.7;
    const x = cx + fx * off, z = cz + fz * off;
    if (!c.world.isWater(x, z, r * 0.5)) continue;
    c.spawnHazard({ kind: 'trade-wind', team: 'player', x, z, radius: r, ttl: EVENT_TUNING.tradeWindTtl, damage: 0, vx: fx * v, vz: fz * v });
  }
}

/** Carries ships inside a patch; the player also gains speed sailing with it. */
function current(c: SimContext, rt: EventRuntime, h: HazardState): void {
  const dt = c.dt;
  const env = Math.max(0, Math.min(1, h.age / 2, (h.ttl - h.age) / 3));
  if (env <= 0) return;
  const p = c.state.player;
  const r2 = h.radius * h.radius;
  if (p.alive && p.airborne < 0.2) {
    const dx = p.x - h.x, dz = p.z - h.z;
    if (dx * dx + dz * dz <= r2) {
      p.x += h.vx * dt * env; p.z += h.vz * dt * env;
      const sp = Math.hypot(h.vx, h.vz) || 1;
      const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
      const align = (fx * h.vx + fz * h.vz) / sp;
      if (align > 0.6) {
        const cap = c.content.ships[p.shipId].maxSpeed * speedMul(p.stats) * EVENT_TUNING.tradeWindCap;
        const fwd = p.vx * fx + p.vz * fz;
        if (fwd < cap) { const a = EVENT_TUNING.tradeWindAccel * (align - 0.6) * 2.5 * env * dt; p.vx += fx * a; p.vz += fz * a; }
      }
    }
  }
  const near = c.targetsNear(h.x, h.z, h.radius, rt.targets);
  for (let i = 0; i < near.length; i++) {
    const t = near[i]!;
    if (t.life !== 'alive' || 'phase' in t || t.defId === 'kraken-arm' || t.defId === 'fort') continue;
    const dx = t.x - h.x, dz = t.z - h.z;
    if (dx * dx + dz * dz > r2) continue;
    t.x += h.vx * dt * env * 0.8; t.z += h.vz * dt * env * 0.8;
  }
}

// ───────────────────────── Salvage ─────────────────────────

function spawnSalvage(c: SimContext): void {
  const p = c.state.player;
  const spot = openSpot(c, p.x, p.z, travelBearing(c) + rand(c, -1.1, 1.1), rand(c, 150, 230), 20, 1.5, 8);
  if (!spot) return;
  c.spawnHazard({ kind: 'salvage', team: 'player', x: spot.x, z: spot.z, radius: EVENT_TUNING.salvageRadius, ttl: EVENT_TUNING.salvageTtl, damage: 0 });
}

function salvage(c: SimContext, h: HazardState): void {
  const p = c.state.player;
  if (!p.alive || hullEdge(p, h.x, h.z) > h.radius) return;
  h.alive = false;
  c.emit({ type: 'hazard-triggered', id: h.id, kind: 'salvage', x: h.x, z: h.z, radius: h.radius });
  spillTreasure(c, h.x, h.z, EVENT_TUNING.salvageXp(c.state.time / 60), 7, 3);
  if (c.random() < 0.3) spillDoubloons(c, h.x, h.z, 3, 6);
  if (c.random() < EVENT_TUNING.salvageRepair) c.spawnPickup('repair', h.x + rand(c, -4, 4), h.z + rand(c, -4, 4), 1);
}

// ───────────────────────── Lighthouse beacons ─────────────────────────

/** Lights a beacon ring off a lighthouse island in reach (once per island per run). */
function checkBeacons(c: SimContext, rt: EventRuntime, ps: PoiState): void {
  const p = c.state.player;
  for (const h of c.state.hazards) if (h.alive && h.kind === 'beacon') return;
  const list = c.world.islandsNear(p.x, p.z, EVENT_TUNING.beaconReach, rt.islands);
  for (const isl of list) {
    if (isl.landmark !== 'lighthouse' || ps.usedBeacons.has(isl.id)) continue;
    const dx = p.x - isl.x, dz = p.z - isl.z, d = Math.hypot(dx, dz) || 1;
    const off = isl.radius + 45;
    const spot = openWaterNear(c, isl.x + (dx / d) * off, isl.z + (dz / d) * off, EVENT_TUNING.beaconRadius + 6, 5);
    if (!spot) continue;
    ps.usedBeacons.add(isl.id);
    c.spawnHazard({ kind: 'beacon', team: 'player', x: spot.x, z: spot.z, radius: EVENT_TUNING.beaconRadius, ttl: EVENT_TUNING.beaconTtl, damage: 0 });
    return;
  }
}

function beacon(c: SimContext, h: HazardState): void {
  const p = c.state.player;
  if (!p.alive || hullEdge(p, h.x, h.z) > h.radius) return;
  h.alive = false;
  const time = EVENT_TUNING.beaconBuff;
  c.applyStatus(p, 'frenzy', time, EVENT_TUNING.beaconFireRate);
  p.shield = Math.max(p.shield, p.maxHp * EVENT_TUNING.beaconShield);
  c.applyStatus(p, 'shielded', time, 1);
  c.emit({ type: 'hazard-triggered', id: h.id, kind: 'beacon', x: h.x, z: h.z, radius: h.radius });
  c.emit({ type: 'director-event', name: "Keeper's Blessing", text: `The lighthouse signals you on: faster guns and a shield for ${time} s.` });
}
