/**
 * Shared seamanship + gunnery helpers for META systems (enemy AI, bosses, director, weather).
 *
 * Conventions (types.ts): forward = (−sin h, −cos h), starboard = (cos h, −sin h), positive heading turns to port.
 * "Side" in this file: +1 = port, −1 = starboard.
 *
 * Telegraph shapes written by META (FX renders them; documented for the contract):
 *  - circle: centre (x, z), `radius`.
 *  - ring:   centre (x, z), outer `radius` (a shockwave/blast edge; the danger is the whole disc).
 *  - line:   starts at (x, z) and runs `length` metres along heading `angle` (same convention as ship
 *            headings: direction (−sin angle, −cos angle)); `radius` is the half-width.
 */
import type { ProjectileKind } from '../ids';
import type { BossState, EnemyState, PlayerState, TelegraphState } from '../types';
import type { SimContext, Target } from './context';

export const TAU = Math.PI * 2;
/** Must match the gravity used for ballistic kinds in src/game/sim/projectiles.ts (CORE). */
export const SHELL_GRAVITY = 18;
/** Launch height used for lobbed shells. */
export const SHELL_Y0 = 4;
/** Offset of the off-map "limbo" used while a ship is fully submerged/phased (untargetable). */
export const LIMBO_OFFSET = 40000;

