/**
 * Hazards (CORE-owned). Semantics per kind (both teams; team 'enemy' hazards hit the player instead of ships):
 *  - fire-patch / burning-wreck: damage everything inside every `tick` s (default 0.5); player fire also sets ships
 *    burning.
 *  - barrel: floats (arms after a moment); ignites into a fire patch on contact or when `ttl` runs out.
 *  - powder-keg: explodes on contact or when `ttl` runs out.
 *  - mine: drifts, arms, explodes on proximity (magnet mines home, depth charges fuse then blast); fizzles at `ttl`.
 *  - whirlpool: pulls ships toward its centre (or onto an eye ring), swirls them, grinds every `tick`.
 *  - storm-cloud: player clouds follow the ship and strike a random ship in `radius` every `tick`.
 *  - shockwave: a ring expanding from 0 to `radius` over `ttl`; hits each ship once (knockback / slow / stun).
 *  - wave-front: a wall `radius` half-wide moving with (vx, vz); hits each ship once, carries it, washes out
 *    enemy shots.
 *  - lightning-strike: strikes its circle once when `ttl` runs out (telegraph first).
 *  - escort-skiff: positions and guns are driven by the Escort Skiffs weapon.
 */
import type { HazardState } from '../types';
import {
  HF_BURN, HF_DEPTH, HF_FOLLOW, HF_MAGNET, HF_RING, HF_SLOW, HF_STUN, HF_WASH, hullEdge, isBoss, massFactor, targetable,
  type CoreSim,
} from './core-runtime';
import { applyBurn } from './core-forces';
import { explode } from './projectiles';
import { areaVsCaptains, frontVsCaptains, ringVsCaptains, whirlVsCaptains } from './captains-damage';

const DEPTH_FUSE = 0.55;

export function updateHazards(c: CoreSim): void {
  const list = c.state.hazards;
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const h = list[i]!;
    if (!h.alive) continue;
    h.age += c.dt;
    switch (h.kind) {
      case 'fire-patch': case 'burning-wreck': tickArea(c, h, i); break;
      case 'barrel': case 'powder-keg': updateBarrel(c, h, i); break;
      case 'mine': updateMine(c, h, i); break;
      case 'whirlpool': updateWhirlpool(c, h, i); break;
      case 'storm-cloud': updateCloud(c, h, i); break;
      case 'shockwave': updateShockwave(c, h, i); break;
      case 'wave-front': updateWaveFront(c, h, i); break;
      case 'lightning-strike': case 'escort-skiff': break;
    }
    if (h.alive && h.age >= h.ttl) expire(c, h, i);
  }
}

function playerHittable(c: CoreSim): boolean {
  const p = c.state.player;
  return p.alive && p.airborne < 0.2 && p.submerged < 0.5;
}

function drift(c: CoreSim, h: HazardState, damping: number): void {
  const dt = c.dt;
  h.x += h.vx * dt; h.z += h.vz * dt;
  if (damping > 0) { const k = Math.exp(-damping * dt); h.vx *= k; h.vz *= k; }
}

function tickArea(c: CoreSim, h: HazardState, i: number): void {
  drift(c, h, 0.6);
  h.tickTimer -= c.dt;
  if (h.tickTimer > 0) return;
  h.tickTimer += h.tick > 0 ? h.tick : 0.5;
  const core = c.core;
  if (h.team === 'player') {
    const buf = core.bufH;
    const n = core.near(c.state, h.x, h.z, h.radius, buf);
    const burn = (core.hFlags[i]! & HF_BURN) !== 0;
    for (let k = 0; k < n; k++) {
      const t = buf[k]!;
      if (!targetable(t)) continue;
      c.hitTarget(t, h.damage, h.weapon, false, 0, h.x, h.z, null, 0, 0, false);
      if (burn) applyBurn(c, t, core.hA[i]! > 0 ? core.hA[i]! : h.damage * 0.5, h.weapon);
    }
  } else if (playerHittable(c)) {
    const p = c.state.player;
    if (hullEdge(p, h.x, h.z) <= h.radius) c.hurtPlayer(h.damage, h.x, h.z, undefined, 'hazard');
  }
  if (h.team !== 'player') areaVsCaptains(c, h); // CAPTAINS
}

function updateBarrel(c: CoreSim, h: HazardState, i: number): void {
  const core = c.core;
  drift(c, h, 1.2);
  if (!h.armed) {
    core.hTimer[i] = core.hTimer[i]! - c.dt;
    if (core.hTimer[i]! > 0) return;
    h.armed = true;
  }
  if (touched(c, h)) trigger(c, h, i);
}

