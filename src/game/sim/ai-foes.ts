/**
 * Round 1 enemy classes (FOES-owned), dispatched from ai.ts by EnemyId. Every behaviour reads its target through
 * focusOf(c, e) (the player or an AI captain) and telegraphs every dangerous attack.
 *
 *   signal-cutter   keeps its range and fires a flare that marks its target: nearby Admiralty ships fire faster,
 *                   tighter and cheaper while the mark holds (see markBuff). Killing the cutter ends the mark.
 *   ironclad        lines up, telegraphs a straight charge and rams; its bow is armoured (hits land at 30% while the
 *                   target sits in the bow arc), its sides and stern are not; it turns slowly after a charge.
 *   harpooner       brig movement and a light broadside; telegraphs a harpoon line that tethers its target: slowed
 *                   and towed for a few seconds. Boost (or sinking the harpooner) breaks the line.
 *   bomb-ketch      artillery ranges; lobs clusters of powder kegs into telegraphed circles that leave fire patches.
 *   smoke-runner    fast skirmisher: darts in, fires a pair of shots, breaks away laying a smoke screen. Ships inside a
 *                   thick screen are hidden from auto-targeting until they fire (reveal).
 *   lantern-wisp    drifting ghost lanterns in groups: latch onto a hull and drain it, then burst. One hit sinks them;
 *                   bracing shakes latched wisps off.
 *   drowned-galleon waits below, surfaces beside its target after a ring + bubbles telegraph (the breach hurts inside
 *                   the ring), fights with broadsides, dives again.
 *
 * AI scratch visual keys (numbers only; renderers and FX may read them):
 *   signal-cutter   flT (s since the flare left; < 0 none) flSX flSZ (launch point) flX flZ (burst point)
 *                   markT (s of mark left) markRef (marked ship: 0 player, < 0 captain)
 *   ironclad        ic (0 approach · 1 wind-up · 2 charge · 3 recover) bow (1 while the target faces the iron bow)
 *   harpooner       hpW (wind-up left) hpH (line heading) tether (1 while a line holds) tetherT tetherRef
 *   lantern-wisp    wl (1 latched) latchT lu ls (hull station −0.5..0.5 / side ±1) lref
 *   drowned-galleon dg (0 deep · 1 rising telegraph · 2 surfacing · 3 fighting · 4 diving) sub (0..1 depth)
 *   any enemy       smoke (1 inside a thick smoke screen) reveal (s visible after firing from smoke) fbuf (buff bits)
 */
import { ENEMY_AI, FOES } from '../content/enemies';
import type { EnemyId } from '../ids';
import type { CaptainState, EnemyDef, EnemyState, PlayerState, ProjectileState, RunState } from '../types';
import type { SimContext, Target } from './context';
import { GRAVITY, hullEdge } from './core-runtime';
import { enemyDamage } from './meta-spawn';
import {
  TAU, clamp, enterLimbo, exitLimbo, fwdX, fwdZ, headingTo, leadAim, lineTelegraph, moveTelegraph, openWaterNear,
  predictPlayer, rand, sail, wrap,
} from './meta-steer';
import { focusOf, type Friendly } from './targeting';
import { BRACE_DURATION, PARRY_WINDOW } from './player';
import {
  baseSpeed, beamHeading, broadside, clearStatus, gunLead, gunSpread, reloadTime, revealShooter, steer, takeFire,
} from './ai';

// ───────────────────────── Buff bits (e.ai.fbuf) ─────────────────────────

/** Admiralty ship near a target marked by a signal cutter. */
export const BUFF_MARK = 1;
/** Inside a Commander elite's aura (affixes.ts). */
export const BUFF_AURA = 2;

// ───────────────────────── Per-run runtime ─────────────────────────

const SHOT_CAP = 160;
const SHOT_HARPOON = 1, SHOT_VAMP = 2, SHOT_BOMB = 3, SHOT_VAMP_LOB = 4;

interface Shot { pr: ProjectileState | null; id: number; owner: number; kind: number; target: number; value: number }

export interface FoeRuntime {
  shots: Shot[];
  shotN: number;
  /** Seconds of signal mark on the player (max over live cutters) and marked captain refs, rebuilt every tick. */
  markPlayer: number;
  markRefs: number[];
  markN: number;
  /** Commander elites this tick (affixes.ts fills them in the pre-pass). */
  cmdX: Float64Array;
  cmdZ: Float64Array;
  cmdId: Int32Array;
  cmdN: number;
  /** Live smoke screens. */
  smokeN: number;
}

const STORES = new WeakMap<RunState, FoeRuntime>();

export function foeRuntime(c: SimContext): FoeRuntime {
  let rt = STORES.get(c.state);
  if (!rt) {
    rt = {
      shots: Array.from({ length: SHOT_CAP }, () => ({ pr: null, id: 0, owner: 0, kind: 0, target: 0, value: 0 })),
      shotN: 0,
      markPlayer: 0, markRefs: [0, 0, 0, 0, 0, 0, 0, 0], markN: 0,
      cmdX: new Float64Array(8), cmdZ: new Float64Array(8), cmdId: new Int32Array(8), cmdN: 0,
      smokeN: 0,
    };
    STORES.set(c.state, rt);
  }
  return rt;
}

