/**
 * Player sailing + skills (CORE-owned).
 *
 * Handling model (per ship mass, see `agility`):
 *  - Keel: velocity is split into forward and lateral parts; the lateral part is damped hard, so turns carve with a
 *    little drift (heavier hulls drift more) instead of sliding.
 *  - Sails: the throttle trims toward the gear (ANCHOR 0 · HALF 0.55 · FULL 1). Half sail turns tightest.
 *  - Wind: a points-of-sail polar scales top speed (in irons ~0.35, beam reach 1.0, broad reach ~1.1, running ~0.95).
 *    `sea.windDir` follows the render side's convention: the wind blows TOWARD (sin windDir, cos windDir) (the same
 *    vector FX/OCEAN/LOOK use for smoke, foam and clouds). A ship with heading == windDir points into the wind (in
 *    irons); heading == windDir + π runs dead downwind.
 *  - Rudder ramps toward the input and recentres faster; yaw rate follows the rudder with a mass-scaled lag.
 *  - Boost: a punchy speed kick plus 3× thrust for BOOST_DURATION. Boost charges (Trade Winds) are stored in
 *    director.scratch; `skills.boost.cooldown` is the time until a boost is usable (0 while any charge is stored).
 *  - Upgrades (PACE round 1): `accel` (thrust), `fullSail` (top speed as the sails are set past half), `carve` (less
 *    rudder drag and drift in hard turns), `helm` (rudder and yaw response), `surge` (Momentum: the 'momentum'
 *    status, whose magnitude is the live speed bonus), `boostDuration` / `boostCooldown` / `boostCharges`.
 *  - Visual roll/pitch are damped springs driven by turning, wind heel, acceleration and impulses (recoil, rams).
 */
import { MOMENTUM } from '../content/passives';
import type { SeaState, ShipDef, Stats } from '../types';
import type { SimContext } from './context';
import { BURN_TICK, clamp, statusOf, type CoreSim } from './core-runtime';
import { activateSpecial, activateUltimate, isDashing, updateDash, updateSkillEffects } from './core-skills';
import {
  accelMul, boostChargesOf, boostCooldownMul, boostDurationMul, carveOf, fullSailMul, helmMul, skillCooldownMul, speedMul,
  turnMul,
} from './stats';

export const BRACE_DURATION = 1.2;
export const PARRY_WINDOW = 0.25;
/** Fraction of damage taken while braced. */
export const BRACE_DAMAGE_TAKEN = 0.3;
export const BRACE_COOLDOWN = 5;
export const BOOST_DURATION = 2.5;
export const BOOST_COOLDOWN = 6;
export const BOOST_SPEED = 1.45;
export const FULL_BROADSIDE_COOLDOWN = 8;

const GEAR_THROTTLE = [0, 0.55, 1] as const;
/** Sail trim rates (throttle per second) when setting / striking sail (PACE: was 0.85 / 1.25). */
const TRIM_SET = 1.5;
const TRIM_STRIKE = 2.1;

/** Points-of-sail polar: angle off the wind source (0 = bow into the wind … π = running) → speed factor. */
const POLAR_ANGLE = [0, 0.35, 0.61, 0.785, 1.22, 1.5708, 2.0, 2.356, 2.79, Math.PI] as const;
const POLAR_VALUE = [0.35, 0.42, 0.62, 0.78, 0.94, 1.0, 1.07, 1.1, 1.02, 0.95] as const;

/** Relative handling agility from hull mass (Sunlion ≈ 1, Dawn Ram ≈ 1.3, White Leviathan ≈ 0.48). */
export const agilityOf = (ship: ShipDef): number => Math.sqrt(600 / ship.mass);

/** Speed factor for sailing at `heading` in this sea's wind (1 = beam reach in a moderate breeze). */
export function windFactor(heading: number, sea: SeaState): number {
  // Heading whose bow points at the wind's source: forward (−sin h, −cos h) = −(sin w, cos w) ⇔ h = w.
  let off = (heading - sea.windDir) % (Math.PI * 2);
  if (off < 0) off += Math.PI * 2;
  if (off > Math.PI) off = Math.PI * 2 - off;
  let i = 1;
  while (i < POLAR_ANGLE.length - 1 && off > POLAR_ANGLE[i]!) i++;
  const a0 = POLAR_ANGLE[i - 1]!, a1 = POLAR_ANGLE[i]!;
  const k = clamp((off - a0) / (a1 - a0), 0, 1);
  const polar = POLAR_VALUE[i - 1]! + (POLAR_VALUE[i]! - POLAR_VALUE[i - 1]!) * k;
  return polar * (0.9 + 0.2 * clamp(sea.windStrength, 0, 1.5));
}

