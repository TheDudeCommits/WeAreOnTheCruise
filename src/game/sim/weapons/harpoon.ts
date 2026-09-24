/**
 * Harpoon Gun (CORE-owned): spears the nearest ships, deals damage, hooks + slows them (level `duration`) and hauls
 * them toward the ship on a tether (`pull` 14 m/s, mass-scaled). Emits 'harpoon' events for the line FX.
 *  - A Chain Harpoon: after a hit the harpoon flies on to the next ship within `chainRange` (70 m), up to
 *    `chainTargets` (3) ships, each hooked.
 *  - B Tow Line: stronger haul (×1.4); hauled ships smash into neighbours (×`smashDamage` 0.8, stun, 'ram' events).
 *  - ★ Leviathan Hook: every `giantCooldown` (3.8 s) a giant hook hits the densest cluster and drags every ship within
 *    `giantRadius` (45 m) together into the struck ship (tow-line smashes), which is hauled to you.
 */
import type { ProjectileState, WeaponSlot } from '../../types';
import type { Target } from '../context';
import { isBoss, PF_CHAIN, PF_GIANT, PF_HOOK, PF_TOW, targetable, type CoreSim } from '../core-runtime';
import { areaMul, cooldownMul } from '../stats';
import { AIM, crit, CRIT, densest, E, eff, ex, lead, levelOf, resetChosen, selectNearest } from './common';

export function updateHarpoon(c: CoreSim, slot: WeaponSlot, rate: number): void {
  const p = c.state.player;
  const core = c.core;
  const l = levelOf(c, slot);
  eff(c, l, 0, 110, 2);
  const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
  const bowX = p.x + fx * p.length * 0.45, bowZ = p.z + fz * p.length * 0.45;
  const tow = slot.branch === 'B';
  const pull = ex(l, 'pull', 14) * (tow ? 1.4 : 1);
  const smash = E.damage * ex(l, 'smashDamage', 0.8);

  if (slot.overdrive) {
    slot.scratch.giant = (slot.scratch.giant ?? 1.5) - c.dt * rate;
    if (slot.scratch.giant <= 0) {
      const buf = core.bufW2;
      const n = core.near(c.state, p.x, p.z, E.range, buf);
      resetChosen();
      const i = n > 0 ? densest(buf, n, ex(l, 'giantRadius', 45), 0) : -1;
      if (i < 0) slot.scratch.giant = 0.3;
      else {
        const t = buf[i]!;
        const idx = launch(c, bowX, bowZ, t, E.speed * 0.9, E.damage * ex(l, 'giantDamage', 2), 3.2, E.range * 1.2);
        if (idx >= 0) {
          core.pFlags[idx] = PF_HOOK | PF_GIANT | PF_TOW;
          core.pA[idx] = E.duration * 1.3; core.pB[idx] = pull; core.pC[idx] = ex(l, 'giantRadius', 45) * areaMul(p.stats); core.pD[idx] = smash * 1.5;
        }
        slot.scratch.giant = ex(l, 'giantCooldown', 3.8) * cooldownMul(p.stats);
      }
    }
  }

  if (slot.cooldown > 0) return;
  const n = selectNearest(c, bowX, bowZ, E.range, Math.min(8, E.count + 2), core.bufW);
  if (n === 0) return;
  // Prefer ships that are not already on a line.
  let fired = 0, dirX = fx, dirZ = fz;
  for (let k = 0; k < n && fired < E.count; k++) {
    const t = core.sel[k]!;
    if (n > E.count && hookedAlready(c, t)) continue;
    const idx = launch(c, bowX, bowZ, t, E.speed, E.damage, 1.6, E.range * 1.15);
    if (idx < 0) continue;
    core.pFlags[idx] = PF_HOOK | (tow ? PF_TOW : 0) | (slot.branch === 'A' ? PF_CHAIN : 0);
    core.pA[idx] = E.duration; core.pB[idx] = pull; core.pC[idx] = slot.branch === 'A' ? ex(l, 'chainTargets', 3) - 1 : 0; core.pD[idx] = smash;
    if (fired === 0) { const pr = c.state.projectiles[idx]!; const s = Math.hypot(pr.vx, pr.vz) || 1; dirX = pr.vx / s; dirZ = pr.vz / s; }
    fired++;
  }
  if (fired === 0) return;
  c.emit({ type: 'weapon-fired', weapon: 'harpoon', owner: 0, x: bowX, z: bowZ, dirX, dirZ, side: 'bow', count: fired });
  slot.cooldown = E.cooldown;
}

