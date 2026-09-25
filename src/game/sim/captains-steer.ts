/**
 * AI captains' seamanship (CAPTAINS-owned): pick a fight near the player, turn beam-on for broadsides, keep range,
 * fall back to patch the hull when badly hurt, keep station on the player when nothing is in reach, never wander
 * beyond the leash, avoid islands (look-ahead probes on WorldQuery.isWater), and keep clear of each other, the player
 * and enemy hulls. Captains sail on the ship tables (speed, turn rate) with a keel like the enemy AI's.
 *
 * `k.ai.mode` (read by the UI for callouts): 0 escort · 1 engage · 2 retreat · 3 recall.
 */
import { CAPTAIN } from '../content/captains';
import type { CaptainState } from '../types';
import type { Target } from './context';
import { broadsideRange } from './captains-guns';
import { isHostile } from './captains-rival';
import { captainSlot } from './captains-runtime';
import { acquirable, type CoreSim } from './core-runtime';

export const MODE_ESCORT = 0, MODE_ENGAGE = 1, MODE_RETREAT = 2, MODE_RECALL = 3;

const TAU = Math.PI * 2;
const wrap = (a: number): number => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const headingTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
const fwdX = (h: number): number => -Math.sin(h);
const fwdZ = (h: number): number => -Math.cos(h);
const AVOID_STEPS = [0.55, 1.05, 1.6, 2.2] as const;

export function steerCaptain(c: CoreSim, k: CaptainState): void {
  const s = c.state, p = s.player, ai = k.ai, dt = c.dt;
  const ship = c.content.ships[k.shipId];
  const vmax = ship.maxSpeed * CAPTAIN.speedMul;
  const turn = ship.turnRate * CAPTAIN.turnMul;
  const dP = Math.hypot(p.x - k.x, p.z - k.z);

  // Retreat when badly holed; recover once patched (or after a while).
  if (ai.mode !== MODE_RETREAT && k.hp < k.maxHp * CAPTAIN.retreatBelow) { ai.mode = MODE_RETREAT; ai.retreatT = 0; ai.tgt = 0; ai.retreats = (ai.retreats ?? 0) + 1; }
  if (ai.mode === MODE_RETREAT) {
    ai.retreatT = (ai.retreatT ?? 0) + dt;
    if (k.hp > k.maxHp * CAPTAIN.recoverAbove || ai.retreatT > CAPTAIN.retreatMax) ai.mode = MODE_ESCORT;
  }

  // Target: re-evaluated every ~1.2 s or when lost; only fights near the player count. A hostile rival hunts the player.
  const hostile = isHostile(k) && p.alive;
  ai.tgtT = (ai.tgtT ?? 0) - dt;
  let t: { x: number; z: number; radius: number } | null = null;
  if (hostile) ai.tgt = 0;
  else {
    let e: Target | null = ai.tgt ? c.findTarget(ai.tgt) ?? null : null;
    if (e && (!acquirable(e) || Math.hypot(e.x - p.x, e.z - p.z) > CAPTAIN.engageRadius + 60 + e.radius)) e = null;
    if (ai.mode !== MODE_RETREAT && (!e || ai.tgtT <= 0)) {
      e = pickTarget(c, k);
      ai.tgtT = 1.1 + c.random() * 0.4;
    }
    ai.tgt = e ? e.id : 0;
    t = e;
  }
  if (hostile && ai.mode !== MODE_RETREAT) t = p;

  let desired: number, speed: number;
  if (dP > CAPTAIN.leash && ai.mode !== MODE_RETREAT && !hostile) {
    ai.mode = MODE_RECALL;
    desired = headingTo(p.x - k.x, p.z - k.z);
    speed = vmax * CAPTAIN.catchUp;
  } else if (ai.mode === MODE_RETREAT) {
    const r = retreatHeading(c, k);
    desired = r; speed = vmax;
  } else if (t) {
    ai.mode = MODE_ENGAGE;
    const dx = t.x - k.x, dz = t.z - k.z, dist = Math.hypot(dx, dz);
    const hb = headingTo(dx, dz);
    const R = clamp(broadsideRange(k) * 0.7, 70, 140) + t.radius;
    // Starboard (+1) puts the target on the right beam (heading = bearing + π/2), port (−1) on the left.
    let side = ai.side || 1;
    const readyS = (ai.reloadS ?? 0) <= 0.6, readyP = (ai.reloadP ?? 0) <= 0.6;
    const turnS = Math.abs(wrap(hb + Math.PI / 2 - k.heading)), turnP = Math.abs(wrap(hb - Math.PI / 2 - k.heading));
    if (readyS && !readyP) side = 1;
    else if (readyP && !readyS) side = -1;
    else if ((side > 0 ? turnS : turnP) > (side > 0 ? turnP : turnS) + 0.6) side = -side;
    ai.side = side;
    if (dist > R + 90) { desired = hb + side * 0.35; speed = vmax; }
    else {
      const rangeErr = clamp((dist - R) / 60, -1, 1);
      desired = hb + side * (Math.PI / 2 - rangeErr * 0.6);
      speed = vmax * 0.72;
    }
  } else {
    ai.mode = MODE_ESCORT;
    const slot = captainSlot(k.id);
    const a = p.heading + (CAPTAIN.escortAngles[slot] ?? Math.PI);
    const R = CAPTAIN.escortRange[0] + (CAPTAIN.escortRange[1] - CAPTAIN.escortRange[0]) * ((slot % 2) * 0.6 + 0.2);
    const tx = p.x + fwdX(a) * R, tz = p.z + fwdZ(a) * R;
    const ddx = tx - k.x, ddz = tz - k.z, d = Math.hypot(ddx, ddz);
    const ps = Math.max(0, p.speed);
    if (d > 30) { desired = headingTo(ddx, ddz); speed = clamp(ps + d * 0.25, 5, vmax * CAPTAIN.catchUp); }
    else {
      desired = p.heading + clamp(wrap(headingTo(ddx, ddz) - p.heading), -0.4, 0.4) * (d / 30);
      const along = ddx * fwdX(p.heading) + ddz * fwdZ(p.heading);
      speed = clamp(ps + along * 0.3, 0, vmax);
    }
  }

  desired = separate(c, k, desired);
  desired = avoidIslands(c, k, desired);
  sail(c, k, desired, speed, turn, ship.accel / Math.max(1, ship.maxSpeed) * 2.2);
}

