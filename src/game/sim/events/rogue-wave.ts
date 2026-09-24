/**
 * Rogue Wave (EVENTS). A towering wave front rolls across the area with the wind: a 'rogue-wave' hazard `radius`
 * half-wide, moved here at a steady speed, with a moving 'line' telegraph just ahead of its face. Ships caught in
 * the face are hit once, thrown along with it and briefly stunned — enemies included — and enemy shots in it are
 * washed out. Boosting through it rides the wave instead: no damage and a speed surge. Later in the run a smaller
 * second wave follows. Objective (optional): ride a wave → a small purse.
 *
 * Per-ship ledger: `e.ai.rw` = serial of the last wave that hit it (never saved).
 */
import { EVENT_TUNING } from '../../content/director';
import type { HazardState, TelegraphState } from '../../types';
import type { SimContext } from '../context';
import { fwdX, fwdZ, headingTo } from '../meta-steer';
import { anchor, eventPlayerDamage, eventShipDamage, hurtShip, openEvent, payout, resolve, undecided } from './common';
import { OUTCOME_SUCCESS, complete, type EventRuntime, type WorldEventHandler } from './runtime';

const MAX_WAVES = 3;
/** Half-thickness of the breaking face (m). */
const BAND = 12;
/** Seconds between waves of a set. */
const SET_GAP = 9;
/** How far past the player a wave rolls before it is spent (m). */
const RUN_OUT = 300;
const TELEGRAPH_LEAD = 22;

class WaveState {
  readonly hazards = new Int32Array(MAX_WAVES);
  readonly telegraphs = new Int32Array(MAX_WAVES);
  readonly met = new Uint8Array(MAX_WAVES);
  readonly scale = new Float32Array(MAX_WAVES);
  count = 0;
  spawned = 0;
  dirX = 0;
  dirZ = 1;
  /** Travel heading (forward = (−sin, −cos)) and the crest's line heading. */
  heading = 0;
  serial = 0;
  rides = 0;
  /** Where the set is aimed (the player's position at the start). */
  ox = 0;
  oz = 0;
}

const state = (rt: EventRuntime): WaveState => rt.slot('rogue-wave', () => new WaveState());

function hazardById(c: SimContext, id: number): HazardState | null {
  if (!id) return null;
  for (const h of c.state.hazards) if (h.alive && h.id === id) return h;
  return null;
}

function telegraphById(c: SimContext, id: number): TelegraphState | null {
  if (!id) return null;
  for (const t of c.state.telegraphs) if (t.alive && t.id === id) return t;
  return null;
}

export const ROGUE_WAVE: WorldEventHandler = {
  id: 'rogue-wave',

  start(c, rt, minute) {
    const w = state(rt);
    const s = c.state, p = s.player;
    // Waves run with the wind (windDir points where it blows TO), give or take.
    const a = s.sea.windDir + (c.random() - 0.5) * 0.9;
    w.dirX = Math.sin(a); w.dirZ = Math.cos(a);
    w.heading = headingTo(w.dirX, w.dirZ);
    w.count = Math.min(MAX_WAVES, EVENT_TUNING.rogueWaves(minute));
    w.spawned = 0; w.rides = 0; w.serial++;
    w.ox = p.x; w.oz = p.z;
    for (let i = 0; i < MAX_WAVES; i++) { w.hazards[i] = 0; w.telegraphs[i] = 0; w.met[i] = 0; w.scale[i] = i === 0 ? 1 : 0.78; }
    spawnWave(c, w, 0);
    if (!w.hazards[0]) return null;
    const speed = EVENT_TUNING.rogueWaveSpeed;
    const duration = (EVENT_TUNING.rogueWaveStart + RUN_OUT) / speed + (w.count - 1) * SET_GAP;
    const ev = openEvent('rogue-wave', w.count > 1 ? 'Ride the waves: boost through them' : 'Ride the wave: boost through it', duration, w.count);
    anchor(ev, w.ox - w.dirX * EVENT_TUNING.rogueWaveStart, w.oz - w.dirZ * EVENT_TUNING.rogueWaveStart, 30);
    return ev;
  },

  update(c, rt, ev) {
    const w = state(rt);
    const dt = c.dt;
    if (w.spawned < w.count && rt.t >= w.spawned * SET_GAP) spawnWave(c, w, w.spawned);
    let live = 0;
    for (let i = 0; i < w.spawned; i++) {
      const h = hazardById(c, w.hazards[i]!);
      if (!h) { w.hazards[i] = 0; continue; }
      live++;
      h.x += h.vx * dt; h.z += h.vz * dt;
      if (i === 0 || !hazardById(c, w.hazards[0]!)) { ev.x = h.x; ev.z = h.z; }
      const t = telegraphById(c, w.telegraphs[i]!);
      const along = (c.state.player.x - h.x) * w.dirX + (c.state.player.z - h.z) * w.dirZ;
      if (t) {
        if (along < -BAND * 2) { t.alive = false; w.telegraphs[i] = 0; }
        else placeTelegraph(t, h, w);
      }
      sweep(c, rt, w, h, i);
    }
    ev.progress = w.rides;
    if (live === 0 && w.spawned >= w.count) {
      if (w.rides > 0 && undecided(rt)) {
        const p = c.state.player;
        payout(c, p.x + fwdX(p.heading) * 30, p.z + fwdZ(p.heading) * 30, EVENT_TUNING.rogueWaveDoubloons, 0, 0.6, 10);
        resolve(c, rt, OUTCOME_SUCCESS, 'Wave Rider!', 'You rode the rogue wave and it carried you clear.');
      }
      complete(rt);
    }
  },

  finish(c, rt, _ev, aborted) {
    const w = state(rt);
    for (let i = 0; i < MAX_WAVES; i++) {
      const t = telegraphById(c, w.telegraphs[i]!);
      if (t) t.alive = false;
      w.telegraphs[i] = 0;
      if (aborted) { const h = hazardById(c, w.hazards[i]!); if (h) h.ttl = Math.min(h.ttl, h.age + 1.2); }
      w.hazards[i] = 0;
    }
  },
};

