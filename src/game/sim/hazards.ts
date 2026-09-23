/** Hazards: fire patches, mines, whirlpools, shockwaves... (CORE-owned skeleton). */
import type { SimContext, Target } from './context';

const scratch: Target[] = [];

export function updateHazards(c: SimContext): void {
  const dt = c.dt;
  const p = c.state.player;
  for (const h of c.state.hazards) {
    if (!h.alive) continue;
    h.age += dt;
    h.x += h.vx * dt; h.z += h.vz * dt;
    if (h.age >= h.ttl) { h.alive = false; continue; }
    if (h.tick <= 0) continue;
    h.tickTimer -= dt;
    if (h.tickTimer > 0) continue;
    h.tickTimer = h.tick;
    if (h.team === 'player') {
      for (const t of c.targetsNear(h.x, h.z, h.radius, scratch)) c.damageTarget(t, h.damage, { weapon: h.weapon });
    } else if (p.alive && Math.hypot(p.x - h.x, p.z - h.z) <= h.radius + p.radius * 0.5) {
      c.damagePlayer(h.damage, { x: h.x, z: h.z, kind: 'hazard' });
    }
  }
}
