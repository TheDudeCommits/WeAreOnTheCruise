/**
 * Projectile motion and hits (CORE-owned).
 *
 * Motion by kind (KIND_TRAITS): flat shots (swept segment tests so fast shots never tunnel), ballistic arcs
 * (gravity; they land and burst — no mid-air collisions), homing (turn-rate limited steering toward a target,
 * retargeting when it sinks; enemy homing shots with target 0 chase the player). Flat shots stop at islands
 * (except the lance and rockets, which fly over).
 * Hits: pierce with per-projectile hit lists, area projectiles detonate on contact with falloff splash, crits carry
 * through, CORE flags add slow / burn / stun / knockback, cluster bomblets, firepots, skyburst sparks and harpoons.
 */
import type { ProjectileKind, StatusKind, Team, WeaponId } from '../ids';
import type { ProjectileState } from '../types';
import type { Target } from './context';
import {
  GRAVITY, HF_BURN, hullEdge, isBoss, K_BALLISTIC, K_EXPIRE_BLAST, K_ISLAND, KIND_TRAITS, PF_AIMED, PF_BIG, PF_BURN,
  PF_CLUSTER, PF_FIREPOT, PF_HOOK, PF_SLOW, PF_SPARKS, PF_STUN, PF_WATER, targetable, wrapAngle, type CoreSim, type ExplosionKind,
} from './core-runtime';
import { applyBurn } from './core-forces';
import { blastCaptains, shotVsCaptains } from './captains-damage';
import { captainBlast, captainHit } from './captains-credit';
import { captainInPath, playerBlastCaptains, playerHitCaptain } from './captains-rival';
import { onHarpoonHit } from './weapons/harpoon';

export { GRAVITY };

export function updateProjectiles(c: CoreSim): void {
  const s = c.state;
  const list = s.projectiles;
  const n = list.length;
  const core = c.core;
  const dt = c.dt;
  const p = s.player;
  const playerHittable = p.alive && p.airborne < 0.2 && p.submerged < 0.5;
  for (let i = 0; i < n; i++) {
    const pr = list[i]!;
    if (!pr.alive) continue;
    pr.age += dt;
    const traits = KIND_TRAITS[pr.kind] ?? K_ISLAND;
    if (core.pTurn[i]! > 0) steer(c, pr, i, dt);

    if (traits & K_BALLISTIC) {
      pr.vy -= GRAVITY * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      if (pr.y <= 0) { pr.y = 0; land(c, pr, i, playerHittable); }
      else if (pr.age > pr.ttl + 6) pr.alive = false;
      continue;
    }

    const px = pr.x, pz = pr.z;
    pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
    if (pr.kind === 'rocket') rocketAltitude(pr, core.pTarget[i] ?? null, dt);

    if (pr.team === 'player') {
      if (hitShips(c, pr, i, px, pz)) continue;
    } else if (playerHittable) {
      if (hullEdge(p, pr.x, pr.z) <= pr.radius) {
        const dealt = c.hurtPlayer(pr.damage, pr.x, pr.z, core.pFrom[i]! < 0 ? core.pFrom[i]! : undefined, 'projectile');
        c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: pr.y, z: pr.z, target: 'ship', targetId: 0, damage: dealt, crit: false });
        if (pr.area > 0) c.emit({ type: 'explosion', x: pr.x, z: pr.z, radius: pr.area, kind: 'medium', team: pr.team });
        pr.alive = false;
        continue;
      }
    }
    // CAPTAINS: enemy shots also hit AI captains (a hostile captain's shots — pFrom < 0 — never hit captains).
    if (pr.team !== 'player' && s.captains.length > 0 && core.pFrom[i]! >= 0 && shotVsCaptains(c, pr)) continue;

    if (pr.age >= pr.ttl) { expire(c, pr, i, traits); continue; }
    if ((traits & K_ISLAND) && core.onLand(c, pr.x, pr.z)) {
      c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: pr.y, z: pr.z, target: 'island', damage: 0, crit: false });
      if (pr.area > 0) detonate(c, pr, i, pr.x, pr.z);
      pr.alive = false;
    }
  }
}