function spawnWave(c: SimContext, w: WaveState, i: number): void {
  const speed = EVENT_TUNING.rogueWaveSpeed;
  const start = EVENT_TUNING.rogueWaveStart;
  const x = w.ox - w.dirX * start, z = w.oz - w.dirZ * start;
  const ttl = (start + RUN_OUT) / speed;
  const h = c.spawnHazard({
    kind: 'rogue-wave', team: 'enemy', x, z, radius: EVENT_TUNING.rogueWaveHalfWidth * (0.85 + 0.15 * w.scale[i]!), ttl,
    damage: eventPlayerDamage(c, EVENT_TUNING.rogueWaveDamage * w.scale[i]!), vx: w.dirX * speed, vz: w.dirZ * speed,
  });
  w.hazards[i] = h ? h.id : 0;
  w.spawned = i + 1;
  if (!h) return;
  const t = c.addTelegraph({ shape: 'line', team: 'enemy', x, z, radius: 8, length: h.radius * 2, angle: 0, duration: ttl + 5 });
  w.telegraphs[i] = t ? t.id : 0;
  if (t) placeTelegraph(t, h, w);
}

/** The warning strip runs along the crest, just ahead of the face. */
function placeTelegraph(t: TelegraphState, h: HazardState, w: WaveState): void {
  // Crest direction: perpendicular to travel. The strip starts at one end and runs `length` along heading `angle`.
  const px = w.dirZ, pz = -w.dirX;
  const cx = h.x + w.dirX * TELEGRAPH_LEAD, cz = h.z + w.dirZ * TELEGRAPH_LEAD;
  t.x = cx + px * h.radius; t.z = cz + pz * h.radius;
  t.angle = headingTo(-px, -pz);
  t.length = h.radius * 2;
  t.time = 0;
}

/** Hits, throws and carries everything in the wave's face; washes out enemy shots. */
function sweep(c: SimContext, rt: EventRuntime, w: WaveState, h: HazardState, i: number): void {
  const s = c.state, p = s.player, dt = c.dt;
  const dirX = w.dirX, dirZ = w.dirZ;
  const rise = Math.min(1, h.age / 2.5);
  if (rise < 0.6) return;
  // Player.
  if (p.alive) {
    const rx = p.x - h.x, rz = p.z - h.z;
    const along = rx * dirX + rz * dirZ, lat = rx * dirZ - rz * dirX;
    if (Math.abs(along) <= BAND + p.beam * 0.5 && Math.abs(lat) <= h.radius) {
      if (!w.met[i]) {
        w.met[i] = 1;
        const riding = p.skills.boost.active > 0;
        if (riding) {
          w.rides++;
          const fx = fwdX(p.heading), fz = fwdZ(p.heading);
          p.vx += fx * EVENT_TUNING.rogueWaveSurge; p.vz += fz * EVENT_TUNING.rogueWaveSurge;
        } else if (p.airborne < 0.2 && p.submerged < 0.5) {
          c.damagePlayer(h.damage, { x: p.x - dirX * 12, z: p.z - dirZ * 12, kind: 'hazard' });
          c.applyStatus(p, 'stunned', 0.45);
          p.vx += dirX * 9; p.vz += dirZ * 9;
        }
      }
      if (p.skills.boost.active <= 0 && p.airborne < 0.2 && p.submerged < 0.5) { p.x += h.vx * dt * 0.55; p.z += h.vz * dt * 0.55; }
    }
  }
  // Ships.
  const near = c.targetsNear(h.x, h.z, h.radius + BAND, rt.targets);
  const serial = w.serial * 4 + i + 1;
  const shipDmg = eventShipDamage(c, EVENT_TUNING.rogueWaveEnemy * w.scale[i]!);
  for (let k = 0; k < near.length; k++) {
    const t = near[k]!;
    if (t.life !== 'alive') continue;
    const boss = 'phase' in t;
    if (!boss && (t.defId === 'kraken-arm' || t.defId === 'fort')) continue;
    const rx = t.x - h.x, rz = t.z - h.z;
    const along = rx * dirX + rz * dirZ, lat = rx * dirZ - rz * dirX;
    if (Math.abs(along) > BAND + t.radius || Math.abs(lat) > h.radius + t.radius) continue;
    if (t.ai.rw !== serial) {
      t.ai.rw = serial;
      hurtShip(c, t, shipDmg, t.x - dirX * 20, t.z - dirZ * 20, { knock: 14, status: 'stunned', statusTime: 1.2, bossMul: 0.2 });
    }
    if (!boss && t.life === 'alive') { t.x += h.vx * dt * 0.75; t.z += h.vz * dt * 0.75; }
  }
  // Enemy shots caught in the face are washed out.
  const shots = s.projectiles;
  for (let k = 0; k < shots.length; k++) {
    const pr = shots[k]!;
    if (!pr.alive || pr.team !== 'enemy') continue;
    const rx = pr.x - h.x, rz = pr.z - h.z;
    if (Math.abs(rx * dirX + rz * dirZ) > BAND || Math.abs(rx * dirZ - rz * dirX) > h.radius) continue;
    pr.alive = false;
    c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: 0, z: pr.z, target: 'water', damage: 0, crit: false });
  }
}
