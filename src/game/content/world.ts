import type { MetaUpgradeId, SeaId } from '../ids';
import type { MetaUpgradeDef, SeaDef, Stats } from '../types';
import { sentence, statsText } from './text';

/**
 * Boss schedule, the same on every sea (DIFFICULTY round 3, owner: bosses are time-based and should come earlier and
 * more often). Strictly on the run clock: the Iron Warden at 3:00, the Tidewyrm at 6:00, tougher rematches of both at
 * 8:30 and 11:00, and the Sovereign at 15:00 (the last entry is the final boss; sinking it wins the run). A boss that
 * is still afloat does not hold the next one back. Rematch hull (`hpMul`) is tuned with scripts/balance-sim.ts so
 * every fight lasts ~45–120 s against the build a decent captain has by then.
 */
const BOSS_SCHEDULE: SeaDef['bosses'] = [
  { at: 180, boss: 'iron-warden' },
  { at: 360, boss: 'tidewyrm' },
  { at: 510, boss: 'iron-warden', hpMul: 3.2 },
  { at: 660, boss: 'tidewyrm', hpMul: 2.3 },
  { at: 900, boss: 'sovereign' },
];

export const SEAS: Readonly<Record<SeaId, SeaDef>> = {
  'sunward-shallows': {
    id: 'sunward-shallows', name: 'Sunward Shallows',
    description: 'Turquoise shallows and lazy islands. The Admiralty patrols them all the same.',
    duration: 900, bosses: BOSS_SCHEDULE,
    startHour: 7, hoursPerRun: 14, weather: [{ at: 0, weather: 'clear' }, { at: 420, weather: 'breezy' }, { at: 780, weather: 'clear' }],
    enemyFactions: ['admiralty', 'corsair', 'deep'], difficulty: 1, unlock: { kind: 'start' },
  },
  'stormwrack-reach': {
    id: 'stormwrack-reach', name: 'Stormwrack Reach',
    description: 'Rogue waves, lightning and a sky the colour of gunmetal.',
    duration: 900, bosses: BOSS_SCHEDULE,
    startHour: 15, hoursPerRun: 8, weather: [{ at: 0, weather: 'breezy' }, { at: 210, weather: 'storm' }, { at: 480, weather: 'breezy' }, { at: 630, weather: 'storm' }],
    enemyFactions: ['admiralty', 'corsair', 'deep'], difficulty: 1.4,
    unlock: { kind: 'achievement', achievement: 'survive-10', text: 'Survive 10:00 on any sea' },
  },
  'the-gloam': {
    id: 'the-gloam', name: 'The Gloam',
    description: 'Fog, moonlight and ships that should have sunk long ago.',
    duration: 900, bosses: BOSS_SCHEDULE,
    startHour: 20, hoursPerRun: 8, weather: [{ at: 0, weather: 'fog' }, { at: 360, weather: 'clear' }, { at: 600, weather: 'fog' }],
    enemyFactions: ['wraith', 'corsair', 'admiralty', 'deep'], difficulty: 1.55,
    unlock: { kind: 'achievement', achievement: 'win-run', text: 'Win a run (defeat the Sovereign)' },
  },
};

/** Rising doubloon costs, rounded to 5. */
const costs = (base: number, max: number, growth = 1.6) => Array.from({ length: max }, (_, i) => Math.round((base * growth ** i) / 5) * 5);

/** "+2% top speed, +6% acceleration per rank." generated from the table (never out of date after a re-tune). */
const perRankText = (perRank: Readonly<Partial<Stats>>): string => `${sentence(statsText(perRank)).slice(0, -1)} per rank.`;

const COPPER: Readonly<Partial<Stats>> = { speed: 0.02, accel: 0.06 };
const STORM_SAILS: Readonly<Partial<Stats>> = { boostDuration: 0.08, boostCooldown: 0.06 };
const RUDDER_CHAINS: Readonly<Partial<Stats>> = { turn: 0.04, helm: 0.12 };

/**
 * Harbor upgrades. A decent run banks ~150–400 doubloons (see content/rewards.ts ECONOMY), so the first ranks
 * are affordable after one run and the long tails need many.
 */
export const META_UPGRADES: Readonly<Record<MetaUpgradeId, MetaUpgradeDef>> = {
  hull: { id: 'hull', name: 'Hull Plating', description: '+6% max hull per rank.', maxRank: 8, costs: costs(40, 8), perRank: { maxHp: 0.06 } },
  sails: { id: 'sails', name: 'Better Sails', description: '+4% top speed per rank.', maxRank: 5, costs: costs(50, 5), perRank: { speed: 0.04 } },
  powder: { id: 'powder', name: 'Fine Powder', description: '+5% damage per rank.', maxRank: 8, costs: costs(60, 8), perRank: { damage: 0.05 } },
  gunnery: { id: 'gunnery', name: 'Gunnery Drills', description: '4% faster weapon reloads per rank.', maxRank: 5, costs: costs(80, 5), perRank: { cooldown: 0.04 } },
  salvage: { id: 'salvage', name: 'Salvage Hooks', description: '+10% treasure pickup radius per rank.', maxRank: 5, costs: costs(30, 5), perRank: { pickupRadius: 0.1 } },
  fortune: { id: 'fortune', name: 'Fortune', description: '+1 luck and +8% doubloons per rank.', maxRank: 5, costs: costs(70, 5), perRank: { luck: 1, doubloonGain: 0.08 } },
  wisdom: { id: 'wisdom', name: "Navigator's Wisdom", description: '+5% experience per rank.', maxRank: 5, costs: costs(60, 5), perRank: { xpGain: 0.05 } },
  'second-wind': { id: 'second-wind', name: 'Second Wind', description: 'Revive once per run per rank (half hull, 3 s invulnerable).', maxRank: 2, costs: [400, 1200], perRank: { revives: 1 } },
  charts: { id: 'charts', name: 'Sea Charts', description: '+1 card reroll per run per rank.', maxRank: 5, costs: costs(50, 5), perRank: {} },
  banish: { id: 'banish', name: 'Black Spot', description: '+1 card banish per run per rank.', maxRank: 3, costs: costs(120, 3, 2), perRank: {} },
  // Round 1 (PACE): speed, boost and helm refits.
  'copper-sheathing': { id: 'copper-sheathing', name: 'Copper Sheathing', description: perRankText(COPPER), maxRank: 5, costs: costs(70, 5), perRank: COPPER },
  'storm-sails': { id: 'storm-sails', name: 'Storm Sails', description: perRankText(STORM_SAILS), maxRank: 5, costs: costs(60, 5), perRank: STORM_SAILS },
  'rudder-chains': { id: 'rudder-chains', name: 'Rudder Chains', description: perRankText(RUDDER_CHAINS), maxRank: 5, costs: costs(50, 5), perRank: RUDDER_CHAINS },
};
