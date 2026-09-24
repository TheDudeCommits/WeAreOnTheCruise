/**
 * Enemy AI (META-owned): one behaviour per EnemyBehavior plus shared seamanship (separation, island look-ahead,
 * line-abreast formations, retreat when badly damaged, convoys) and gunnery (loaded-side broadsides, lead that
 * grows with run time and captain skill, telegraphed heavy volleys, mortar circles).
 *
 * Enemy AI scratch (`e.ai`, numbers only; renderers may read the documented visual keys):
 *   visual:   fade 0..1 (Gloam wraith phasing, 1 = invisible) · sub 0..1 (wyrmling submerged) ·
 *             limbo 1 while fully phased/submerged (the ship stays put with e.hidden = 1: untargetable, no contacts).
 *             Statuses mirror them: 'invulnerable' (wraith phase), 'submerged' (wyrmling dive), 'burning' (lit fire ship).
 *   behaviour: init mode t orbit flank skill reloadP reloadS windup windSide aimX aimZ tslot slotT retreated avoid
 *             hx hz tg lh lx lz leader fslot isLeader convoy detonate
 *   CORE:     contactCd (collisions.ts)
 */
import { DIRECTOR } from '../content/director';
import { ENEMY_AI } from '../content/enemies';
import type { EnemyAttackDef, EnemyDef, EnemyState, StatusState } from '../types';
import type { SimContext, Target } from './context';
import { focusOf } from './targeting';
import { metaRuntime, type MetaRuntime } from './meta-runtime';
import { enemyDamage } from './meta-spawn';
import {
  TAU, avoidIslands, bearingFromPlayer, clamp, enterLimbo, exitLimbo, fireShot, fwdX, fwdZ, headingTo, killTelegraph,
  leadAim, lineTelegraph, lobShell, moveTelegraph, openWaterNear, predictPlayer, rand, sail, separate, sideX, sideZ, wrap,
} from './meta-steer';

const blastScratch: Target[] = [];
/** Fire-control store of the run being updated (set at the top of updateEnemies). */
let fleet: MetaRuntime | null = null;

/** Takes fire-control tokens for an attack; false = hold fire this tick. */
function takeFire(e: EnemyState): boolean {
  const cost = ENEMY_AI[e.defId].fireCost;
  if (!fleet || fleet.fire < cost) return false;
  fleet.fire -= cost;
  return true;
}

/** Lunge line length (m), speed (m/s) and ripple telegraph (s) for wyrmlings. */
const LUNGE_LENGTH = 150;
const LUNGE_SPEED = 60;
const LUNGE_TELEGRAPH = 0.9;

// Modes (e.ai.mode).
const M_ENGAGE = 0, M_RETREAT = 1, M_RAM_WINDUP = 2, M_RAM = 3, M_PEEL = 4;
const SW_GATHER = 0, SW_RAM = 1, SW_PEEL = 2;
const PH_SAIL = 0, PH_FADE_OUT = 1, PH_LIMBO = 2, PH_FADE_IN = 3, PH_FIRE = 4;
const LG_SWIM = 0, LG_DIVE = 1, LG_UNDER = 2, LG_RIPPLE = 3, LG_LUNGE = 4, LG_RECOVER = 5;

export function updateEnemies(c: SimContext): void {
  const enemies = c.state.enemies;
  const rt = metaRuntime(c.state, c.content);
  const difficulty = c.content.seas[c.state.seaId].difficulty;
  rt.fire = Math.min(DIRECTOR.fireBank, rt.fire + DIRECTOR.fireRate(c.state.time / 60) * Math.pow(difficulty, DIRECTOR.fireDifficultyExp) * c.dt);
  fleet = rt;
  // Rotate the update order every tick so no ship is always first in line for fire-control tokens.
  const n = enemies.length;
  const start = n > 0 ? c.state.tick % n : 0;
  for (let k = 0; k < n; k++) {
    const e = enemies[(start + k) % n]!;
    if (e.life !== 'alive') { e.hidden = 0; wreck(c, e); continue; }
    e.hitFlash = Math.max(0, e.hitFlash - c.dt * 4);
    tickStatuses(c, e);
    const def = c.content.enemies[e.defId];
    if (e.ai.init !== 1) initEnemy(c, e);
    if (e.ai.limbo !== 1 && c.hasStatus(e, 'stunned')) drift(c, e);
    else switch (def.behavior) {
      case 'swarm': swarm(c, e, def); break;
      case 'ram': rammer(c, e, def); break;
      case 'chaser': chaser(c, e, def); break;
      case 'broadside': broadside(c, e, def); break;
      case 'artillery': artillery(c, e, def); break;
      case 'kamikaze': kamikaze(c, e, def); break;
      case 'phase': phaseShip(c, e, def); break;
      case 'lunge': lunge(c, e, def); break;
      case 'stationary': stationary(c, e, def); break;
    }
    e.hidden = e.ai.limbo === 1 ? 1 : Math.max(e.ai.fade ?? 0, e.ai.sub ?? 0);
  }
}

