/**
 * Boss behaviours (META-owned): The Iron Warden, The Tidewyrm and The Sovereign (DESIGN §4).
 *
 * Each boss cruises (broadside orbit or serpentine), then runs attacks from its current phase list. Every attack
 * is telegraphed on the water (LINE for broadsides/rams/lunges/judgment, CIRCLE for mortars, RING for tail slams),
 * announced with 'boss-attack' {attack} for FX/audio, and resolved from the SAME geometry that was drawn.
 * Phase changes emit 'boss-phase', slow time for a beat and trigger a signature move.
 *
 * `b.attack` holds the current attack name ('arrive' | 'cruise' | 'phase-shift' | attack names from BossDef.phases);
 * extra 'boss-attack' names emitted for FX: 'plates-off', 'brood-call', 'raise-colours', 'last-stand', 'lunge-strike'.
 */
import { BOSS_KITS, type BossKitDef, type BoltKit, type JudgmentKit, type LungeKit, type MortarKit, type RamKit, type SummonKit, type TailSlamKit, type VolleyKit } from '../content/bosses';
import type { BossDef, BossState, StatusState } from '../types';
import type { SimContext } from './context';
import { bossDamage, spawnScaled } from './meta-spawn';
import {
  TAU, avoidIslands, clamp, fireAlong, fireShot, fwdX, fwdZ, headingTo, killTelegraph, leadAim, lineTelegraph, lobShell,
  moveTelegraph, openWaterNear, predictPlayer, rand, sail, sideX, sideZ, wrap,
} from './meta-steer';

const OX = ['ox0', 'ox1', 'ox2', 'ox3', 'ox4', 'ox5'] as const;
const OZ = ['oz0', 'oz1', 'oz2', 'oz3', 'oz4', 'oz5'] as const;
const OH = ['oh0', 'oh1', 'oh2', 'oh3', 'oh4', 'oh5'] as const;
const OS = ['os0', 'os1', 'os2', 'os3', 'os4', 'os5'] as const;
const PICK_W = [0, 0, 0, 0, 0, 0, 0, 0];
const GUN = { x: 0, z: 0, h: 0 };

const at = <T>(list: readonly T[], i: number): T => list[Math.min(i, list.length - 1)]!;

export function updateBosses(c: SimContext): void {
  const bosses = c.state.bosses;
  for (let i = 0; i < bosses.length; i++) {
    const b = bosses[i]!;
    b.hitFlash = Math.max(0, b.hitFlash - c.dt * 4);
    tickStatuses(c, b);
    if (b.life !== 'alive') { wreck(c, b); continue; }
    const def = c.content.bosses[b.defId];
    const kit = BOSS_KITS[b.defId];
    if (b.ai.init !== 1) initBoss(c, b, kit);
    checkPhase(c, b, def, kit);
    runBoss(c, b, def, kit);
    keepOffIslands(c, b);
  }
}

// ───────────────────────── Framework ─────────────────────────

function initBoss(c: SimContext, b: BossState, kit: BossKitDef): void {
  b.ai.init = 1;
  b.armor = at(kit.phaseArmor, 0);
  b.ai.gap = 1.5;
  b.ai.side = 1;
  b.ai.orbit = c.random() < 0.5 ? 1 : -1;
  b.ai.last = -1;
  b.ai.summonAt = -999;
  b.ai.force = -1;
  if (b.attack !== 'arrive') { b.attack = 'arrive'; b.attackTime = 0; }
}

function tickStatuses(c: SimContext, b: BossState): void {
  const list = b.statuses;
  for (let i = list.length - 1; i >= 0; i--) {
    const st = list[i]!;
    // Bosses shrug off control effects quickly.
    if (st.kind === 'stunned' || st.kind === 'hooked') st.time = Math.min(st.time, 0.3);
    st.time -= c.dt;
    if (st.time <= 0) {
      list.splice(i, 1);
      c.emit({ type: 'status-changed', target: b.id, status: st.kind, on: false });
    }
  }
}

