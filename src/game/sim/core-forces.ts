/**
 * CORE forces applied to enemy ships after the AI moves them (CORE-owned):
 *  - stun: a stunned ship is held where it was before the AI step and cannot fire;
 *  - knockback: displacement impulses from DamageOpts.knockback / core.push, decaying over ~0.4 s;
 *  - harpoon tethers: hooked ships are hauled toward the player (or toward a Leviathan-hooked ship), and Tow Line
 *    ships smash into their neighbours;
 *  - burning: 'burning' status (magnitude = damage per second) ticks every BURN_TICK.
 * Status timers are decayed by their owners: ai.ts (enemies), bosses.ts (bosses), player.ts (player).
 */
import { WEAPON_IDS, type WeaponId } from '../ids';
import type { Target } from './context';
import {
  BURN_TICK, BURN_TIME, isBoss, KNOCK_DECAY, massFactor, statusOf, targetable, TETHERS, type CoreSim,
} from './core-runtime';

/** Records every enemy's position before the AI step (for the stun freeze). */
export function snapshotEnemies(c: CoreSim): void {
  const list = c.state.enemies;
  const core = c.core;
  if (list.length > core.snapX.length) {
    const size = Math.max(list.length, core.snapX.length * 2);
    core.snapX = new Float64Array(size); core.snapZ = new Float64Array(size); core.snapId = new Int32Array(size);
  }
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    core.snapX[i] = e.x; core.snapZ[i] = e.z; core.snapId[i] = e.id;
  }
  core.snapCount = list.length;
}

export function applyBurn(c: CoreSim, t: Target, dps: number, weapon: WeaponId | undefined): void {
  if (t.life !== 'alive' || !(dps > 0)) return;
  c.applyStatus(t, 'burning', BURN_TIME, dps);
  t.ai.coreBurnW = weapon ? WEAPON_IDS.indexOf(weapon) : -1;
}

export function applyShipForces(c: CoreSim): void {
  const s = c.state;
  const core = c.core;
  const dt = c.dt;
  const decay = Math.exp(-KNOCK_DECAY * dt);
  const enemies = s.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]!;
    if (e.life !== 'alive') continue;
    if (e.statuses.length > 0) {
      if (statusOf(e.statuses, 'stunned') && i < core.snapCount && core.snapId[i] === e.id) {
        e.x = core.snapX[i]!; e.z = core.snapZ[i]!;
        e.speed *= 0.85; e.vx *= 0.85; e.vz *= 0.85; e.yawRate = 0;
        if (e.attackCooldown < 0.2) e.attackCooldown = 0.2;
      }
      burn(c, e, dt);
    } else if (e.ai.coreBurnT) e.ai.coreBurnT = 0;
    const ai = e.ai;
    const kx = ai.coreKx ?? 0, kz = ai.coreKz ?? 0;
    if (kx !== 0 || kz !== 0) {
      e.x += kx * dt; e.z += kz * dt;
      if (Math.abs(kx) + Math.abs(kz) < 0.05) { ai.coreKx = 0; ai.coreKz = 0; } else { ai.coreKx = kx * decay; ai.coreKz = kz * decay; }
    }
  }
  const bosses = s.bosses;
  for (let i = 0; i < bosses.length; i++) {
    const b = bosses[i]!;
    if (b.life === 'alive' && b.statuses.length > 0) burn(c, b, dt);
  }
  updateTethers(c);
}

function burn(c: CoreSim, t: Target, dt: number): void {
  const st = statusOf(t.statuses, 'burning');
  const ai = t.ai;
  if (!st) { if (ai.coreBurnT) ai.coreBurnT = 0; return; }
  ai.coreBurnT = (ai.coreBurnT ?? 0) + dt;
  if (ai.coreBurnT < BURN_TICK) return;
  ai.coreBurnT -= BURN_TICK;
  const w = ai.coreBurnW ?? -1;
  c.hitTarget(t, st.magnitude * BURN_TICK, w >= 0 ? WEAPON_IDS[w] : undefined, false, 0, t.x, t.z, null, 0, 0, true);
}

function updateTethers(c: CoreSim): void {
  const core = c.core;
  const p = c.state.player;
  const dt = c.dt;
  for (let k = 0; k < TETHERS; k++) {
    const t = core.tTarget[k];
    if (!t) continue;
    core.tTime[k] = core.tTime[k]! - dt;
    if (!targetable(t) || core.tTime[k]! <= 0 || !p.alive) { core.tTarget[k] = null; core.tAnchor[k] = null; continue; }
    let a = core.tAnchor[k] ?? null;
    if (a && a.life !== 'alive') { a = null; core.tAnchor[k] = null; }
    if (isBoss(t)) continue; // bosses shrug off the line (still slowed)
    const ax = a ? a.x : p.x, az = a ? a.z : p.z;
    const minD = a ? a.radius + t.radius + 2 : p.beam * 0.5 + t.radius + 8;
    const dx = ax - t.x, dz = az - t.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d <= minD || d < 1e-3) continue;
    const step = Math.min(d - minD, core.tPull[k]! * massFactor(c, t) * dt);
    t.x += (dx / d) * step; t.z += (dz / d) * step;
    if (core.tTow[k] && step > dt * 3) smash(c, t, a, k, step / dt);
  }
}

/** Tow Line: a hauled ship slams into whatever it is dragged through. */
function smash(c: CoreSim, t: Target, anchor: Target | null, k: number, speed: number): void {
  const core = c.core;
  const s = c.state;
  const buf = core.bufT;
  const n = core.near(s, t.x, t.z, t.radius + 3, buf);
  for (let j = 0; j < n; j++) {
    const o = buf[j]!;
    if (o === t || o === anchor || !targetable(o)) continue;
    const dx = o.x - t.x, dz = o.z - t.z, rr = o.radius + t.radius + 1.5;
    if (dx * dx + dz * dz > rr * rr) continue;
    if ((o.ai.coreSmash ?? 0) > s.time) continue;
    o.ai.coreSmash = s.time + 0.6;
    const dmg = core.tSmash[k]!;
    const x = (o.x + t.x) * 0.5, z = (o.z + t.z) * 0.5;
    const dealt = c.hitTarget(o, dmg, 'harpoon', false, 8, t.x, t.z, 'stunned', 0.4, 1, false);
    c.hitTarget(t, dmg * 0.5, 'harpoon', false, 0, o.x, o.z, null, 0, 0, false);
    c.emit({ type: 'collision', a: t.id, b: o.id, x, z, impulse: speed });
    c.emit({ type: 'ram', attacker: t.id, target: o.id, damage: dealt, x, z });
  }
}