// ───────────────────────── Shared ─────────────────────────

function initEnemy(c: SimContext, e: EnemyState): void {
  const ai = e.ai;
  ai.init = 1;
  ai.mode = ai.mode ?? 0;
  ai.t = ai.t ?? rand(c, 0.8, 2.6);
  ai.orbit = ai.orbit ?? (c.random() < 0.5 ? 1 : -1);
  ai.flank = ai.flank ?? rand(c, -1.2, 1.2);
  ai.skill = ENEMY_AI[e.defId].skill + (e.elite ? 0.15 : 0);
  ai.reloadP = rand(c, 0.8, 3);
  ai.reloadS = rand(c, 0.8, 3);
  ai.slotT = 0;
  ai.windup = 0;
}

function tickStatuses(c: SimContext, e: EnemyState): void {
  const list = e.statuses;
  for (let i = list.length - 1; i >= 0; i--) {
    const st = list[i]!;
    st.time -= c.dt;
    if (st.time <= 0) {
      list.splice(i, 1);
      c.emit({ type: 'status-changed', target: e.id, status: st.kind, on: false });
    }
  }
}

function clearStatus(e: EnemyState, kind: StatusState['kind']): void {
  for (const st of e.statuses) if (st.kind === kind) st.time = Math.min(st.time, 1e-4);
}

/** Speed after heat, slows and hooks. */
function baseSpeed(c: SimContext, e: EnemyState, def: EnemyDef): number {
  let m = DIRECTOR.speedScale(c.state.time / 60);
  for (const st of e.statuses) {
    if (st.time <= 0) continue;
    if (st.kind === 'slowed') m *= 1 - Math.min(0.8, st.magnitude > 1 ? 0.4 : st.magnitude);
    else if (st.kind === 'hooked') m *= 0.35;
  }
  return def.speed * m;
}

/** Gunnery lead: grows with run time and captain skill (0 = current position, 1 = perfect intercept). */
function gunLead(c: SimContext, e: EnemyState, attack: EnemyAttackDef): number {
  const minute = c.state.time / 60;
  return clamp(attack.lead * DIRECTOR.graceLead(minute) + e.ai.skill! * 0.45 * Math.min(1, minute / 14), 0, 0.95);
}

/** Spread tightens as crews get better. */
function gunSpread(c: SimContext, e: EnemyState, attack: EnemyAttackDef): number {
  const minute = c.state.time / 60;
  return attack.spread * DIRECTOR.graceSpread(minute) * (1 - 0.4 * e.ai.skill! * Math.min(1, minute / 14));
}

/** Reload time after heat grace and elite drill. */
function reloadTime(c: SimContext, e: EnemyState, attack: EnemyAttackDef): number {
  return attack.cooldown * rand(c, 0.9, 1.1) * (e.elite ? 0.85 : 1) * DIRECTOR.graceReload(c.state.time / 60);
}

/** Tactical skill (T-crossing, stern rakes): grows over the run. */
function tactics(c: SimContext, e: EnemyState): number {
  return clamp(e.ai.skill! * (0.5 + c.state.time / 900), 0, 0.95);
}

function steer(c: SimContext, e: EnemyState, desired: number, speed: number, turnRate: number, sepWeight = 1.6, accel = 1.2): void {
  let h = separate(c, e, desired, sepWeight);
  h = avoidIslands(c, e, h);
  sail(c, e, h, speed, turnRate, accel);
}

/** Heading that puts the player on `side` beam (+1 port, −1 starboard) at range R, with range keeping. */
function beamHeading(hb: number, side: number, dist: number, R: number): number {
  const rangeErr = clamp((dist - R) / 60, -1, 1);
  return hb - side * (Math.PI / 2) + side * rangeErr * 0.6;
}

function drift(c: SimContext, e: EnemyState): void {
  e.speed *= 0.96;
  e.yawRate *= 0.9;
  sail(c, e, e.heading, e.speed, 0);
}

function wreck(c: SimContext, e: EnemyState): void {
  if (e.ai.limbo === 1) { e.ai.limbo = 0; e.x = e.ai.hx ?? e.x; e.z = e.ai.hz ?? e.z; }
  e.hitFlash = Math.max(0, e.hitFlash - c.dt * 4);
  e.speed *= 0.97;
  e.vx *= 0.985; e.vz *= 0.985;
  e.x += e.vx * c.dt * 0.5; e.z += e.vz * c.dt * 0.5;
  if (e.ai.tg) { killTelegraph(c, e.ai.tg); e.ai.tg = 0; }
  if (e.ai.detonate === 1) { e.ai.detonate = 0; detonate(c, e, c.content.enemies[e.defId], false); }
}

// ───────────────────────── Swarm (skiffs) ─────────────────────────