/** Turn authority by sail trim: pivots at anchor, tightest at half sail, wider at full sail. */
export function turnByTrim(throttle: number): number {
  if (throttle <= 0.55) return 0.8 + 0.5 * (throttle / 0.55);
  return 1.3 - 0.4 * ((throttle - 0.55) / 0.45);
}

export function updatePlayer(c: CoreSim): void {
  const p = c.state.player;
  if (!p.alive) return;
  const ship = c.content.ships[p.shipId];
  // Aim first: skills pressed this tick use this tick's cursor.
  p.aimX = c.input.aimX; p.aimZ = c.input.aimZ;
  handleActions(c, ship);
  tickSkillTimers(c);
  updateSkillEffects(c);
  if (isDashing(c.core)) updateDash(c);
  else sail(c, ship);
  attitude(c, ship);
  tickPlayerTimers(c);
}

function handleActions(c: CoreSim, ship: ShipDef): void {
  const p = c.state.player;
  const sk = p.skills;
  const cdMul = skillCooldownMul(p.stats);
  const stunned = statusOf(p.statuses, 'stunned') !== null;
  if (c.actions.has('gear-up') && p.gear < 2) p.gear = (p.gear + 1) as 0 | 1 | 2;
  if (c.actions.has('gear-down') && p.gear > 0) p.gear = (p.gear - 1) as 0 | 1 | 2;
  if (c.actions.has('brace') && sk.brace.cooldown <= 0 && !stunned) {
    sk.brace.active = BRACE_DURATION;
    sk.brace.cooldownMax = BRACE_COOLDOWN * cdMul; sk.brace.cooldown = sk.brace.cooldownMax;
    c.core.parryUsed = false;
    c.emit({ type: 'skill-used', slot: 'brace', skill: 'brace', x: p.x, z: p.z, aimX: p.aimX, aimZ: p.aimZ });
  }
  if (c.actions.has('boost') && sk.boost.cooldown <= 0 && !stunned && !isDashing(c.core)) {
    sk.boost.active = boostDuration(p.stats);
    spendBoostCharge(c);
    // The punch: an immediate surge along the bow plus a nose-up kick.
    const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
    const kick = Math.max(4, ship.maxSpeed * 0.2);
    p.vx += fx * kick; p.vz += fz * kick;
    c.core.kickPitch(0.22);
    c.emit({ type: 'skill-used', slot: 'boost', skill: 'boost', x: p.x, z: p.z, aimX: p.aimX, aimZ: p.aimZ });
  }
  if (c.actions.has('special') && sk.special.cooldown <= 0 && !stunned) {
    const cooldown = activateSpecial(c, ship.special);
    if (cooldown > 0) {
      sk.special.cooldownMax = cooldown * cdMul; sk.special.cooldown = sk.special.cooldownMax;
      c.emit({ type: 'skill-used', slot: 'special', skill: ship.special, x: p.x, z: p.z, aimX: p.aimX, aimZ: p.aimZ });
    }
  }
  if (c.actions.has('ultimate') && sk.ultimate.charge >= 1 && sk.ultimate.active <= 0 && !stunned) {
    const active = activateUltimate(c, ship.ultimate);
    if (active >= 0) {
      sk.ultimate.charge = 0; sk.ultimate.active = Math.max(0.5, active);
      c.emit({ type: 'skill-used', slot: 'ultimate', skill: ship.ultimate, x: p.x, z: p.z, aimX: p.aimX, aimZ: p.aimZ });
    }
  }
}

