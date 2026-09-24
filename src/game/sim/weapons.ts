/**
 * Player weapon behaviours (CORE-owned): entry point. Each weapon lives in ./weapons/<id>.ts and reads its numbers
 * from content.weapons levels (plus optional `extra` keys documented at the top of each file).
 *
 * Rate: the 'frenzy' status (Chef's Banquet) multiplies reload speed by its magnitude. Weapons are silent while the
 * hull is submerged (Deep Dive) or stunned; the escort skiffs keep sailing on their own.
 */
import type { WeaponId } from '../ids';
import type { WeaponSlot } from '../types';
import { statusOf, type CoreSim } from './core-runtime';
import { FULL_BROADSIDE_COOLDOWN } from './player';
import { skillCooldownMul } from './stats';
import { fireFullBroadside, updateBroadside, updateGunQueue, updateUltBroadsides } from './weapons/broadside';
import { updateBowChaser } from './weapons/bow-chaser';
import { updateEscortSkiffs } from './weapons/escort-skiffs';
import { updateFireBarrels } from './weapons/fire-barrels';
import { updateHarpoon } from './weapons/harpoon';
import { updateIronRam } from './weapons/iron-ram';
import { updateMaelstrom } from './weapons/maelstrom-charm';
import { updateRocketRack } from './weapons/rocket-rack';
import { updateSternMortar } from './weapons/stern-mortar';
import { updateStormRod } from './weapons/storm-rod';
import { updateSwivelGuns } from './weapons/swivel-guns';
import { updateTideMines } from './weapons/tide-mines';

type WeaponBehavior = (c: CoreSim, slot: WeaponSlot, rate: number) => void;

const BEHAVIORS: Readonly<Record<WeaponId, WeaponBehavior>> = {
  broadside: updateBroadside,
  'bow-chaser': updateBowChaser,
  'stern-mortar': updateSternMortar,
  'swivel-guns': updateSwivelGuns,
  'fire-barrels': updateFireBarrels,
  harpoon: updateHarpoon,
  'rocket-rack': updateRocketRack,
  'storm-rod': updateStormRod,
  'tide-mines': updateTideMines,
  'iron-ram': updateIronRam,
  'escort-skiffs': updateEscortSkiffs,
  'maelstrom-charm': updateMaelstrom,
};

export function updateWeapons(c: CoreSim): void {
  const p = c.state.player;
  if (!p.alive) { c.core.gunCount = 0; return; }
  const dt = c.dt;
  const frenzy = statusOf(p.statuses, 'frenzy');
  const rate = frenzy ? Math.max(1, frenzy.magnitude) : 1;
  const silent = p.submerged > 0.5 || statusOf(p.statuses, 'stunned') !== null;
  const weapons = p.weapons;
  for (let i = 0; i < weapons.length; i++) {
    const slot = weapons[i]!;
    slot.cooldown -= dt * rate;
    if (silent && slot.id !== 'escort-skiffs') { if (slot.cooldown < 0) slot.cooldown = 0; continue; }
    BEHAVIORS[slot.id](c, slot, rate);
  }
  if (!silent) updateUltBroadsides(c, rate);
  updateGunQueue(c);

  // Manual Full Broadside (Q / LMB, repeats while held): the side facing the aim point, ×2 power.
  const sk = p.skills.broadside;
  if ((c.actions.has('broadside') || c.input.broadsideHeld) && sk.cooldown <= 0 && !silent) {
    fireFullBroadside(c);
    sk.cooldownMax = FULL_BROADSIDE_COOLDOWN * skillCooldownMul(p.stats);
    sk.cooldown = sk.cooldownMax;
    sk.active = 0.4;
    c.emit({ type: 'skill-used', slot: 'broadside', skill: 'broadside', x: p.x, z: p.z, aimX: p.aimX, aimZ: p.aimZ });
  }
}