function swarm(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const p = focusOf(c, e), ai = e.ai;
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  const speed = baseSpeed(c, e, def);
  ai.t! -= c.dt;
  let desired: number, spd = speed;
  if (!p.alive) desired = headingTo(-dx, -dz);
  else if (ai.mode === SW_RAM) {
    const aim = leadAim(c, e.x, e.z, speed * 1.3, 0.75, p);
    desired = headingTo(aim.x - e.x, aim.z - e.z);
    spd = speed * 1.3;
    if (dist < p.radius + e.radius + 2 || ai.t! <= 0) { ai.mode = SW_PEEL; ai.t = rand(c, 1, 1.8); }
  } else if (ai.mode === SW_PEEL) {
    desired = headingTo(-dx, -dz) + ai.orbit! * 0.9;
    if (ai.t! <= 0) { ai.mode = SW_GATHER; ai.t = rand(c, 2, 4.5); ai.flank = rand(c, -1.2, 1.2); }
  } else {
    // Fan out around the player on a flank point, then commit to a ram.
    const around = headingTo(-dx, -dz) + ai.flank! * 0.6;
    const r = clamp(dist * 0.6, 40, 80);
    desired = headingTo(p.x + fwdX(around) * r - e.x, p.z + fwdZ(around) * r - e.z);
    if (dist < 110 && ai.t! <= 0) { ai.mode = SW_RAM; ai.t = 3.2; }
  }
  steer(c, e, desired, spd, def.turnRate, 1.6, 2);
}

// ───────────────────────── Ram (charger; also corsair brigs' boarding rush) ─────────────────────────

function rammer(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const p = focusOf(c, e), ai = e.ai;
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  const speed = baseSpeed(c, e, def);
  ai.t! -= c.dt;
  if (ai.mode === M_RAM_WINDUP || ai.mode === M_RAM || ai.mode === M_PEEL) { ramStep(c, e, def, speed, dist); return; }
  steer(c, e, headingTo(dx, dz) + (dist > 160 ? ai.flank! * 0.3 : 0), speed, def.turnRate);
  if (dist < 130 && ai.t! <= 0 && p.alive) startRam(c, e, speed);
}

function startRam(c: SimContext, e: EnemyState, speed: number): void {
  const ai = e.ai;
  const aim = leadAim(c, e.x, e.z, speed * 1.9, 0.7, focusOf(c, e));
  ai.mode = M_RAM_WINDUP;
  ai.t = 0.9;
  ai.lh = headingTo(aim.x - e.x, aim.z - e.z);
  ai.tg = lineTelegraph(c, e.x, e.z, ai.lh, 170, e.radius + 3, 0.9)?.id ?? 0;
}

function ramStep(c: SimContext, e: EnemyState, def: EnemyDef, speed: number, dist: number): void {
  const p = focusOf(c, e), ai = e.ai;
  if (ai.mode === M_RAM_WINDUP) {
    sail(c, e, ai.lh!, speed * 0.35, def.turnRate * 2);
    moveTelegraph(c, ai.tg!, e.x, e.z);
    if (ai.t! <= 0) { ai.mode = M_RAM; ai.t = 2.2; ai.tg = 0; }
  } else if (ai.mode === M_RAM) {
    sail(c, e, ai.lh!, speed * 1.9, def.turnRate * 0.25, 3);
    if (dist < p.radius + e.radius + 2 || ai.t! <= 0) { ai.mode = M_PEEL; ai.t = rand(c, 1.2, 2); }
  } else {
    steer(c, e, headingTo(e.x - p.x, e.z - p.z) + ai.orbit! * 0.8, speed, def.turnRate);
    if (ai.t! <= 0) { ai.mode = M_ENGAGE; ai.t = rand(c, 4, 7); }
  }
}

// ───────────────────────── Chaser (cutters: bow gun) ─────────────────────────

function chaser(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const attack = def.attack!;
  const tune = ENEMY_AI[e.defId];
  const p = focusOf(c, e), ai = e.ai;
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  const speed = baseSpeed(c, e, def);
  const R = attack.range * tune.rangeFrac;
  ai.t! -= c.dt;
  let desired: number, spd = speed;
  if (ai.mode === 1) {
    // Too close: break away and come round again.
    desired = headingTo(-dx, -dz) + ai.orbit! * 0.8;
    if (ai.t! <= 0 || dist > R) ai.mode = 0;
  } else {
    const aim = leadAim(c, e.x, e.z, attack.speed, gunLead(c, e, attack), p);
    desired = headingTo(aim.x - e.x, aim.z - e.z) + (dist > R + 40 ? ai.flank! * 0.3 : 0);
    spd = dist > R ? speed : speed * 0.55;
    if (dist < R * 0.45) { ai.mode = 1; ai.t = rand(c, 2, 3); }
  }
  steer(c, e, desired, spd, def.turnRate);

  // Bow gun: fires when the (led) target is within ±18° of the bow.
  e.attackCooldown -= c.dt;
  if (e.attackCooldown > 0 || dist > attack.range || !p.alive) return;
  const aim = leadAim(c, e.x, e.z, attack.speed, gunLead(c, e, attack), p);
  const tx = aim.x, tz = aim.z;
  if (Math.abs(wrap(headingTo(tx - e.x, tz - e.z) - e.heading)) > 0.32) return;
  if (!takeFire(e)) { e.attackCooldown = 0.25; return; }
  const bx = e.x + fwdX(e.heading) * e.length * 0.45, bz = e.z + fwdZ(e.heading) * e.length * 0.45;
  const count = attack.count + (e.elite ? 1 : 0);
  const spread = gunSpread(c, e, attack);
  const damage = enemyDamage(c, e, attack.damage);
  for (let k = 0; k < count; k++) {
    const fan = count > 1 ? (k - (count - 1) / 2) * 0.06 : 0;
    fireShot(c, attack.projectile, bx, bz, tx, tz, attack.speed, damage, attack.range, 1.3, fan + (c.random() - 0.5) * 2 * spread);
  }
  c.emit({ type: 'enemy-fired', source: e.id, projectile: attack.projectile, x: bx, z: bz, dirX: fwdX(e.heading), dirZ: fwdZ(e.heading), count });
  e.attackCooldown = reloadTime(c, e, attack);
}

