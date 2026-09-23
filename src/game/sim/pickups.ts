/** Treasure magnet + collection (CORE-owned skeleton). Collection effects are META's (progression.onPickupCollected). */
import { pickupMul } from './stats';
import { onPickupCollected } from './progression';
import type { SimContext } from './context';

export function updatePickups(c: SimContext): void {
  const p = c.state.player;
  if (!p.alive) return;
  const ship = c.content.ships[p.shipId];
  const radius = ship.pickupRadius * pickupMul(p.stats);
  for (const k of c.state.pickups) {
    if (!k.alive) continue;
    k.age += c.dt;
    const dx = p.x - k.x, dz = p.z - k.z, d = Math.hypot(dx, dz);
    if (d < radius) k.magnet = true;
    if (k.magnet) {
      const speed = 40 + Math.max(0, 140 - d) * 1.2 + k.age * 4;
      const step = Math.min(d, speed * c.dt);
      k.x += (dx / (d || 1)) * step; k.z += (dz / (d || 1)) * step;
    }
    if (d < p.radius + 2) {
      k.alive = false;
      c.emit({ type: 'pickup-collected', id: k.id, kind: k.kind, x: k.x, z: k.z, value: k.value });
      onPickupCollected(c, k);
    }
    if (!k.magnet && k.age > 90 && k.kind.startsWith('xp')) k.alive = false;
  }
}
