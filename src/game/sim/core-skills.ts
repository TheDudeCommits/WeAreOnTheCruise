/**
 * Ship specials (E), ultimates (R) and the brace parry (CORE-owned).
 *
 * Tuning lives in SPECIALS / ULTIMATES below until content grows SpecialDef / UltimateDef tables (see the CORE
 * report's contract request). Damage scales with the player's damage stat and level via `skillPower`; radii with
 * `area`; durations with `duration`.
 */
import type { SpecialId, UltimateId } from '../ids';
import type { PlayerState } from '../types';
import {
  clamp, HF_SLOW, HF_STUN, HF_ULT, HF_WASH, K_BALLISTIC, KIND_TRAITS, PF_REFLECTED, PF_WATER, wrapAngle,
  type CoreRuntime, type CoreSim,
} from './core-runtime';
import { areaMul, damageMul, durationMul, rangeMul } from './stats';
import { crit, CRIT, lobShell, selectNearest } from './weapons/common';

/** Damage an ultimate needs to deal before it is ready again. */
export const ULT_CHARGE_DAMAGE = 2500;

export const SPECIALS = {
  'second-wind': { cooldown: 20, heal: 0.3, shield: 0.5, time: 3 },
  lionburst: { cooldown: 12, distance: 180, minDistance: 70, time: 1, damage: 70, radius: 42, knockback: 14 },
  'deep-dive': { cooldown: 14, time: 3, damage: 80, radius: 46, knockback: 14, stun: 0.6 },
  'chefs-banquet': { cooldown: 22, heal: 0.2, time: 6, fireRate: 1.5 },
  'signal-flare': { cooldown: 16, shells: 12, spread: 34, damage: 55, radius: 14, maxRange: 320, flight: 1.1 },
  seaquake: { cooldown: 18, radius: 160, damage: 70, knockback: 18, slow: 0.5, slowTime: 3, time: 0.8 },
} as const;

export const ULTIMATES = {
  'ramming-speed': { time: 6, speed: 1.8, ram: 5, knockback: 2.5 },
  'sunfire-barrage': { time: 8, rate: 2, burn: 0.25 },
  'torpedo-swarm': { count: 12, damage: 90, area: 14, speed: 78, turn: 2.4, range: 380 },
  'kitchen-inferno': { time: 6, barrels: 12, ring: 45, fireRadius: 18, fireDamage: 20, fireTime: 6, rate: 1.5, burn: 0.25 },
  'admirals-judgment': { length: 340, spacing: 13, damage: 90, area: 16, delay: 1.0, width: 30 },
  'tidal-colossus': { distance: 400, speed: 85, width: 150, damage: 150, stun: 1, knockback: 12 },
} as const;

export const PARRY = { radius: 42, damage: 30, knockback: 12, stun: 0.5, reflectRadius: 45 } as const;

export function specialCooldown(id: SpecialId): number { return SPECIALS[id].cooldown; }

/** Skill damage scale: the damage stat plus +6% per level so skills stay relevant late in a run. */
export function skillPower(p: PlayerState): number { return damageMul(p.stats) * (1 + 0.06 * (p.level - 1)); }

export const isDashing = (core: CoreRuntime): boolean => core.dashTime > 0;

/** Spawns an expanding player shockwave ring (0 → radius over ttl). Returns the hazard pool index. */
export function spawnShockwave(
  c: CoreSim, x: number, z: number, radius: number, damage: number, knockback: number, ttl: number,
  slowMag: number, slowTime: number, stun: number, weapon?: import('../ids').WeaponId,
): number {
  const idx = c.placeHazard('shockwave', 'player', x, z, radius, ttl, damage, 0, 0, 0, weapon, true);
  if (idx < 0) return -1;
  const core = c.core;
  core.hKnock[idx] = knockback;
  if (slowMag > 0) { core.hFlags[idx] |= HF_SLOW; core.hA[idx] = slowMag; core.hB[idx] = slowTime; }
  if (stun > 0) { core.hFlags[idx] |= HF_STUN; core.hC[idx] = stun; }
  return idx;
}

// ───────────────────────────── Specials ─────────────────────────────