// ───────────────────────── Broadside ships ─────────────────────────

function broadside(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const attack = def.attack!;
  const tune = ENEMY_AI[e.defId];
  const p = focusOf(c, e), ai = e.ai, dt = c.dt;
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  const speed = baseSpeed(c, e, def);
  ai.reloadP! -= dt; ai.reloadS! -= dt; ai.t! -= dt; ai.slotT! -= dt;

  if (ai.convoy === 1) { convoy(c, e, def, speed, dist); return; }
  if (tune.retreatBelow > 0 && ai.retreated !== 1 && e.hp < e.maxHp * tune.retreatBelow && ai.windup! <= 0) {
    ai.retreated = 1; ai.mode = M_RETREAT; ai.t = rand(c, 5.5, 8); ai.leader = 0;
  }
  if ((ai.leader ?? 0) > 0 && ai.mode === M_ENGAGE && followFormation(c, e, def, speed, dist)) return;
  if (ai.mode === M_RAM_WINDUP || ai.mode === M_RAM || ai.mode === M_PEEL) { ramStep(c, e, def, speed, dist); return; }

  let desired = e.heading, spd = speed, turn = def.turnRate;
  if (ai.windup! > 0) {
    // Telegraphed volley: hold course while the gun crews lay the guns.
    ai.windup! -= dt;
    spd = speed * 0.55; turn = def.turnRate * 0.3;
    if (ai.windup! <= 0) { ai.tg = 0; fireVolley(c, e, def, ai.windSide!, true); }
  } else if (ai.mode === M_RETREAT) {
    desired = headingTo(-dx, -dz) + ai.orbit! * 0.25;
    spd = speed * 1.1;
    if (ai.t! <= 0) ai.mode = M_ENGAGE;
  } else {
    const R = attack.range * tune.rangeFrac;
    const hb = headingTo(dx, dz);
    if (dist > R + 70) {
      desired = hb + ai.flank! * 0.35;
      if (ai.isLeader === 1) spd = speed * 0.88;
    } else {
      // Present the LOADED side; if both are loaded, the one needing the least turn.
      const rel = wrap(hb - e.heading);
      const portReady = ai.reloadP! <= 0.6, stbdReady = ai.reloadS! <= 0.6;
      let side = rel >= 0 ? 1 : -1;
      if (portReady && !stbdReady) side = 1;
      else if (stbdReady && !portReady) side = -1;
      if (ai.slotT! <= 0) { ai.slotT = rand(c, 2.5, 4.5); ai.tslot = c.random() < tactics(c, e) ? 1 : 0; }
      desired = beamHeading(hb, side, dist, R);
      if (ai.tslot === 1 && p.speed > 3) {
        // Cross the T (sit off the player's bow) or rake the stern: where the player's broadside cannot bear.
        const bow = bearingFromPlayer(p, e.x, e.z);
        const slot = p.heading + (Math.abs(bow) < Math.PI / 2 ? 0 : Math.PI);
        const tx = p.x + fwdX(slot) * R, tz = p.z + fwdZ(slot) * R;
        const sd = Math.hypot(tx - e.x, tz - e.z);
        if (sd > 55 && sd < R * 2.2) desired = headingTo(tx - e.x, tz - e.z);
      }
      if (tune.ramChance > 0 && dist < 110 && ai.t! <= 0) {
        ai.t = rand(c, 5, 8);
        if (c.random() < tune.ramChance && p.alive) { startRam(c, e, speed); return; }
      }
    }
  }
  // Gun ships keep clear of the player's hull (only rams mean to touch).
  const clear = e.radius + p.radius + 35;
  if (dist < clear) {
    const away = headingTo(-dx, -dz);
    const w = (clear - dist) / clear;
    desired = Math.atan2(-(fwdX(desired) * (1 - w) + fwdX(away) * w * 2), -(fwdZ(desired) * (1 - w) + fwdZ(away) * w * 2));
  }
  steer(c, e, desired, spd, turn);
  if (ai.windup! <= 0) tryBroadside(c, e, def, dist);
}

