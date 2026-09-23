/**
 * Player sailing + skills (CORE-owned). Skeleton: keel-ish sailing with gears, boost, brace and a manual
 * full broadside. Specials/ultimates are stubs until CORE implements them.
 */
import { skillCooldownMul, speedMul, turnMul } from './stats';
import type { SimContext } from './context';

export const BRACE_DURATION = 1.2;
export const PARRY_WINDOW = 0.25;
export const BOOST_DURATION = 2.5;

const GEAR_THROTTLE = [0, 0.55, 1] as const;

export function updatePlayer(c: SimContext): void {
  const p = c.state.player;
  const ship = c.content.ships[p.shipId];
  const dt = c.dt;
  if (!p.alive) return;

  // Discrete actions.
  if (c.actions.has('gear-up') && p.gear < 2) p.gear = (p.gear + 1) as 0 | 1 | 2;
  if (c.actions.has('gear-down') && p.gear > 0) p.gear = (p.gear - 1) as 0 | 1 | 2;
  const sk = p.skills;
  const cdMul = skillCooldownMul(p.stats);
  if (c.actions.has('brace') && sk.brace.cooldown <= 0) {
    sk.brace.active = BRACE_DURATION; sk.brace.cooldownMax = 5 * cdMul; sk.brace.cooldown = sk.brace.cooldownMax;
    c.emit({ type: 'skill-used', slot: 'brace', skill: 'brace', x: p.x, z: p.z, aimX: p.aimX, aimZ: p.aimZ });
  }
  if (c.actions.has('boost') && sk.boost.cooldown <= 0) {
    sk.boost.active = BOOST_DURATION; sk.boost.cooldownMax = 6 * cdMul; sk.boost.cooldown = sk.boost.cooldownMax;
    c.emit({ type: 'skill-used', slot: 'boost', skill: 'boost', x: p.x, z: p.z, aimX: p.aimX, aimZ: p.aimZ });
  }
  if (c.actions.has('special') && sk.special.cooldown <= 0) {
    sk.special.cooldownMax = 18 * cdMul; sk.special.cooldown = sk.special.cooldownMax; sk.special.active = 1;
    c.emit({ type: 'skill-used', slot: 'special', skill: ship.special, x: p.x, z: p.z, aimX: p.aimX, aimZ: p.aimZ });
    // TODO(CORE): implement each ship special (see docs/overhaul-v2/DESIGN.md §4).
  }
  if (c.actions.has('ultimate') && sk.ultimate.charge >= 1) {
    sk.ultimate.charge = 0; sk.ultimate.active = 1;
    c.emit({ type: 'skill-used', slot: 'ultimate', skill: ship.ultimate, x: p.x, z: p.z, aimX: p.aimX, aimZ: p.aimZ });
    // TODO(CORE): implement each ship ultimate.
  }

  for (const key of ['broadside', 'special', 'brace', 'boost'] as const) {
    const state = sk[key];
    if (state.cooldown > 0) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      if (state.cooldown === 0) c.emit({ type: 'skill-ready', slot: key });
    }
  }
  for (const state of Object.values(sk)) if (state.active > 0) state.active = Math.max(0, state.active - dt);

  // Aim point.
  p.aimX = c.input.aimX; p.aimZ = c.input.aimZ;

  // Sailing: throttle follows the gear; boost adds speed.
  const targetThrottle = c.input.throttleAxis !== 0 ? Math.max(0, c.input.throttleAxis) : GEAR_THROTTLE[p.gear];
  p.throttle += Math.sign(targetThrottle - p.throttle) * Math.min(Math.abs(targetThrottle - p.throttle), dt * 0.8);
  const boost = sk.boost.active > 0 ? 1.45 : 1;
  const maxSpeed = ship.maxSpeed * speedMul(p.stats) * boost;
  const targetSpeed = maxSpeed * p.throttle;
  p.speed += Math.sign(targetSpeed - p.speed) * Math.min(Math.abs(targetSpeed - p.speed), ship.accel * dt * (boost > 1 ? 2 : 1));

  // Rudder: half sail turns tightest.
  p.rudder += Math.sign(c.input.steer - p.rudder) * Math.min(Math.abs(c.input.steer - p.rudder), dt * 3.5);
  const flow = Math.min(1, 0.35 + p.speed / Math.max(1, ship.maxSpeed));
  const halfBonus = p.gear === 1 ? 1.3 : 1;
  const targetYaw = p.rudder * ship.turnRate * turnMul(p.stats) * flow * halfBonus;
  const yawLag = 2.2 * Math.sqrt(600 / ship.mass);
  p.yawRate += (targetYaw - p.yawRate) * Math.min(1, dt * yawLag);
  p.heading += p.yawRate * dt;

  // Keel: forward velocity follows speed; lateral drift is damped hard.
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const forward = p.vx * fx + p.vz * fz;
  let lateral = p.vx * sx + p.vz * sz;
  const newForward = forward + (p.speed - forward) * Math.min(1, dt * 2.5);
  lateral *= Math.exp(-dt * 6);
  p.vx = fx * newForward + sx * lateral;
  p.vz = fz * newForward + sz * lateral;
  p.x += p.vx * dt; p.z += p.vz * dt;

  // Visual heel from turning.
  p.roll += (-p.yawRate * p.speed * 0.012 - p.roll) * Math.min(1, dt * 3);

  // Timers and statuses.
  p.invulnerable = Math.max(0, p.invulnerable - dt);
  p.sinceHit += dt;
  if (p.stats.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * p.stats.regen * dt);
  for (const st of p.statuses) st.time -= dt;
  for (let i = p.statuses.length - 1; i >= 0; i--) if (p.statuses[i]!.time <= 0) {
    c.emit({ type: 'status-changed', target: 0, status: p.statuses[i]!.kind, on: false });
    p.statuses.splice(i, 1);
  }
}