function slowMul(b: BossState): number {
  let m = 1;
  for (const st of b.statuses as StatusState[]) if (st.kind === 'slowed' && st.time > 0) m *= 1 - Math.min(0.3, (st.magnitude > 1 ? 0.4 : st.magnitude) * 0.5);
  return m;
}

function wreck(c: SimContext, b: BossState): void {
  b.submerged = Math.max(0, b.submerged - c.dt);
  b.speed *= 0.98;
  b.vx *= 0.98; b.vz *= 0.98;
  b.x += b.vx * c.dt * 0.4; b.z += b.vz * c.dt * 0.4;
  if (b.ai.tg) { killTelegraph(c, b.ai.tg); b.ai.tg = 0; }
}

function checkPhase(c: SimContext, b: BossState, def: BossDef, kit: BossKitDef): void {
  let target = b.phase;
  const frac = b.hp / b.maxHp;
  for (let i = b.phase + 1; i < def.phases.length; i++) if (frac <= def.phases[i]!.hpFraction) target = i;
  if (target === b.phase) return;
  b.phase = target;
  b.armor = at(kit.phaseArmor, target);
  c.emit({ type: 'boss-phase', boss: b.defId, id: b.id, phase: target });
  c.requestTimeScale(0.3, 0.9);
  // Interrupt the current attack cleanly and roar.
  if (b.ai.tg) { killTelegraph(c, b.ai.tg); b.ai.tg = 0; }
  b.attack = 'phase-shift';
  b.attackTime = 0;
  const attacks = def.phases[target]!.attacks;
  let signature = '';
  if (b.defId === 'iron-warden') { signature = 'ram-charge'; emitAttack(c, b, 'plates-off'); }
  else if (b.defId === 'tidewyrm') { signature = 'summon-wyrmlings'; emitAttack(c, b, 'brood-call'); }
  else if (b.defId === 'sovereign') {
    signature = target >= 2 ? 'ram-charge' : 'judgment-line';
    emitAttack(c, b, target >= 2 ? 'last-stand' : 'raise-colours');
  }
  b.ai.force = attacks.indexOf(signature);
}

function emitAttack(c: SimContext, b: BossState, attack: string): void {
  c.emit({ type: 'boss-attack', boss: b.defId, id: b.id, attack, x: b.x, z: b.z });
}

function toCruise(b: BossState, gap: number): void {
  b.attack = 'cruise';
  b.attackTime = 0;
  b.ai.gap = gap;
}

function runBoss(c: SimContext, b: BossState, def: BossDef, kit: BossKitDef): void {
  const p = c.state.player;
  const dist = Math.hypot(p.x - b.x, p.z - b.z);
  b.attackTime += c.dt;
  switch (b.attack) {
    case 'arrive':
      cruise(c, b, def, kit, dist, 1);
      if (dist < kit.engageRange || b.attackTime > 10) {
        toCruise(b, 1);
        if (b.defId === 'sovereign') b.ai.force = def.phases[0]!.attacks.indexOf('summon-man-o-war');
      }
      return;
    case 'cruise':
      cruise(c, b, def, kit, dist, 1);
      b.ai.gap! -= c.dt;
      if (b.ai.gap! <= 0 && dist < kit.engageRange && p.alive) startAttack(c, b, def, kit, dist);
      return;
    case 'phase-shift':
      cruise(c, b, def, kit, dist, 0.3);
      if (b.attackTime > 1.6) toCruise(b, 0);
      return;
    default: {
      const done = runAttack(c, b, def, kit, dist);
      if (done) {
        const gap = at(kit.gap, b.phase);
        toCruise(b, rand(c, gap[0], gap[1]));
      }
    }
  }
}