/** Fires (or starts the telegraph for) the side whose beam currently bears on the player. */
function tryBroadside(c: SimContext, e: EnemyState, def: EnemyDef, dist: number): void {
  const attack = def.attack!;
  const p = focusOf(c, e), ai = e.ai;
  if (dist > attack.range || !p.alive) return;
  const rel = wrap(headingTo(p.x - e.x, p.z - e.z) - e.heading);
  const arc = 0.5;
  let side = 0;
  if (ai.reloadP! <= 0 && Math.abs(wrap(rel - Math.PI / 2)) < arc) side = 1;
  else if (ai.reloadS! <= 0 && Math.abs(wrap(rel + Math.PI / 2)) < arc) side = -1;
  if (!side || !takeFire(e)) return;
  if (attack.telegraph > 0) beginVolley(c, e, def, side, dist);
  else fireVolley(c, e, def, side, false);
}

/** Starts a telegraphed volley: locks the aim point and draws the danger line. */
function beginVolley(c: SimContext, e: EnemyState, def: EnemyDef, side: number, dist: number): void {
  const attack = def.attack!;
  const ai = e.ai;
  const aim = leadAim(c, e.x, e.z, attack.speed, gunLead(c, e, attack), focusOf(c, e));
  ai.aimX = aim.x; ai.aimZ = aim.z;
  ai.windup = attack.telegraph;
  ai.windSide = side;
  if (side === 1) ai.reloadP = 99; else ai.reloadS = 99;
  const h = headingTo(ai.aimX - e.x, ai.aimZ - e.z);
  const halfWidth = Math.max(6, gunSpread(c, e, attack) * dist + e.length * 0.25);
  ai.tg = lineTelegraph(c, e.x, e.z, h, attack.range, halfWidth, attack.telegraph)?.id ?? 0;
}

/** One broadside from `side` (+1 port, −1 starboard). Guns are spread along the hull. */
function fireVolley(c: SimContext, e: EnemyState, def: EnemyDef, side: number, locked: boolean): void {
  const attack = def.attack!;
  const tune = ENEMY_AI[e.defId];
  const ai = e.ai;
  let tx: number, tz: number;
  if (locked) { tx = ai.aimX!; tz = ai.aimZ!; }
  else { const aim = leadAim(c, e.x, e.z, attack.speed, gunLead(c, e, attack), focusOf(c, e)); tx = aim.x; tz = aim.z; }
  const count = attack.count + (e.elite ? 1 : 0);
  const spread = gunSpread(c, e, attack);
  const fx = fwdX(e.heading), fz = fwdZ(e.heading);
  const sx = sideX(e.heading, side), sz = sideZ(e.heading, side);
  const span = e.length * tune.gunSpan;
  const damage = enemyDamage(c, e, attack.damage);
  const radius = 1.4 + e.length / 90;
  for (let k = 0; k < count; k++) {
    const along = count > 1 ? (k / (count - 1) - 0.5) * span : 0;
    const gx = e.x + fx * along + sx * e.radius * 0.7, gz = e.z + fz * along + sz * e.radius * 0.7;
    fireShot(c, attack.projectile, gx, gz, tx + fx * along * 0.5, tz + fz * along * 0.5, attack.speed, damage, attack.range * 1.15, radius,
      (c.random() - 0.5) * 2 * spread);
  }
  c.emit({ type: 'enemy-fired', source: e.id, projectile: attack.projectile, x: e.x, z: e.z, dirX: sx, dirZ: sz, count });
  const reload = reloadTime(c, e, attack);
  if (side === 1) ai.reloadP = reload; else ai.reloadS = reload;
}

/** Line-abreast follower: holds its slot on the leader's beam until the fight starts. */
function followFormation(c: SimContext, e: EnemyState, def: EnemyDef, speed: number, dist: number): boolean {
  const ai = e.ai;
  const L = c.findTarget(ai.leader!);
  const attack = def.attack;
  if (!L || L.life !== 'alive' || 'phase' in L || (attack && dist < attack.range * 1.15)) { ai.leader = 0; return false; }
  const spacing = ENEMY_AI[e.defId].formation || 45;
  const lh = L.heading;
  const off = ai.fslot! * spacing;
  const tx = L.x + sideX(lh, -1) * off + fwdX(lh) * 10;
  const tz = L.z + sideZ(lh, -1) * off + fwdZ(lh) * 10;
  const ddx = tx - e.x, ddz = tz - e.z, d = Math.hypot(ddx, ddz);
  let desired: number, spd: number;
  if (d > 30) { desired = headingTo(ddx, ddz); spd = speed * 1.15; }
  else {
    desired = lh + clamp(wrap(headingTo(ddx, ddz) - lh), -0.4, 0.4) * (d / 30);
    const along = ddx * fwdX(lh) + ddz * fwdZ(lh);
    spd = clamp(L.speed + along * 0.3, speed * 0.5, speed * 1.2);
  }
  steer(c, e, desired, spd, def.turnRate, 0.8);
  return true;
}

