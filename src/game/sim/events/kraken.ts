/**
 * Kraken Rising (EVENTS). A ring of arms bursts from the sea around the player. Every arm is a stationary
 * 'kraken-arm' enemy (the guns shoot it like any ship); this module drives its attacks:
 *  - line slam: a telegraphed strip from the arm toward its target, crushing everything under it (both sides);
 *  - circle slam: farther out, a tentacle erupts under a telegraphed circle;
 *  - grab: close in, the arm snatches the player (telegraphed ring) and squeezes until it lets go — boost, dive,
 *    leap or shoot the arm to break free. Idle arms also snatch and crush enemy ships that stray too close.
 * Objective: sink every arm before the Kraken loses interest → treasure and a chest at the ring's centre.
 * Fail: time runs out or the player sails off; the arms sink back.
 *
 * Arm AI scratch (numbers; WorldEventFx reads the visual ones):
 *   kArm 1 · kIdx arm index · kSt state (see ST_*) · kT seconds in state · kCd attack cooldown ·
 *   kAng attack heading (forward = (−sin, −cos)) · kLen strip length · kTx/kTz circle or grab point ·
 *   kLast the windup that led to the current slam (ARM_LINE / ARM_CIRCLE / ARM_GRAB_WINDUP) ·
 *   kGrab 0 none / 1 player / 2 ship (kGid = its id) · kHp HP when the grab began · kTick squeeze timer ·
 *   sub 0..1 submerged (ai.ts turns it into e.hidden) · tg telegraph id (ai.ts clears it when the arm dies).
 */
import { DIRECTOR_EVENTS, EVENT_TUNING } from '../../content/director';
import { ENEMY_AI } from '../../content/enemies';
import type { EnemyState } from '../../types';
import type { SimContext } from '../context';
import { hullEdge } from '../core-runtime';
import { TAU, headingTo, killTelegraph, lineTelegraph, rand } from '../meta-steer';
import { focusOf } from '../targeting';
import {
  anchor, blastCircle, blastLine, eventPlayerDamage, eventShipDamage, eventSpawn, hurtShip, openEvent, payout, resolve, undecided,
} from './common';
import { OUTCOME_FAIL, OUTCOME_SUCCESS, complete, type EventRuntime, type WorldEventHandler } from './runtime';

export const ARM_RISE = 0, ARM_IDLE = 1, ARM_LINE = 2, ARM_CIRCLE = 3, ARM_SLAM = 4, ARM_GRAB_WINDUP = 5, ARM_GRAB = 6, ARM_RETRACT = 7;

const RISE_TIME = 1.4;
const RETRACT_TIME = 1.3;
const LINE_TELEGRAPH = 1.25;
const LINE_HALF_WIDTH = 6.5;
const LINE_REACH = 88;
const CIRCLE_TELEGRAPH = 1.35;
const CIRCLE_REACH = 175;
const SLAM_RECOVER = 0.9;
const GRAB_RADIUS = 12;
/** Metres per second a held ship is reeled toward the arm. */
const REEL = 3;
const SHIP_GRAB_REACH = 30;
const SHIP_GRAB_TIME = 2;
const SHIP_SQUEEZE = 35;
/** The Kraken loses interest when the player stays this far from the ring for AWAY_TIME seconds. */
const AWAY_DIST = 330;
const AWAY_TIME = 5;
const MAX_ARMS = 8;

class KrakenState {
  cx = 0;
  cz = 0;
  readonly ids = new Int32Array(MAX_ARMS);
  n = 0;
  sunk = 0;
  away = 0;
  retreating = false;
  grabCd = 0;
}

const state = (rt: EventRuntime): KrakenState => rt.slot('kraken', () => new KrakenState());

function armOf(c: SimContext, id: number): EnemyState | null {
  const t = c.findTarget(id);
  return t && !('phase' in t) ? t : null;
}

function setState(e: EnemyState, st: number): void {
  e.ai.kSt = st; e.ai.kT = 0;
  if (st === ARM_LINE || st === ARM_CIRCLE || st === ARM_GRAB_WINDUP) e.ai.kLast = st;
}