/** Follows a projectile so its hit (or landing) can be resolved on the tick it happens. */
export function trackShot(c: SimContext, pr: ProjectileState | null, owner: number, kind: number, target: number, value = 0): void {
  if (!pr) return;
  const rt = foeRuntime(c);
  if (rt.shotN >= SHOT_CAP) return;
  const s = rt.shots[rt.shotN++]!;
  s.pr = pr; s.id = pr.id; s.owner = owner; s.kind = kind; s.target = target; s.value = value;
}

export const SHOT = { harpoon: SHOT_HARPOON, vamp: SHOT_VAMP, bomb: SHOT_BOMB, vampLob: SHOT_VAMP_LOB } as const;

// ───────────────────────── Friendly ships (player / AI captains) ─────────────────────────

/** Ship ref of a friendly: 0 = the player, < 0 = an AI captain. */
export function refOf(c: SimContext, f: Friendly): number {
  return f === c.state.player ? 0 : (f as CaptainState).id;
}

export function friendlyByRef(c: SimContext, ref: number): Friendly | null {
  if (ref === 0) return c.state.player;
  for (const k of c.state.captains) if (k.id === ref) return k;
  return null;
}

/** True while `f` can be hit (the player: alive, not airborne or submerged). */
export function hittable(c: SimContext, f: Friendly): boolean {
  if (!f.alive) return false;
  if (f !== c.state.player) return true;
  const p = f as PlayerState;
  return p.airborne < 0.2 && p.submerged < 0.5;
}

/** Distance from (x, z) to the hull edge of `f` (the player's 80% hitbox, a captain's circle). */
export function edgeOf(c: SimContext, f: Friendly, x: number, z: number): number {
  if (f === c.state.player) return hullEdge(f as PlayerState, x, z);
  return Math.hypot(f.x - x, f.z - z) - f.radius;
}

/**
 * Damage to a friendly ship from an AI effect (drains, breaches, blasts). The player goes through CORE's
 * damagePlayer (brace, shield, armour); captains lose hull directly (CAPTAINS sinks them at 0).
 */
export function hurtFriendly(c: SimContext, f: Friendly, amount: number, x: number, z: number, source: number): number {
  if (!(amount > 0) || !f.alive) return 0;
  if (f === c.state.player) return c.damagePlayer(amount, { x, z, source, kind: 'hazard' });
  const k = f as CaptainState;
  const dealt = Math.min(k.hp, amount);
  k.hp -= dealt;
  k.hitFlash = 1;
  return dealt;
}

/** Hurts every friendly ship whose hull edge is inside the circle (100% at the centre → 60% at the rim). */
export function blastFriendlies(c: SimContext, x: number, z: number, radius: number, damage: number, source: number): void {
  const p = c.state.player;
  if (hittable(c, p)) {
    const d = hullEdge(p, x, z);
    if (d <= radius) hurtFriendly(c, p, damage * (1 - 0.4 * clamp(d / Math.max(1, radius), 0, 1)), x, z, source);
  }
  for (const k of c.state.captains) {
    if (!k.alive) continue;
    const d = Math.hypot(k.x - x, k.z - z) - k.radius;
    if (d <= radius) hurtFriendly(c, k, damage * (1 - 0.4 * clamp(d / Math.max(1, radius), 0, 1)), x, z, source);
  }
}

// ───────────────────────── Pre-pass (start of every AI tick) ─────────────────────────

const smokeBuf: Target[] = [];

/**
 * Runs before any enemy acts this tick: resolves tracked shots (CORE moves projectiles later this tick; flat shots and
 * lobbed kegs are predicted exactly: the player does not move between the AI and the projectile step), rebuilds the
 * signal marks and flags ships inside thick smoke screens.
 */
export function foePrePass(c: SimContext): void {
  const rt = foeRuntime(c);
  resolveShots(c, rt);
  // Signal marks from live cutters.
  rt.markPlayer = 0; rt.markN = 0;
  const enemies = c.state.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]!;
    e.ai.smoke = 0;
    if (e.life !== 'alive' || e.defId !== 'signal-cutter') continue;
    const t = e.ai.markT ?? 0;
    if (t <= 0) continue;
    const ref = e.ai.markRef ?? 0;
    if (ref === 0) rt.markPlayer = Math.max(rt.markPlayer, t);
    else if (rt.markN < rt.markRefs.length) rt.markRefs[rt.markN++] = ref;
  }
  // Smoke screens: thick ones hide the ships inside.
  let smoke = 0;
  const hazards = c.state.hazards;
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i]!;
    if (!h.alive || h.kind !== 'smoke-screen') continue;
    smoke++;
    if (h.age > h.ttl * FOES.smoke.thick) continue;
    const near = c.targetsNear(h.x, h.z, h.radius, smokeBuf);
    const r2 = h.radius * h.radius * 0.72;
    for (let k = 0; k < near.length; k++) {
      const t = near[k]!;
      if ('phase' in t) continue;
      const dx = t.x - h.x, dz = t.z - h.z;
      if (dx * dx + dz * dz <= r2) t.ai.smoke = 1;
    }
  }
  rt.smokeN = smoke;
}