export function wrap(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Heading whose forward vector points along (dx, dz). */
export const headingTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
export const fwdX = (h: number): number => -Math.sin(h);
export const fwdZ = (h: number): number => -Math.cos(h);
/** Unit vector toward `side` (+1 port, −1 starboard). */
export const sideX = (h: number, side: number): number => -side * Math.cos(h);
export const sideZ = (h: number, side: number): number => side * Math.sin(h);

export function rand(c: SimContext, lo: number, hi: number): number {
  return lo + (hi - lo) * c.random();
}

export function randInt(c: SimContext, lo: number, hi: number): number {
  return lo + Math.floor(c.random() * (hi - lo + 1));
}

/** Bearing of (x, z) seen from the player's bow: 0 ahead, +π/2 port beam, −π/2 starboard beam, ±π astern. */
export function bearingFromPlayer(p: PlayerState, x: number, z: number): number {
  return wrap(headingTo(x - p.x, z - p.z) - p.heading);
}

const AIM = { x: 0, z: 0, t: 0 };

/** Intercept aim point on the player for a shot of `speed` fired from (sx, sz). `lead` 0 = current position, 1 = perfect. */
export function leadAim(c: SimContext, sx: number, sz: number, speed: number, lead: number): Readonly<typeof AIM> {
  const p = c.state.player;
  let tx = p.x, tz = p.z;
  let t = Math.hypot(tx - sx, tz - sz) / Math.max(1, speed);
  for (let i = 0; i < 2; i++) {
    tx = p.x + p.vx * t * lead;
    tz = p.z + p.vz * t * lead;
    t = Math.hypot(tx - sx, tz - sz) / Math.max(1, speed);
  }
  AIM.x = tx; AIM.z = tz; AIM.t = t;
  return AIM;
}

/** Player position predicted `t` seconds ahead (scaled by `lead`). */
export function predictPlayer(c: SimContext, t: number, lead: number): Readonly<typeof AIM> {
  const p = c.state.player;
  AIM.x = p.x + p.vx * t * lead;
  AIM.z = p.z + p.vz * t * lead;
  AIM.t = t;
  return AIM;
}

/** Flat shot from (sx, sz) toward (tx, tz) with an angular error of `err` radians. */
export function fireShot(
  c: SimContext, kind: ProjectileKind, sx: number, sz: number, tx: number, tz: number,
  speed: number, damage: number, range: number, radius: number, err = 0,
): void {
  const ang = Math.atan2(tx - sx, tz - sz) + err;
  c.spawnProjectile({
    kind, team: 'enemy', x: sx, y: 3, z: sz, vx: Math.sin(ang) * speed, vy: 0, vz: Math.cos(ang) * speed,
    damage, radius, ttl: range / speed + 0.35,
  });
}

/** Flat shot along a heading (used for telegraphed lines so balls follow the drawn line exactly). */
export function fireAlong(
  c: SimContext, kind: ProjectileKind, sx: number, sz: number, heading: number,
  speed: number, damage: number, length: number, radius: number,
): void {
  c.spawnProjectile({
    kind, team: 'enemy', x: sx, y: 3, z: sz, vx: fwdX(heading) * speed, vy: 0, vz: fwdZ(heading) * speed,
    damage, radius, ttl: length / speed,
  });
}

/**
 * Lobbed shell that lands on (tx, tz) after exactly `flight` seconds, with an optional circle telegraph that
 * completes on impact. Impact damage/area is resolved by CORE's projectile system.
 */
export function lobShell(
  c: SimContext, kind: 'enemy-mortar' | 'boss-shell', sx: number, sz: number, tx: number, tz: number,
  flight: number, damage: number, area: number, telegraph = true,
): void {
  const T = Math.max(0.4, flight);
  const vy = 0.5 * SHELL_GRAVITY * T - SHELL_Y0 / T;
  c.spawnProjectile({
    kind, team: 'enemy', x: sx, y: SHELL_Y0, z: sz, vx: (tx - sx) / T, vy, vz: (tz - sz) / T,
    damage, area, radius: 1.4, ttl: T + 1,
  });
  if (telegraph) c.addTelegraph({ shape: 'circle', team: 'enemy', x: tx, z: tz, radius: area, duration: T });
}

export function lineTelegraph(c: SimContext, x: number, z: number, heading: number, length: number, halfWidth: number, duration: number): TelegraphState | null {
  return c.addTelegraph({ shape: 'line', team: 'enemy', x, z, radius: halfWidth, length, angle: heading, duration });
}

/** Moves a live telegraph (found by id) so it follows a moving source. Returns false if it expired. */
export function moveTelegraph(c: SimContext, id: number, x: number, z: number, angle?: number): boolean {
  if (!id) return false;
  for (const t of c.state.telegraphs) {
    if (t.alive && t.id === id) {
      t.x = x; t.z = z;
      if (angle !== undefined) t.angle = angle;
      return true;
    }
  }
  return false;
}

export function killTelegraph(c: SimContext, id: number): void {
  if (!id) return;
  for (const t of c.state.telegraphs) if (t.alive && t.id === id) { t.alive = false; return; }
}

// ───────────────────────── Enemy seamanship ─────────────────────────

const neighbours: Target[] = [];
const AVOID_STEPS = [0.55, 1.05, 1.6, 2.2] as const;

/**
 * Integrates a ship toward a desired heading/speed with a keel (lateral drift decays) and a smoothed yaw.
 * External impulses (knockback) already in vx/vz decay naturally.
 */
export function sail(c: SimContext, e: EnemyState | BossState, desired: number, speed: number, turnRate: number, accel = 1.2): void {
  const dt = c.dt;
  const diff = wrap(desired - e.heading);
  const targetYaw = clamp(diff * 2.4, -turnRate, turnRate);
  e.yawRate += (targetYaw - e.yawRate) * Math.min(1, dt * 5);
  e.heading = wrap(e.heading + e.yawRate * dt);
  e.speed += (speed - e.speed) * Math.min(1, dt * accel);
  const fx = fwdX(e.heading), fz = fwdZ(e.heading);
  const k = Math.min(1, dt * 2.2);
  e.vx += (fx * e.speed - e.vx) * k;
  e.vz += (fz * e.speed - e.vz) * k;
  e.x += e.vx * dt;
  e.z += e.vz * dt;
  e.roll += (-e.yawRate * e.speed * 0.02 - e.roll) * Math.min(1, dt * 3);
}

/** True when a circle of `margin` stays in open water along a look-ahead ray. */
function clearAlong(c: SimContext, x: number, z: number, h: number, look: number, margin: number): boolean {
  const fx = fwdX(h), fz = fwdZ(h);
  return c.world.isWater(x + fx * look * 0.5, z + fz * look * 0.5, margin) && c.world.isWater(x + fx * look, z + fz * look, margin);
}

/**
 * Island avoidance: every 6 ticks (staggered by id) probes ahead along the desired heading and, if blocked,
 * picks the smallest open offset (keeping the previous side for hysteresis). Stored in `ai.avoid`.
 */
export function avoidIslands(c: SimContext, e: EnemyState | BossState, desired: number): number {
  const ai = e.ai;
  if ((c.state.tick + e.id) % 6 === 0) {
    const look = 26 + e.radius * 2 + Math.abs(e.speed) * 1.6;
    const margin = e.radius + 4;
    if (clearAlong(c, e.x, e.z, desired, look, margin)) ai.avoid = 0;
    else {
      const pref = ai.avoid ? Math.sign(ai.avoid) : (e.id % 2 === 0 ? 1 : -1);
      let chosen = Math.PI * pref;
      for (let i = 0; i < AVOID_STEPS.length; i++) {
        const k = AVOID_STEPS[i]!;
        if (clearAlong(c, e.x, e.z, desired + pref * k, look, margin)) { chosen = pref * k; break; }
        if (clearAlong(c, e.x, e.z, desired - pref * k, look, margin)) { chosen = -pref * k; break; }
      }
      ai.avoid = chosen;
    }
  }
  return desired + (ai.avoid ?? 0);
}

/**
 * Separation from other ships (spatial index) blended into the desired heading, plus a soft positional push
 * when hulls overlap. Returns the adjusted heading.
 */
export function separate(c: SimContext, e: EnemyState, desired: number, weight = 1.6): number {
  let sx = 0, sz = 0;
  const near = c.targetsNear(e.x, e.z, e.radius + 16, neighbours);
  for (let i = 0; i < near.length; i++) {
    const o = near[i]!;
    if (o === e) continue;
    const dx = e.x - o.x, dz = e.z - o.z;
    const d2 = dx * dx + dz * dz;
    const min = e.radius + o.radius + 6;
    if (d2 >= min * min || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const w = (min - d) / min;
    sx += (dx / d) * w; sz += (dz / d) * w;
    const overlap = e.radius + o.radius - d;
    if (overlap > 0) {
      const push = overlap * ('phase' in o ? 0.5 : 0.25);
      e.x += (dx / d) * push; e.z += (dz / d) * push;
    }
  }
  if (sx === 0 && sz === 0) return desired;
  const fx = fwdX(desired) + sx * weight, fz = fwdZ(desired) + sz * weight;
  return Math.atan2(-fx, -fz);
}

/** Moves a ship into the off-map limbo (untargetable, no contacts) remembering its real position. */
export function enterLimbo(e: EnemyState): void {
  if (e.ai.limbo === 1) return;
  e.ai.limbo = 1;
  e.ai.hx = e.x; e.ai.hz = e.z;
  e.x += LIMBO_OFFSET; e.z += LIMBO_OFFSET;
  e.vx = 0; e.vz = 0; e.speed = 0;
}

/** Brings a ship back from limbo at (x, z). */
export function exitLimbo(e: EnemyState, x: number, z: number, heading: number): void {
  e.ai.limbo = 0;
  e.x = x; e.z = z; e.heading = heading;
  e.vx = 0; e.vz = 0; e.yawRate = 0;
}

/** Finds an open-water point near (x, z) by probing a small spiral; returns false if none. */
const SPOT = { x: 0, z: 0 };
export function openWaterNear(c: SimContext, x: number, z: number, margin: number, maxSteps = 8): Readonly<typeof SPOT> | null {
  if (c.world.isWater(x, z, margin)) { SPOT.x = x; SPOT.z = z; return SPOT; }
  for (let i = 1; i <= maxSteps; i++) {
    const a = i * 2.39996;
    const r = margin * 0.8 * i;
    const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
    if (c.world.isWater(px, pz, margin)) { SPOT.x = px; SPOT.z = pz; return SPOT; }
  }
  return null;
}
