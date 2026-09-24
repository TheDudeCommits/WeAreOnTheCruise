/**
 * Maelstrom (EVENTS). A giant whirlpool opens ahead of the ship for ~30 s: a 'maelstrom' hazard of outer radius
 * `radius`. The water itself moves — every ship inside is carried round and drawn in (a current added to its
 * position, so it never fights the helm), faster toward the eye, where hulls are ground (enemies hard, the player
 * less). Bosses, forts and kraken arms hold. Sailing WITH the swirl on the outer band slingshots the player: the hull
 * gains real speed it keeps after leaving. Objective: feed it ships (any enemy sunk in its inner half) → when it
 * collapses, its eye coughs up treasure.
 */
import { EVENT_TUNING } from '../../content/director';
import type { HazardState } from '../../types';
import type { SimContext } from '../context';
import { speedMul } from '../stats';
import { anchor, eventPlayerDamage, eventShipDamage, hurtShip, openEvent, openSpot, payout, resolve, travelBearing, undecided } from './common';
import { OUTCOME_SUCCESS, complete, type EventRuntime, type WorldEventHandler } from './runtime';

/** Spin-up and collapse (s). */
const RAMP = 3;
/** Slingshot acceleration (m/s²) at full alignment and the speed cap as a multiple of the ship's top speed. */
const SLING_ACCEL = 7;
const SLING_CAP = 1.6;

class MaelstromState {
  hazard = 0;
  x = 0;
  z = 0;
  R = 0;
  eye = 0;
  spin = 1;
  duration = 0;
  fed = 0;
  goal = 0;
  grind = 0;
  paid = false;
}

const state = (rt: EventRuntime): MaelstromState => rt.slot('maelstrom', () => new MaelstromState());

function hazardById(c: SimContext, id: number): HazardState | null {
  if (!id) return null;
  for (const h of c.state.hazards) if (h.alive && h.id === id) return h;
  return null;
}

/** A spot for the vortex: ahead of the ship, clear of land. */
function site(c: SimContext): { x: number; z: number } | null {
  const p = c.state.player;
  const R = EVENT_TUNING.maelstromRadius;
  return openSpot(c, p.x, p.z, travelBearing(c), R + 30, R * 0.62, 1.8, 10) ?? openSpot(c, p.x, p.z, travelBearing(c), R + 70, R * 0.5, 3, 10);
}

export const MAELSTROM: WorldEventHandler = {
  id: 'maelstrom',

  weight(c) { return site(c) ? 1 : 0; },

  start(c, rt, minute) {
    const m = state(rt);
    const spot = site(c);
    if (!spot) return null;
    m.x = spot.x; m.z = spot.z;
    m.R = EVENT_TUNING.maelstromRadius; m.eye = EVENT_TUNING.maelstromEye;
    m.spin = c.random() < 0.5 ? 1 : -1;
    m.duration = EVENT_TUNING.maelstromDuration;
    m.fed = 0; m.goal = EVENT_TUNING.maelstromGoal(minute); m.grind = 0.5; m.paid = false;
    const h = c.spawnHazard({
      kind: 'maelstrom', team: 'enemy', x: m.x, z: m.z, radius: m.R, ttl: m.duration, damage: eventPlayerDamage(c, EVENT_TUNING.maelstromGrind),
      tick: 0.5, vx: 0, vz: 0,
    });
    if (!h) return null;
    // The hazard's `armed` flag carries the spin direction for the renderer (true = counter-clockwise seen from above).
    h.armed = m.spin > 0;
    m.hazard = h.id;
    const ev = openEvent('maelstrom', 'Lure ships into its eye', m.duration, m.goal);
    anchor(ev, m.x, m.z, m.R);
    return ev;
  },

  update(c, rt, ev) {
    const m = state(rt);
    const h = hazardById(c, m.hazard);
    const t = rt.t;
    if (!h || t >= m.duration) {
      if (!m.paid && m.fed >= m.goal) {
        m.paid = true;
        payout(c, m.x, m.z, EVENT_TUNING.maelstromDoubloons, 0, 1.3, 22);
      }
      complete(rt);
      return;
    }
    const env = Math.max(0, Math.min(1, t / RAMP, (m.duration - t) / RAMP));
    m.grind -= c.dt;
    const grind = m.grind <= 0;
    if (grind) m.grind += 0.5;
    pull(c, rt, m, env, grind);
    countFed(c, m, h.id);
    ev.progress = Math.min(m.goal, m.fed);
    if (m.fed >= m.goal && undecided(rt)) {
      resolve(c, rt, OUTCOME_SUCCESS, 'The Maelstrom Feeds', 'Enough ships dragged under! Its eye will give up their treasure.');
    }
  },

  finish(c, rt, _ev, aborted) {
    const m = state(rt);
    if (aborted) { const h = hazardById(c, m.hazard); if (h) h.ttl = Math.min(h.ttl, h.age + 2); }
    m.hazard = 0;
  },
};