/** Swept hit test against ships for a player projectile. Returns true when the projectile is spent. */
function hitShips(c: CoreSim, pr: ProjectileState, i: number, px: number, pz: number): boolean {
  const core = c.core;
  const segX = pr.x - px, segZ = pr.z - pz;
  const seg2 = segX * segX + segZ * segZ;
  const segLen = Math.sqrt(seg2);
  const buf = core.bufP;
  const n = core.near(c.state, pr.x - segX * 0.5, pr.z - segZ * 0.5, pr.radius + segLen * 0.5 + 0.5, buf);
  for (let j = 0; j < n; j++) {
    const t = buf[j]!;
    if (!targetable(t)) continue;
    let u = seg2 > 1e-9 ? ((t.x - px) * segX + (t.z - pz) * segZ) / seg2 : 1;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const dx = t.x - (px + segX * u), dz = t.z - (pz + segZ * u), rr = t.radius + pr.radius;
    if (dx * dx + dz * dz > rr * rr) continue;
    if (pr.hits.length > 0 && pr.hits.includes(t.id)) continue;
    if (pr.area > 0) { detonate(c, pr, i, pr.x, pr.z); pr.alive = false; return true; }
    if (onHit(c, pr, i, t)) return true;
  }
  // Rivals: the player's own shots (not the captains') hit hostile captains, and hand-aimed ones hit any captain.
  if (core.pFrom[i]! >= 0 && c.state.captains.length > 0) {
    const k = captainInPath(c, pr, px, pz, (core.pFlags[i]! & PF_AIMED) !== 0);
    if (k) {
      const dealt = playerHitCaptain(c, k, pr.damage);
      c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: pr.y, z: pr.z, target: 'ship', targetId: k.id, damage: dealt, crit: pr.crit });
      if (pr.area > 0) { detonate(c, pr, i, pr.x, pr.z); pr.alive = false; return true; }
      if (pr.pierce > 0 && !(core.pFlags[i]! & PF_HOOK)) { pr.pierce--; pr.hits.push(k.id); return false; }
      pr.alive = false;
      return true;
    }
  }
  return false;
}

/** Direct hit on a ship. Returns true when the projectile is spent. */
function onHit(c: CoreSim, pr: ProjectileState, i: number, t: Target): boolean {
  const core = c.core;
  const flags = core.pFlags[i]!;
  let status: StatusKind | null = null, st = 0, sm = 0;
  if (flags & PF_SLOW) { status = 'slowed'; st = core.pSlowTime[i]!; sm = core.pSlowMag[i]!; }
  const back = 0.05;
  // CAPTAINS: a captain's shot (pFrom < 0) is credited to that captain.
  const dealt = core.pFrom[i]! < 0
    ? captainHit(c, core.pFrom[i]!, t, pr.damage, pr.crit, core.pKnock[i]!, pr.x - pr.vx * back, pr.z - pr.vz * back)
    : c.hitTarget(t, pr.damage, pr.weapon, pr.crit, core.pKnock[i]!, pr.x - pr.vx * back, pr.z - pr.vz * back, status, st, sm, false);
  if ((flags & PF_BURN) && core.pBurn[i]! > 0) applyBurn(c, t, core.pBurn[i]!, pr.weapon);
  if ((flags & PF_STUN) && core.pStun[i]! > 0 && !isBoss(t)) c.applyStatus(t, 'stunned', core.pStun[i]!, 1);
  c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: pr.y, z: pr.z, target: 'ship', targetId: t.id, damage: dealt, crit: pr.crit });
  if (flags & PF_HOOK) {
    if (onHarpoonHit(c, pr, i, t)) return false;
    pr.alive = false;
    return true;
  }
  if (pr.pierce > 0) {
    pr.pierce--;
    pr.hits.push(t.id);
    return false;
  }
  pr.alive = false;
  return true;
}