/** Activates the ship special. Returns its base cooldown, or 0 if it could not be used (nothing spent). */
export function activateSpecial(c: CoreSim, id: SpecialId): number {
  const p = c.state.player;
  const core = c.core;
  switch (id) {
    case 'second-wind': {
      const t = SPECIALS['second-wind'];
      const time = t.time * durationMul(p.stats);
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * t.heal);
      p.shield = Math.max(p.shield, p.maxHp * t.shield);
      c.applyStatus(p, 'shielded', time, 1);
      p.skills.special.active = time;
      return t.cooldown;
    }
    case 'lionburst':
      return startDash(c) ? SPECIALS.lionburst.cooldown : 0;
    case 'deep-dive': {
      if (core.dive > 0 || p.submerged > 0) return 0;
      const t = SPECIALS['deep-dive'];
      core.dive = t.time * durationMul(p.stats);
      core.diveBurstDone = false;
      c.applyStatus(p, 'submerged', core.dive + 0.3, 1);
      p.skills.special.active = core.dive;
      return t.cooldown;
    }
    case 'chefs-banquet': {
      const t = SPECIALS['chefs-banquet'];
      const time = t.time * durationMul(p.stats);
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * t.heal);
      c.applyStatus(p, 'frenzy', time, t.fireRate);
      p.skills.special.active = time;
      return t.cooldown;
    }
    case 'signal-flare':
      signalFlare(c);
      p.skills.special.active = SPECIALS['signal-flare'].flight + 1;
      return SPECIALS['signal-flare'].cooldown;
    case 'seaquake': {
      const t = SPECIALS.seaquake;
      const radius = t.radius * areaMul(p.stats);
      spawnShockwave(c, p.x, p.z, radius, t.damage * skillPower(p), t.knockback, t.time, t.slow, t.slowTime * durationMul(p.stats), 0);
      c.emit({ type: 'explosion', x: p.x, z: p.z, radius, kind: 'water', team: 'player' });
      core.kickPitch(-0.25); core.kickRoll(0.18);
      c.requestTimeScale(0.5, 0.2);
      p.skills.special.active = t.time;
      return t.cooldown;
    }
  }
}

function startDash(c: CoreSim): boolean {
  const p = c.state.player;
  const core = c.core;
  if (core.dashTime > 0) return false;
  const t = SPECIALS.lionburst;
  let dx = p.aimX - p.x, dz = p.aimZ - p.z;
  let d = Math.sqrt(dx * dx + dz * dz);
  // Leap toward the cursor and land on it (70–180 m); a cursor on the ship leaps straight ahead at full length.
  let dist: number = d < 30 ? t.distance : Math.min(t.distance, Math.max(t.minDistance, d));
  if (d < 30) { dx = -Math.sin(p.heading); dz = -Math.cos(p.heading); d = 1; }
  dx /= d; dz /= d;
  const margin = p.beam * 0.6 + 4;
  while (dist >= t.minDistance && !c.world.isWater(p.x + dx * dist, p.z + dz * dist, margin)) dist -= 15;
  if (dist < t.minDistance) return false;
  core.dashTime = t.time; core.dashDur = t.time;
  core.dashSX = p.x; core.dashSZ = p.z; core.dashEX = p.x + dx * dist; core.dashEZ = p.z + dz * dist;
  core.dashH0 = p.heading; core.dashH1 = Math.atan2(-dx, -dz);
  p.invulnerable = Math.max(p.invulnerable, t.time + 0.15);
  c.applyStatus(p, 'airborne', t.time, 1);
  core.kickPitch(0.35);
  p.skills.special.active = t.time;
  return true;
}

/** Lionburst flight: eased arc to the landing point, turning to face the leap; lands with a shock ring. */
export function updateDash(c: CoreSim): void {
  const p = c.state.player;
  const core = c.core;
  const dt = c.dt;
  const px = p.x, pz = p.z;
  core.dashTime = Math.max(0, core.dashTime - dt);
  const k = clamp(1 - core.dashTime / core.dashDur, 0, 1);
  const e = 0.5 - 0.5 * Math.cos(Math.PI * k);
  p.x = core.dashSX + (core.dashEX - core.dashSX) * e;
  p.z = core.dashSZ + (core.dashEZ - core.dashSZ) * e;
  const turn = clamp(k * 1.6, 0, 1);
  p.heading = core.dashH0 + wrapAngle(core.dashH1 - core.dashH0) * turn * turn * (3 - 2 * turn);
  p.airborne = Math.sin(Math.PI * k);
  p.vx = (p.x - px) / dt; p.vz = (p.z - pz) / dt;
  p.speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  p.yawRate = 0;
  if (core.dashTime <= 0) land(c);
}