/** Treasure convoy galleon: flees, never fires, slips away after its escape timer. */
function convoy(c: SimContext, e: EnemyState, def: EnemyDef, speed: number, dist: number): void {
  const p = focusOf(c, e);
  const away = headingTo(e.x - p.x, e.z - p.z);
  const wander = Math.sin((c.state.time + e.id) * 0.35) * 0.5;
  steer(c, e, away + wander, speed * 1.05, def.turnRate);
  if (e.ai.t! <= 0 && dist > 330) {
    e.life = 'dead';
    let others = false;
    for (const o of c.state.enemies) if (o !== e && o.life === 'alive' && o.ai.convoy === 1) { others = true; break; }
    if (!others) c.emit({ type: 'director-event', name: 'Convoy Escaped', text: 'The treasure convoy slipped over the horizon.' });
  }
}

// ───────────────────────── Artillery (mortar barges) ─────────────────────────

function artillery(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const attack = def.attack!;
  const tune = ENEMY_AI[e.defId];
  const p = focusOf(c, e), ai = e.ai;
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  const speed = baseSpeed(c, e, def);
  ai.t! -= c.dt;
  if (tune.retreatBelow > 0 && ai.retreated !== 1 && e.hp < e.maxHp * tune.retreatBelow) { ai.retreated = 1; ai.mode = M_RETREAT; ai.t = 6; }
  const hb = headingTo(dx, dz);
  let desired: number, spd = speed;
  const minD = 180, maxD = 270;
  if (ai.mode === M_RETREAT) { desired = hb + Math.PI; spd = speed * 1.15; if (ai.t! <= 0) ai.mode = M_ENGAGE; }
  else if (dist < minD) { desired = hb + Math.PI + ai.orbit! * 0.5; spd = speed * (dist < 110 ? 1.2 : 1); }
  else if (dist > maxD) desired = hb + ai.flank! * 0.3;
  else { desired = hb - ai.orbit! * (Math.PI / 2); spd = speed * 0.4; }
  steer(c, e, desired, spd, def.turnRate);
  e.attackCooldown -= c.dt;
  if (e.attackCooldown <= 0 && dist < attack.range && dist > 60 && p.alive) {
    if (takeFire(e)) fireMortars(c, e, def, dist); else e.attackCooldown = 0.3;
  }
}

/** Lobbed shells with circle telegraphs that complete on impact (the first shell leads the player). */
function fireMortars(c: SimContext, e: EnemyState, def: EnemyDef, dist: number): void {
  const attack = def.attack!;
  const tune = ENEMY_AI[e.defId];
  const p = focusOf(c, e);
  const minute = c.state.time / 60;
  const count = attack.count + (minute >= 9 ? 1 : 0) + (e.elite ? 1 : 0);
  const flight = clamp(dist / attack.speed, attack.telegraph, attack.telegraph + 1.4);
  const lead = gunLead(c, e, attack);
  const damage = enemyDamage(c, e, attack.damage);
  const area = tune.area || 14;
  for (let k = 0; k < count; k++) {
    const t = flight + k * 0.25;
    const pred = predictPlayer(c, t, lead, p);
    let tx = pred.x, tz = pred.z;
    if (k > 0 || c.random() > e.ai.skill!) {
      const a = c.random() * TAU, r = area * rand(c, 0.6, 1.8);
      tx += Math.sin(a) * r; tz += Math.cos(a) * r;
    }
    lobShell(c, 'enemy-mortar', e.x, e.z, tx, tz, t, damage, area, true, Math.max(0, e.y) + 4);
  }
  const inv = 1 / (dist || 1);
  c.emit({ type: 'enemy-fired', source: e.id, projectile: 'enemy-mortar', x: e.x, z: e.z, dirX: (p.x - e.x) * inv, dirZ: (p.z - e.z) * inv, count });
  e.attackCooldown = reloadTime(c, e, attack);
}

// ───────────────────────── Kamikaze (fire ships) ─────────────────────────

function kamikaze(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const tune = ENEMY_AI[e.defId];
  const p = focusOf(c, e), ai = e.ai;
  const dist = Math.hypot(p.x - e.x, p.z - e.z);
  const speed = baseSpeed(c, e, def);
  let desired: number, spd: number;
  if (ai.mode !== 1) {
    const aim = leadAim(c, e.x, e.z, Math.max(8, speed), 0.55, p);
    desired = headingTo(aim.x - e.x, aim.z - e.z) + (dist > 160 ? ai.flank! * 0.25 : 0);
    spd = speed;
    if (dist < tune.igniteRange && p.alive) {
      // Ignition: the ship catches fire, a ring shows the blast radius, and it burns in at speed.
      ai.mode = 1;
      ai.t = tune.fuse;
      c.applyStatus(e, 'burning', tune.fuse + 4, 1);
      ai.tg = c.addTelegraph({ shape: 'ring', team: 'enemy', x: e.x, z: e.z, radius: tune.area, duration: tune.fuse })?.id ?? 0;
    }
  } else {
    const aim = leadAim(c, e.x, e.z, speed * tune.burnSpeed, 0.85, p);
    desired = headingTo(aim.x - e.x, aim.z - e.z);
    spd = speed * tune.burnSpeed;
    ai.t! -= c.dt;
    if (dist < p.radius + e.radius + 3 || ai.t! <= 0) { detonate(c, e, def, true); return; }
  }
  steer(c, e, desired, spd, def.turnRate * (ai.mode === 1 ? 1.3 : 1), 0.8, 2);
  if (ai.mode === 1) moveTelegraph(c, ai.tg!, e.x, e.z);
}