function steer(c: CoreSim, pr: ProjectileState, i: number, dt: number): void {
  const core = c.core;
  let tx: number, tz: number;
  if (pr.team === 'enemy' && pr.target === 0) {
    const p = c.state.player;
    if (!p.alive) return;
    tx = p.x; tz = p.z;
  } else {
    let t = core.pTarget[i] ?? null;
    if (t && !targetable(t)) t = null;
    if (!t) {
      core.pTarget[i] = null;
      if (pr.team === 'player' && (c.state.tick + i) % 6 === 0) {
        t = core.nearest(c.state, pr.x, pr.z, 90, core.bufP);
        core.pTarget[i] = t;
        pr.target = t ? t.id : undefined;
      }
    }
    if (!t) { accelerate(pr, core.pSpeed[i]!, dt); return; }
    tx = t.x; tz = t.z;
  }
  const speed = Math.sqrt(pr.vx * pr.vx + pr.vz * pr.vz);
  const nominal = core.pSpeed[i]!;
  const next = speed + Math.max(-60 * dt, Math.min(60 * dt, nominal - speed));
  const cur = Math.atan2(pr.vx, pr.vz);
  const want = Math.atan2(tx - pr.x, tz - pr.z);
  const turn = core.pTurn[i]! * dt;
  const diff = wrapAngle(want - cur);
  const a = cur + (diff > turn ? turn : diff < -turn ? -turn : diff);
  pr.vx = Math.sin(a) * next;
  pr.vz = Math.cos(a) * next;
}

function accelerate(pr: ProjectileState, nominal: number, dt: number): void {
  const speed = Math.sqrt(pr.vx * pr.vx + pr.vz * pr.vz);
  if (speed < 1e-3 || speed >= nominal) return;
  const k = Math.min(nominal, speed + 60 * dt) / speed;
  pr.vx *= k; pr.vz *= k;
}

function rocketAltitude(pr: ProjectileState, t: Target | null, dt: number): void {
  let goal = 7;
  if (t) { const dx = t.x - pr.x, dz = t.z - pr.z; if (dx * dx + dz * dz < 35 * 35) goal = 1.2; }
  pr.vy = 0;
  pr.y += (goal - pr.y) * Math.min(1, dt * 3);
}

function expire(c: CoreSim, pr: ProjectileState, i: number, traits: number): void {
  if ((traits & K_EXPIRE_BLAST) && pr.area > 0) { detonate(c, pr, i, pr.x, pr.z); pr.alive = false; return; }
  c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: 0, z: pr.z, target: 'water', damage: 0, crit: false });
  pr.alive = false;
}

/** A ballistic shell reaches the water. */
function land(c: CoreSim, pr: ProjectileState, i: number, playerHittable: boolean): void {
  pr.alive = false;
  if (pr.team === 'player') { detonate(c, pr, i, pr.x, pr.z); return; }
  const radius = Math.max(pr.area, 6);
  c.emit({ type: 'explosion', x: pr.x, z: pr.z, radius, kind: pr.kind === 'boss-shell' ? 'medium' : 'mortar', team: pr.team });
  const p = c.state.player;
  if (playerHittable && hullEdge(p, pr.x, pr.z) <= radius) c.hurtPlayer(pr.damage, pr.x, pr.z, undefined, 'projectile');
  blastCaptains(c, pr.x, pr.z, radius, pr.damage); // CAPTAINS
}

const KIND_BLAST: Partial<Record<ProjectileKind, ExplosionKind>> = {
  'mortar-shell': 'mortar', bomblet: 'small', rocket: 'small', torpedo: 'water',
};

