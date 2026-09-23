/**
 * Boss behaviours (META-owned). Skeleton: approach, circle and fire broadsides; phase changes by HP.
 * TODO(META): full kits from docs/overhaul-v2/DESIGN.md §4 (telegraphs, summons, submerge/lunge, judgment line).
 */
import type { SimContext } from './context';

export function updateBosses(c: SimContext): void {
  const p = c.state.player;
  const dt = c.dt;
  for (const b of c.state.bosses) {
    b.hitFlash = Math.max(0, b.hitFlash - dt * 4);
    if (b.life !== 'alive') continue;
    const def = c.content.bosses[b.defId];
    const nextPhase = def.phases.findIndex((ph, i) => i > b.phase && b.hp / b.maxHp <= ph.hpFraction);
    if (nextPhase > b.phase) { b.phase = nextPhase; c.emit({ type: 'boss-phase', boss: b.defId, id: b.id, phase: b.phase }); }
    const dx = p.x - b.x, dz = p.z - b.z, dist = Math.hypot(dx, dz) || 1;
    const desired = Math.atan2(-dx, -dz) + (dist < 160 ? Math.PI / 2 : 0);
    let diff = desired - b.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    b.yawRate = Math.max(-def.turnRate, Math.min(def.turnRate, diff));
    b.heading += b.yawRate * dt;
    b.speed += (def.speed - b.speed) * Math.min(1, dt);
    b.vx = -Math.sin(b.heading) * b.speed; b.vz = -Math.cos(b.heading) * b.speed;
    b.x += b.vx * dt; b.z += b.vz * dt;
    b.attackTime += dt;
    if (b.attackTime > 3 && dist < 220) {
      b.attackTime = 0; b.attack = 'broadside-volley';
      for (let i = 0; i < 10; i++) {
        const ang = Math.atan2(dx, dz) + (c.random() - 0.5) * 0.4;
        c.spawnProjectile({ kind: 'boss-shell', team: 'enemy', x: b.x, y: 4, z: b.z, vx: Math.sin(ang) * 70, vy: 11, vz: Math.cos(ang) * 70, damage: 12, area: 10, ttl: 4 });
      }
      c.emit({ type: 'boss-attack', boss: b.defId, id: b.id, attack: b.attack, x: b.x, z: b.z });
    }
  }
}