/** True if a ship of the opposing team touches the hazard's trigger circle. */
function touched(c: CoreSim, h: HazardState): boolean {
  if (h.team === 'player') {
    const core = c.core;
    const n = core.near(c.state, h.x, h.z, h.radius, core.bufH);
    for (let k = 0; k < n; k++) if (targetable(core.bufH[k]!)) return true;
    return false;
  }
  if (!playerHittable(c)) return false;
  const p = c.state.player;
  return hullEdge(p, h.x, h.z) <= h.radius;
}

function trigger(c: CoreSim, h: HazardState, i: number): void {
  if (h.kind === 'barrel') ignite(c, h, i);
  else if (h.kind === 'powder-keg') keg(c, h, i);
  else if (h.kind === 'mine') mineBlast(c, h, i);
}

function ignite(c: CoreSim, h: HazardState, i: number): void {
  const core = c.core;
  const radius = core.hA[i]! > 0 ? core.hA[i]! : h.radius * 3;
  const ttl = core.hB[i]! > 0 ? core.hB[i]! : 4;
  const tickDamage = core.hC[i]! > 0 ? core.hC[i]! : h.damage;
  const burst = core.hD[i]! > 0 ? core.hD[i]! : h.damage * 2;
  h.alive = false;
  c.emit({ type: 'hazard-triggered', id: h.id, kind: h.kind, x: h.x, z: h.z, radius });
  explode(c, h.x, h.z, radius * 0.6, burst, h.team, h.weapon, false, 2, 'fire', null, 0, 0);
  const fi = c.placeHazard('fire-patch', h.team, h.x, h.z, radius, ttl, tickDamage, 0.5, h.vx * 0.3, h.vz * 0.3, h.weapon, true);
  if (fi >= 0) { core.hFlags[fi] = HF_BURN; core.hA[fi] = tickDamage; }
}

function keg(c: CoreSim, h: HazardState, i: number): void {
  const core = c.core;
  const radius = core.hA[i]! > 0 ? core.hA[i]! : h.radius * 4;
  const damage = core.hB[i]! > 0 ? core.hB[i]! : h.damage;
  h.alive = false;
  c.emit({ type: 'hazard-triggered', id: h.id, kind: h.kind, x: h.x, z: h.z, radius });
  explode(c, h.x, h.z, radius, damage, h.team, h.weapon, false, core.hKnock[i]! > 0 ? core.hKnock[i]! : 8, 'powder', null, 0, 0);
}

function updateMine(c: CoreSim, h: HazardState, i: number): void {
  const core = c.core;
  const flags = core.hFlags[i]!;
  if (!h.armed) {
    drift(c, h, 0.9);
    core.hTimer[i] = core.hTimer[i]! - c.dt;
    if (core.hTimer[i]! > 0) return;
    h.armed = true;
  }
  if (core.hMode[i] === 1) {
    drift(c, h, 2);
    core.hTimer[i] = core.hTimer[i]! - c.dt;
    if (core.hTimer[i]! <= 0) mineBlast(c, h, i);
    return;
  }
  if ((flags & HF_MAGNET) && h.team === 'player') {
    const t = core.nearest(c.state, h.x, h.z, core.hD[i]!, core.bufH);
    if (t) {
      const dx = t.x - h.x, dz = t.z - h.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
      const max = core.hC[i]!;
      h.vx += (dx / d) * 18 * c.dt; h.vz += (dz / d) * 18 * c.dt;
      const v = Math.sqrt(h.vx * h.vx + h.vz * h.vz);
      if (v > max) { h.vx *= max / v; h.vz *= max / v; }
      drift(c, h, 0);
    } else drift(c, h, 0.9);
  } else drift(c, h, 0.9);
  if (!touched(c, h)) return;
  if (flags & HF_DEPTH) {
    core.hMode[i] = 1;
    core.hTimer[i] = DEPTH_FUSE;
    c.emit({ type: 'hazard-triggered', id: h.id, kind: h.kind, x: h.x, z: h.z, radius: h.radius });
  } else mineBlast(c, h, i);
}

function mineBlast(c: CoreSim, h: HazardState, i: number): void {
  const core = c.core;
  const depth = (core.hFlags[i]! & HF_DEPTH) !== 0;
  const radius = core.hA[i]! > 0 ? core.hA[i]! : h.radius * 2.5;
  const damage = core.hB[i]! > 0 ? core.hB[i]! : h.damage;
  h.alive = false;
  if (!depth) c.emit({ type: 'hazard-triggered', id: h.id, kind: h.kind, x: h.x, z: h.z, radius });
  explode(c, h.x, h.z, radius, damage, h.team, h.weapon, false, core.hKnock[i]! > 0 ? core.hKnock[i]! : 6,
    depth ? 'water' : 'mine', depth ? 'stunned' : null, depth ? 0.8 : 0, 1);
}