function startAttack(c: SimContext, b: BossState, def: BossDef, kit: BossKitDef, dist: number): void {
  const list = def.phases[b.phase]!.attacks;
  let index = b.ai.force ?? -1;
  b.ai.force = -1;
  if (index < 0 || index >= list.length) index = pickAttack(c, b, list, kit, dist);
  if (index < 0) { b.ai.gap = 0.5; return; }
  const name = list[index]!;
  b.attack = name;
  b.attackTime = 0;
  b.ai.last = index;
  b.ai.stage = 0; b.ai.wave = 0; b.ai.fired = 0; b.ai.t0 = 0;
  if (name.startsWith('summon')) b.ai.summonAt = c.state.time;
  emitAttack(c, b, name);
}

function pickAttack(c: SimContext, b: BossState, list: readonly string[], kit: BossKitDef, dist: number): number {
  let total = 0;
  const n = Math.min(list.length, PICK_W.length);
  for (let i = 0; i < n; i++) {
    const name = list[i]!;
    let w = 1;
    if (name.startsWith('summon')) w = c.state.time - (b.ai.summonAt ?? -999) > 18 && c.state.enemies.length < 70 ? 0.8 : 0;
    else if (name === 'tail-slam') w = kit.tailSlam && dist < kit.tailSlam.maxDist ? 1.6 : 0;
    else if (name === 'ram-charge') w = dist > 70 && dist < 300 ? 1.3 : 0.2;
    else if (name === 'judgment-line') w = 1.3;
    if (i === b.ai.last) w *= 0.25;
    PICK_W[i] = w;
    total += w;
  }
  if (total <= 0) return -1;
  let r = c.random() * total;
  for (let i = 0; i < n; i++) { r -= PICK_W[i]!; if (r <= 0) return i; }
  return n - 1;
}

function runAttack(c: SimContext, b: BossState, def: BossDef, kit: BossKitDef, dist: number): boolean {
  switch (b.attack) {
    case 'broadside-volley': return kit.volley ? volleyAttack(c, b, def, kit.volley) : true;
    case 'broadside-storm': return kit.storm ? volleyAttack(c, b, def, kit.storm) : true;
    case 'mortar-barrage': return kit.mortar ? mortarAttack(c, b, def, kit.mortar) : true;
    case 'summon-cutters': return kit.summonCutters ? summonAttack(c, b, def, kit, kit.summonCutters, 'boss') : true;
    case 'summon-wyrmlings': return kit.summonWyrmlings ? summonAttack(c, b, def, kit, kit.summonWyrmlings, 'player') : true;
    case 'summon-man-o-war': return kit.summonManOWar ? summonAttack(c, b, def, kit, kit.summonManOWar, 'escort') : true;
    case 'ram-charge': return kit.ram ? ramAttack(c, b, def, kit.ram) : true;
    case 'submerge-lunge': return kit.lunge ? lungeAttack(c, b, def, kit, kit.lunge, dist) : true;
    case 'tail-slam': return kit.tailSlam ? tailSlamAttack(c, b, def, kit.tailSlam) : true;
    case 'water-bolts': return kit.bolts ? boltAttack(c, b, def, kit.bolts) : true;
    case 'judgment-line': return kit.judgment ? judgmentAttack(c, b, def, kit.judgment) : true;
    default: return true;
  }
}

// ───────────────────────── Movement ─────────────────────────

function catchUp(kit: BossKitDef, dist: number): number {
  return 1 + clamp((dist - kit.catchUpRange) / 120, 0, 3);
}