function land(c: CoreSim): void {
  const p = c.state.player;
  const core = c.core;
  const ship = c.content.ships[p.shipId];
  const t = SPECIALS.lionburst;
  p.airborne = 0;
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const v = ship.maxSpeed * Math.max(0.6, p.throttle);
  p.vx = fx * v; p.vz = fz * v; p.speed = v; core.prevForward = v;
  const radius = t.radius * areaMul(p.stats);
  spawnShockwave(c, p.x, p.z, radius, t.damage * skillPower(p), t.knockback, 0.45, 0, 0, 0);
  c.emit({ type: 'explosion', x: p.x, z: p.z, radius, kind: 'large', team: 'player' });
  core.kickPitch(-0.4);
  core.kickRoll(0.12);
  c.requestTimeScale(0.55, 0.12);
}

function signalFlare(c: CoreSim): void {
  const p = c.state.player;
  const t = SPECIALS['signal-flare'];
  const power = skillPower(p);
  let dx = p.aimX - p.x, dz = p.aimZ - p.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const maxR = t.maxRange * rangeMul(p.stats);
  if (d > maxR) { dx *= maxR / d; dz *= maxR / d; }
  const cx = p.x + dx, cz = p.z + dz;
  const area = t.radius * areaMul(p.stats);
  const spread = t.spread * Math.sqrt(areaMul(p.stats));
  const sternX = p.x + Math.sin(p.heading) * p.length * 0.45, sternZ = p.z + Math.cos(p.heading) * p.length * 0.45;
  for (let i = 0; i < t.shells; i++) {
    const a = c.random() * Math.PI * 2, r = Math.sqrt(c.random()) * spread;
    const tx = cx + Math.sin(a) * r, tz = cz + Math.cos(a) * r;
    const flight = t.flight + i * 0.07;
    c.addTelegraph({ shape: 'circle', team: 'player', x: tx, z: tz, radius: area, duration: flight });
    const cm = crit(c);
    lobShell(c, 'mortar-shell', sternX, sternZ, 6, tx, tz, flight, t.damage * power * cm, area, undefined, CRIT.on);
  }
}

// ───────────────────────────── Ultimates ─────────────────────────────

/** Activates the ship ultimate. Returns its active time (≥ 0), or −1 if it could not fire. */
export function activateUltimate(c: CoreSim, id: UltimateId): number {
  const p = c.state.player;
  const core = c.core;
  const dur = durationMul(p.stats);
  switch (id) {
    case 'ramming-speed': {
      const t = ULTIMATES['ramming-speed'];
      core.rammingSpeed = t.time * dur;
      const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
      const kick = c.content.ships[p.shipId].maxSpeed * 0.35;
      p.vx += fx * kick; p.vz += fz * kick;
      core.kickPitch(0.3);
      return core.rammingSpeed;
    }
    case 'sunfire-barrage':
      core.sunfire = ULTIMATES['sunfire-barrage'].time * dur;
      core.ultGunT = 0;
      return core.sunfire;
    case 'torpedo-swarm':
      torpedoSwarm(c);
      return 1;
    case 'kitchen-inferno':
      kitchenInferno(c);
      return core.inferno;
    case 'admirals-judgment':
      admiralsJudgment(c);
      return ULTIMATES['admirals-judgment'].delay + 1;
    case 'tidal-colossus':
      tidalColossus(c);
      return ULTIMATES['tidal-colossus'].distance / ULTIMATES['tidal-colossus'].speed;
  }
}