function resolveShots(c: SimContext, rt: FoeRuntime): void {
  const dt = c.dt;
  const p = c.state.player;
  for (let i = 0; i < rt.shotN; i++) {
    const s = rt.shots[i]!;
    const pr = s.pr;
    let done = !pr || pr.id !== s.id || !pr.alive;
    if (!done && pr) {
      if (s.kind === SHOT_BOMB || s.kind === SHOT_VAMP_LOB) {
        const vy = pr.vy - GRAVITY * dt;
        if (pr.y + vy * dt <= 0) {
          const x = pr.x + pr.vx * dt, z = pr.z + pr.vz * dt;
          if (s.kind === SHOT_BOMB) onKegLands(c, s, x, z);
          else {
            // A lobbed shell hurts what its blast reaches (CORE: max(area, 6) from the hull edge).
            const f = friendlyByRef(c, s.target);
            if (f && hittable(c, f) && edgeOf(c, f, x, z) <= Math.max(pr.area, 6)) onShotHits(c, s, f, x, z);
          }
          done = true;
        }
      } else {
        const x = pr.x + pr.vx * dt, z = pr.z + pr.vz * dt;
        const f = friendlyByRef(c, s.target);
        if (f && hittable(c, f)) {
          if (f === p) {
            if (hullEdge(p, x, z) <= pr.radius) { onShotHits(c, s, f, x, z); done = true; }
          } else if (Math.hypot(f.x - x, f.z - z) <= f.radius + pr.radius) {
            // CORE only lands enemy shots on the player: resolve captain hits here.
            hurtFriendly(c, f, pr.damage, x, z, s.owner);
            pr.alive = false;
            onShotHits(c, s, f, x, z);
            done = true;
          }
        }
      }
    }
    if (done) {
      // Swap-remove (order does not matter).
      const last = rt.shots[rt.shotN - 1]!;
      rt.shots[i] = last; rt.shots[rt.shotN - 1] = s;
      s.pr = null;
      rt.shotN--; i--;
    }
  }
}

function onKegLands(c: SimContext, s: Shot, x: number, z: number): void {
  const T = FOES.bomb;
  c.spawnHazard({ kind: 'fire-patch', team: 'enemy', x, z, radius: T.patchRadius, ttl: T.patchTtl, damage: s.value, tick: 0.5 });
}

function onShotHits(c: SimContext, s: Shot, f: Friendly, x: number, z: number): void {
  const e = c.findTarget(s.owner);
  if (!e || 'phase' in e || e.life !== 'alive') return;
  if (s.kind === SHOT_HARPOON) {
    if (f === c.state.player) {
      const p = f as PlayerState;
      // Boosting ships shrug the barb off; a parry or invulnerability blocks it.
      if (p.skills.boost.active > 0 || p.invulnerable > 0) return;
      if (p.skills.brace.active > BRACE_DURATION - PARRY_WINDOW) return;
    }
    const ai = e.ai;
    ai.tether = 1;
    ai.tetherT = FOES.harpoon.tether;
    ai.tetherRef = s.target;
    c.emit({ type: 'harpoon', from: e.id, to: s.target, x1: e.x, z1: e.z, x2: x, z2: z });
  } else if (s.kind === SHOT_VAMP || s.kind === SHOT_VAMP_LOB) {
    vampHeal(e, s.value);
  }
}

/** Vampiric lifesteal: heals `amount` hull (the shield bubble does not count toward the cap). */
export function vampHeal(e: EnemyState, amount: number): void {
  const shield = e.ai.shield ?? 0;
  const room = e.maxHp - (e.hp - shield);
  const heal = Math.min(room, amount);
  if (heal <= 0) return;
  e.hp += heal;
  if (e.ai.realHp !== undefined) e.ai.realHp += heal;
  e.ai.vampT = 0.7;
}

/** Buff bits for this enemy this tick (read by the gunnery helpers in ai.ts). */
export function foeBuffs(c: SimContext, e: EnemyState): number {
  let bits = 0;
  const rt = foeRuntime(c);
  if (e.faction === 'admiralty' && e.defId !== 'signal-cutter' && (rt.markPlayer > 0 || rt.markN > 0)) {
    const f = focusOf(c, e);
    let marked = false;
    if (f === c.state.player) marked = rt.markPlayer > 0;
    else { const ref = refOf(c, f); for (let i = 0; i < rt.markN; i++) if (rt.markRefs[i] === ref) { marked = true; break; } }
    if (marked && Math.hypot(f.x - e.x, f.z - e.z) < FOES.signal.buffRadius) bits |= BUFF_MARK;
  }
  if (rt.cmdN > 0) {
    for (let i = 0; i < rt.cmdN; i++) {
      if (rt.cmdId[i] === e.id) continue;
      const dx = rt.cmdX[i]! - e.x, dz = rt.cmdZ[i]! - e.z;
      if (dx * dx + dz * dz < AURA_R2) { bits |= BUFF_AURA; break; }
    }
  }
  return bits;
}