function cruise(c: SimContext, b: BossState, def: BossDef, kit: BossKitDef, dist: number, speedMul: number): void {
  const p = c.state.player;
  const hb = headingTo(p.x - b.x, p.z - b.z);
  const speed = def.speed * at(kit.phaseSpeed, b.phase) * catchUp(kit, dist) * speedMul * slowMul(b);
  let desired: number;
  if (b.defId === 'tidewyrm') {
    // Serpentine hunting circle: orbit with a weave; the head is the hit circle, the body follows its path.
    b.submerged = Math.max(0, b.submerged - c.dt / 0.5);
    const rangeErr = clamp((dist - kit.orbitRange) / 60, -1, 1);
    desired = dist > kit.orbitRange * 2
      ? hb + Math.sin(c.state.time * 1.3 + b.id) * 0.3
      : hb + b.ai.orbit! * (Math.PI / 2 - rangeErr * 0.9) + Math.sin(c.state.time * 1.7 + b.id) * 0.45;
    desired = avoidIslands(c, b, desired);
    sail(c, b, desired, speed, def.turnRate * 1.2, 1.5);
    return;
  }
  // Ships of the line: hold the player on a beam at orbit range.
  const rel = wrap(hb - b.heading);
  if (Math.abs(rel) > 0.25 && Math.abs(Math.abs(rel) - Math.PI) > 0.25) b.ai.side = rel >= 0 ? 1 : -1;
  const side = b.ai.side!;
  const rangeErr = clamp((dist - kit.orbitRange) / 70, -1, 1);
  desired = dist > kit.orbitRange * 1.8 ? hb : hb - side * (Math.PI / 2) + side * rangeErr * 0.6;
  desired = avoidIslands(c, b, desired);
  sail(c, b, desired, speed, def.turnRate);
}

/** Holds heading and crawls (while gun crews work). */
function heaveTo(c: SimContext, b: BossState, def: BossDef, speedFrac = 0.2): void {
  sail(c, b, b.heading, def.speed * speedFrac, def.turnRate * 0.4);
}

function keepOffIslands(c: SimContext, b: BossState): void {
  if (b.submerged > 0.5) return;
  const hit = c.world.collideCircle(b.x, b.z, b.radius * 0.8);
  if (hit.hit) { b.x += hit.nx * hit.depth; b.z += hit.nz * hit.depth; }
}

// ───────────────────────── Attacks ─────────────────────────

/** Side the player is on relative to the boss (+1 port, −1 starboard). */
function playerSide(c: SimContext, b: BossState): number {
  const p = c.state.player;
  return wrap(headingTo(p.x - b.x, p.z - b.z) - b.heading) >= 0 ? 1 : -1;
}

/** Gun i of n on `side` for a volley wave: origin on the hull, fanned slightly, swept per wave. */
function gunLine(ox: number, oz: number, oh: number, length: number, radius: number, i: number, n: number, side: number, wave: number): typeof GUN {
  const u = n > 1 ? i / (n - 1) - 0.5 : 0;
  const along = u * length * 0.62;
  const fan = u * 0.28;
  const sweep = (wave % 2 === 0 ? 1 : -1) * 0.07 * Math.ceil(wave / 2);
  GUN.x = ox + fwdX(oh) * along + sideX(oh, side) * radius * 0.8;
  GUN.z = oz + fwdZ(oh) * along + sideZ(oh, side) * radius * 0.8;
  GUN.h = oh + side * (Math.PI / 2 - fan + sweep);
  return GUN;
}

/** Broadside volleys with LINE telegraphs; waves overlap; balls travel exactly along the drawn lines. */
function volleyAttack(c: SimContext, b: BossState, def: BossDef, v: VolleyKit): boolean {
  const t = b.attackTime, ai = b.ai;
  const waves = Math.min(OX.length, at(v.waves, b.phase));
  const lines = at(v.lines, b.phase);
  heaveTo(c, b, def, 0.25);
  while (ai.wave! < waves && t >= ai.wave! * v.waveGap) {
    const k = ai.wave!;
    const side = v.bothSides ? 0 : playerSide(c, b);
    ai[OX[k]] = b.x; ai[OZ[k]] = b.z; ai[OH[k]] = b.heading; ai[OS[k]] = side;
    for (let s = -1; s <= 1; s += 2) {
      if (side !== 0 && s !== side) continue;
      for (let i = 0; i < lines; i++) {
        const g = gunLine(b.x, b.z, b.heading, def.length, b.radius, i, lines, s, k);
        lineTelegraph(c, g.x, g.z, g.h, v.length, v.width, v.telegraph);
      }
    }
    ai.wave = k + 1;
  }
  while (ai.fired! < ai.wave! && t >= ai.fired! * v.waveGap + v.telegraph) {
    const k = ai.fired!;
    const side = ai[OS[k]]!;
    const damage = bossDamage(c, v.damage);
    let count = 0;
    for (let s = -1; s <= 1; s += 2) {
      if (side !== 0 && s !== side) continue;
      for (let i = 0; i < lines; i++) {
        const g = gunLine(ai[OX[k]]!, ai[OZ[k]]!, ai[OH[k]]!, def.length, b.radius, i, lines, s, k);
        fireAlong(c, 'enemy-cannonball', g.x, g.z, g.h, v.speed, damage, v.length, v.width * 0.5);
        count++;
      }
    }
    const sh = ai[OH[k]]! + (side || 1) * (Math.PI / 2);
    c.emit({ type: 'enemy-fired', source: b.id, projectile: 'enemy-cannonball', x: b.x, z: b.z, dirX: fwdX(sh), dirZ: fwdZ(sh), count });
    ai.fired = k + 1;
  }
  return ai.fired! >= waves && t >= (waves - 1) * v.waveGap + v.telegraph + 0.5;
}