function tickSkillTimers(c: CoreSim): void {
  const sk = c.state.player.skills;
  const dt = c.dt;
  if (sk.broadside.cooldown > 0) { sk.broadside.cooldown = Math.max(0, sk.broadside.cooldown - dt); if (sk.broadside.cooldown === 0) c.emit({ type: 'skill-ready', slot: 'broadside' }); }
  if (sk.special.cooldown > 0) { sk.special.cooldown = Math.max(0, sk.special.cooldown - dt); if (sk.special.cooldown === 0) c.emit({ type: 'skill-ready', slot: 'special' }); }
  if (sk.brace.cooldown > 0) { sk.brace.cooldown = Math.max(0, sk.brace.cooldown - dt); if (sk.brace.cooldown === 0) c.emit({ type: 'skill-ready', slot: 'brace' }); }
  tickBoostCharges(c);
  if (sk.broadside.active > 0) sk.broadside.active = Math.max(0, sk.broadside.active - dt);
  if (sk.special.active > 0) sk.special.active = Math.max(0, sk.special.active - dt);
  if (sk.ultimate.active > 0) sk.ultimate.active = Math.max(0, sk.ultimate.active - dt);
  if (sk.brace.active > 0) sk.brace.active = Math.max(0, sk.brace.active - dt);
  if (sk.boost.active > 0) sk.boost.active = Math.max(0, sk.boost.active - dt);
}

function sail(c: CoreSim, ship: ShipDef): void {
  const p = c.state.player;
  const core = c.core;
  const dt = c.dt;
  const stats = p.stats;
  const agility = agilityOf(ship);
  const stunned = statusOf(p.statuses, 'stunned') !== null;

  // Sail trim follows the gear (sails are set slower than they are struck); a gear change reads within ~⅓ s.
  const trimTarget = c.input.throttleAxis !== 0 ? clamp(c.input.throttleAxis, 0, 1) : GEAR_THROTTLE[p.gear];
  const trimRate = trimTarget > p.throttle ? TRIM_SET : TRIM_STRIKE;
  p.throttle += clamp(trimTarget - p.throttle, -trimRate * dt, trimRate * dt);

  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  let forward = p.vx * fx + p.vz * fz;
  let lateral = p.vx * sx + p.vz * sz;

  // Top speed on this point of sail (Clipper Rigging adds more as the sails are set past half; Momentum surges it).
  const submerged = p.submerged > 0.5 || core.dive > 0;
  const surge = momentumOf(p.statuses);
  let vmax = ship.maxSpeed * speedMul(stats) * fullSailMul(stats, p.throttle) * (1 + surge) * (submerged ? 1 : windFactor(p.heading, c.state.sea));
  const boosting = p.skills.boost.active > 0;
  if (boosting) vmax *= BOOST_SPEED;
  if (core.rammingSpeed > 0) vmax *= 1.8;
  if (submerged) vmax *= 1.35;
  if (p.skills.brace.active > 0) vmax *= 0.85;
  const slow = statusOf(p.statuses, 'slowed');
  if (slow) vmax *= 1 - clamp(slow.magnitude, 0, 0.8);
  // Hard turns bleed speed (rudder drag); a racing keel carves through them.
  const carve = carveOf(stats);
  const rudderDrag = 1 - 0.14 * Math.abs(p.rudder) * p.throttle * (1 - carve);
  const target = vmax * p.throttle * rudderDrag;

  // Thrust tapers as the hull nears the target; water drag makes slowing down heavy and gradual.
  if (forward < target) {
    let a = ship.accel * accelMul(stats) * (1 + 2 * surge) * (0.35 + 0.65 * (1 - forward / Math.max(1, target)));
    if (boosting) a *= 3;
    if (core.rammingSpeed > 0) a *= 2;
    forward = Math.min(target, forward + a * dt);
  } else {
    const drag = ship.accel * 0.45 + (forward - target) * 0.35;
    forward = Math.max(target, forward - drag * dt);
  }
  // Keel: lateral motion dies quickly (heavier hulls carry a little more drift through turns); a carving keel keeps
  // part of the sideways momentum as headway instead of scrubbing it off.
  const lateral0 = lateral;
  lateral *= Math.exp(-(3.2 + 2.8 * agility) * (1 + carve) * dt);
  if (carve > 0 && forward > 0) forward = Math.min(Math.max(forward, target), forward + (Math.abs(lateral0) - Math.abs(lateral)) * carve * 0.5);

  // Rudder ramp (recentring is faster than laying it over); rudder chains answer the helm faster.
  const helm = helmMul(stats);
  const steer = stunned ? 0 : clamp(c.input.steer, -1, 1);
  const rate = 2.4 * (0.6 + 0.4 * agility) * helm * (steer === 0 || steer * p.rudder < 0 ? 1.7 : 1);
  p.rudder += clamp(steer - p.rudder, -rate * dt, rate * dt);

  // Yaw: rudder authority needs water flow; half sail turns tightest; heavy hulls answer late.
  const flow = Math.min(1, 0.25 + (1.25 * Math.abs(forward)) / Math.max(1, ship.maxSpeed));
  let yawTarget = p.rudder * ship.turnRate * turnMul(stats) * flow * turnByTrim(p.throttle);
  if (boosting) yawTarget *= 0.85;
  if (submerged) yawTarget *= 1.15;
  const response = 3.2 * agility * helm;
  p.yawRate += (yawTarget - p.yawRate) * (1 - Math.exp(-response * dt));

  // Recompose in the frame the hull had this tick, then turn: inertia turns into drift next tick.
  p.vx = fx * forward + sx * lateral;
  p.vz = fz * forward + sz * lateral;
  p.heading += p.yawRate * dt;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  p.speed = forward;
  core.forwardAccel = (forward - core.prevForward) / dt;
  core.prevForward = forward;
}

