/**
 * Storm Rod (CORE-owned): chain lightning from the mast to the nearest ship, jumping to the nearest unstruck ship
 * within `jumpRange` (75 m) — `count` strikes in total, ×`falloff` (0.92) per jump. Emits 'lightning' with the
 * bolt's points (mast first).
 *  - A Forked: +`forkJumps` (2) jumps, and a second chain forks from the first target.
 *  - B Thunderclap: the first strike also blasts everything within `clapRadius` (32 m, ×area) for ×`clapDamage` 0.6
 *    and stuns for `stun` (1.2 s).
 *  - ★ Thunderhead: a storm cloud follows the ship and strikes a random ship within `cloudRadius` (110 m) every
 *    `cloudInterval` (0.6 s) for ×`cloudDamage` 1.2.
 */
import type { Vec2, WeaponLevelDef, WeaponSlot } from '../../types';
import type { Target } from '../context';
import { HF_FOLLOW, targetable, type CoreSim } from '../core-runtime';
import { areaMul, cooldownMul } from '../stats';
import { crit, CRIT, E, eff, ex, levelOf } from './common';

const HIT = new Int32Array(64);
let hitCount = 0;
const wasHit = (id: number): boolean => { for (let i = 0; i < hitCount; i++) if (HIT[i] === id) return true; return false; };
const markHit = (id: number): void => { if (hitCount < HIT.length) HIT[hitCount++] = id; };

export function updateStormRod(c: CoreSim, slot: WeaponSlot): void {
  const p = c.state.player;
  const core = c.core;
  const l = levelOf(c, slot);
  eff(c, l, 0, 0, 0);
  if (slot.overdrive) ensureCloud(c, slot, l);
  if (slot.cooldown > 0) return;
  const first = core.nearest(c.state, p.x, p.z, E.range, core.bufW);
  if (!first) return;
  const forked = slot.branch === 'A';
  const jumps = E.count + (forked ? ex(l, 'forkJumps', 2) : 0);
  const jumpRange = ex(l, 'jumpRange', 75) * Math.sqrt(areaMul(p.stats));
  const falloff = ex(l, 'falloff', 0.92);
  const cm = crit(c);
  const critOn = CRIT.on;
  const damage = E.damage * cm;
  hitCount = 0;
  const points: Vec2[] = [{ x: p.x, z: p.z }];
  chain(c, first, jumps, jumpRange, damage, critOn, falloff, points);
  c.emit({ type: 'lightning', points, team: 'player' });
  c.emit({ type: 'explosion', x: first.x, z: first.z, radius: 6, kind: 'lightning', team: 'player' });
  if (slot.branch === 'B') {
    const clap = ex(l, 'clapRadius', 32) * areaMul(p.stats);
    const buf = core.bufW;
    const n = core.near(c.state, first.x, first.z, clap, buf);
    for (let i = 0; i < n; i++) {
      const t = buf[i]!;
      if (!targetable(t)) continue;
      c.hitTarget(t, damage * ex(l, 'clapDamage', 0.6), 'storm-rod', critOn, 3, first.x, first.z, 'stunned', ex(l, 'stun', 1.2), 1, false);
    }
    c.emit({ type: 'explosion', x: first.x, z: first.z, radius: clap, kind: 'lightning', team: 'player' });
  }
  if (forked) {
    const next = nearestUnhit(c, first.x, first.z, jumpRange, first);
    if (next) {
      const fork: Vec2[] = [{ x: first.x, z: first.z }];
      chain(c, next, Math.max(1, jumps - 1), jumpRange, damage * falloff, critOn, falloff, fork);
      c.emit({ type: 'lightning', points: fork, team: 'player' });
    }
  }
  const dx = first.x - p.x, dz = first.z - p.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
  c.emit({ type: 'weapon-fired', weapon: 'storm-rod', owner: 0, x: p.x, z: p.z, dirX: dx / d, dirZ: dz / d, count: hitCount });
  slot.cooldown = E.cooldown;
}

function chain(c: CoreSim, start: Target, jumps: number, range: number, damage: number, critOn: boolean, falloff: number, points: Vec2[]): void {
  let cur: Target | null = start;
  let dmg = damage;
  for (let k = 0; cur && k < jumps; k++) {
    markHit(cur.id);
    points.push({ x: cur.x, z: cur.z });
    c.hitTarget(cur, dmg, 'storm-rod', critOn, 0, cur.x, cur.z, null, 0, 0, false);
    dmg *= falloff;
    cur = nearestUnhit(c, cur.x, cur.z, range, cur);
  }
}

function nearestUnhit(c: CoreSim, x: number, z: number, range: number, from: Target): Target | null {
  const buf = c.core.bufW2;
  const n = c.core.near(c.state, x, z, range, buf);
  let best: Target | null = null, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const t = buf[i]!;
    if (t === from || !targetable(t) || wasHit(t.id)) continue;
    const dx = t.x - x, dz = t.z - z, d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** ★ Thunderhead: keeps one storm cloud alive over the ship and refreshes its stats from the current level. */
function ensureCloud(c: CoreSim, slot: WeaponSlot, l: WeaponLevelDef): void {
  const p = c.state.player;
  const list = c.state.hazards;
  const idx = slot.scratch.cloudIdx ?? -1;
  let h = idx >= 0 ? list[idx] : undefined;
  if (!h || !h.alive || h.id !== slot.scratch.cloudId || h.kind !== 'storm-cloud') {
    const ni = c.placeHazard('storm-cloud', 'player', p.x, p.z, 110, 1e9, 0, 0.7, 0, 0, 'storm-rod', true);
    if (ni < 0) return;
    h = list[ni]!;
    slot.scratch.cloudIdx = ni; slot.scratch.cloudId = h.id;
    c.core.hFlags[ni] = HF_FOLLOW;
    c.core.hTimer[ni] = 0.5;
  }
  h.radius = ex(l, 'cloudRadius', 110) * areaMul(p.stats);
  h.damage = E.damage * ex(l, 'cloudDamage', 1.2);
  h.tick = ex(l, 'cloudInterval', 0.6) * cooldownMul(p.stats);
}