/** Fire-ship blast: hurts the player, rocks nearby enemy ships (chain reactions) and leaves burning water. */
function detonate(c: SimContext, e: EnemyState, def: EnemyDef, selfDestruct: boolean): void {
  const tune = ENEMY_AI[e.defId];
  const p = c.state.player;
  const r = tune.area || 22;
  killTelegraph(c, e.ai.tg ?? 0);
  e.ai.tg = 0;
  c.emit({ type: 'explosion', x: e.x, z: e.z, radius: r, kind: 'fire', team: 'enemy' });
  const d = Math.hypot(p.x - e.x, p.z - e.z);
  const reach = r + p.radius * 0.5;
  if (p.alive && d <= reach) {
    const falloff = 1 - 0.4 * clamp(d / reach, 0, 1);
    c.damagePlayer(enemyDamage(c, e, def.contactDamage) * falloff, { x: e.x, z: e.z, source: e.id, kind: 'hazard' });
  }
  const near = c.targetsNear(e.x, e.z, r, blastScratch);
  for (let i = 0; i < near.length; i++) {
    const t = near[i]!;
    if (t === e || t.life !== 'alive') continue;
    c.damageTarget(t, def.contactDamage * 1.5, { knockback: 8, fromX: e.x, fromZ: e.z });
  }
  c.spawnHazard({ kind: 'fire-patch', team: 'enemy', x: e.x, z: e.z, radius: r * 0.55, ttl: 4, damage: enemyDamage(c, e, 3), tick: 0.5 });
  if (selfDestruct) { e.hp = 0; e.life = 'sinking'; }
}

// ───────────────────────── Phase (Gloam wraiths) ─────────────────────────

function phaseShip(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const attack = def.attack!;
  const tune = ENEMY_AI[e.defId];
  const p = focusOf(c, e), ai = e.ai, dt = c.dt;
  const speed = baseSpeed(c, e, def);
  ai.t! -= dt;
  switch (ai.mode) {
    case PH_FADE_OUT: {
      ai.fade = Math.min(1, (ai.fade ?? 0) + dt / 0.6);
      sail(c, e, e.heading, speed * 0.5, def.turnRate);
      if (ai.fade >= 1) {
        enterLimbo(e);
        ai.mode = PH_LIMBO;
        ai.t = rand(c, 0.5, 0.9);
        c.applyStatus(e, 'invulnerable', ai.t + 0.5, 1);
      }
      return;
    }
    case PH_LIMBO: {
      if (ai.t! > 0) return;
      // Blink to a quarter the player's broadside cannot cover (off the bow or the stern).
      const sideSign = c.random() < 0.5 ? 1 : -1;
      const quarter = c.random() < 0.6 ? 0.7 : 2.45;
      const ang = p.heading + sideSign * quarter;
      const r = rand(c, 90, 115);
      const spot = openWaterNear(c, p.x + fwdX(ang) * r, p.z + fwdZ(ang) * r, e.radius + 6);
      const x = spot ? spot.x : ai.hx!, z = spot ? spot.z : ai.hz!;
      const hb = headingTo(p.x - x, p.z - z);
      const side = c.random() < 0.5 ? 1 : -1;
      exitLimbo(e, x, z, hb - side * (Math.PI / 2));
      e.speed = speed * 0.4;
      ai.mode = PH_FADE_IN;
      ai.t = 0.45;
      ai.fade = 1;
      return;
    }
    case PH_FADE_IN: {
      ai.fade = Math.max(0, ai.fade! - dt / 0.45);
      sail(c, e, e.heading, speed * 0.4, def.turnRate * 0.3);
      if (ai.t! <= 0) {
        ai.fade = 0;
        clearStatus(e, 'invulnerable');
        const rel = wrap(headingTo(p.x - e.x, p.z - e.z) - e.heading);
        ai.mode = PH_FIRE;
        ai.t = attack.telegraph + 0.3;
        if (p.alive) beginVolley(c, e, def, rel >= 0 ? 1 : -1, Math.hypot(p.x - e.x, p.z - e.z));
      }
      return;
    }
    case PH_FIRE: {
      sail(c, e, e.heading, speed * 0.5, def.turnRate * 0.3);
      if (ai.windup! > 0) {
        ai.windup! -= dt;
        if (ai.windup! <= 0) { ai.tg = 0; fireVolley(c, e, def, ai.windSide!, true); }
      }
      if (ai.t! <= 0) { ai.mode = PH_SAIL; ai.t = rand(c, 4, 6); ai.windup = 0; }
      return;
    }
    default: {
      const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
      const R = attack.range * tune.rangeFrac;
      const hb = headingTo(dx, dz);
      steer(c, e, dist > R + 40 ? hb + ai.flank! * 0.4 : beamHeading(hb, ai.orbit!, dist, R), speed, def.turnRate);
      // The blink volley is paid for up front: no fire-control token, no phase.
      if (ai.t! <= 0 && dist < 280 && p.alive) {
        if (takeFire(e)) { ai.mode = PH_FADE_OUT; ai.fade = 0; } else ai.t = 0.5;
      }
    }
  }
}