function attitude(c: CoreSim, ship: ShipDef): void {
  const p = c.state.player;
  const core = c.core;
  const dt = c.dt;
  const agility = agilityOf(ship);
  const sea = c.state.sea;
  // Heel outward in turns, to leeward on a reach (sails drawing), none while submerged or airborne.
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const wx = Math.sin(sea.windDir), wz = Math.cos(sea.windDir);
  const sails = p.submerged > 0.3 || p.airborne > 0.1 ? 0 : p.throttle;
  const heelTurn = -p.yawRate * p.speed * 0.0075;
  const heelWind = -(wx * sx + wz * sz) * clamp(sea.windStrength, 0, 1.5) * sails * 0.09;
  const rollTarget = clamp(heelTurn + heelWind, -0.32, 0.32);
  const w = 2.4 * Math.sqrt(agility);
  core.rollVel += ((rollTarget - p.roll) * w * w - 2 * 0.3 * w * core.rollVel) * dt;
  p.roll = clamp(p.roll + core.rollVel * dt, -0.6, 0.6);
  // Bow lifts when accelerating, squats when braking.
  const pitchTarget = clamp(core.forwardAccel * 0.01, -0.07, 0.09);
  const wp = w * 1.35;
  core.pitchVel += ((pitchTarget - p.pitch) * wp * wp - 2 * 0.35 * wp * core.pitchVel) * dt;
  p.pitch = clamp(p.pitch + core.pitchVel * dt, -0.4, 0.4);
}

function tickPlayerTimers(c: CoreSim): void {
  const p = c.state.player;
  const dt = c.dt;
  p.invulnerable = Math.max(0, p.invulnerable - dt);
  p.sinceHit += dt;
  if (p.stats.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * p.stats.regen * dt);
  // Burning (e.g. enemy fire patches): damage ticks, armour applies.
  const burn = statusOf(p.statuses, 'burning');
  if (burn) {
    c.core.playerBurnT += dt;
    if (c.core.playerBurnT >= BURN_TICK) {
      c.core.playerBurnT -= BURN_TICK;
      c.hurtPlayer(burn.magnitude * BURN_TICK, p.x, p.z, undefined, 'hazard');
    }
  } else c.core.playerBurnT = 0;
  const list = p.statuses;
  for (let i = 0; i < list.length; i++) list[i]!.time -= dt;
  // Momentum: the surge holds, then drains linearly to 0 as its clock runs out (see gainMomentum).
  const mo = statusOf(list, 'momentum');
  if (mo) mo.magnitude = Math.min(mo.magnitude, MOMENTUM.drain * mo.time);
  for (let i = list.length - 1; i >= 0; i--) {
    const st = list[i]!;
    if (st.time > 0) continue;
    if (st.kind === 'shielded') p.shield = 0;
    c.emit({ type: 'status-changed', target: 0, status: st.kind, on: false });
    for (let j = i; j < list.length - 1; j++) list[j] = list[j + 1]!;
    list.length--;
  }
}