/** Commander aura radius (m), shared with affixes.ts. */
export const AURA_RADIUS = 110;
const AURA_R2 = AURA_RADIUS * AURA_RADIUS;

/** True while an enemy counts as hidden by smoke (inside a thick screen and not revealed by its own fire). */
export function smokeHidden(e: EnemyState): boolean {
  return e.ai.smoke === 1 && (e.ai.reveal ?? 0) <= 0 && e.life === 'alive';
}

// ───────────────────────── Behaviours ─────────────────────────

type Behaviour = (c: SimContext, e: EnemyState, def: EnemyDef) => void;

// ── Signal cutter ──

function signalCutter(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const T = FOES.signal;
  const ai = e.ai;
  const p = focusOf(c, e);
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  const speed = baseSpeed(c, e, def);
  ai.flCd = (ai.flCd ?? rand(c, 2.5, 4.5)) - c.dt;
  if ((ai.markT ?? 0) > 0) ai.markT = Math.max(0, ai.markT! - c.dt);
  const hb = headingTo(dx, dz);
  let desired: number, spd = speed;
  if (!p.alive) { desired = hb + Math.PI; spd = speed * 0.6; }
  else if (dist < T.range - 40) { desired = hb + Math.PI + ai.orbit! * 0.45; spd = speed * 1.05; }
  else if (dist > T.range + 50) desired = hb + ai.flank! * 0.35;
  else { desired = beamHeading(hb, ai.orbit!, dist, T.range); spd = speed * 0.72; }
  steer(c, e, desired, spd, def.turnRate);

  // Flare in flight: bursts over the (led) target and marks it.
  if ((ai.flT ?? -1) >= 0) {
    ai.flT! += c.dt;
    if (ai.flT! >= T.flight) {
      ai.flT = -1;
      if (p.alive) { ai.markT = T.markTime; ai.markRef = ai.flRef ?? 0; }
    }
    return;
  }
  const attack = def.attack!;
  if (ai.flCd! > 0 || (ai.markT ?? 0) > 0 || !p.alive || dist > attack.range) return;
  const pred = predictPlayer(c, T.flight, attack.lead, p);
  ai.flT = 0;
  ai.flSX = e.x; ai.flSZ = e.z;
  ai.flX = pred.x; ai.flZ = pred.z;
  ai.flRef = refOf(c, p);
  ai.flCd = rand(c, T.cooldown[0], T.cooldown[1]);
  revealShooter(e);
  const inv = 1 / (dist || 1);
  c.emit({ type: 'enemy-fired', source: e.id, projectile: 'enemy-flare', x: e.x, z: e.z, dirX: dx * inv, dirZ: dz * inv, count: 1 });
}

// ── Ironclad ──

function ironclad(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const T = FOES.ironclad;
  const ai = e.ai;
  const p = focusOf(c, e);
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  const speed = baseSpeed(c, e, def);
  if (ai.armor0 === undefined) ai.armor0 = e.armor;
  ai.t! -= c.dt;
  switch (ai.ic ?? 0) {
    case 1: {
      // Wind-up: bow onto the locked line, barely moving; the line follows the bow.
      sail(c, e, ai.lh!, speed * 0.3, def.turnRate * 1.8);
      moveTelegraph(c, ai.tg!, e.x, e.z, ai.lh);
      if (ai.t! <= 0) {
        ai.ic = 2; ai.tg = 0; ai.cx = e.x; ai.cz = e.z;
        ai.t = T.chargeLength / Math.max(1, speed * T.chargeSpeed) + 1;
      }
      break;
    }
    case 2: {
      // Charge: a straight line at ramming speed (it cannot turn).
      sail(c, e, ai.lh!, speed * T.chargeSpeed, def.turnRate * 0.08, 3);
      const run = Math.hypot(e.x - ai.cx!, e.z - ai.cz!);
      if (run >= T.chargeLength || ai.t! <= 0 || dist < p.radius + e.radius + 1) { ai.ic = 3; ai.t = rand(c, T.recover[0], T.recover[1]); }
      break;
    }
    case 3: {
      // Recover: coasting, swinging round slowly (sides and stern exposed).
      steer(c, e, headingTo(dx, dz), speed * 0.45, def.turnRate * 0.8);
      if (ai.t! <= 0) { ai.ic = 0; ai.t = rand(c, 0.8, 2.2); }
      break;
    }
    default: {
      steer(c, e, headingTo(dx, dz) + (dist > 260 ? ai.flank! * 0.3 : 0), speed, def.turnRate);
      if (!p.alive || ai.t! > 0 || dist > T.lineUp || dist < 35) break;
      const aim = leadAim(c, e.x, e.z, speed * T.chargeSpeed, 0.6, p);
      const h = headingTo(aim.x - e.x, aim.z - e.z);
      if (Math.abs(wrap(h - e.heading)) > 0.55) break;
      ai.ic = 1; ai.t = T.windup; ai.lh = h;
      ai.tg = lineTelegraph(c, e.x, e.z, h, T.chargeLength + e.length * 0.5, e.radius + 3, T.windup)?.id ?? 0;
    }
  }
  // Armoured bow: while the target sits in the bow arc every hit lands at CORE's 30% armour floor.
  const bow = p.alive && Math.abs(wrap(headingTo(dx, dz) - e.heading)) < T.bowArc;
  ai.bow = bow ? 1 : 0;
  e.armor = bow ? T.bowArmor : ai.armor0!;
}

