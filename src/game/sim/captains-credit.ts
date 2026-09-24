/**
 * Damage dealt BY AI captains (CAPTAINS-owned). Captain shots are ordinary team-'player' projectiles tagged with the
 * captain's ship ref in CORE's `pFrom` slot; projectiles.ts routes their hits here instead of straight to
 * Sim.hitTarget. The same damage rules apply (armour, knockback, death → onEnemyKilled, so treasure spills where the
 * ship sinks and the player can scoop it), but the credit is the captain's: the player's damage stats, ultimate
 * charge, kill count, kills-by-weapon and bounty are left exactly as they were. Boss kills stay the player's too (the
 * achievement and victory flow), and the captain is credited alongside.
 *
 * Contract wish: Sim.hitTarget taking an attacker ShipRef would make the snapshot/restore below unnecessary.
 */
import { CAPTAIN } from '../content/captains';
import { BOUNTY } from '../content/rewards';
import type { CaptainState } from '../types';
import type { Target } from './context';
import { captainById } from './captains-runtime';
import { isBoss, targetable, type CoreSim, type ExplosionKind } from './core-runtime';

/** Damage from captain `id` to an enemy or boss. Returns the damage dealt. */
export function captainHit(c: CoreSim, id: number, t: Target, amount: number, crit: boolean, knock: number, fromX: number, fromZ: number): number {
  if (t.life !== 'alive' || !(amount > 0)) return 0;
  const s = c.state, st = s.stats, ult = s.player.skills.ultimate;
  const boss = isBoss(t);
  const kills = st.kills, elites = st.eliteKills, bounty = st.bounty, dealt0 = st.damageDealt;
  const w = boss ? undefined : t.lastHitBy;
  const wKills = w ? st.killsByWeapon[w] : undefined;
  // The player's ultimate charges from the player's own damage only (hitTarget skips charging while it is active).
  const ultActive = ult.active;
  ult.active = 1;
  // Id watermark: treasure spilled by this kill gets ids above it (only needed when the hit can sink the ship).
  const mark = !boss && amount >= t.hp ? c.nextId() : 0;
  // Flag the hit as a captain's for the kill handler: the player's Momentum surge feeds on the player's sinkings only.
  const sc = s.director.scratch;
  sc.captainCredit = 1;
  const dealt = c.hitTarget(t, boss ? amount * CAPTAIN.bossDamageMul : amount, undefined, crit, knock, fromX, fromZ, null, 0, 0, false);
  sc.captainCredit = 0;
  ult.active = ultActive;
  st.damageDealt = dealt0;
  const k = captainById(s.captains, id);
  if (k) k.ai.dealt = (k.ai.dealt ?? 0) + dealt;
  if (t.life !== 'alive') {
    if (!boss) {
      st.kills = kills; st.eliteKills = elites; st.bounty = bounty;
      if (w) { if (wKills === undefined) delete st.killsByWeapon[w]; else st.killsByWeapon[w] = wKills; }
      if (mark > 0) salvage(c, mark);
    }
    if (k) creditKill(c, k, t);
  }
  return dealt;
}

/** Scales the XP coins a captain's kill just spilled (ids above `mark`) to CAPTAIN.salvageXp of their value. */
function salvage(c: CoreSim, mark: number): void {
  const list = c.state.pickups;
  for (let i = 0; i < list.length; i++) {
    const k = list[i]!;
    if (!k.alive || k.id <= mark || (k.kind !== 'xp-copper' && k.kind !== 'xp-silver' && k.kind !== 'xp-gold')) continue;
    k.value *= CAPTAIN.salvageXp;
    k.kind = k.value >= 25 ? 'xp-gold' : k.value >= 5 ? 'xp-silver' : 'xp-copper';
  }
}

function creditKill(c: CoreSim, k: CaptainState, t: Target): void {
  const heat = c.state.director.heat;
  k.kills++;
  if (isBoss(t)) k.bounty += Math.round(BOUNTY.boss * heat * 0.25);
  else k.bounty += Math.round(c.content.enemies[t.defId].xp * BOUNTY.perXp * heat * (t.elite ? BOUNTY.eliteMul : 1));
  c.emit({ type: 'captain-kill', id: k.id, name: k.name, victim: t.defId, x: t.x, z: t.z });
}

/** A captain's shell bursting at (x, z): falloff like CORE's explode (100% at the centre → 50% at the rim). */
export function captainBlast(c: CoreSim, id: number, x: number, z: number, radius: number, damage: number, crit: boolean, knock: number, kind: ExplosionKind): void {
  c.emit({ type: 'explosion', x, z, radius, kind, team: 'player' });
  const buf = c.core.bufE;
  const n = c.core.near(c.state, x, z, radius, buf);
  for (let i = 0; i < n; i++) {
    const t = buf[i]!;
    if (!targetable(t)) continue;
    const dx = t.x - x, dz = t.z - z;
    const edge = Math.max(0, Math.sqrt(dx * dx + dz * dz) - t.radius);
    captainHit(c, id, t, damage * (1 - 0.5 * Math.min(1, edge / Math.max(1, radius))), crit, knock, x, z);
  }
}