function torpedoSwarm(c: CoreSim): void {
  const p = c.state.player;
  const core = c.core;
  const t = ULTIMATES['torpedo-swarm'];
  const power = skillPower(p);
  const n = selectNearest(c, p.x, p.z, t.range * rangeMul(p.stats), t.count, core.bufW);
  const bowX = p.x - Math.sin(p.heading) * p.length * 0.45, bowZ = p.z - Math.cos(p.heading) * p.length * 0.45;
  const area = t.area * areaMul(p.stats);
  for (let i = 0; i < t.count; i++) {
    const fan = (i / (t.count - 1) - 0.5) * 2.4;
    const a = p.heading + fan;
    const dx = -Math.sin(a), dz = -Math.cos(a);
    const cm = crit(c);
    const idx = c.shoot('torpedo', 'player', bowX, -1, bowZ, dx * 36, 0, dz * 36, t.damage * power * cm, 2, 0, 7, undefined, CRIT.on, area);
    if (idx < 0) continue;
    core.pTurn[idx] = t.turn;
    core.pSpeed[idx] = t.speed;
    core.pFlags[idx] = PF_WATER;
    core.pKnock[idx] = 6;
    if (n > 0) {
      const target = core.sel[i % n]!;
      core.pTarget[idx] = target;
      c.state.projectiles[idx]!.target = target.id;
    }
  }
}

function kitchenInferno(c: CoreSim): void {
  const p = c.state.player;
  const core = c.core;
  const t = ULTIMATES['kitchen-inferno'];
  const power = skillPower(p);
  core.inferno = t.time * durationMul(p.stats);
  core.ultGunT = 0;
  const ring = t.ring * Math.sqrt(areaMul(p.stats));
  for (let i = 0; i < t.barrels; i++) {
    const a = (i / t.barrels) * Math.PI * 2 + p.heading;
    const x = p.x + Math.sin(a) * ring, z = p.z + Math.cos(a) * ring;
    const fuse = 0.4 + (i % 4) * 0.25;
    const idx = c.placeHazard('barrel', 'player', x, z, 4, fuse, t.fireDamage * power, 0, 0, 0, undefined, true);
    if (idx < 0) continue;
    core.hFlags[idx] = HF_ULT;
    core.hA[idx] = t.fireRadius * areaMul(p.stats);
    core.hB[idx] = t.fireTime * durationMul(p.stats);
    core.hC[idx] = t.fireDamage * power;
    core.hD[idx] = t.fireDamage * power * 2;
  }
}

function admiralsJudgment(c: CoreSim): void {
  const p = c.state.player;
  const t = ULTIMATES['admirals-judgment'];
  const power = skillPower(p);
  let dx = p.aimX - p.x, dz = p.aimZ - p.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 25) { dx = -Math.sin(p.heading); dz = -Math.cos(p.heading); } else { dx /= d; dz /= d; }
  const len = t.length * rangeMul(p.stats);
  const width = t.width * areaMul(p.stats);
  const area = t.area * areaMul(p.stats);
  // Telegraph 'line': starts at (x,z), runs `length` metres along `angle` (heading convention: direction
  // (−sin angle, −cos angle)); `radius` is the half-width.
  c.addTelegraph({ shape: 'line', team: 'player', x: p.x, z: p.z, radius: width * 0.5, length: len, angle: Math.atan2(-dx, -dz), duration: t.delay + 0.3 });
  const count = Math.max(1, Math.floor((len - 20) / t.spacing) + 1);
  for (let i = 0; i < count; i++) {
    const along = 20 + i * t.spacing;
    const lat = (c.random() - 0.5) * width * 0.5;
    const tx = p.x + dx * along - dz * lat, tz = p.z + dz * along + dx * lat;
    const cm = crit(c);
    lobShell(c, 'mortar-shell', p.x, p.z, 8, tx, tz, t.delay + i * 0.045, t.damage * power * cm, area, undefined, CRIT.on);
  }
  c.requestTimeScale(0.7, 0.15);
}