/** Mortar barrage: salvos of lobbed shells with CIRCLE telegraphs around the player's predicted track. */
function mortarAttack(c: SimContext, b: BossState, def: BossDef, m: MortarKit): boolean {
  const t = b.attackTime, ai = b.ai;
  const shells = at(m.shells, b.phase);
  const per = Math.ceil(shells / m.salvos);
  heaveTo(c, b, def, 0.5);
  while (ai.wave! < m.salvos && t >= ai.wave! * m.salvoGap) {
    const damage = bossDamage(c, m.damage);
    for (let j = 0; j < per; j++) {
      const flight = m.flight + c.random() * 0.4;
      const pred = predictPlayer(c, flight, 0.8);
      let tx = pred.x, tz = pred.z;
      if (!(ai.wave === 0 && j === 0)) {
        const a = c.random() * TAU, r = Math.sqrt(c.random()) * m.spread;
        tx += Math.sin(a) * r; tz += Math.cos(a) * r;
      }
      const along = (c.random() - 0.5) * def.length * 0.5;
      lobShell(c, 'boss-shell', b.x + fwdX(b.heading) * along, b.z + fwdZ(b.heading) * along, tx, tz, flight, damage, m.area);
    }
    const p = c.state.player, d = Math.hypot(p.x - b.x, p.z - b.z) || 1;
    c.emit({ type: 'enemy-fired', source: b.id, projectile: 'boss-shell', x: b.x, z: b.z, dirX: (p.x - b.x) / d, dirZ: (p.z - b.z) / d, count: per });
    ai.wave! += 1;
  }
  return t >= m.salvos * m.salvoGap + m.flight + 0.5;
}

/** Summons: cutters/skiffs around the boss, wyrmlings around the player, or man-o'-war escorts. */
function summonAttack(c: SimContext, b: BossState, def: BossDef, kit: BossKitDef, s: SummonKit, where: 'boss' | 'player' | 'escort'): boolean {
  const ai = b.ai;
  const p = c.state.player;
  if (ai.stage === 0) {
    ai.stage = 1;
    for (const unit of s.units) {
      for (let k = 0; k < unit.count; k++) {
        if (c.state.enemies.length >= s.cap) break;
        let x: number, z: number;
        if (where === 'boss') {
          const a = b.heading + (k % 2 === 0 ? 1 : -1) * (Math.PI / 2) + rand(c, -0.6, 0.6);
          const r = b.radius + rand(c, 25, 55);
          x = b.x + fwdX(a) * r; z = b.z + fwdZ(a) * r;
        } else if (where === 'player') {
          const a = rand(c, 0, TAU), r = rand(c, 130, 170);
          x = p.x + fwdX(a) * r; z = p.z + fwdZ(a) * r;
        } else {
          const a = headingTo(b.x - p.x, b.z - p.z) + (k % 2 === 0 ? 0.9 : -0.9);
          const r = rand(c, 230, 280);
          x = p.x + fwdX(a) * r; z = p.z + fwdZ(a) * r;
        }
        const spot = openWaterNear(c, x, z, c.content.enemies[unit.enemy].radius + 8);
        if (!spot) continue;
        spawnScaled(c, unit.enemy, spot.x, spot.z, { heading: headingTo(p.x - spot.x, p.z - spot.z) });
      }
    }
  }
  cruise(c, b, def, kit, Math.hypot(p.x - b.x, p.z - b.z), 0.4);
  return b.attackTime > 1.4;
}

