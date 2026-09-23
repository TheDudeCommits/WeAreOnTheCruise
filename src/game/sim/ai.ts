/**
 * Enemy movement + attacks (META-owned). Skeleton: seek/orbit steering with separation and simple aimed fire.
 * TODO(META): behaviours per EnemyBehavior (formations, lead, telegraphs, kamikaze, phase, lunge, stationary).
 */
import type { EnemyState } from '../types';
import type { SimContext, Target } from './context';

const neighbours: Target[] = [];

export function updateEnemies(c: SimContext): void {
  const p = c.state.player;
  const dt = c.dt;
  for (const e of c.state.enemies) {
    if (e.life !== 'alive') { e.speed *= 0.97; e.x += e.vx * dt * 0.3; e.z += e.vz * dt * 0.3; continue; }
    const def = c.content.enemies[e.defId];
    e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
    for (const st of e.statuses) st.time -= dt;
    for (let i = e.statuses.length - 1; i >= 0; i--) if (e.statuses[i]!.time <= 0) e.statuses.splice(i, 1);
    if (def.speed <= 0) { tryFire(c, e); continue; }

    const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz) || 1;
    let desired = Math.atan2(-dx, -dz);
    if (def.behavior === 'broadside' && dist < (def.attack?.range ?? 140) * 0.9) {
      const orbit = (e.id % 2 === 0 ? 1 : -1) * Math.PI / 2;
      desired = Math.atan2(-dx, -dz) + orbit;
    }
    // Separation.
    let sepX = 0, sepZ = 0;
    for (const o of c.targetsNear(e.x, e.z, e.radius * 2.5, neighbours)) {
      if (o === e) continue;
      const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz) || 1;
      sepX += ox / od; sepZ += oz / od;
    }
    if (sepX || sepZ) {
      const blend = Math.atan2(-(Math.sin(desired) * -1 + sepX * 0.8), -(Math.cos(desired) * -1 + sepZ * 0.8));
      desired = blend;
    }
    let diff = desired - e.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-def.turnRate, Math.min(def.turnRate, diff * 2));
    e.yawRate = turn;
    e.heading += turn * dt;
    const slow = c.hasStatus(e, 'slowed') ? 0.6 : 1;
    const targetSpeed = def.speed * slow * (c.state.director.heat > 1 ? 1 + (c.state.director.heat - 1) * 0.15 : 1);
    e.speed += (targetSpeed - e.speed) * Math.min(1, dt * 1.5);
    const fx = -Math.sin(e.heading), fz = -Math.cos(e.heading);
    e.vx += (fx * e.speed - e.vx) * Math.min(1, dt * 2);
    e.vz += (fz * e.speed - e.vz) * Math.min(1, dt * 2);
    e.x += e.vx * dt; e.z += e.vz * dt;
    e.roll += (-e.yawRate * e.speed * 0.02 - e.roll) * Math.min(1, dt * 3);
    tryFire(c, e);
  }
}

function tryFire(c: SimContext, e: EnemyState): void {
  const def = c.content.enemies[e.defId];
  const attack = def.attack;
  if (!attack) return;
  e.attackCooldown -= c.dt;
  if (e.attackCooldown > 0) return;
  const p = c.state.player;
  const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
  if (dist > attack.range) return;
  e.attackCooldown = attack.cooldown * (0.85 + c.random() * 0.3);
  const lead = attack.lead * Math.min(1, dist / attack.speed);
  const tx = p.x + p.vx * lead, tz = p.z + p.vz * lead;
  const ballistic = attack.projectile === 'enemy-mortar';
  for (let i = 0; i < attack.count; i++) {
    const ang = Math.atan2(tx - e.x, tz - e.z) + (c.random() - 0.5) * attack.spread * 2;
    if (ballistic) {
      const ax = tx + (c.random() - 0.5) * 20, az = tz + (c.random() - 0.5) * 20;
      const flight = Math.hypot(ax - e.x, az - e.z) / attack.speed;
      c.addTelegraph({ shape: 'circle', team: 'enemy', x: ax, z: az, radius: 14, duration: flight });
      c.spawnProjectile({ kind: 'enemy-mortar', team: 'enemy', x: e.x, y: 4, z: e.z, vx: (ax - e.x) / flight, vy: 9 * flight, vz: (az - e.z) / flight, damage: attack.damage, area: 14, ttl: flight + 1 });
    } else {
      c.spawnProjectile({ kind: attack.projectile, team: 'enemy', x: e.x, y: 3, z: e.z, vx: Math.sin(ang) * attack.speed, vz: Math.cos(ang) * attack.speed, damage: attack.damage, ttl: attack.range / attack.speed + 0.3, radius: 1.5 });
    }
  }
  c.emit({ type: 'enemy-fired', source: e.id, projectile: attack.projectile, x: e.x, z: e.z, dirX: dx / (dist || 1), dirZ: dz / (dist || 1), count: attack.count });
}