// ── Harpooner ──

function harpooner(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const T = FOES.harpoon;
  const ai = e.ai;
  const p = focusOf(c, e);
  ai.hpCd = (ai.hpCd ?? rand(c, 3, 6)) - c.dt;
  const fx = fwdX(e.heading), fz = fwdZ(e.heading);
  const bx = e.x + fx * e.length * 0.45, bz = e.z + fz * e.length * 0.45;

  if (ai.tether === 1) {
    const f = friendlyByRef(c, ai.tetherRef ?? 0);
    ai.tetherT! -= c.dt;
    const d = f ? Math.hypot(f.x - e.x, f.z - e.z) : 1e9;
    const boosting = f === c.state.player && (f as PlayerState).skills.boost.active > 0;
    if (!f || !f.alive || ai.tetherT! <= 0 || d > T.snap || boosting) {
      ai.tether = 0; ai.tetherT = 0;
      ai.hpCd = rand(c, T.cooldown[0], T.cooldown[1]);
    } else {
      // Reel in: the harpooner hauls away while the line drags and slows its catch.
      const k = (T.tow * c.dt) / Math.max(1, d);
      f.x += (e.x - f.x) * k; f.z += (e.z - f.z) * k;
      if (f === c.state.player) c.applyStatus(f as PlayerState, 'slowed', 0.25, T.slow);
      steer(c, e, headingTo(e.x - f.x, e.z - f.z) + (ai.orbit ?? 1) * 0.5, baseSpeed(c, e, def) * 0.55, def.turnRate);
      return;
    }
  }

  broadside(c, e, def);

  if ((ai.hpW ?? 0) > 0) {
    ai.hpW! -= c.dt;
    moveTelegraph(c, ai.tg2 ?? 0, bx, bz, ai.hpH);
    if (ai.hpW! <= 0) {
      ai.tg2 = 0;
      const damage = enemyDamage(c, e, T.damage);
      const pr = c.spawnProjectile({
        kind: 'enemy-harpoon', team: 'enemy', x: bx, y: 3, z: bz, vx: fwdX(ai.hpH!) * T.speed, vy: 0, vz: fwdZ(ai.hpH!) * T.speed,
        damage, radius: 1.8, ttl: T.range / T.speed,
      });
      trackShot(c, pr, e.id, SHOT_HARPOON, ai.hpRef ?? 0);
      ai.hpId = pr ? pr.id : 0;
      ai.hpCd = rand(c, T.cooldown[0], T.cooldown[1]);
      revealShooter(e);
      c.emit({ type: 'enemy-fired', source: e.id, projectile: 'enemy-harpoon', x: bx, z: bz, dirX: fwdX(ai.hpH!), dirZ: fwdZ(ai.hpH!), count: 1 });
    }
    return;
  }
  if (ai.hpCd! > 0 || !p.alive || (ai.windup ?? 0) > 0) return;
  const dist = Math.hypot(p.x - bx, p.z - bz);
  if (dist < T.minRange || dist > T.range * 0.92) return;
  const ref = refOf(c, p);
  // The harpoon is a special with its own reload: it does not draw on the fleet's fire-control tokens.
  if (tetheredByAnother(c, e, ref)) { ai.hpCd = 1.5; return; }
  const aim = leadAim(c, bx, bz, T.speed, clamp(gunLead(c, e, def.attack!) + 0.25, 0, 0.95), p);
  ai.hpH = headingTo(aim.x - bx, aim.z - bz);
  ai.hpW = T.windup;
  ai.hpRef = ref;
  ai.tg2 = lineTelegraph(c, bx, bz, ai.hpH, T.range, 2.8, T.windup)?.id ?? 0;
}

function tetheredByAnother(c: SimContext, self: EnemyState, ref: number): boolean {
  for (const o of c.state.enemies) {
    if (o === self || o.life !== 'alive' || o.defId !== 'harpooner') continue;
    if ((o.ai.tether === 1 && o.ai.tetherRef === ref) || ((o.ai.hpW ?? 0) > 0 && o.ai.hpRef === ref)) return true;
  }
  return false;
}

// ── Bomb ketch ──