/** Ram charge: swing onto the player, LINE telegraph, then charge along the drawn line. */
function ramAttack(c: SimContext, b: BossState, def: BossDef, r: RamKit): boolean {
  const t = b.attackTime, ai = b.ai, dt = c.dt;
  const p = c.state.player;
  if (ai.stage === 0) {
    const pred = predictPlayer(c, 1.2, 0.6);
    sail(c, b, headingTo(pred.x - b.x, pred.z - b.z), def.speed * 0.3, def.turnRate * 3);
    if (t >= 0.6) {
      const aim = predictPlayer(c, r.telegraph * 0.8, 0.7);
      ai.rh = headingTo(aim.x - b.x, aim.z - b.z);
      ai.tg = lineTelegraph(c, b.x, b.z, ai.rh, r.length, r.width, r.telegraph)?.id ?? 0;
      ai.stage = 1; ai.t0 = t; ai.rammed = 0;
    }
    return false;
  }
  if (ai.stage === 1) {
    sail(c, b, ai.rh!, 0, def.turnRate * 5);
    moveTelegraph(c, ai.tg!, b.x, b.z);
    if (t >= ai.t0! + r.telegraph) { ai.stage = 2; ai.t0 = t; ai.tg = 0; b.heading = ai.rh!; }
    return false;
  }
  if (ai.stage === 2) {
    b.heading = ai.rh!; b.yawRate = 0; b.speed = r.speed;
    b.vx = fwdX(ai.rh!) * r.speed; b.vz = fwdZ(ai.rh!) * r.speed;
    b.x += b.vx * dt; b.z += b.vz * dt;
    if (ai.rammed !== 1 && p.alive && Math.hypot(p.x - b.x, p.z - b.z) < b.radius + p.radius + 3) {
      ai.rammed = 1;
      const dealt = c.damagePlayer(bossDamage(c, r.damage), { x: b.x, z: b.z, source: b.id, kind: 'boss' });
      c.emit({ type: 'ram', attacker: b.id, target: 0, damage: dealt, x: (p.x + b.x) / 2, z: (p.z + b.z) / 2 });
    }
    if (t >= ai.t0! + r.duration) { ai.stage = 3; ai.t0 = t; }
    return false;
  }
  heaveTo(c, b, def, 0.3);
  return t >= ai.t0! + 1.2;
}

