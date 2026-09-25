/**
 * AI captains (CAPTAINS-owned). Other captains sailing the same sea: while no live captains are online (see
 * src/runtime/presence.ts) they fill the roster, fight the fleet near the player, draw part of its fire (targeting.ts),
 * sink and sail back in. They are rivals (captains-rival.ts): the player can shoot them, and they fire back. `state.captains` holds them; ids are negative ShipRefs (−1 … −4 by slot).
 *
 * Called once per tick after enemies and bosses (Sim.ts). The count comes from Settings.captains through
 * `configureCaptains(sim.state, n)` (captains-runtime.ts); unconfigured sims (tests, tools) have none and are
 * bit-identical to a sim without this module.
 *
 * Per tick: captains sail in on their join times (seeded persona and ship, preferring ships the player is not
 * sailing), level up with time and kills (hull grows with level), regenerate (faster out of the fight and while
 * falling back), steer (captains-steer.ts), fire (captains-guns.ts), earn bounty, and sunk captains count down and
 * re-enter on the player's spawn ring. The aggro tally at the end feeds focusOf's load balancing.
 *
 * Captain AI scratch (`k.ai`, numbers only; renderers and UI may read): slot · mode (0 escort, 1 engage, 2 retreat,
 * 3 recall) · tgt (target id) · grace (spawn protection s) · sinkT (s since sinking) · fade (s since sailing in) ·
 * attackers (enemies focused on it) · sunk / retreats (counts). Events: captain-joined, captain-sunk,
 * captain-respawned, captain-kill, weapon-fired (owner = id), damage (target = id).
 */
import { SPAWN_RING_MAX, SPAWN_RING_MIN } from '../constants';
import { DIRECTOR } from '../content/director';
import { CAPTAIN, CAPTAIN_PERSONAS, CAPTAIN_SHIPS } from '../content/captains';
import { BOUNTY } from '../content/rewards';
import type { ShipId } from '../ids';
import type { CaptainState } from '../types';
import { flushCaptainDamage } from './captains-damage';
import { updateCaptainGuns } from './captains-guns';
import { captainRuntime, captainSlot, type CaptainRuntime } from './captains-runtime';
import { onCaptainRespawn, updateRivalry } from './captains-rival';
import { MODE_RETREAT, steerCaptain } from './captains-steer';
import type { SimContext } from './context';
import type { CoreSim } from './core-runtime';
import { metaRuntime } from './meta-runtime';

export { configureCaptains, captainSetting } from './captains-runtime';

export function updateCaptains(c: SimContext): void {
  const s = c.state;
  const rt = captainRuntime(s);
  if (rt.count === 0 && s.captains.length === 0) return;
  const cs = c as CoreSim;
  join(cs, rt);
  const caps = s.captains;
  let afloatCount = 0;
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]!;
    if (!k.alive) { sunk(cs, k); continue; }
    afloat(cs, k);
    afloatCount++;
  }
  tally(cs, rt);
  fireBudget(cs, afloatCount);
}

/**
 * The enemy fleet shares one volley budget (META's fire-control tokens, refilled in ai.ts). Captains afloat add
 * CAPTAIN.firePerCaptain of the refill each, like the spawn budget (director.ts), so the player keeps roughly the
 * incoming fire of a solo run while the captains draw the rest.
 */
function fireBudget(c: CoreSim, afloat: number): void {
  if (afloat === 0) return;
  const rt = metaRuntime(c.state, c.content);
  const difficulty = c.content.seas[c.state.seaId].difficulty;
  const rate = DIRECTOR.fireRate(c.state.time / 60) * Math.pow(difficulty, DIRECTOR.fireDifficultyExp);
  rt.fire = Math.min(DIRECTOR.fireBank, rt.fire + rate * CAPTAIN.firePerCaptain * afloat * c.dt);
}

// ───────────────────────── Joining ─────────────────────────

