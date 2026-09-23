import type { WeaponId } from '../ids';
import type { WeaponDef, WeaponLevelDef } from '../types';

const L = (damage: number, cooldown: number, count: number, range: number, text: string, more: Partial<WeaponLevelDef> = {}): WeaponLevelDef =>
  ({ damage, cooldown, count, range, text, ...more });

const icon = (id: WeaponId) => `/assets/icons/${id}.png`;

/** Initial balance — META tunes these with scripts/balance-sim.ts. */
export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  broadside: {
    id: 'broadside', name: 'Broadside Battery', icon: icon('broadside'), mount: 'broadside', tags: ['projectile'],
    description: 'Your gun decks fire on their own whenever an enemy crosses either beam.',
    levels: [
      L(14, 2.4, 3, 150, 'Three guns a side.', { speed: 95 }),
      L(16, 2.2, 4, 155, '+1 gun per side, +damage.', { speed: 98 }),
      L(18, 2.1, 4, 160, 'Choose your shot.', { speed: 100 }),
      L(21, 1.95, 5, 165, '+1 gun per side.', { speed: 102 }),
      L(25, 1.8, 6, 172, '+1 gun per side, faster reload.', { speed: 106 }),
      L(30, 1.6, 7, 180, 'Full gun decks.', { speed: 110 }),
    ],
    branches: [
      { id: 'A', name: 'Chain Shot', text: 'Volleys slow targets by 40% and shred their speed.' },
      { id: 'B', name: 'Heavy Shot', text: 'Balls pierce one more ship and knock targets back.' },
    ],
    overdrive: { name: 'Rolling Thunder', text: 'Both batteries ripple-fire continuously.' },
  },
  'bow-chaser': {
    id: 'bow-chaser', name: 'Bow Chaser', icon: icon('bow-chaser'), mount: 'bow', tags: ['projectile'],
    description: 'A long gun in the bow picks off enemies dead ahead.',
    levels: [
      L(34, 1.9, 1, 240, 'A long-range bow gun.', { speed: 150 }),
      L(40, 1.75, 1, 250, '+damage.', { speed: 155 }),
      L(44, 1.65, 1, 260, 'Choose your chaser.', { speed: 160 }),
      L(52, 1.5, 2, 265, '+1 shot.', { speed: 165 }),
      L(60, 1.4, 2, 275, '+damage, faster.', { speed: 170 }),
      L(72, 1.25, 2, 290, 'Master gunner in the bow.', { speed: 180 }),
    ],
    branches: [
      { id: 'A', name: 'Twin Chasers', text: 'A second gun fires at a different target.' },
      { id: 'B', name: 'Longtom', text: 'Shots pierce everything in a line.' },
    ],
    overdrive: { name: 'Lance of Dawn', text: 'A searing piercing lance of fire every few seconds.' },
  },
  'stern-mortar': {
    id: 'stern-mortar', name: 'Stern Mortar', icon: icon('stern-mortar'), mount: 'stern', tags: ['projectile', 'area'],
    description: 'Lobs shells into the thickest knot of enemies.',
    levels: [
      L(30, 3.2, 1, 250, 'One shell at the densest cluster.', { area: 16, speed: 60 }),
      L(34, 3.0, 1, 255, '+damage, +area.', { area: 18, speed: 60 }),
      L(38, 2.9, 2, 260, 'Choose your shells.', { area: 18, speed: 62 }),
      L(44, 2.7, 2, 265, '+area.', { area: 21, speed: 62 }),
      L(50, 2.5, 3, 270, '+1 shell.', { area: 22, speed: 64 }),
      L(58, 2.2, 3, 280, 'Heavy bombardment.', { area: 25, speed: 66 }),
    ],
    branches: [
      { id: 'A', name: 'Cluster Shells', text: 'Each shell bursts into three bomblets.' },
      { id: 'B', name: 'Firepots', text: 'Shells leave burning patches on the water.' },
    ],
    overdrive: { name: 'Meteor Rain', text: 'A rain of shells falls around your ship.' },
  },
  'swivel-guns': {
    id: 'swivel-guns', name: 'Swivel Guns', icon: icon('swivel-guns'), mount: 'rails', tags: ['projectile'],
    description: 'Rail-mounted swivels spray the nearest enemy.',
    levels: [
      L(5, 0.32, 1, 90, 'Rapid fire at the nearest ship.', { speed: 120 }),
      L(6, 0.29, 1, 95, '+damage, faster.', { speed: 124 }),
      L(7, 0.27, 2, 100, 'Choose your swivels.', { speed: 128 }),
      L(8, 0.25, 2, 105, '+range.', { speed: 130 }),
      L(9, 0.22, 3, 110, '+1 swivel.', { speed: 134 }),
      L(11, 0.2, 3, 118, 'Every rail bristles.', { speed: 140 }),
    ],
    branches: [
      { id: 'A', name: 'Double Swivels', text: 'Twice the swivels on your rails.' },
      { id: 'B', name: 'Grapeshot', text: 'Each shot becomes a short-range cone of shot.' },
    ],
    overdrive: { name: 'Hailstorm', text: 'Eight swivels fire in every direction.' },
  },
  'fire-barrels': {
    id: 'fire-barrels', name: 'Fire Barrels', icon: icon('fire-barrels'), mount: 'stern', tags: ['drop', 'fire', 'area'],
    description: 'Drops burning barrels in your wake. Pursuers pay for it.',
    levels: [
      L(8, 3.0, 1, 0, 'A burning barrel astern.', { area: 12, duration: 4 }),
      L(10, 2.8, 1, 0, '+burn.', { area: 13, duration: 4.5 }),
      L(11, 2.6, 2, 0, 'Choose your cargo.', { area: 13, duration: 4.5 }),
      L(13, 2.4, 2, 0, '+area.', { area: 15, duration: 5 }),
      L(15, 2.2, 3, 0, '+1 barrel.', { area: 16, duration: 5.5 }),
      L(18, 2.0, 3, 0, 'A trail of fire.', { area: 18, duration: 6 }),
    ],
    branches: [
      { id: 'A', name: 'Barrel Chains', text: 'Drops three barrels in a chain.' },
      { id: 'B', name: 'Powder Kegs', text: 'Barrels explode when enemies touch them.' },
    ],
    overdrive: { name: 'Sea of Fire', text: 'Your whole wake burns.' },
  },
  harpoon: {
    id: 'harpoon', name: 'Harpoon Gun', icon: icon('harpoon'), mount: 'bow', tags: ['projectile'],
    description: 'Spears an enemy, hauls it close and slows it.',
    levels: [
      L(24, 2.6, 1, 140, 'Spear and slow a target.', { speed: 110, duration: 2 }),
      L(28, 2.4, 1, 145, '+damage.', { speed: 115, duration: 2.2 }),
      L(32, 2.3, 1, 150, 'Choose your line.', { speed: 118, duration: 2.4 }),
      L(38, 2.1, 2, 155, '+1 harpoon.', { speed: 120, duration: 2.6 }),
      L(44, 1.95, 2, 160, '+damage.', { speed: 124, duration: 2.8 }),
      L(52, 1.8, 2, 170, 'Whaler\'s pride.', { speed: 130, duration: 3 }),
    ],
    branches: [
      { id: 'A', name: 'Chain Harpoon', text: 'The harpoon chains through three ships.' },
      { id: 'B', name: 'Tow Line', text: 'Hauled ships smash into their neighbours.' },
    ],
    overdrive: { name: 'Leviathan Hook', text: 'A giant hook drags whole groups together.' },
  },
  'rocket-rack': {
    id: 'rocket-rack', name: 'Rocket Rack', icon: icon('rocket-rack'), mount: 'deck', tags: ['projectile', 'area'],
    description: 'A rack of homing signal rockets.',
    levels: [
      L(12, 3.4, 3, 200, 'Three homing rockets.', { area: 8, speed: 70 }),
      L(14, 3.2, 4, 205, '+1 rocket.', { area: 8, speed: 72 }),
      L(16, 3.0, 4, 210, 'Choose your rockets.', { area: 9, speed: 74 }),
      L(18, 2.8, 5, 215, '+1 rocket.', { area: 10, speed: 76 }),
      L(21, 2.6, 6, 220, '+1 rocket.', { area: 10, speed: 78 }),
      L(25, 2.4, 7, 230, 'Fireworks night.', { area: 11, speed: 82 }),
    ],
    branches: [
      { id: 'A', name: 'Swarm', text: 'Twice the rockets, smaller blasts.' },
      { id: 'B', name: 'Big Bertha', text: 'Fewer, huge rockets with wide blasts.' },
    ],
    overdrive: { name: 'Skyburst', text: 'Rockets burst into a carpet of sparks.' },
  },
  'storm-rod': {
    id: 'storm-rod', name: 'Storm Rod', icon: icon('storm-rod'), mount: 'mast', tags: ['lightning'],
    description: 'A copper rod on the mainmast calls lightning that jumps ship to ship.',
    levels: [
      L(18, 2.8, 3, 130, 'Lightning jumps between three ships.'),
      L(21, 2.6, 3, 135, '+damage.'),
      L(24, 2.5, 4, 140, 'Choose your storm.'),
      L(28, 2.3, 5, 145, '+1 jump.'),
      L(32, 2.1, 6, 150, '+1 jump, faster.'),
      L(38, 1.9, 7, 160, 'The sky answers.'),
    ],
    branches: [
      { id: 'A', name: 'Forked', text: 'Every bolt forks into a second chain.' },
      { id: 'B', name: 'Thunderclap', text: 'The first strike stuns everything around it.' },
    ],
    overdrive: { name: 'Thunderhead', text: 'A storm cloud follows you, raining bolts.' },
  },
  'tide-mines': {
    id: 'tide-mines', name: 'Tide Mines', icon: icon('tide-mines'), mount: 'stern', tags: ['drop', 'area'],
    description: 'Drifting mines that arm after a moment.',
    levels: [
      L(40, 4.0, 1, 0, 'A drifting mine.', { area: 18, duration: 12 }),
      L(46, 3.8, 1, 0, '+damage.', { area: 19, duration: 12 }),
      L(50, 3.6, 2, 0, 'Choose your mines.', { area: 20, duration: 13 }),
      L(56, 3.4, 2, 0, '+area.', { area: 23, duration: 13 }),
      L(62, 3.2, 3, 0, '+1 mine.', { area: 24, duration: 14 }),
      L(72, 3.0, 3, 0, 'A sea of iron.', { area: 26, duration: 15 }),
    ],
    branches: [
      { id: 'A', name: 'Magnet Mines', text: 'Mines drift toward nearby ships.' },
      { id: 'B', name: 'Depth Charges', text: 'Huge, slow blasts.' },
    ],
    overdrive: { name: 'Minefield', text: 'Mines seed themselves around you.' },
  },
  'iron-ram': {
    id: 'iron-ram', name: 'Iron Ram', icon: icon('iron-ram'), mount: 'prow', tags: ['contact'],
    description: 'An iron prow. Ramming hurts them, not you.',
    levels: [
      L(40, 0.6, 1, 0, 'Ramming deals heavy damage.', { extra: { ramMultiplier: 2, knockback: 8 } }),
      L(48, 0.55, 1, 0, '+damage.', { extra: { ramMultiplier: 2.4, knockback: 9 } }),
      L(56, 0.5, 1, 0, 'Choose your prow.', { extra: { ramMultiplier: 2.8, knockback: 10 } }),
      L(66, 0.45, 1, 0, '+damage, +knockback.', { extra: { ramMultiplier: 3.2, knockback: 12 } }),
      L(76, 0.4, 1, 0, '+damage.', { extra: { ramMultiplier: 3.6, knockback: 13 } }),
      L(90, 0.35, 1, 0, 'Unstoppable.', { extra: { ramMultiplier: 4.2, knockback: 15 } }),
    ],
    branches: [
      { id: 'A', name: 'Spiked Hull', text: 'Any ship that touches your hull takes damage.' },
      { id: 'B', name: 'Shockwave Prow', text: 'Rams release a shockwave.' },
    ],
    overdrive: { name: 'Iron Tusk', text: 'Rams heal you and grant a moment of invulnerability.' },
  },
  'escort-skiffs': {
    id: 'escort-skiffs', name: 'Escort Skiffs', icon: icon('escort-skiffs'), mount: 'alongside', tags: ['summon', 'projectile'],
    description: 'Loyal skiffs circle your ship and shoot at anything close.',
    levels: [
      L(8, 0.9, 2, 110, 'Two escort skiffs.', { speed: 110 }),
      L(10, 0.85, 2, 115, '+damage.', { speed: 112 }),
      L(11, 0.8, 3, 120, 'Choose your escorts.', { speed: 114 }),
      L(13, 0.75, 3, 125, '+range.', { speed: 116 }),
      L(15, 0.7, 4, 130, '+1 skiff.', { speed: 118 }),
      L(18, 0.62, 4, 140, 'Your own little fleet.', { speed: 122 }),
    ],
    branches: [
      { id: 'A', name: '+2 Skiffs', text: 'Two more skiffs join the escort.' },
      { id: 'B', name: 'Fire Skiffs', text: 'Skiffs ram enemies and explode, then rejoin.' },
    ],
    overdrive: { name: 'Armada', text: 'A ring of eight escorts.' },
  },
  'maelstrom-charm': {
    id: 'maelstrom-charm', name: 'Maelstrom Charm', icon: icon('maelstrom-charm'), mount: 'deck', tags: ['area'],
    description: 'A coral charm that opens whirlpools under enemy clusters.',
    levels: [
      L(6, 6.0, 1, 200, 'A whirlpool pulls and grinds.', { area: 28, duration: 4 }),
      L(7, 5.6, 1, 205, '+pull.', { area: 30, duration: 4.5 }),
      L(8, 5.3, 1, 210, 'Choose your current.', { area: 32, duration: 5 }),
      L(9, 5.0, 2, 215, '+1 whirlpool.', { area: 34, duration: 5 }),
      L(11, 4.6, 2, 220, '+area.', { area: 37, duration: 5.5 }),
      L(13, 4.2, 2, 230, 'The sea obeys.', { area: 40, duration: 6 }),
    ],
    branches: [
      { id: 'A', name: 'Twin Vortex', text: 'Two whirlpools at once.' },
      { id: 'B', name: 'Riptide', text: 'Bigger, longer whirlpools.' },
    ],
    overdrive: { name: 'Maelstrom', text: 'A vast maelstrom follows your ship.' },
  },
};