function tidalColossus(c: CoreSim): void {
  const p = c.state.player;
  const core = c.core;
  const t = ULTIMATES['tidal-colossus'];
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const sx = p.x + fx * (p.length * 0.5 + 12), sz = p.z + fz * (p.length * 0.5 + 12);
  const halfWidth = t.width * 0.5 * areaMul(p.stats);
  const idx = c.placeHazard('wave-front', 'player', sx, sz, halfWidth, t.distance / t.speed, t.damage * skillPower(p), 0, fx * t.speed, fz * t.speed, undefined, true);
  if (idx >= 0) {
    core.hA[idx] = fx; core.hB[idx] = fz; core.hC[idx] = 12; core.hD[idx] = t.stun;
    core.hKnock[idx] = t.knockback;
    core.hFlags[idx] = HF_WASH | HF_STUN;
  }
  c.emit({ type: 'explosion', x: sx, z: sz, radius: halfWidth, kind: 'water', team: 'player' });
  core.kickPitch(0.3);
  c.requestTimeScale(0.6, 0.25);
}

// ───────────────────────────── Per-tick skill state ─────────────────────────────

export function updateSkillEffects(c: CoreSim): void {
  const p = c.state.player;
  const core = c.core;
  const dt = c.dt;
  if (core.rammingSpeed > 0) core.rammingSpeed = Math.max(0, core.rammingSpeed - dt);
  if (core.sunfire > 0) core.sunfire = Math.max(0, core.sunfire - dt);
  if (core.inferno > 0) core.inferno = Math.max(0, core.inferno - dt);
  // Deep Dive: sink, cruise submerged, surface with a burst.
  if (core.dive > 0) {
    core.dive = Math.max(0, core.dive - dt);
    p.submerged = Math.min(1, p.submerged + dt / 0.35);
  } else if (p.submerged > 0) {
    const before = p.submerged;
    p.submerged = Math.max(0, p.submerged - dt / 0.3);
    if (!core.diveBurstDone && before >= 0.5 && p.submerged < 0.5) {
      core.diveBurstDone = true;
      const t = SPECIALS['deep-dive'];
      const radius = t.radius * areaMul(p.stats);
      spawnShockwave(c, p.x, p.z, radius, t.damage * skillPower(p), t.knockback, 0.4, 0, 0, t.stun);
      c.emit({ type: 'explosion', x: p.x, z: p.z, radius, kind: 'water', team: 'player' });
      core.kickPitch(0.3);
      c.requestTimeScale(0.6, 0.1);
    }
  }
}

// ───────────────────────────── Brace parry ─────────────────────────────

/**
 * A hit landed in the first PARRY_WINDOW seconds of a brace: negate it, ring out a shockwave and send nearby enemy
 * shots back the way they came (as player shots, double damage).
 */
export function parry(c: CoreSim, _x: number, _z: number): void {
  const p = c.state.player;
  const core = c.core;
  const power = skillPower(p);
  spawnShockwave(c, p.x, p.z, PARRY.radius * areaMul(p.stats), PARRY.damage * power, PARRY.knockback, 0.35, 0, 0, PARRY.stun);
  const list = c.state.projectiles;
  const r2 = PARRY.reflectRadius * PARRY.reflectRadius;
  for (let i = 0; i < list.length; i++) {
    const pr = list[i]!;
    if (!pr.alive || pr.team !== 'enemy') continue;
    const dx = pr.x - p.x, dz = pr.z - p.z;
    if (dx * dx + dz * dz > r2) continue;
    if (KIND_TRAITS[pr.kind] & K_BALLISTIC) { pr.alive = false; continue; }
    pr.team = 'player';
    pr.vx = -pr.vx * 1.2; pr.vz = -pr.vz * 1.2;
    pr.damage *= 2; pr.age = 0; pr.ttl = 2; pr.weapon = undefined; pr.pierce = 0; pr.target = undefined;
    if (pr.hits.length > 0) pr.hits.length = 0;
    core.pFlags[i] = PF_REFLECTED; core.pTurn[i] = 0; core.pTarget[i] = null;
  }
  c.emit({ type: 'skill-used', slot: 'brace', skill: 'brace', x: p.x, z: p.z, aimX: p.aimX, aimZ: p.aimZ });
  c.emit({ type: 'explosion', x: p.x, z: p.z, radius: PARRY.radius, kind: 'medium', team: 'player' });
  p.skills.brace.cooldown = Math.min(p.skills.brace.cooldown, 1.5);
  core.kickRoll(0.12);
  c.requestTimeScale(0.3, 0.15);
}