function updateWhirlpool(c: CoreSim, h: HazardState, i: number): void {
  const core = c.core;
  const p = c.state.player;
  const dt = c.dt;
  const flags = core.hFlags[i]!;
  if ((flags & HF_FOLLOW) && h.team === 'player') { h.x = p.x; h.z = p.z; } else drift(c, h, 0.5);
  const pull = core.hA[i]! > 0 ? core.hA[i]! : 8;
  const swirl = core.hB[i]! > 0 ? core.hB[i]! : 5;
  const eye = (flags & HF_RING) ? core.hC[i]! : 0;
  h.tickTimer -= dt;
  const grind = h.tickTimer <= 0;
  if (grind) h.tickTimer += h.tick > 0 ? h.tick : 0.5;
  if (h.team === 'player') {
    const buf = core.bufH;
    const n = core.near(c.state, h.x, h.z, h.radius, buf);
    for (let k = 0; k < n; k++) {
      const t = buf[k]!;
      if (!targetable(t)) continue;
      if (grind) c.hitTarget(t, h.damage, h.weapon, false, 0, h.x, h.z, null, 0, 0, false);
      if (isBoss(t) || t.life !== 'alive') continue;
      const dx = h.x - t.x, dz = h.z - t.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < 1e-3) continue;
      const nx = dx / d, nz = dz / d;
      const mf = massFactor(c, t);
      const radial = d - eye;
      const rim = 0.4 + 0.6 * Math.min(1, d / Math.max(1, h.radius));
      const step = radial > 0 ? Math.min(radial, pull * rim * mf * dt) : Math.max(radial, -pull * 0.6 * mf * dt);
      t.x += nx * step; t.z += nz * step;
      t.x += -nz * swirl * mf * dt; t.z += nx * swirl * mf * dt;
    }
  } else if (playerHittable(c)) {
    const dx = h.x - p.x, dz = h.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < h.radius && d > 1e-3) {
      p.vx += (dx / d) * pull * 0.6 * dt; p.vz += (dz / d) * pull * 0.6 * dt;
      if (grind) c.hurtPlayer(h.damage, h.x, h.z, undefined, 'hazard');
    }
  }
  if (h.team !== 'player') whirlVsCaptains(c, h, pull, grind); // CAPTAINS
}

function updateCloud(c: CoreSim, h: HazardState, i: number): void {
  const core = c.core;
  const p = c.state.player;
  if ((core.hFlags[i]! & HF_FOLLOW) && h.team === 'player') {
    h.x = p.x + Math.sin(p.heading) * p.length * 0.3;
    h.z = p.z + Math.cos(p.heading) * p.length * 0.3;
  } else drift(c, h, 0);
  core.hTimer[i] = core.hTimer[i]! - c.dt;
  if (core.hTimer[i]! > 0) return;
  core.hTimer[i] = core.hTimer[i]! + (h.tick > 0 ? h.tick : 0.8);
  if (h.team === 'player') {
    const buf = core.bufH;
    const n = core.near(c.state, h.x, h.z, h.radius, buf);
    if (n === 0) return;
    let t = buf[Math.floor(c.random() * n)]!;
    if (!targetable(t)) { t = buf[0]!; if (!targetable(t)) return; }
    c.hitTarget(t, h.damage, h.weapon, false, 2, h.x, h.z, null, 0, 0, false);
    explode(c, t.x, t.z, 10, h.damage * 0.35, 'player', h.weapon, false, 1, 'lightning', null, 0, 0);
    c.emit({ type: 'lightning', points: [{ x: h.x, z: h.z }, { x: t.x, z: t.z }], team: 'player' });
    c.emit({ type: 'hazard-triggered', id: h.id, kind: h.kind, x: t.x, z: t.z, radius: 10 });
  } else if (playerHittable(c)) {
    const dx = p.x - h.x, dz = p.z - h.z;
    if (dx * dx + dz * dz > h.radius * h.radius) return;
    c.hurtPlayer(h.damage, p.x, p.z, undefined, 'hazard');
    c.emit({ type: 'lightning', points: [{ x: h.x, z: h.z }, { x: p.x, z: p.z }], team: 'enemy' });
    c.emit({ type: 'hazard-triggered', id: h.id, kind: h.kind, x: p.x, z: p.z, radius: 10 });
  }
}

