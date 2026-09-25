import type { PassiveId } from '../ids';
import type { PassiveDef } from '../types';
import { num, pct } from './text';

const icon = (id: PassiveId) => `/assets/icons/${id}.png`;

/**
 * Stat semantics (per rank): maxHp/speed/turn/damage/area/range/projectileSpeed/duration/pickupRadius/xpGain/
 * critDamage/ramDamage/doubloonGain are fractional bonuses (+0.1 = +10%); cooldown/skillCooldown are fractional
 * reductions; armor/regen (fraction of max HP per second)/amount/crit/luck/revives are additive.
 * Handling and boost (PACE round 1): accel (+thrust), fullSail (+top speed as the sails are set past half, full at
 * FULL SAIL), helm (+rudder and yaw response) and boostDuration are fractional bonuses; carve is the fraction of the
 * speed a hard turn costs that the keel keeps (cap 80%); boostCooldown is a fractional reduction of the boost
 * recharge (cap 60%, on top of skillCooldown); surge is Momentum's cap (see MOMENTUM); boostCharges is additive
 * (whole charges count, like `amount`).
 * Card texts are generated from `perRank` (src/game/sim/meta-cards.ts); `description` is the one-line pitch.
 */

/** Momentum: each sinking adds `perKill` speed up to the `surge` stat; the surge holds `hold` s, then drains per second. */
export const MOMENTUM = { perKill: 0.02, hold: 2, drain: 0.08 } as const;
export const PASSIVES: Readonly<Record<PassiveId, PassiveDef>> = {
  'ironwood-hull': { id: 'ironwood-hull', name: 'Ironwood Hull', icon: icon('ironwood-hull'), maxRank: 5, description: 'Planks of ironwood: more hull and flat armour against every hit.', perRank: { maxHp: 0.12, armor: 1 } },
  'cloudsilk-sails': { id: 'cloudsilk-sails', name: 'Cloudsilk Sails', icon: icon('cloudsilk-sails'), maxRank: 5, description: 'Light sails that catch every breath of wind.', perRank: { speed: 0.08, turn: 0.06 } },
  'powder-monkeys': { id: 'powder-monkeys', name: 'Powder Monkeys', icon: icon('powder-monkeys'), maxRank: 5, description: 'Quick hands on the gun deck: every weapon reloads faster.', perRank: { cooldown: 0.07 } },
  'master-gunner': { id: 'master-gunner', name: 'Master Gunner', icon: icon('master-gunner'), maxRank: 5, description: 'A veteran gunner lays every shot true.', perRank: { damage: 0.1 } },
  'long-barrels': { id: 'long-barrels', name: 'Long Barrels', icon: icon('long-barrels'), maxRank: 5, description: 'Longer guns reach further and shoot faster.', perRank: { range: 0.1, projectileSpeed: 0.1 } },
  'salvage-nets': { id: 'salvage-nets', name: 'Salvage Nets', icon: icon('salvage-nets'), maxRank: 5, description: 'Wide nets haul in floating treasure from further away.', perRank: { pickupRadius: 0.25 } },
  'lucky-doubloon': { id: 'lucky-doubloon', name: 'Lucky Doubloon', icon: icon('lucky-doubloon'), maxRank: 5, description: 'Critical hits, rarer cards and a 4th card choice at 3 luck.', perRank: { crit: 0.06, luck: 1 } },
  // DIFFICULTY round 3: regen 0.002 → 0.0008 per rank (rank 5 mended 60% of the hull a minute, more than the fleet dealt).
  shipwright: { id: 'shipwright', name: 'Shipwright', icon: icon('shipwright'), maxRank: 5, description: 'A carpenter who patches the hull mid-battle.', perRank: { regen: 0.0008 } },
  'figurehead-fury': { id: 'figurehead-fury', name: 'Figurehead of Fury', icon: icon('figurehead-fury'), maxRank: 5, description: 'A snarling figurehead: harder criticals and bigger blasts.', perRank: { critDamage: 0.2, area: 0.08 } },
  'weather-eye': { id: 'weather-eye', name: 'Weather Eye', icon: icon('weather-eye'), maxRank: 5, description: 'A navigator who reads the sea: more experience from treasure.', perRank: { xpGain: 0.08 } },
  'drill-master': { id: 'drill-master', name: 'Drill Master', icon: icon('drill-master'), maxRank: 5, description: 'Drilled crews: brace, boost, special and full broadside recharge faster.', perRank: { skillCooldown: 0.12 } },
  'deep-stores': { id: 'deep-stores', name: 'Deep Stores', icon: icon('deep-stores'), maxRank: 5, description: 'Deeper magazines: +1 projectile for every 2 ranks and longer effects.', perRank: { amount: 0.5, duration: 0.08 } },
  // Round 1 (PACE): speed and handling.
  'clipper-rigging': {
    id: 'clipper-rigging', name: 'Clipper Rigging', icon: icon('clipper-rigging'), maxRank: 5,
    description: 'Tall racing rigging: quicker off the mark, and fastest of all under full sail.',
    perRank: { speed: 0.03, accel: 0.1, fullSail: 0.03 },
  },
  'racing-keel': {
    id: 'racing-keel', name: 'Racing Keel', icon: icon('racing-keel'), maxRank: 5,
    description: 'A deep, narrow keel that carves hard turns without scrubbing off speed.',
    perRank: { turn: 0.08, carve: 0.15 },
  },
  momentum: {
    id: 'momentum', name: 'Momentum', icon: icon('momentum'), maxRank: 5,
    description: `Every sinking fills the sails: +${pct(MOMENTUM.perKill)} speed per ship sunk, fading ${num(MOMENTUM.hold)} s after the last.`,
    perRank: { surge: 0.06 },
  },
  'trade-winds': {
    id: 'trade-winds', name: 'Trade Winds', icon: icon('trade-winds'), maxRank: 5,
    description: 'The wind always finds you: longer gusts that come round sooner.',
    perRank: { boostDuration: 0.15, boostCooldown: 0.08, boostCharges: 0.25 },
  },
};