export const KRAKEN: WorldEventHandler = {
  id: 'kraken-rising',

  weight(c) {
    const p = c.state.player;
    // The ring needs open water around the ship.
    return c.world.isWater(p.x + p.vx, p.z + p.vz, EVENT_TUNING.krakenRing * 0.85) ? 1 : 0;
  },

  start(c, rt, minute) {
    const k = state(rt);
    const p = c.state.player;
    const R = EVENT_TUNING.krakenRing;
    k.cx = p.x + p.vx; k.cz = p.z + p.vz;
    k.n = 0; k.sunk = 0; k.away = 0; k.retreating = false; k.grabCd = 4;
    const count = Math.min(MAX_ARMS, EVENT_TUNING.krakenArms(minute));
    const offset = c.random() * TAU;
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * TAU + (c.random() - 0.5) * 0.3;
      const r = R * (0.92 + c.random() * 0.2);
      const e = eventSpawn(c, 'kraken-arm', k.cx + Math.sin(a) * r, k.cz + Math.cos(a) * r, { hpMul: EVENT_TUNING.krakenArmHp, margin: 3, force: true });
      if (!e) continue;
      const ai = e.ai;
      ai.kArm = 1; ai.kIdx = i; ai.kSt = ARM_RISE; ai.kT = -0.14 * i; ai.kCd = 2.2 + c.random() * 1.8 + i * 0.25;
      ai.kAng = headingTo(p.x - e.x, p.z - e.z); ai.kLen = 0; ai.kTx = e.x; ai.kTz = e.z;
      ai.kGrab = 0; ai.kGid = 0; ai.kHp = 0; ai.kTick = 0; ai.sub = 1; ai.tg = 0; ai.kLast = ARM_LINE;
      e.hidden = 1;
      e.heading = ai.kAng;
      k.ids[k.n++] = e.id;
    }
    if (k.n < 3) {
      for (let i = 0; i < k.n; i++) { const e = armOf(c, k.ids[i]!); if (e) e.life = 'dead'; }
      k.n = 0;
      return null;
    }
    const ev = openEvent('kraken-rising', "Sink the Kraken's arms", DIRECTOR_EVENTS['kraken-rising'].duration, k.n);
    anchor(ev, k.cx, k.cz, R + 22);
    return ev;
  },

  update(c, rt, ev) {
    const k = state(rt);
    const s = c.state, p = s.player;
    const minute = s.time / 60;
    let alive = 0, busy = 0;
    for (let i = 0; i < k.n; i++) {
      const e = armOf(c, k.ids[i]!);
      if (!e || e.life !== 'alive') continue;
      alive++;
      const st = e.ai.kSt;
      if (st === ARM_LINE || st === ARM_CIRCLE || st === ARM_GRAB_WINDUP) busy++;
    }
    k.grabCd = Math.max(0, k.grabCd - c.dt);
    for (let i = 0; i < k.n; i++) {
      const e = armOf(c, k.ids[i]!);
      if (!e) continue;
      if (e.life !== 'alive') {
        // Sunk by the player: the arm's own collapse is drawn by WorldEventFx; skip the ship-wreck choreography.
        if (e.ai.kDead !== 1) { e.ai.kDead = 1; if (e.life === 'sinking') { k.sunk++; e.life = 'dead'; } }
        continue;
      }
      if (updateArm(c, rt, k, e, minute, busy)) busy++;
    }
    ev.progress = k.sunk;

    if (k.retreating) {
      if (alive === 0) complete(rt);
      return;
    }
    if (k.sunk >= k.n) {
      payout(c, k.cx, k.cz, EVENT_TUNING.krakenDoubloons, 1, 1.4, 20);
      resolve(c, rt, OUTCOME_SUCCESS, 'Kraken Repelled!', 'The arms sink away, and treasure floats up from the deep!');
      complete(rt);
      return;
    }
    const d = Math.hypot(p.x - k.cx, p.z - k.cz);
    k.away = d > AWAY_DIST ? k.away + c.dt : 0;
    if (undecided(rt) && (rt.t >= ev.duration || k.away >= AWAY_TIME || !p.alive)) {
      resolve(c, rt, OUTCOME_FAIL, 'The Kraken Retreats', 'The arms slip back into the deep, and the treasure with them.');
      retreat(c, k);
    }
  },

  finish(c, rt) {
    const k = state(rt);
    for (let i = 0; i < k.n; i++) {
      const e = armOf(c, k.ids[i]!);
      if (!e || e.life === 'dead') continue;
      if (e.ai.tg) { killTelegraph(c, e.ai.tg); e.ai.tg = 0; }
      e.life = 'dead';
    }
    k.n = 0;
  },
};