function updateShockwave(c: CoreSim, h: HazardState, i: number): void {
  const core = c.core;
  const k = Math.min(1, h.age / Math.max(0.05, h.ttl));
  const cur = h.radius * (1 - (1 - k) * (1 - k));
  const hits = core.hHits[i]!;
  const flags = core.hFlags[i]!;
  if (h.team === 'player') {
    const buf = core.bufH;
    const n = core.near(c.state, h.x, h.z, cur, buf);
    for (let j = 0; j < n; j++) {
      const t = buf[j]!;
      if (!targetable(t) || hits.includes(t.id)) continue;
      hits.push(t.id);
      const stun = (flags & HF_STUN) !== 0;
      c.hitTarget(t, h.damage, h.weapon, false, core.hKnock[i]!, h.x, h.z, stun ? 'stunned' : (flags & HF_SLOW) ? 'slowed' : null,
        stun ? core.hC[i]! : core.hB[i]!, stun ? 1 : core.hA[i]!, false);
      if (stun && (flags & HF_SLOW)) c.applyStatus(t, 'slowed', core.hB[i]!, core.hA[i]!);
    }
  } else if (!hits.includes(0) && playerHittable(c)) {
    const p = c.state.player;
    if (hullEdge(p, h.x, h.z) <= cur) { hits.push(0); c.hurtPlayer(h.damage, h.x, h.z, undefined, 'hazard'); }
  }
  if (h.team !== 'player') ringVsCaptains(c, h, cur, hits); // CAPTAINS
}

function updateWaveFront(c: CoreSim, h: HazardState, i: number): void {
  const core = c.core;
  const dt = c.dt;
  h.x += h.vx * dt; h.z += h.vz * dt;
  const speed = Math.sqrt(h.vx * h.vx + h.vz * h.vz) || 1;
  const dirX = core.hA[i]! !== 0 || core.hB[i]! !== 0 ? core.hA[i]! : h.vx / speed;
  const dirZ = core.hA[i]! !== 0 || core.hB[i]! !== 0 ? core.hB[i]! : h.vz / speed;
  const band = core.hC[i]! > 0 ? core.hC[i]! : 10;
  const hits = core.hHits[i]!;
  const flags = core.hFlags[i]!;
  if (h.team === 'player') {
    const buf = core.bufH;
    const n = core.near(c.state, h.x, h.z, h.radius + band, buf);
    for (let j = 0; j < n; j++) {
      const t = buf[j]!;
      if (t.life !== 'alive') continue;
      const rx = t.x - h.x, rz = t.z - h.z;
      const along = rx * dirX + rz * dirZ, lat = rx * dirZ - rz * dirX;
      if (Math.abs(along) > band + t.radius || Math.abs(lat) > h.radius + t.radius) continue;
      if (!hits.includes(t.id) && targetable(t)) {
        hits.push(t.id);
        const stun = (flags & HF_STUN) !== 0 ? core.hD[i]! : 0;
        c.hitTarget(t, h.damage, h.weapon, false, core.hKnock[i]!, h.x - dirX * 20, h.z - dirZ * 20, stun > 0 ? 'stunned' : null, stun, 1, false);
      }
      if (!isBoss(t) && targetable(t)) { t.x += h.vx * dt * 0.75; t.z += h.vz * dt * 0.75; }
    }
    if (flags & HF_WASH) {
      const shots = c.state.projectiles;
      for (let j = 0; j < shots.length; j++) {
        const pr = shots[j]!;
        if (!pr.alive || pr.team !== 'enemy') continue;
        const rx = pr.x - h.x, rz = pr.z - h.z;
        if (Math.abs(rx * dirX + rz * dirZ) > band || Math.abs(rx * dirZ - rz * dirX) > h.radius) continue;
        pr.alive = false;
        c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: 0, z: pr.z, target: 'water', damage: 0, crit: false });
      }
    }
  } else if (playerHittable(c)) {
    const p = c.state.player;
    const rx = p.x - h.x, rz = p.z - h.z;
    if (Math.abs(rx * dirX + rz * dirZ) <= band + p.beam && Math.abs(rx * dirZ - rz * dirX) <= h.radius + p.length * 0.5) {
      if (!hits.includes(0)) { hits.push(0); c.hurtPlayer(h.damage, p.x, p.z, undefined, 'hazard'); }
      p.vx += dirX * speed * 0.5 * dt; p.vz += dirZ * speed * 0.5 * dt;
    }
  }
  if (h.team !== 'player') frontVsCaptains(c, h, dirX, dirZ, band, speed, hits); // CAPTAINS
}

function expire(c: CoreSim, h: HazardState, i: number): void {
  switch (h.kind) {
    case 'barrel': ignite(c, h, i); return;
    case 'powder-keg': keg(c, h, i); return;
    case 'lightning-strike': {
      h.alive = false;
      c.emit({ type: 'hazard-triggered', id: h.id, kind: h.kind, x: h.x, z: h.z, radius: h.radius });
      explode(c, h.x, h.z, h.radius, h.damage, h.team, h.weapon, false, 2, 'lightning', null, 0, 0);
      return;
    }
    case 'mine':
      if (c.core.hMode[i] === 1) { mineBlast(c, h, i); return; }
      break;
    default: break;
  }
  h.alive = false;
}
