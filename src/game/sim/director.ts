/**
 * Spawn director (META-owned). Skeleton: time-based budget spawning on a ring, boss schedule with warnings.
 * TODO(META): enemy mix per minute and faction, elites, set-piece events, heat curve, despawn/recycle.
 */
import { DESPAWN_RADIUS, SOFT_ENEMY_CAP, SPAWN_RING_MAX, SPAWN_RING_MIN } from '../constants';
import type { EnemyId } from '../ids';
import type { SimContext } from './context';

export function updateDirector(c: SimContext): void {
  const s = c.state;
  const d = s.director;
  const sea = c.content.seas[s.seaId];
  const p = s.player;
  d.minute = s.time / 60;
  d.heat = sea.difficulty * (1 + s.time / 600);

  // Boss schedule.
  const next = sea.bosses[d.nextBossIndex];
  if (next) {
    if (!d.bossWarning && s.time >= next.at - 10) {
      d.bossWarning = next.boss; d.bossWarningTime = next.at;
      c.emit({ type: 'boss-warning', boss: next.boss, eta: 10 });
    }
    if (s.time >= next.at) {
      const a = c.random() * Math.PI * 2;
      c.spawnBoss(next.boss, p.x + Math.sin(a) * 320, p.z + Math.cos(a) * 320, a + Math.PI);
      d.nextBossIndex++; d.bossWarning = null;
    }
  }

  // Budget spawning.
  d.budget += c.dt * (0.8 + d.minute * 0.55) * sea.difficulty;
  const alive = s.enemies.length;
  let guard = 0;
  while (d.budget >= 1 && alive + guard < SOFT_ENEMY_CAP && guard < 6) {
    const pool = (Object.keys(c.content.enemies) as EnemyId[]).filter((id) => {
      const def = c.content.enemies[id];
      return def.firstMinute <= d.minute && sea.enemyFactions.includes(def.faction) && def.behavior !== 'stationary';
    });
    const id = pool[Math.floor(c.random() * pool.length)] ?? 'skiff';
    const cost = Math.max(1, c.content.enemies[id].xp);
    if (d.budget < cost) break;
    d.budget -= cost;
    const a = c.random() * Math.PI * 2;
    const r = SPAWN_RING_MIN + c.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);
    const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
    if (!c.world.isWater(x, z, 20)) { guard++; continue; }
    c.spawnEnemy(id, x, z, { elite: c.random() < 0.015 + d.minute * 0.004 });
    guard++;
  }

  // Recycle stragglers left far behind.
  for (const e of s.enemies) {
    if (e.life !== 'alive') continue;
    if (Math.hypot(e.x - p.x, e.z - p.z) > DESPAWN_RADIUS) {
      const a = c.random() * Math.PI * 2;
      e.x = p.x + Math.sin(a) * SPAWN_RING_MAX; e.z = p.z + Math.cos(a) * SPAWN_RING_MAX;
    }
  }
}