/** Every surviving arm lets go and sinks back. */
function retreat(c: SimContext, k: KrakenState): void {
  k.retreating = true;
  for (let i = 0; i < k.n; i++) {
    const e = armOf(c, k.ids[i]!);
    if (!e || e.life !== 'alive') continue;
    if (e.ai.tg) { killTelegraph(c, e.ai.tg); e.ai.tg = 0; }
    e.ai.kGrab = 0;
    setState(e, ARM_RETRACT);
  }
}

/** One arm's tick. Returns true when it started a telegraphed attack. */
function updateArm(c: SimContext, rt: EventRuntime, k: KrakenState, e: EnemyState, minute: number, busy: number): boolean {
  const ai = e.ai, dt = c.dt;
  ai.kT = (ai.kT ?? 0) + dt;
  const target = focusOf(c, e);
  if (ai.kSt !== ARM_GRAB) e.heading = headingTo(target.x - e.x, target.z - e.z);
  switch (ai.kSt) {
    case ARM_RISE:
      ai.sub = ai.kT < 0 ? 1 : Math.max(0, 1 - ai.kT / RISE_TIME);
      if (ai.kT >= RISE_TIME) { ai.sub = 0; setState(e, ARM_IDLE); }
      return false;
    case ARM_IDLE: {
      ai.kCd -= dt;
      if (k.retreating) return false;
      if (ai.kCd <= 0 && busy < EVENT_TUNING.krakenConcurrent(minute)) return chooseAttack(c, k, e, target.x, target.z, target.vx, target.vz, target === c.state.player);
      if (ai.kCd > 1.2 && (c.state.tick + ai.kIdx! * 7) % 20 === 0) grabShip(c, rt, e);
      return false;
    }
    case ARM_LINE:
      if (ai.kT >= LINE_TELEGRAPH) {
        ai.tg = 0;
        blastLine(c, rt, e.x, e.z, ai.kAng!, ai.kLen!, LINE_HALF_WIDTH, eventPlayerDamage(c, EVENT_TUNING.krakenSlam),
          eventShipDamage(c, EVENT_TUNING.krakenSlamEnemy), { knock: 10, status: 'stunned', statusTime: 0.8, skip: 'kraken-arm', bossMul: 0.3 });
        const tx = e.x - Math.sin(ai.kAng!) * ai.kLen!, tz = e.z - Math.cos(ai.kAng!) * ai.kLen!;
        c.emit({ type: 'explosion', x: tx, z: tz, radius: 11, kind: 'water', team: 'enemy' });
        setState(e, ARM_SLAM);
      }
      return false;
    case ARM_CIRCLE:
      if (ai.kT >= CIRCLE_TELEGRAPH) {
        ai.tg = 0;
        const r = ENEMY_AI['kraken-arm'].area;
        blastCircle(c, rt, ai.kTx!, ai.kTz!, r, eventPlayerDamage(c, EVENT_TUNING.krakenSlam * 0.9),
          eventShipDamage(c, EVENT_TUNING.krakenSlamEnemy), { knock: 12, status: 'stunned', statusTime: 1, skip: 'kraken-arm', bossMul: 0.3 });
        c.emit({ type: 'explosion', x: ai.kTx!, z: ai.kTz!, radius: r, kind: 'water', team: 'enemy' });
        setState(e, ARM_SLAM);
      }
      return false;
    case ARM_SLAM:
      if (ai.kT >= SLAM_RECOVER) { setState(e, ARM_IDLE); ai.kCd = rand(c, EVENT_TUNING.krakenCooldown[0], EVENT_TUNING.krakenCooldown[1]); }
      return false;
    case ARM_GRAB_WINDUP:
      if (ai.kT >= EVENT_TUNING.krakenGrabTelegraph) {
        ai.tg = 0;
        const p = c.state.player;
        const reach = GRAB_RADIUS + p.beam * 0.5;
        if (p.alive && p.airborne < 0.2 && p.submerged < 0.5 && Math.hypot(p.x - ai.kTx!, p.z - ai.kTz!) <= reach) {
          ai.kGrab = 1; ai.kHp = e.hp; ai.kTick = 0.25;
          setState(e, ARM_GRAB);
        } else {
          c.emit({ type: 'explosion', x: ai.kTx!, z: ai.kTz!, radius: 8, kind: 'water', team: 'enemy' });
          setState(e, ARM_SLAM);
        }
      }
      return false;
    case ARM_GRAB:
      holdGrab(c, e);
      return false;
    case ARM_RETRACT:
      ai.sub = Math.min(1, ai.kT / RETRACT_TIME);
      if (ai.kT >= RETRACT_TIME) e.life = 'dead';
      return false;
    default:
      setState(e, ARM_IDLE);
      return false;
  }
}