// ───────────────────────────── Boost charges (Trade Winds, Storm Sails) ─────────────────────────────

const BOOST_STORED = 'pace:boostCharges';
const BOOST_RECHARGE = 'pace:boostRecharge';
const BOOST_MAX = 'pace:boostMax';

/** Seconds a boost lasts with these stats. */
export function boostDuration(s: Stats): number { return BOOST_DURATION * boostDurationMul(s); }

/** Seconds to recharge one boost charge with these stats (skill cooldowns and boost recharge both apply). */
export function boostCooldown(s: Stats): number { return BOOST_COOLDOWN * skillCooldownMul(s) * boostCooldownMul(s); }

/** Boost charges stored right now (0 … boostChargesOf(stats)). */
export function boostChargesLeft(c: SimContext): number {
  const max = boostChargesOf(c.state.player.stats);
  return Math.min(max, c.state.director.scratch[BOOST_STORED] ?? max);
}

function spendBoostCharge(c: CoreSim): void {
  const p = c.state.player, sk = p.skills.boost, sc = c.state.director.scratch;
  const max = boostChargesOf(p.stats);
  const stored = Math.max(0, Math.min(max, sc[BOOST_STORED] ?? max) - 1);
  const cd = boostCooldown(p.stats);
  if (!((sc[BOOST_RECHARGE] ?? 0) > 0)) sc[BOOST_RECHARGE] = cd;
  sc[BOOST_STORED] = stored;
  sc[BOOST_MAX] = max;
  sk.cooldownMax = cd;
  sk.cooldown = stored > 0 ? 0 : sc[BOOST_RECHARGE]!;
}

/** Recharges stored boosts one at a time; the visible cooldown is the wait until a boost is usable. */
function tickBoostCharges(c: CoreSim): void {
  const p = c.state.player, sk = p.skills.boost, sc = c.state.director.scratch;
  const max = boostChargesOf(p.stats);
  let stored = sc[BOOST_STORED] ?? max;
  // A newly earned charge arrives ready.
  const prevMax = sc[BOOST_MAX] ?? max;
  if (max > prevMax) stored += max - prevMax;
  stored = Math.min(stored, max);
  let recharge = sc[BOOST_RECHARGE] ?? 0;
  // Cooldown cleared from outside (QA resetCooldowns): every charge back.
  if (stored <= 0 && sk.cooldown <= 0) { stored = max; recharge = 0; }
  if (stored < max) {
    recharge -= c.dt;
    if (recharge <= 0) {
      stored++;
      if (stored === 1) c.emit({ type: 'skill-ready', slot: 'boost' });
      recharge = stored < max ? recharge + boostCooldown(p.stats) : 0;
    }
  } else recharge = 0;
  sc[BOOST_STORED] = stored;
  sc[BOOST_RECHARGE] = recharge;
  sc[BOOST_MAX] = max;
  sk.cooldown = stored > 0 ? 0 : Math.max(1e-4, recharge);
}

// ───────────────────────────── Momentum ─────────────────────────────

/** Live Momentum speed bonus (0 when the passive is not owned or the surge has drained). */
export function momentumOf(statuses: Parameters<typeof statusOf>[0]): number {
  const st = statusOf(statuses, 'momentum');
  return st ? Math.max(0, st.magnitude) : 0;
}

/**
 * A sinking fills the sails (Momentum passive): +MOMENTUM.perKill speed, up to the `surge` stat; the surge holds for
 * MOMENTUM.hold s after the last sinking, then drains at MOMENTUM.drain per second (status 'momentum').
 */
export function gainMomentum(c: SimContext): void {
  const p = c.state.player;
  const cap = p.stats.surge;
  if (!(cap > 0) || !p.alive) return;
  const st = statusOf(p.statuses, 'momentum');
  const magnitude = Math.min(cap, (st ? st.magnitude : 0) + MOMENTUM.perKill);
  const time = MOMENTUM.hold + magnitude / MOMENTUM.drain;
  if (st) { st.magnitude = magnitude; st.time = time; }
  else c.applyStatus(p, 'momentum', time, magnitude);
}
