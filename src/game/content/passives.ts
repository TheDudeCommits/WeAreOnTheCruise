import type { PassiveId } from '../ids';
import type { PassiveDef } from '../types';

const icon = (id: PassiveId) => `/assets/icons/${id}.png`;

/**
 * Stat semantics (per rank): maxHp/speed/turn/damage/area/range/projectileSpeed/duration/pickupRadius/xpGain/
 * critDamage/ramDamage/doubloonGain are fractional bonuses (+0.1 = +10%); cooldown/skillCooldown are fractional
 * reductions; armor/regen (% max HP per second)/amount/crit/luck/revives are additive.
 */
export const PASSIVES: Readonly<Record<PassiveId, PassiveDef>> = {
  'ironwood-hull': { id: 'ironwood-hull', name: 'Ironwood Hull', icon: icon('ironwood-hull'), maxRank: 5, description: '+12% max hull and +1 armour per rank.', perRank: { maxHp: 0.12, armor: 1 } },
  'cloudsilk-sails': { id: 'cloudsilk-sails', name: 'Cloudsilk Sails', icon: icon('cloudsilk-sails'), maxRank: 5, description: '+8% speed and +6% turning per rank.', perRank: { speed: 0.08, turn: 0.06 } },
  'powder-monkeys': { id: 'powder-monkeys', name: 'Powder Monkeys', icon: icon('powder-monkeys'), maxRank: 5, description: '7% faster weapon reloads per rank.', perRank: { cooldown: 0.07 } },
  'master-gunner': { id: 'master-gunner', name: 'Master Gunner', icon: icon('master-gunner'), maxRank: 5, description: '+10% damage per rank.', perRank: { damage: 0.1 } },
  'long-barrels': { id: 'long-barrels', name: 'Long Barrels', icon: icon('long-barrels'), maxRank: 5, description: '+10% range and projectile speed per rank.', perRank: { range: 0.1, projectileSpeed: 0.1 } },
  'salvage-nets': { id: 'salvage-nets', name: 'Salvage Nets', icon: icon('salvage-nets'), maxRank: 5, description: '+25% treasure pickup radius per rank.', perRank: { pickupRadius: 0.25 } },
  'lucky-doubloon': { id: 'lucky-doubloon', name: 'Lucky Doubloon', icon: icon('lucky-doubloon'), maxRank: 5, description: '+6% critical chance and +1 luck per rank.', perRank: { crit: 0.06, luck: 1 } },
  shipwright: { id: 'shipwright', name: 'Shipwright', icon: icon('shipwright'), maxRank: 5, description: 'Repairs 0.35% of max hull per second per rank.', perRank: { regen: 0.0035 } },
  'figurehead-fury': { id: 'figurehead-fury', name: 'Figurehead of Fury', icon: icon('figurehead-fury'), maxRank: 5, description: '+20% critical damage and +8% area per rank.', perRank: { critDamage: 0.2, area: 0.08 } },
  'weather-eye': { id: 'weather-eye', name: 'Weather Eye', icon: icon('weather-eye'), maxRank: 5, description: '+8% experience per rank.', perRank: { xpGain: 0.08 } },
  'drill-master': { id: 'drill-master', name: 'Drill Master', icon: icon('drill-master'), maxRank: 5, description: '12% faster skill cooldowns per rank.', perRank: { skillCooldown: 0.12 } },
  'deep-stores': { id: 'deep-stores', name: 'Deep Stores', icon: icon('deep-stores'), maxRank: 5, description: '+0.5 projectiles and +8% duration per rank.', perRank: { amount: 0.5, duration: 0.08 } },
};