/** Picks the attack for an idle arm aimed at a target at (tx, tz) moving with (vx, vz). */
function chooseAttack(c: SimContext, k: KrakenState, e: EnemyState, tx: number, tz: number, vx: number, vz: number, isPlayer: boolean): boolean {
  const ai = e.ai;
  const d = Math.hypot(tx - e.x, tz - e.z);
  if (isPlayer && k.grabCd <= 0 && d < EVENT_TUNING.krakenGrabReach + GRAB_RADIUS) {
    ai.kTx = tx + vx * 0.25; ai.kTz = tz + vz * 0.25;
    ai.kAng = headingTo(ai.kTx - e.x, ai.kTz - e.z);
    ai.tg = c.addTelegraph({ shape: 'ring', team: 'enemy', x: ai.kTx, z: ai.kTz, radius: GRAB_RADIUS + 3, length: GRAB_RADIUS - 3, duration: EVENT_TUNING.krakenGrabTelegraph })?.id ?? 0;
    k.grabCd = 7;
    setState(e, ARM_GRAB_WINDUP);
    return true;
  }
  if (d < LINE_REACH) {
    const lead = LINE_TELEGRAPH * 0.55;
    const ax = tx + vx * lead, az = tz + vz * lead;
    ai.kAng = headingTo(ax - e.x, az - e.z);
    ai.kLen = Math.max(40, Math.min(LINE_REACH + 6, Math.hypot(ax - e.x, az - e.z) + 18));
    ai.tg = lineTelegraph(c, e.x, e.z, ai.kAng, ai.kLen, LINE_HALF_WIDTH, LINE_TELEGRAPH)?.id ?? 0;
    setState(e, ARM_LINE);
    return true;
  }
  if (d < CIRCLE_REACH) {
    const lead = CIRCLE_TELEGRAPH * 0.75;
    ai.kTx = tx + vx * lead; ai.kTz = tz + vz * lead;
    ai.kAng = headingTo(ai.kTx - e.x, ai.kTz - e.z);
    ai.tg = c.addTelegraph({ shape: 'circle', team: 'enemy', x: ai.kTx, z: ai.kTz, radius: ENEMY_AI['kraken-arm'].area, duration: CIRCLE_TELEGRAPH })?.id ?? 0;
    setState(e, ARM_CIRCLE);
    return true;
  }
  ai.kCd = 0.8;
  return false;
}

