/** Ship ↔ island and ship ↔ ship contacts (CORE-owned skeleton). */
import { ramMul } from './stats';
import type { SimContext, Target } from './context';

const scratch: Target[] = [];

export function resolveCollisions(c: SimContext): void {
  const p = c.state.player;
  if (p.alive) {
    // Islands push the player out and bleed speed.
    const hit = c.world.collideCircle(p.x, p.z, p.radius);
    if (hit.hit) {
      p.x += hit.nx * hit.depth; p.z += hit.nz * hit.depth;
      const vn = p.vx * hit.nx + p.vz * hit.nz;
      if (vn < 0) { p.vx -= vn * hit.nx * 1.4; p.vz -= vn * hit.nz * 1.4; }
      p.speed *= 0.9;
      if (Math.abs(vn) > 4) c.emit({ type: 'collision', a: 0, b: 'island', x: p.x - hit.nx * p.radius, z: p.z - hit.nz * p.radius, impulse: Math.abs(vn) });
    }
    // Ship contacts: contact damage to the player, ram damage to the enemy.
    for (const t of c.targetsNear(p.x, p.z, p.radius, scratch)) {
      const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1;
      const overlap = p.radius + t.radius - d;
      if (overlap <= 0) continue;
      const nx = dx / d, nz = dz / d;
      const isBoss = 'phase' in t;
      const def = isBoss ? c.content.bosses[t.defId as keyof typeof c.content.bosses] : c.content.enemies[t.defId as keyof typeof c.content.enemies];
      const massP = c.content.ships[p.shipId].mass, massT = def.mass;
      const share = massT / (massP + massT);
      p.x -= nx * overlap * share; p.z -= nz * overlap * share;
      if (!isBoss) { t.x += nx * overlap * (1 - share); t.z += nz * overlap * (1 - share); }
      const closing = (p.vx - t.vx) * nx + (p.vz - t.vz) * nz;
      if (t.ai.contactCd === undefined || t.ai.contactCd <= 0) {
        t.ai.contactCd = 0.6;
        const ram = Math.max(0, closing) * massP * 0.004 * ramMul(p.stats);
        if (ram > 1) { c.damageTarget(t, ram, { knockback: 6, fromX: p.x, fromZ: p.z }); c.emit({ type: 'ram', attacker: 0, target: t.id, damage: ram, x: p.x + nx * p.radius, z: p.z + nz * p.radius }); }
        if (def.contactDamage > 0) c.damagePlayer(def.contactDamage, { x: t.x, z: t.z, source: t.id, kind: 'contact' });
      }
    }
  }
  // Enemies avoid islands (push out).
  for (const e of c.state.enemies) {
    if (e.life !== 'alive') continue;
    if (e.ai.contactCd !== undefined && e.ai.contactCd > 0) e.ai.contactCd -= c.dt;
    const hit = c.world.collideCircle(e.x, e.z, e.radius);
    if (hit.hit) { e.x += hit.nx * hit.depth; e.z += hit.nz * hit.depth; }
  }
}