/** The current: swirl + inflow for every ship inside, the slingshot for the player, grinding in the eye. */
function pull(c: SimContext, rt: EventRuntime, m: MaelstromState, env: number, grind: boolean): void {
  if (env <= 0) return;
  const s = c.state, p = s.player, dt = c.dt;
  const R = m.R, eye = m.eye;
  const swirl = EVENT_TUNING.maelstromSwirl * env, inflow = EVENT_TUNING.maelstromPull * env;
  if (p.alive && p.airborne < 0.2) {
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz);
    if (d < R && d > 1e-3) {
      const nx = dx / d, nz = dz / d;
      const tx = -nz * m.spin, tz = nx * m.spin;
      const f = Math.max(0, Math.min(1, (R - d) / (R - eye * 0.5)));
      const vt = swirl * (0.25 + 0.75 * Math.pow(f, 0.8));
      const vr = inflow * (0.2 + 0.8 * f) * (p.submerged > 0.5 ? 0.5 : 1);
      p.x += (nx * vr + tx * vt) * dt; p.z += (nz * vr + tz * vt) * dt;
      // Slingshot: sailing with the swirl on the outer band builds real hull speed.
      const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
      const align = fx * tx + fz * tz;
      if (align > 0.5 && d > eye * 1.4 && d < R * 0.92) {
        const cap = c.content.ships[p.shipId].maxSpeed * speedMul(p.stats) * SLING_CAP;
        const fwd = p.vx * fx + p.vz * fz;
        if (fwd < cap) { const a = SLING_ACCEL * (align - 0.5) * 2 * env * dt; p.vx += fx * a; p.vz += fz * a; }
      }
      if (grind && d < eye) c.damagePlayer(eventPlayerDamage(c, EVENT_TUNING.maelstromGrind), { x: m.x, z: m.z, kind: 'hazard' });
    }
  }
  const near = c.targetsNear(m.x, m.z, R, rt.targets);
  const grindEye = grind ? eventShipDamage(c, EVENT_TUNING.maelstromGrindEnemy) : 0;
  for (let i = 0; i < near.length; i++) {
    const t = near[i]!;
    if (t.life !== 'alive' || 'phase' in t || t.defId === 'kraken-arm' || t.defId === 'fort') continue;
    const dx = m.x - t.x, dz = m.z - t.z, d = Math.hypot(dx, dz);
    if (d >= R || d < 1e-3) continue;
    const nx = dx / d, nz = dz / d;
    const f = Math.max(0, Math.min(1, (R - d) / (R - eye * 0.5)));
    const vt = swirl * 1.15 * (0.25 + 0.75 * Math.pow(f, 0.8));
    const vr = inflow * 1.25 * (0.2 + 0.8 * f);
    const step = Math.min(d - eye * 0.25, vr * dt);
    t.x += nx * step - nz * m.spin * vt * dt; t.z += nz * step + nx * m.spin * vt * dt;
    if (grind) {
      if (d < eye * 1.25) hurtShip(c, t, grindEye, m.x, m.z, { status: 'slowed', statusTime: 1 });
      else if (d < R * 0.5) hurtShip(c, t, grindEye * 0.15, m.x, m.z);
    }
  }
}

/** Every enemy that goes down in the vortex's inner half counts as fed (once). */
function countFed(c: SimContext, m: MaelstromState, serial: number): void {
  const R2 = (m.R * 0.6) * (m.R * 0.6);
  for (const e of c.state.enemies) {
    if (e.life !== 'sinking' || e.ai.mf === serial || e.defId === 'kraken-arm') continue;
    const dx = e.x - m.x, dz = e.z - m.z;
    if (dx * dx + dz * dz > R2) continue;
    e.ai.mf = serial;
    m.fed++;
  }
}
