/** Projectile motion and hits (CORE-owned). Skeleton: flat shots + ballistic mortars, pierce, area. */
import type { ProjectileState } from '../types';
import type { SimContext, Target } from './context';

const GRAVITY = 18;
const scratch: Target[] = [];
const BALLISTIC = new Set(['mortar-shell', 'enemy-mortar', 'bomblet', 'boss-shell']);

export function updateProjectiles(c: SimContext): void {
  const dt = c.dt;
  const p = c.state.player;
  for (const pr of c.state.projectiles) {
    if (!pr.alive) continue;
    pr.age += dt;
    const ballistic = BALLISTIC.has(pr.kind);
    if (ballistic) pr.vy -= GRAVITY * dt;
    pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;

    if (ballistic) {
      if (pr.y <= 0) { impact(c, pr); }
      continue;
    }
    if (pr.team === 'player') {
      for (const t of c.targetsNear(pr.x, pr.z, pr.radius, scratch)) {
        if (pr.hits.includes(t.id)) continue;
        pr.hits.push(t.id);
        c.damageTarget(t, pr.damage, { weapon: pr.weapon, crit: pr.crit, knockback: pr.kind === 'heavy-shot' ? 6 : 0, fromX: pr.x - pr.vx, fromZ: pr.z - pr.vz,
          status: pr.kind === 'chain-shot' ? { kind: 'slowed', time: 2, magnitude: 0.4 } : undefined });
        c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: pr.y, z: pr.z, target: 'ship', targetId: t.id, damage: pr.damage, crit: pr.crit });
        if (pr.area > 0) splash(c, pr);
        if (pr.pierce-- <= 0) { pr.alive = false; break; }
      }
    } else if (p.alive) {
      const dx = p.x - pr.x, dz = p.z - pr.z;
      const r = p.radius + pr.radius;
      if (dx * dx + dz * dz <= r * r) {
        c.damagePlayer(pr.damage, { x: pr.x, z: pr.z, kind: 'projectile' });
        c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: pr.y, z: pr.z, target: 'ship', targetId: 0, damage: pr.damage, crit: false });
        pr.alive = false;
      }
    }
    if (!pr.alive) continue;
    if (pr.age >= pr.ttl) {
      c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: 0, z: pr.z, target: 'water', damage: 0, crit: false });
      pr.alive = false;
    } else if (!c.world.isWater(pr.x, pr.z, 0)) {
      c.emit({ type: 'projectile-hit', projectile: pr.kind, team: pr.team, x: pr.x, y: pr.y, z: pr.z, target: 'island', damage: 0, crit: false });
      pr.alive = false;
    }
  }
}

function impact(c: SimContext, pr: ProjectileState): void {
  pr.alive = false;
  const radius = Math.max(pr.area, 6);
  c.emit({ type: 'explosion', x: pr.x, z: pr.z, radius, kind: 'mortar', team: pr.team });
  if (pr.team === 'player') splash(c, pr);
  else {
    const p = c.state.player;
    if (Math.hypot(p.x - pr.x, p.z - pr.z) <= radius + p.radius * 0.5) c.damagePlayer(pr.damage, { x: pr.x, z: pr.z, kind: 'projectile' });
  }
}

function splash(c: SimContext, pr: ProjectileState): void {
  for (const t of c.targetsNear(pr.x, pr.z, pr.area, scratch)) {
    c.damageTarget(t, pr.damage * 0.6, { weapon: pr.weapon, crit: pr.crit, knockback: 4, fromX: pr.x, fromZ: pr.z });
  }
}