/** Tidewyrm: submerge (untargetable), swim to a flank, ripple LINE telegraph, then surface in a lunge. */
function lungeAttack(c: SimContext, b: BossState, def: BossDef, kit: BossKitDef, L: LungeKit, dist: number): boolean {
  const t = b.attackTime, ai = b.ai, dt = c.dt;
  const p = c.state.player;
  switch (ai.stage) {
    case 0: {
      b.submerged = Math.min(1, b.submerged + dt / L.dive);
      sail(c, b, b.heading, def.speed * 0.6, def.turnRate);
      if (b.submerged >= 1) {
        const base = headingTo(b.x - p.x, b.z - p.z) + rand(c, -0.8, 0.8);
        const spot = openWaterNear(c, p.x + fwdX(base) * L.startDist, p.z + fwdZ(base) * L.startDist, b.radius + 6);
        ai.sx = spot ? spot.x : b.x; ai.sz = spot ? spot.z : b.z;
        ai.stage = 1; ai.t0 = t;
      }
      return false;
    }
    case 1: {
      // Swim unseen to the start point, skirting around the player's hull.
      let desired = headingTo(ai.sx! - b.x, ai.sz! - b.z);
      if (dist < 85) {
        const away = headingTo(b.x - p.x, b.z - p.z);
        desired = away + (wrap(desired - away) >= 0 ? 1 : -1) * (Math.PI / 2);
      }
      sail(c, b, desired, L.travelSpeed, def.turnRate * 3, 3);
      if (Math.hypot(ai.sx! - b.x, ai.sz! - b.z) < 14 || t - ai.t0! > 4) {
        const pred = predictPlayer(c, L.telegraph + 0.4, 0.6);
        ai.lh = headingTo(pred.x - b.x, pred.z - b.z);
        ai.tg = lineTelegraph(c, b.x, b.z, ai.lh, L.length, L.width, L.telegraph)?.id ?? 0;
        ai.stage = 2; ai.t0 = t;
      }
      return false;
    }
    case 2: {
      sail(c, b, ai.lh!, 0, def.turnRate * 4);
      moveTelegraph(c, ai.tg!, b.x, b.z);
      if (t >= ai.t0! + L.telegraph) {
        ai.stage = 3; ai.t0 = t; ai.rammed = 0; ai.tg = 0; b.heading = ai.lh!;
        emitAttack(c, b, 'lunge-strike');
      }
      return false;
    }
    case 3: {
      b.submerged = Math.max(0, b.submerged - dt / 0.2);
      b.heading = ai.lh!; b.yawRate = 0; b.speed = L.speed;
      b.vx = fwdX(ai.lh!) * L.speed; b.vz = fwdZ(ai.lh!) * L.speed;
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (ai.rammed !== 1 && p.alive && Math.hypot(p.x - b.x, p.z - b.z) < b.radius + p.radius + 2) {
        ai.rammed = 1;
        const dealt = c.damagePlayer(bossDamage(c, L.damage), { x: b.x, z: b.z, source: b.id, kind: 'boss' });
        c.emit({ type: 'ram', attacker: b.id, target: 0, damage: dealt, x: (p.x + b.x) / 2, z: (p.z + b.z) / 2 });
      }
      if (t >= ai.t0! + L.length / L.speed) { ai.stage = 4; ai.t0 = t; }
      return false;
    }
    default:
      b.submerged = Math.max(0, b.submerged - dt / 0.3);
      cruise(c, b, def, kit, dist, 0.35);
      return t >= ai.t0! + L.recover;
  }
}

/** Tidewyrm tail slam: RING telegraph on the coils, then a blast and radiating wave fronts. */
function tailSlamAttack(c: SimContext, b: BossState, def: BossDef, T: TailSlamKit): boolean {
  const t = b.attackTime, ai = b.ai;
  const p = c.state.player;
  if (ai.stage === 0) {
    ai.cx = b.x - fwdX(b.heading) * 38;
    ai.cz = b.z - fwdZ(b.heading) * 38;
    ai.tg = c.addTelegraph({ shape: 'ring', team: 'enemy', x: ai.cx, z: ai.cz, radius: T.radius, duration: T.telegraph })?.id ?? 0;
    ai.stage = 1;
  }
  if (ai.stage === 1) {
    sail(c, b, b.heading + 1.2 * b.ai.orbit!, def.speed * 0.25, def.turnRate);
    if (t >= T.telegraph) {
      ai.stage = 2; ai.tg = 0;
      const cx = ai.cx!, cz = ai.cz!;
      c.emit({ type: 'explosion', x: cx, z: cz, radius: T.radius, kind: 'water', team: 'enemy' });
      c.spawnHazard({ kind: 'shockwave', team: 'enemy', x: cx, z: cz, radius: T.radius, ttl: 0.5, damage: 0 });
      if (p.alive && Math.hypot(p.x - cx, p.z - cz) <= T.radius + p.radius * 0.5) {
        c.damagePlayer(bossDamage(c, T.damage), { x: cx, z: cz, source: b.id, kind: 'boss' });
      }
      const waveDamage = bossDamage(c, T.waveDamage);
      for (let i = 0; i < T.waves; i++) {
        const a = (i / T.waves) * TAU;
        c.spawnHazard({
          kind: 'wave-front', team: 'enemy', x: cx + Math.sin(a) * (T.radius * 0.6), z: cz + Math.cos(a) * (T.radius * 0.6), radius: 9, ttl: 3.4,
          damage: waveDamage, tick: 0.8, vx: Math.sin(a) * T.waveSpeed, vz: Math.cos(a) * T.waveSpeed,
        });
      }
    }
    return false;
  }
  heaveTo(c, b, def, 0.3);
  return t >= T.telegraph + 0.8;
}