function pickTarget(c: CoreSim, k: CaptainState): Target | null {
  const s = c.state, p = s.player;
  let best: Target | null = null, bestScore = Infinity;
  const list = s.enemies, bosses = s.bosses;
  for (let i = 0; i < list.length + bosses.length; i++) {
    const t: Target = i < list.length ? list[i]! : bosses[i - list.length]!;
    if (!acquirable(t)) continue;
    const dp = Math.hypot(t.x - p.x, t.z - p.z) - t.radius;
    if (dp > CAPTAIN.engageRadius) continue;
    const dk = Math.hypot(t.x - k.x, t.z - k.z) - t.radius;
    if (dk > 420) continue;
    let score = dk;
    if ('phase' in t) score += 120; // the boss fight is the player's; captains chip in
    else {
      const f = t.ai.capFocus ?? 0;
      if (f === k.id) score -= 60; // it is shooting at me
      else if (f === 0) score -= 25; // it is shooting at the player
      if (t.elite) score -= 20;
    }
    for (const o of s.captains) if (o !== k && o.alive && o.ai.tgt === t.id) score += 45; // spread the fire
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return best;
}

/** Away from the nearest threats, drifting toward the player's side of the fight. */
function retreatHeading(c: CoreSim, k: CaptainState): number {
  const s = c.state, p = s.player;
  let tx = 0, tz = 0;
  for (const e of s.enemies) {
    if (e.life !== 'alive' || e.hidden >= 1) continue;
    const dx = e.x - k.x, dz = e.z - k.z, d = Math.hypot(dx, dz);
    if (d > 260 || d < 1e-3) continue;
    const w = 1 / (d + 30);
    tx += (dx / d) * w; tz += (dz / d) * w;
  }
  const px = p.x - k.x, pz = p.z - k.z, pd = Math.hypot(px, pz) || 1;
  // Head for a point on the far side of the player (the fleet's core), away from the threat centre.
  let vx = -tx * 40 + (pd > 140 ? (px / pd) * 0.6 : 0);
  let vz = -tz * 40 + (pd > 140 ? (pz / pd) * 0.6 : 0);
  if (Math.abs(vx) + Math.abs(vz) < 1e-4) { vx = fwdX(k.heading); vz = fwdZ(k.heading); }
  return headingTo(vx, vz);
}

/** Separation from other captains, the player and enemy hulls, blended into the desired heading. */
function separate(c: CoreSim, k: CaptainState, desired: number): number {
  const s = c.state, p = s.player;
  let sx = 0, sz = 0;
  const push = (ox: number, oz: number, min: number) => {
    const dx = k.x - ox, dz = k.z - oz, d2 = dx * dx + dz * dz;
    if (d2 >= min * min || d2 < 1e-6) return;
    const d = Math.sqrt(d2), w = (min - d) / min;
    sx += (dx / d) * w; sz += (dz / d) * w;
  };
  if (p.alive) push(p.x, p.z, (k.length + p.length) * 0.5 + (isHostile(k) ? 12 : 28));
  for (const o of s.captains) if (o !== k && o.alive) push(o.x, o.z, (k.length + o.length) * 0.5 + 22);
  for (const e of s.enemies) if (e.life === 'alive' && e.hidden < 1) push(e.x, e.z, k.beam * 0.5 + e.radius + 10);
  if (sx === 0 && sz === 0) return desired;
  return Math.atan2(-(fwdX(desired) + sx * 1.8), -(fwdZ(desired) + sz * 1.8));
}

function clearAlong(c: CoreSim, x: number, z: number, h: number, look: number, margin: number): boolean {
  const fx = fwdX(h), fz = fwdZ(h);
  return c.world.isWater(x + fx * look * 0.5, z + fz * look * 0.5, margin) && c.world.isWater(x + fx * look, z + fz * look, margin);
}

/** Look-ahead island avoidance every 6 ticks (staggered), keeping the previous side for hysteresis. */
function avoidIslands(c: CoreSim, k: CaptainState, desired: number): number {
  const ai = k.ai;
  if ((c.state.tick + captainSlot(k.id) * 2) % 6 === 0) {
    if (!c.core.nearIsland(k.x, k.z, k.length + 90)) ai.avoid = 0;
    else {
      const look = 30 + k.length * 0.8 + Math.abs(k.speed) * 1.8;
      const margin = k.beam * 0.6 + 4;
      if (clearAlong(c, k.x, k.z, desired, look, margin)) ai.avoid = 0;
      else {
        const pref = ai.avoid ? Math.sign(ai.avoid) : (captainSlot(k.id) % 2 === 0 ? 1 : -1);
        let chosen = Math.PI * pref;
        for (const step of AVOID_STEPS) {
          if (clearAlong(c, k.x, k.z, desired + pref * step, look, margin)) { chosen = pref * step; break; }
          if (clearAlong(c, k.x, k.z, desired - pref * step, look, margin)) { chosen = -pref * step; break; }
        }
        ai.avoid = chosen;
      }
    }
  }
  return desired + (ai.avoid ?? 0);
}

/** Integrates heading/speed with a smoothed yaw and a keel (lateral drift decays); heel follows the turn. */
function sail(c: CoreSim, k: CaptainState, desired: number, speed: number, turnRate: number, accel: number): void {
  const dt = c.dt;
  const diff = wrap(desired - k.heading);
  const targetYaw = clamp(diff * 2.2, -turnRate, turnRate);
  k.yawRate += (targetYaw - k.yawRate) * Math.min(1, dt * 3);
  k.heading = wrap(k.heading + k.yawRate * dt);
  const want = speed * (1 - 0.25 * Math.min(1, Math.abs(diff) / 1.5));
  const before = k.speed;
  k.speed += (want - k.speed) * Math.min(1, dt * Math.max(0.35, accel));
  const fx = fwdX(k.heading), fz = fwdZ(k.heading);
  const kk = Math.min(1, dt * 2.2);
  k.vx += (fx * k.speed - k.vx) * kk;
  k.vz += (fz * k.speed - k.vz) * kk;
  k.x += k.vx * dt;
  k.z += k.vz * dt;
  k.roll += (clamp(-k.yawRate * k.speed * 0.012, -0.25, 0.25) - k.roll) * Math.min(1, dt * 3);
  k.pitch += (clamp((k.speed - before) / dt * 0.01, -0.06, 0.08) - k.pitch) * Math.min(1, dt * 3);
}