function bombKetch(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const attack = def.attack!;
  const tune = ENEMY_AI[e.defId];
  const ai = e.ai;
  const p = focusOf(c, e);
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  const speed = baseSpeed(c, e, def);
  ai.t! -= c.dt;
  if (tune.retreatBelow > 0 && ai.retreated !== 1 && e.hp < e.maxHp * tune.retreatBelow) { ai.retreated = 1; ai.mode = 1; ai.t = 6; }
  const hb = headingTo(dx, dz);
  let desired: number, spd = speed;
  if (ai.mode === 1) { desired = hb + Math.PI; spd = speed * 1.15; if (ai.t! <= 0) ai.mode = 0; }
  else if (dist < 170) { desired = hb + Math.PI + ai.orbit! * 0.5; spd = speed * (dist < 110 ? 1.2 : 1); }
  else if (dist > 265) desired = hb + ai.flank! * 0.3;
  else { desired = hb - ai.orbit! * (Math.PI / 2); spd = speed * 0.4; }
  steer(c, e, desired, spd, def.turnRate);
  e.attackCooldown -= c.dt;
  if (e.attackCooldown > 0 || dist > attack.range || dist < 80 || !p.alive) return;
  if (!takeFire(e)) { e.attackCooldown = 0.3; return; }
  lobKegs(c, e, def, p, dist);
}

function lobKegs(c: SimContext, e: EnemyState, def: EnemyDef, p: Friendly, dist: number): void {
  const T = FOES.bomb;
  const attack = def.attack!;
  const minute = c.state.time / 60;
  const count = attack.count + (minute >= 9 ? 1 : 0) + (e.elite ? 1 : 0);
  const flight = clamp(dist / attack.speed, T.minFlight, T.maxFlight);
  const pred = predictPlayer(c, flight, gunLead(c, e, attack), p);
  const cx = pred.x, cz = pred.z;
  const damage = enemyDamage(c, e, attack.damage);
  const patch = enemyDamage(c, e, T.patchDamage);
  const ref = refOf(c, p);
  const a0 = c.random() * TAU;
  const y0 = Math.max(0, e.y) + 4;
  const ring = T.ring * (1 + gunSpread(c, e, attack));
  for (let k = 0; k < count; k++) {
    let tx = cx, tz = cz;
    if (k > 0) { const a = a0 + ((k - 1) / Math.max(1, count - 1)) * TAU; tx += Math.sin(a) * ring; tz += Math.cos(a) * ring; }
    const t = flight + k * 0.12;
    const pr = c.spawnProjectile({
      kind: 'enemy-bomb', team: 'enemy', x: e.x, y: y0, z: e.z,
      vx: (tx - e.x) / t, vy: 0.5 * GRAVITY * t - y0 / t, vz: (tz - e.z) / t, damage, area: T.blast, radius: 1.4, ttl: t + 1,
    });
    c.addTelegraph({ shape: 'circle', team: 'enemy', x: tx, z: tz, radius: T.blast, duration: t });
    trackShot(c, pr, e.id, SHOT_BOMB, ref, patch);
  }
  revealShooter(e);
  const inv = 1 / (dist || 1);
  c.emit({ type: 'enemy-fired', source: e.id, projectile: 'enemy-bomb', x: e.x, z: e.z, dirX: (p.x - e.x) * inv, dirZ: (p.z - e.z) * inv, count });
  e.attackCooldown = reloadTime(c, e, attack);
}

// ── Smoke runner ──

const SR_APPROACH = 0, SR_ATTACK = 1, SR_BREAK = 2;

function smokeRunner(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const attack = def.attack!;
  const ai = e.ai;
  const p = focusOf(c, e);
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  const speed = baseSpeed(c, e, def);
  ai.t! -= c.dt;
  e.attackCooldown -= c.dt;
  let desired: number, spd = speed;
  const mode = ai.sr ?? SR_APPROACH;
  if (!p.alive) desired = headingTo(-dx, -dz);
  else if (mode === SR_ATTACK) {
    const aim = leadAim(c, e.x, e.z, attack.speed, gunLead(c, e, attack), p);
    desired = headingTo(aim.x - e.x, aim.z - e.z);
    spd = speed * 0.8;
    if (e.attackCooldown <= 0 && dist < attack.range && Math.abs(wrap(desired - e.heading)) < 0.35) {
      if (takeFire(e)) {
        const bx = e.x + fwdX(e.heading) * e.length * 0.45, bz = e.z + fwdZ(e.heading) * e.length * 0.45;
        const damage = enemyDamage(c, e, attack.damage);
        const spread = gunSpread(c, e, attack);
        const count = attack.count + (e.elite ? 1 : 0);
        for (let k = 0; k < count; k++) {
          const ang = headingTo(aim.x - bx, aim.z - bz) + (k - (count - 1) / 2) * 0.05 + (c.random() - 0.5) * 2 * spread;
          c.spawnProjectile({
            kind: attack.projectile, team: 'enemy', x: bx, y: 3, z: bz, vx: fwdX(ang) * attack.speed, vy: 0, vz: fwdZ(ang) * attack.speed,
            damage, radius: 1.2, ttl: attack.range / attack.speed + 0.35,
          });
        }
        revealShooter(e);
        c.emit({ type: 'enemy-fired', source: e.id, projectile: attack.projectile, x: bx, z: bz, dirX: fwdX(e.heading), dirZ: fwdZ(e.heading), count });
        e.attackCooldown = reloadTime(c, e, attack);
        ai.t = Math.min(ai.t!, 0.4);
      } else e.attackCooldown = 0.3;
    }
    if (ai.t! <= 0 || dist < 30) { ai.sr = SR_BREAK; ai.t = rand(c, 3.5, 5); ai.smoked = 0; }
  } else if (mode === SR_BREAK) {
    desired = headingTo(-dx, -dz) + ai.orbit! * 0.6;
    spd = speed * 1.1;
    if (ai.smoked !== 1 && ai.t! < 3.2) { laySmoke(c, e); ai.smoked = 1; }
    if (ai.t! <= 0 && dist > 140) { ai.sr = SR_APPROACH; ai.flank = rand(c, -1.4, 1.4); }
  } else {
    const around = headingTo(-dx, -dz) + ai.flank! * 0.7;
    const r = 70;
    desired = headingTo(p.x + fwdX(around) * r - e.x, p.z + fwdZ(around) * r - e.z);
    if (dist < 100) { ai.sr = SR_ATTACK; ai.t = 2.4; }
  }
  steer(c, e, desired, spd, def.turnRate, 1.6, 2);
}