/** Tidewyrm water bolts: rears up, then fans of bolts at the led player position (alternate fans offset). */
function boltAttack(c: SimContext, b: BossState, def: BossDef, B: BoltKit): boolean {
  const t = b.attackTime, ai = b.ai;
  const p = c.state.player;
  const fans = at(B.fans, b.phase), bolts = at(B.bolts, b.phase);
  sail(c, b, headingTo(p.x - b.x, p.z - b.z), def.speed * 0.25, def.turnRate * 2);
  while (ai.wave! < fans && t >= B.windup + ai.wave! * B.fanGap) {
    const aim = leadAim(c, b.x, b.z, B.speed, 0.5);
    const tx = aim.x, tz = aim.z;
    const step = bolts > 1 ? B.spread / (bolts - 1) : 0;
    const offset = ai.wave! % 2 === 1 ? step * 0.5 : 0;
    const hx = b.x + fwdX(b.heading) * b.radius, hz = b.z + fwdZ(b.heading) * b.radius;
    const damage = bossDamage(c, B.damage);
    for (let j = 0; j < bolts; j++) {
      const err = (bolts > 1 ? -B.spread / 2 + j * step : 0) + offset;
      fireShot(c, 'water-bolt', hx, hz, tx, tz, B.speed, damage, 320, 2.2, err);
    }
    const d = Math.hypot(tx - hx, tz - hz) || 1;
    c.emit({ type: 'enemy-fired', source: b.id, projectile: 'water-bolt', x: hx, z: hz, dirX: (tx - hx) / d, dirZ: (tz - hz) / d, count: bolts });
    ai.wave! += 1;
  }
  return t >= B.windup + fans * B.fanGap + 0.3;
}

/** Sovereign's Judgment Line: long LINE telegraph through the player, then shells walk down it in sequence. */
function judgmentAttack(c: SimContext, b: BossState, def: BossDef, J: JudgmentKit): boolean {
  const t = b.attackTime, ai = b.ai;
  const p = c.state.player;
  if (ai.stage === 0) {
    ai.stage = 1;
    const lines = at(J.lines, b.phase);
    const base = headingTo(p.x - b.x, p.z - b.z);
    const damage = bossDamage(c, J.damage);
    for (let L = 0; L < lines; L++) {
      // Line 0 runs from the flagship through the player; line 1 crosses it at the player.
      let ox: number, oz: number, h: number;
      if (L === 0) { ox = b.x; oz = b.z; h = base; }
      else {
        const cross = base + Math.PI / 2;
        ox = p.x - fwdX(cross) * (J.length / 2); oz = p.z - fwdZ(cross) * (J.length / 2); h = cross;
      }
      lineTelegraph(c, ox, oz, h, J.length, J.width, J.telegraph);
      for (let i = 0; i < J.shells; i++) {
        const d = 40 + ((J.length - 40) * i) / Math.max(1, J.shells - 1);
        const tx = ox + fwdX(h) * d, tz = oz + fwdZ(h) * d;
        lobShell(c, 'boss-shell', b.x, b.z, tx, tz, J.telegraph + i * J.stagger, damage, J.area, false);
      }
    }
    c.emit({ type: 'enemy-fired', source: b.id, projectile: 'boss-shell', x: b.x, z: b.z, dirX: fwdX(base), dirZ: fwdZ(base), count: J.shells * lines });
  }
  heaveTo(c, b, def, 0.3);
  return t >= J.telegraph + J.shells * J.stagger + 0.6;
}