function hookedAlready(c: CoreSim, t: Target): boolean {
  const st = t.statuses;
  for (let i = 0; i < st.length; i++) if (st[i]!.kind === 'hooked' && st[i]!.time > 0) return true;
  return c.core.tTarget.includes(t);
}

function launch(c: CoreSim, x: number, z: number, t: Target, speed: number, damage: number, radius: number, range: number): number {
  const core = c.core;
  lead(x, z, t, speed);
  let dx = AIM.x - x, dz = AIM.z - z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  dx /= d; dz /= d;
  const cm = crit(c);
  const idx = c.shoot('harpoon', 'player', x, 3.5, z, dx * speed, 0, dz * speed, damage * cm, radius, 0, range / speed + 0.4, 'harpoon', CRIT.on, 0);
  if (idx < 0) return idx;
  core.pTurn[idx] = 2.5;
  core.pTarget[idx] = t;
  core.pFrom[idx] = 0;
  core.pKnock[idx] = 0;
  c.state.projectiles[idx]!.target = t.id;
  return idx;
}

/** Point a harpoon line starts from: the player's bow (ref 0) or a previously hooked ship. */
function lineFrom(c: CoreSim, ref: number): { x: number; z: number } {
  const p = c.state.player;
  if (ref !== 0) { const t = c.core.byId.get(ref); if (t) { FROM.x = t.x; FROM.z = t.z; return FROM; } }
  FROM.x = p.x - Math.sin(p.heading) * p.length * 0.45; FROM.z = p.z - Math.cos(p.heading) * p.length * 0.45;
  return FROM;
}
const FROM = { x: 0, z: 0 };

/**
 * Called by the projectile system when a hooking projectile strikes `t` (damage already applied).
 * Returns true if the projectile flies on (chain harpoon), false if it is spent.
 */
export function onHarpoonHit(c: CoreSim, pr: ProjectileState, i: number, t: Target): boolean {
  const core = c.core;
  const flags = core.pFlags[i]!;
  const time = core.pA[i]!, pull = core.pB[i]!, smash = core.pD[i]!;
  const from = lineFrom(c, core.pFrom[i]!);
  c.emit({ type: 'harpoon', from: core.pFrom[i]!, to: t.id, x1: from.x, z1: from.z, x2: t.x, z2: t.z });
  hook(c, t, null, time, pull, smash, (flags & PF_TOW) !== 0);

  if (flags & PF_GIANT) {
    const radius = core.pC[i]!;
    const buf = core.bufW2;
    const n = core.near(c.state, t.x, t.z, radius, buf);
    let lines = 0;
    for (let k = 0; k < n; k++) {
      const o = buf[k]!;
      if (o === t || !targetable(o)) continue;
      hook(c, o, t, time, pull * 1.2, smash, true);
      if (lines++ < 8) c.emit({ type: 'harpoon', from: t.id, to: o.id, x1: t.x, z1: t.z, x2: o.x, z2: o.z });
    }
    return false;
  }

  if ((flags & PF_CHAIN) && core.pC[i]! > 0) {
    const next = nextChainTarget(c, pr, t, 70);
    if (next) {
      core.pC[i] = core.pC[i]! - 1;
      core.pFrom[i] = t.id;
      core.pTarget[i] = next;
      pr.target = next.id;
      pr.hits.push(t.id);
      const dx = next.x - pr.x, dz = next.z - pr.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
      const speed = Math.max(80, Math.hypot(pr.vx, pr.vz));
      pr.vx = (dx / d) * speed; pr.vz = (dz / d) * speed;
      pr.ttl = pr.age + d / speed + 0.6;
      return true;
    }
  }
  return false;
}

function nextChainTarget(c: CoreSim, pr: ProjectileState, from: Target, range: number): Target | null {
  const buf = c.core.bufW2;
  const n = c.core.near(c.state, from.x, from.z, range, buf);
  let best: Target | null = null, bestD = Infinity;
  for (let k = 0; k < n; k++) {
    const o = buf[k]!;
    if (o === from || !targetable(o) || pr.hits.includes(o.id)) continue;
    const dx = o.x - from.x, dz = o.z - from.z, d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function hook(c: CoreSim, t: Target, anchor: Target | null, time: number, pull: number, smash: number, tow: boolean): void {
  if (t.life !== 'alive') return;
  if (!isBoss(t)) c.applyStatus(t, 'hooked', time, 1);
  c.applyStatus(t, 'slowed', time, isBoss(t) ? 0.25 : 0.5);
  c.core.tether(t, anchor, time, pull, smash, tow);
}