/** An idle arm snatches an enemy ship that strays within reach. */
function grabShip(c: SimContext, rt: EventRuntime, e: EnemyState): void {
  const near = c.targetsNear(e.x, e.z, SHIP_GRAB_REACH, rt.targets);
  for (let i = 0; i < near.length; i++) {
    const t = near[i]!;
    if ('phase' in t || t.life !== 'alive' || t.defId === 'kraken-arm' || t.hidden >= 0.5 || t.defId === 'fort') continue;
    const ai = e.ai;
    ai.kGrab = 2; ai.kGid = t.id; ai.kHp = e.hp; ai.kTick = 0.3;
    ai.kTx = t.x; ai.kTz = t.z;
    setState(e, ARM_GRAB);
    return;
  }
}

/** Holds what the arm has caught where it was seized, reels it in to just short of the arm, and squeezes. */
function holdGrab(c: SimContext, e: EnemyState): void {
  const ai = e.ai, dt = c.dt;
  const p = c.state.player;
  if (ai.kGrab === 1) {
    const hurt = e.hp < (ai.kHp ?? e.hp) - e.maxHp * 0.3;
    const boosting = p.skills.boost.active > 0 && ai.kT > 0.25;
    if (!p.alive || ai.kT >= EVENT_TUNING.krakenGrabTime || hurt || boosting || p.airborne > 0.2 || p.submerged > 0.5) {
      release(c, e, p.x, p.z);
      const d = Math.hypot(p.x - e.x, p.z - e.z) || 1;
      p.vx += ((p.x - e.x) / d) * 6; p.vz += ((p.z - e.z) / d) * 6;
      return;
    }
    // Reel in (stopping short of the arm so the hull never grinds on it) and choke the ship's way.
    if (hullEdge(p, e.x, e.z) > e.radius + 5) {
      const d = Math.hypot(p.x - e.x, p.z - e.z) || 1;
      p.x -= ((p.x - e.x) / d) * REEL * dt; p.z -= ((p.z - e.z) / d) * REEL * dt;
    }
    const damp = Math.max(0, 1 - 4 * dt);
    p.vx *= damp; p.vz *= damp;
    ai.kTx = p.x; ai.kTz = p.z;
    ai.kAng = headingTo(p.x - e.x, p.z - e.z);
    ai.kTick! -= dt;
    if (ai.kTick! <= 0) { ai.kTick! += 0.5; c.damagePlayer(eventPlayerDamage(c, EVENT_TUNING.krakenGrabTick), { x: e.x, z: e.z, kind: 'hazard' }); }
    return;
  }
  const t = c.findTarget(ai.kGid ?? 0);
  if (!t || 'phase' in t || t.life !== 'alive' || ai.kT >= SHIP_GRAB_TIME) {
    release(c, e, t ? t.x : e.x, t ? t.z : e.z);
    return;
  }
  const d = Math.hypot(t.x - e.x, t.z - e.z) || 1;
  if (d > e.radius + t.radius + 5) { t.x -= ((t.x - e.x) / d) * REEL * dt; t.z -= ((t.z - e.z) / d) * REEL * dt; }
  t.vx = 0; t.vz = 0; t.speed = 0;
  ai.kTx = t.x; ai.kTz = t.z;
  ai.kAng = headingTo(t.x - e.x, t.z - e.z);
  ai.kTick! -= dt;
  if (ai.kTick! <= 0) {
    ai.kTick! += 0.5;
    hurtShip(c, t, eventShipDamage(c, SHIP_SQUEEZE), e.x, e.z, { status: 'stunned', statusTime: 0.7, skip: 'kraken-arm' });
  }
}

function release(c: SimContext, e: EnemyState, x: number, z: number): void {
  const ai = e.ai;
  ai.kGrab = 0; ai.kGid = 0;
  ai.kTx = x; ai.kTz = z;
  setState(e, ARM_SLAM);
  ai.kCd = rand(c, EVENT_TUNING.krakenCooldown[0], EVENT_TUNING.krakenCooldown[1]);
}

