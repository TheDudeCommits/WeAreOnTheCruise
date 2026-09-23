import type { MetaUpgradeId, SeaId } from '../ids';
import type { MetaUpgradeDef, SeaDef } from '../types';

export const SEAS: Readonly<Record<SeaId, SeaDef>> = {
  'sunward-shallows': {
    id: 'sunward-shallows', name: 'Sunward Shallows',
    description: 'Turquoise shallows and lazy islands. The Admiralty patrols them all the same.',
    duration: 900, bosses: [{ at: 300, boss: 'iron-warden' }, { at: 600, boss: 'tidewyrm' }, { at: 900, boss: 'sovereign' }],
    startHour: 7, hoursPerRun: 14, weather: [{ at: 0, weather: 'clear' }, { at: 420, weather: 'breezy' }, { at: 780, weather: 'clear' }],
    enemyFactions: ['admiralty', 'corsair', 'deep'], difficulty: 1, unlock: { kind: 'start' },
  },
  'stormwrack-reach': {
    id: 'stormwrack-reach', name: 'Stormwrack Reach',
    description: 'Rogue waves, lightning and a sky the colour of gunmetal.',
    duration: 900, bosses: [{ at: 300, boss: 'iron-warden' }, { at: 600, boss: 'tidewyrm' }, { at: 900, boss: 'sovereign' }],
    startHour: 15, hoursPerRun: 8, weather: [{ at: 0, weather: 'breezy' }, { at: 180, weather: 'storm' }, { at: 540, weather: 'breezy' }, { at: 660, weather: 'storm' }],
    enemyFactions: ['admiralty', 'corsair', 'deep'], difficulty: 1.35,
    unlock: { kind: 'achievement', achievement: 'survive-10', text: 'Survive 10 minutes' },
  },
  'the-gloam': {
    id: 'the-gloam', name: 'The Gloam',
    description: 'Fog, moonlight and ships that should have sunk long ago.',
    duration: 900, bosses: [{ at: 300, boss: 'iron-warden' }, { at: 600, boss: 'tidewyrm' }, { at: 900, boss: 'sovereign' }],
    startHour: 20, hoursPerRun: 8, weather: [{ at: 0, weather: 'fog' }, { at: 360, weather: 'clear' }, { at: 600, weather: 'fog' }],
    enemyFactions: ['wraith', 'corsair', 'admiralty', 'deep'], difficulty: 1.7,
    unlock: { kind: 'achievement', achievement: 'win-run', text: 'Win a run' },
  },
};

const costs = (base: number, max: number, growth = 1.55) => Array.from({ length: max }, (_, i) => Math.round(base * growth ** i / 5) * 5);

export const META_UPGRADES: Readonly<Record<MetaUpgradeId, MetaUpgradeDef>> = {
  hull: { id: 'hull', name: 'Hull Plating', description: '+6% max hull per rank.', maxRank: 8, costs: costs(60, 8), perRank: { maxHp: 0.06 } },
  sails: { id: 'sails', name: 'Better Sails', description: '+4% speed per rank.', maxRank: 5, costs: costs(80, 5), perRank: { speed: 0.04 } },
  powder: { id: 'powder', name: 'Fine Powder', description: '+5% damage per rank.', maxRank: 8, costs: costs(80, 8), perRank: { damage: 0.05 } },
  gunnery: { id: 'gunnery', name: 'Gunnery Drills', description: '4% faster reloads per rank.', maxRank: 5, costs: costs(100, 5), perRank: { cooldown: 0.04 } },
  salvage: { id: 'salvage', name: 'Salvage Hooks', description: '+10% pickup radius per rank.', maxRank: 5, costs: costs(50, 5), perRank: { pickupRadius: 0.1 } },
  fortune: { id: 'fortune', name: 'Fortune', description: '+1 luck and +8% doubloons per rank.', maxRank: 5, costs: costs(90, 5), perRank: { luck: 1, doubloonGain: 0.08 } },
  wisdom: { id: 'wisdom', name: "Navigator's Wisdom", description: '+5% experience per rank.', maxRank: 5, costs: costs(90, 5), perRank: { xpGain: 0.05 } },
  'second-wind': { id: 'second-wind', name: 'Second Wind', description: 'Revive once per run per rank.', maxRank: 2, costs: [600, 1800], perRank: { revives: 1 } },
  charts: { id: 'charts', name: 'Sea Charts', description: '+1 reroll per run per rank.', maxRank: 5, costs: costs(120, 5), perRank: {} },
  banish: { id: 'banish', name: 'Black Spot', description: '+1 banish per run per rank.', maxRank: 3, costs: costs(200, 3), perRank: {} },
};