function laySmoke(c: SimContext, e: EnemyState): void {
  const T = FOES.smoke;
  const rt = foeRuntime(c);
  if (rt.smokeN >= T.max) return;
  const back = e.length * 0.5;
  const x = e.x - fwdX(e.heading) * back, z = e.z - fwdZ(e.heading) * back;
  if (c.spawnHazard({ kind: 'smoke-screen', team: 'enemy', x, z, radius: T.radius, ttl: T.ttl, damage: 0 })) rt.smokeN++;
}

// ── Lantern wisp ──

function lanternWisp(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const T = FOES.wisp;
  const ai = e.ai;
  if (ai.wl === 1) { latched(c, e); return; }
  const p = focusOf(c, e);
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  const speed = baseSpeed(c, e, def);
  // Drift in weaving; close in, the lantern darts at the hull.
  const weave = Math.sin((c.state.time + e.id * 0.37) * 1.7) * 0.55;
  const dart = dist < T.dartRange;
  const aim = leadAim(c, e.x, e.z, Math.max(8, speed * (dart ? T.dart : 1)), dart ? 0.85 : 0.5, p);
  const desired = headingTo(aim.x - e.x, aim.z - e.z) + weave * (dart ? 0.15 : 1) + (dist > 140 ? ai.flank! * 0.4 : 0);
  steer(c, e, desired, speed * (dart ? T.dart : 1), def.turnRate, 0.7, dart ? 3 : 1.5);
  if (!hittable(c, p)) return;
  if (p === c.state.player && (c.state.player.invulnerable > 0)) return;
  if (edgeOf(c, p, e.x, e.z) > e.radius + T.reach) return;
  // Latch onto the hull: remember the station along it and the side.
  const hx = fwdX(p.heading), hz = fwdZ(p.heading);
  const sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  const rx = e.x - p.x, rz = e.z - p.z;
  ai.wl = 1;
  ai.latchT = T.latch;
  ai.drainT = 0.5;
  ai.lu = clamp((rx * hx + rz * hz) / Math.max(1, p.length), -0.4, 0.4);
  ai.ls = rx * sx + rz * sz >= 0 ? 1 : -1;
  ai.lref = refOf(c, p);
}

function latched(c: SimContext, e: EnemyState): void {
  const T = FOES.wisp;
  const ai = e.ai;
  const f = friendlyByRef(c, ai.lref ?? 0);
  if (!f || !f.alive) { ai.wl = 0; return; }
  // Bracing shakes latched wisps off: they pop.
  if (f === c.state.player && (f as PlayerState).skills.brace.active > 0) {
    ai.wl = 0;
    c.damageTarget(e, e.hp + 10, { pierceArmor: true });
    return;
  }
  const hx = fwdX(f.heading), hz = fwdZ(f.heading);
  const sx = Math.cos(f.heading), sz = -Math.sin(f.heading);
  const off = f.beam * 0.5 + e.radius + 0.4;
  e.x = f.x + hx * ai.lu! * f.length + sx * ai.ls! * off;
  e.z = f.z + hz * ai.lu! * f.length + sz * ai.ls! * off;
  e.heading = f.heading; e.speed = f.speed; e.vx = f.vx; e.vz = f.vz; e.yawRate = 0;
  ai.drainT! -= c.dt;
  if (ai.drainT! <= 0) { ai.drainT! += 0.5; if (hittable(c, f)) hurtFriendly(c, f, enemyDamage(c, e, T.drain), e.x, e.z, e.id); }
  ai.latchT! -= c.dt;
  if (ai.latchT! > 0) return;
  // Burst: a spectral blast, then the lantern is gone (no treasure: it spent itself).
  ai.wl = 0;
  c.emit({ type: 'explosion', x: e.x, z: e.z, radius: T.burstRadius, kind: 'lightning', team: 'enemy' });
  blastFriendlies(c, e.x, e.z, T.burstRadius, enemyDamage(c, e, T.burst), e.id);
  e.hp = 0;
  e.life = 'sinking';
}