// ───────────────────────── Lunge (wyrmlings) ─────────────────────────

function lunge(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const p = focusOf(c, e), ai = e.ai, dt = c.dt;
  const speed = baseSpeed(c, e, def);
  ai.t! -= dt;
  switch (ai.mode) {
    case LG_DIVE: {
      ai.sub = Math.min(1, (ai.sub ?? 0) + dt / 0.5);
      e.y = -ai.sub * 5;
      sail(c, e, e.heading, speed * 0.8, def.turnRate);
      if (ai.sub >= 1) {
        enterLimbo(e);
        ai.mode = LG_UNDER;
        ai.t = rand(c, 0.6, 1);
        c.applyStatus(e, 'submerged', ai.t + LUNGE_TELEGRAPH + 0.1, 1);
      }
      return;
    }
    case LG_UNDER: {
      if (ai.t! > 0) return;
      // Surface point near the player, roughly on the side it dived from; ripple line toward the led target.
      const base = headingTo(ai.hx! - p.x, ai.hz! - p.z) + rand(c, -0.9, 0.9);
      const r = rand(c, 70, 90);
      const spot = openWaterNear(c, p.x + fwdX(base) * r, p.z + fwdZ(base) * r, e.radius + 4);
      ai.lx = spot ? spot.x : ai.hx!;
      ai.lz = spot ? spot.z : ai.hz!;
      const pred = predictPlayer(c, LUNGE_TELEGRAPH + (r / LUNGE_SPEED) * 0.6, 0.8, p);
      ai.lh = headingTo(pred.x - ai.lx, pred.z - ai.lz);
      ai.tg = lineTelegraph(c, ai.lx, ai.lz, ai.lh, LUNGE_LENGTH, e.radius + 3, LUNGE_TELEGRAPH)?.id ?? 0;
      ai.mode = LG_RIPPLE;
      ai.t = LUNGE_TELEGRAPH;
      return;
    }
    case LG_RIPPLE: {
      if (ai.t! > 0) return;
      exitLimbo(e, ai.lx!, ai.lz!, ai.lh!);
      clearStatus(e, 'submerged');
      e.speed = LUNGE_SPEED;
      ai.tg = 0;
      ai.mode = LG_LUNGE;
      ai.t = LUNGE_LENGTH / LUNGE_SPEED;
      return;
    }
    case LG_LUNGE: {
      ai.sub = Math.max(0, ai.sub! - dt / 0.2);
      e.y = -ai.sub * 5;
      sail(c, e, ai.lh!, LUNGE_SPEED, 0.15, 6);
      if (ai.t! <= 0) { ai.mode = LG_RECOVER; ai.t = rand(c, 2.2, 3.4); }
      return;
    }
    case LG_RECOVER: {
      steer(c, e, headingTo(p.x - e.x, p.z - e.z) + ai.orbit! * 1.2, speed * 0.45, def.turnRate);
      if (ai.t! <= 0) ai.mode = LG_SWIM;
      return;
    }
    default: {
      ai.sub = Math.max(0, (ai.sub ?? 0) - dt / 0.3);
      e.y = -ai.sub * 5;
      const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
      const weave = Math.sin((c.state.time + e.id) * 2.2) * 0.35;
      steer(c, e, headingTo(dx, dz) + weave + (dist > 160 ? ai.flank! * 0.3 : 0), speed, def.turnRate);
      if (dist < 140 && ai.t! <= 0 && p.alive) ai.mode = LG_DIVE;
    }
  }
}

// ───────────────────────── Stationary (fort batteries) ─────────────────────────

function stationary(c: SimContext, e: EnemyState, def: EnemyDef): void {
  e.vx = 0; e.vz = 0; e.speed = 0; e.yawRate = 0;
  const attack = def.attack;
  if (!attack) return;
  const p = focusOf(c, e);
  const dist = Math.hypot(p.x - e.x, p.z - e.z);
  e.attackCooldown -= c.dt;
  if (e.attackCooldown <= 0 && dist < attack.range && dist > 40 && p.alive) {
    if (takeFire(e)) fireMortars(c, e, def, dist); else e.attackCooldown = 0.3;
  }
}