function join(c: CoreSim, rt: CaptainRuntime): void {
  const s = c.state;
  if (rt.joined >= rt.count) return;
  if (rt.personas.length === 0) {
    // Seeded persona draw (no repeats) on the first captain tick.
    const pool = CAPTAIN_PERSONAS.map((_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(c.random() * (i + 1)); const t = pool[i]!; pool[i] = pool[j]!; pool[j] = t; }
    rt.personas = pool.slice(0, CAPTAIN.max);
  }
  while (rt.joined < rt.count && s.time >= (CAPTAIN.joinAt[rt.joined] ?? 10)) {
    spawnCaptain(c, rt, rt.joined);
    rt.joined++;
  }
}

function pickShip(c: CoreSim): ShipId {
  const s = c.state;
  const taken = (id: ShipId) => id === s.shipId || s.captains.some((k) => k.shipId === id);
  const free = CAPTAIN_SHIPS.filter((id) => !taken(id));
  const pool = free.length > 0 ? free : CAPTAIN_SHIPS.filter((id) => id !== s.shipId);
  return pool[Math.floor(c.random() * pool.length)] ?? 'sunlion';
}

function spawnCaptain(c: CoreSim, rt: CaptainRuntime, slot: number): void {
  const s = c.state, p = s.player;
  const persona = CAPTAIN_PERSONAS[rt.personas[slot] ?? slot]!;
  const shipId = pickShip(c);
  const ship = c.content.ships[shipId];
  const k: CaptainState = {
    id: -(slot + 1), name: persona.name, shipId, alive: true,
    x: p.x, z: p.z, y: 0, heading: p.heading, speed: 0, vx: 0, vz: 0, yawRate: 0, roll: 0, pitch: 0,
    radius: ship.beam * 0.6, length: ship.length, beam: ship.beam,
    hp: 1, maxHp: 1, level: 1, kills: 0, bounty: 0, respawn: 0, hitFlash: 0, statuses: [],
    ai: {
      slot, persona: rt.personas[slot] ?? slot, mode: 0, tgt: 0, tgtT: 0, side: slot % 2 ? -1 : 1, avoid: 0,
      sinceHit: 99, grace: 0, retreatT: 0, reloadP: 1 + slot * 0.3, reloadS: 1.2 + slot * 0.3, chaserCd: 1, mortarCd: 2,
      ripLeft: 0, ripSide: 1, ripIdx: 0, ripGuns: 0, ripNext: 0, ripAngle: 0, dmgAcc: 0, dmgT: 0, bountyT: 0,
      sinkT: 0, fade: 0, attackers: 0, sunk: 0, retreats: 0, dealt: 0, taken: 0,
    },
  };
  setLevel(c, k, 1);
  k.hp = k.maxHp;
  // Sail in from off the player's quarter, in open water, on a course alongside.
  const a = p.heading + (CAPTAIN.escortAngles[slot] ?? Math.PI);
  placeOnRing(c, k, a, CAPTAIN.joinRange[0], CAPTAIN.joinRange[1]);
  k.heading = p.heading;
  k.speed = Math.max(4, p.speed);
  k.vx = -Math.sin(k.heading) * k.speed; k.vz = -Math.cos(k.heading) * k.speed;
  s.captains.push(k);
  c.emit({ type: 'captain-joined', id: k.id, name: k.name, shipId });
}

/** Puts a captain in open water on a ring around the player (tries around angle `a`). */
function placeOnRing(c: CoreSim, k: CaptainState, a: number, r0: number, r1: number): void {
  const p = c.state.player;
  const margin = k.beam * 0.6 + 8;
  for (let tries = 0; tries < 16; tries++) {
    const ang = a + (tries === 0 ? 0 : (c.random() - 0.5) * Math.min(Math.PI * 2, 0.6 + tries * 0.4));
    const r = r0 + c.random() * (r1 - r0);
    const x = p.x - Math.sin(ang) * r, z = p.z - Math.cos(ang) * r;
    if (c.world.isWater(x, z, margin)) { k.x = x; k.z = z; return; }
  }
  k.x = p.x - Math.sin(a) * r0; k.z = p.z - Math.cos(a) * r0;
}

// ───────────────────────── Afloat ─────────────────────────

function setLevel(c: CoreSim, k: CaptainState, level: number): void {
  const ship = c.content.ships[k.shipId];
  const oldMax = k.maxHp;
  k.level = level;
  k.maxHp = ship.hp * CAPTAIN.hpMul * (1 + CAPTAIN.hpPerLevel * (level - 1));
  if (k.alive && oldMax > 1 && k.maxHp > oldMax) k.hp += k.maxHp - oldMax;
  k.hp = Math.min(k.hp, k.maxHp);
}

function afloat(c: CoreSim, k: CaptainState): void {
  const s = c.state, ai = k.ai, dt = c.dt;
  k.hitFlash = Math.max(0, k.hitFlash - dt * 4);
  ai.grace = Math.max(0, (ai.grace ?? 0) - dt);
  ai.fade = (ai.fade ?? 0) + dt;
  ai.sinceHit = (ai.sinceHit ?? 99) + dt;
  // Level: time at sea and kills.
  const level = Math.min(CAPTAIN.maxLevel, Math.floor(1 + (s.time / 60) * CAPTAIN.levelPerMinute + k.kills * CAPTAIN.levelPerKill));
  if (level > k.level) setLevel(c, k, level);
  // Hull patching.
  let regen = CAPTAIN.regen;
  if (ai.sinceHit > CAPTAIN.calmAfter) regen += CAPTAIN.regenCalm;
  if (ai.mode === MODE_RETREAT) regen += CAPTAIN.regenRetreat;
  if (k.hp < k.maxHp) k.hp = Math.min(k.maxHp, k.hp + k.maxHp * regen * dt);
  // Statuses (none are applied yet; kept ticking for future effects).
  for (let i = k.statuses.length - 1; i >= 0; i--) { const st = k.statuses[i]!; st.time -= dt; if (st.time <= 0) k.statuses.splice(i, 1); }
  // Survival bounty.
  ai.bountyT = (ai.bountyT ?? 0) + dt;
  if (ai.bountyT >= 1) { ai.bountyT -= 1; k.bounty += Math.round(BOUNTY.perSecond * s.director.heat * CAPTAIN.bountyPerSecond); }
  // A captain left far behind (the player boosted away, QA teleports) re-enters on the ring.
  const p = s.player;
  if (Math.hypot(p.x - k.x, p.z - k.z) > CAPTAIN.recall) {
    placeOnRing(c, k, p.heading + Math.PI + (c.random() - 0.5) * 1.6, SPAWN_RING_MIN, SPAWN_RING_MIN + 60);
    k.heading = Math.atan2(-(p.x - k.x), -(p.z - k.z));
    k.vx = 0; k.vz = 0; k.speed = 6; ai.tgt = 0;
  }
  updateRivalry(c, k);
  if ((ai.grudge ?? 0) > 0) captainRuntime(s).hostileTime += dt;
  if (s.player.alive) {
    steerCaptain(c, k);
    updateCaptainGuns(c, k);
  } else {
    k.speed *= 0.99; k.x += k.vx * dt * 0.5; k.z += k.vz * dt * 0.5;
  }
  ai.dmgT = (ai.dmgT ?? 0) - dt;
  if (ai.dmgAcc! > 0 && ai.dmgT <= 0) flushCaptainDamage(c, k);
}

// ───────────────────────── Sunk ─────────────────────────

function sunk(c: CoreSim, k: CaptainState): void {
  const ai = k.ai, dt = c.dt;
  ai.sinkT = (ai.sinkT ?? 0) + dt;
  k.hitFlash = Math.max(0, k.hitFlash - dt * 2);
  k.speed *= 0.97; k.vx *= 0.97; k.vz *= 0.97;
  if (ai.sinkT < 4) { k.x += k.vx * dt * 0.4; k.z += k.vz * dt * 0.4; }
  k.respawn = Math.max(0, k.respawn - dt);
  if (k.respawn > 0 || !c.state.player.alive) return;
  // Sail back in on the player's spawn ring, astern or abeam, heading for the fight.
  const p = c.state.player;
  placeOnRing(c, k, p.heading + Math.PI + (c.random() - 0.5) * 2.4, SPAWN_RING_MIN, Math.min(SPAWN_RING_MAX, SPAWN_RING_MIN + 60));
  k.heading = Math.atan2(-(p.x - k.x), -(p.z - k.z));
  k.speed = 8; k.vx = -Math.sin(k.heading) * 8; k.vz = -Math.cos(k.heading) * 8; k.yawRate = 0; k.roll = 0; k.pitch = 0;
  k.alive = true;
  k.hp = k.maxHp;
  k.hitFlash = 0;
  ai.grace = CAPTAIN.respawnGrace; ai.fade = 0; ai.sinkT = 0; ai.mode = 0; ai.tgt = 0; ai.sinceHit = 99; ai.ripLeft = 0;
  ai.reloadP = 0.8; ai.reloadS = 1;
  c.emit({ type: 'captain-respawned', id: k.id, name: k.name });
  onCaptainRespawn(c, k);
}

// ───────────────────────── Aggro tally ─────────────────────────

/** Counts which friendly every live enemy is fighting (focusOf's load balancing, HUD, balance reports). */
function tally(c: CoreSim, rt: CaptainRuntime): void {
  const s = c.state;
  rt.focusCaptain.fill(0);
  let player = 0, alive = 0;
  for (const e of s.enemies) {
    if (e.life !== 'alive' || e.defId === 'fort' || e.ai.convoy === 1) continue;
    alive++;
    const f = e.ai.capFocus ?? 0;
    if (f < 0 && s.time < (e.ai.capFocusT ?? 0)) { const i = captainSlot(f); if (i >= 0 && i < rt.focusCaptain.length) rt.focusCaptain[i]!++; }
    else player++;
  }
  rt.focusPlayer = player;
  rt.aliveEnemies = alive;
  rt.ticksPlayer += player;
  rt.ticksCaptains += alive - player;
  for (const k of s.captains) k.ai.attackers = k.alive ? rt.focusCaptain[captainSlot(k.id)] ?? 0 : 0;
}