// ── Drowned galleon ──

const DG_DEEP = 0, DG_RISING = 1, DG_SURFACING = 2, DG_FIGHT = 3, DG_DIVING = 4;

function drownedGalleon(c: SimContext, e: EnemyState, def: EnemyDef): void {
  const T = FOES.drowned;
  const ai = e.ai, dt = c.dt;
  const p = focusOf(c, e);
  if (ai.dg === undefined) {
    ai.dg = DG_DEEP; ai.t = rand(c, 1, 2.5); ai.sub = 1;
    enterLimbo(e);
    c.applyStatus(e, 'submerged', 999, 1);
  }
  ai.t! -= dt;
  switch (ai.dg) {
    case DG_DEEP: {
      if (ai.t! > 0 || !p.alive) return;
      // Rise on the target's beam, broadside toward it.
      const side = c.random() < 0.5 ? 1 : -1;
      const a = p.heading + side * (Math.PI / 2) + rand(c, -0.6, 0.6);
      const r = rand(c, T.riseRange[0], T.riseRange[1]);
      const spot = openWaterNear(c, p.x + fwdX(a) * r, p.z + fwdZ(a) * r, e.radius + 8, 6);
      if (!spot) { ai.t = 1; return; }
      e.x = spot.x; e.z = spot.z; ai.hx = spot.x; ai.hz = spot.z;
      ai.rh = headingTo(p.x - spot.x, p.z - spot.z) + (c.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
      ai.tg = c.addTelegraph({ shape: 'ring', team: 'enemy', x: spot.x, z: spot.z, radius: e.length * T.ring, duration: T.telegraph })?.id ?? 0;
      ai.dg = DG_RISING; ai.t = T.telegraph;
      return;
    }
    case DG_RISING: {
      if (ai.t! > 0) return;
      exitLimbo(e, e.x, e.z, ai.rh!);
      ai.sub = 1;
      clearStatus(e, 'submerged');
      breach(c, e);
      ai.tg = 0;
      ai.dg = DG_SURFACING; ai.t = T.rise;
      return;
    }
    case DG_SURFACING: {
      ai.sub = Math.max(0, ai.sub! - dt / T.rise);
      sail(c, e, e.heading, 0, def.turnRate * 0.2);
      if (ai.sub <= 0) {
        ai.dg = DG_FIGHT; ai.t = rand(c, T.surface[0], T.surface[1]);
        ai.reloadP = rand(c, 0.4, 1.2); ai.reloadS = rand(c, 0.4, 1.2); ai.mode = 0;
      }
      return;
    }
    case DG_FIGHT: {
      broadside(c, e, def);
      if (ai.t! <= 0 && (ai.windup ?? 0) <= 0) { ai.dg = DG_DIVING; ai.t = T.dive; }
      return;
    }
    default: {
      ai.sub = Math.min(1, (ai.sub ?? 0) + dt / T.dive);
      sail(c, e, e.heading, baseSpeed(c, e, def) * 0.4, def.turnRate);
      if (ai.sub >= 1) {
        enterLimbo(e);
        c.applyStatus(e, 'submerged', 999, 1);
        ai.dg = DG_DEEP; ai.t = rand(c, T.deep[0], T.deep[1]);
      }
    }
  }
}

/** The galleon breaks the surface: water blast, damage and a shove for friendly ships inside the ring. */
function breach(c: SimContext, e: EnemyState): void {
  const T = FOES.drowned;
  const r = e.length * T.ring;
  c.emit({ type: 'explosion', x: e.x, z: e.z, radius: r, kind: 'water', team: 'enemy' });
  const damage = enemyDamage(c, e, T.breach);
  const shove = (f: Friendly) => {
    if (!hittable(c, f) || edgeOf(c, f, e.x, e.z) > r) return;
    hurtFriendly(c, f, damage, e.x, e.z, e.id);
    const dx = f.x - e.x, dz = f.z - e.z, d = Math.hypot(dx, dz) || 1;
    f.vx += (dx / d) * T.knock; f.vz += (dz / d) * T.knock;
  };
  shove(c.state.player);
  for (const k of c.state.captains) shove(k);
}

/** Behaviours by class (ai.ts dispatches these before the generic EnemyBehavior switch). */
export const FOE_AI: Partial<Record<EnemyId, Behaviour>> = {
  'signal-cutter': signalCutter,
  ironclad,
  harpooner,
  'bomb-ketch': bombKetch,
  'smoke-runner': smokeRunner,
  'lantern-wisp': lanternWisp,
  'drowned-galleon': drownedGalleon,
};