/** Area burst of a player projectile at (x,z) with its branch payloads. */
function detonate(c: CoreSim, pr: ProjectileState, i: number, x: number, z: number): void {
  const core = c.core;
  const flags = core.pFlags[i]!;
  const radius = Math.max(pr.area, 4);
  const kind: ExplosionKind = flags & PF_BIG ? 'large' : flags & PF_WATER ? 'water' : KIND_BLAST[pr.kind] ?? 'medium';
  // CAPTAINS: a captain's shell bursts with credited damage.
  if (core.pFrom[i]! < 0) { captainBlast(c, core.pFrom[i]!, x, z, radius, pr.damage, pr.crit, core.pKnock[i]!, kind); return; }
  let status: StatusKind | null = null, st = 0, sm = 0;
  if (flags & PF_SLOW) { status = 'slowed'; st = core.pSlowTime[i]!; sm = core.pSlowMag[i]!; }
  explode(c, x, z, radius, pr.damage, pr.team, pr.weapon, pr.crit, core.pKnock[i]!, kind, status, st, sm);
  if (flags & PF_CLUSTER) {
    const count = Math.max(0, Math.round(core.pA[i]!));
    const dmg = pr.damage * core.pB[i]!, area = pr.area * core.pC[i]!;
    for (let k = 0; k < count; k++) {
      const a = (k / Math.max(1, count)) * Math.PI * 2 + c.random() * 0.8;
      const sp = 10 + c.random() * 10;
      c.shoot('bomblet', pr.team, x, 2, z, Math.sin(a) * sp, 9, Math.cos(a) * sp, dmg, 1, 0, 3, pr.weapon, pr.crit, area);
    }
  }
  if (flags & PF_SPARKS) {
    const count = Math.max(0, Math.round(core.pA[i]!));
    const dmg = pr.damage * core.pB[i]!, area = Math.max(5, pr.area * 0.5);
    for (let k = 0; k < count; k++) {
      const a = (k / Math.max(1, count)) * Math.PI * 2 + c.random() * 0.6;
      const sp = 12 + c.random() * 10;
      const idx = c.shoot('bomblet', pr.team, x, 3, z, Math.sin(a) * sp, 8, Math.cos(a) * sp, dmg, 0.8, 0, 3, pr.weapon, false, area);
      if (idx >= 0) { core.pFlags[idx] = PF_BURN; core.pBurn[idx] = dmg * 0.3; }
    }
  }
  if (flags & PF_FIREPOT) {
    const idx = c.placeHazard('fire-patch', pr.team, x, z, pr.area * core.pC[i]!, core.pA[i]!, pr.damage * core.pB[i]!, 0.5, 0, 0, pr.weapon, true);
    if (idx >= 0) { core.hFlags[idx] = HF_BURN; core.hA[idx] = pr.damage * core.pB[i]!; }
  }
  if ((flags & PF_BURN) && core.pBurn[i]! > 0) {
    // Burning bursts (sparks) set everything in the blast alight.
    const buf = core.bufE;
    const n = core.near(c.state, x, z, radius, buf);
    for (let k = 0; k < n; k++) if (targetable(buf[k]!)) applyBurn(c, buf[k]!, core.pBurn[i]!, pr.weapon);
  }
}

/**
 * Explosion at (x,z): emits the 'explosion' event and damages everything of the other team inside `radius`
 * (100% at the centre → 50% at the rim, measured to hull edges). Exported for hazards / skills / skiffs.
 */
export function explode(
  c: CoreSim, x: number, z: number, radius: number, damage: number, team: Team, weapon: WeaponId | undefined, crit: boolean,
  knockback: number, kind: ExplosionKind, status: StatusKind | null, statusTime: number, statusMag: number,
): void {
  c.emit({ type: 'explosion', x, z, radius, kind, team });
  if (team === 'player') {
    const core = c.core;
    const buf = core.bufE;
    const n = core.near(c.state, x, z, radius, buf);
    for (let k = 0; k < n; k++) {
      const t = buf[k]!;
      if (!targetable(t)) continue;
      const dx = t.x - x, dz = t.z - z;
      const edge = Math.max(0, Math.sqrt(dx * dx + dz * dz) - t.radius);
      const f = 1 - 0.5 * Math.min(1, edge / Math.max(1, radius));
      c.hitTarget(t, damage * f, weapon, crit, knockback, x, z, status, statusTime, statusMag, false);
    }
    playerBlastCaptains(c, x, z, radius, damage); // rivals
    return;
  }
  blastCaptains(c, x, z, radius, damage); // CAPTAINS
  const p = c.state.player;
  if (!p.alive || p.airborne > 0.2 || p.submerged > 0.5) return;
  if (hullEdge(p, x, z) <= radius) c.hurtPlayer(damage, x, z, undefined, 'projectile');
}

