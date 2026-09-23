import type { ShipId } from '../ids';
import type { ShipDef } from '../types';

/**
 * Player ships. The six downloaded models are kept for now (modelKey = legacy file name) but the
 * world is original: names, epithets and descriptions must never reference the source franchise.
 */
export const SHIPS: Readonly<Record<ShipId, ShipDef>> = {
  'dawn-ram': {
    id: 'dawn-ram', name: 'Dawn Ram', epithet: 'The Lucky Little Ram',
    description: 'A nimble caravel with a ram figurehead and more luck than hull. Turns on a doubloon.',
    modelKey: 'going-merry', length: 34, beam: 11, hp: 180, armor: 0, maxSpeed: 27, accel: 7.5, turnRate: 0.95, mass: 350,
    broadsideGuns: 3, pickupRadius: 34, special: 'second-wind', ultimate: 'ramming-speed', startingWeapon: 'broadside',
    unlock: { kind: 'start' }, accent: 0xf2d38a,
  },
  sunlion: {
    id: 'sunlion', name: 'Sunlion', epithet: 'The Roaring Brig',
    description: 'A sun-maned brigantine built for adventure. Balanced guns, balanced sails, a roar in its bow.',
    modelKey: 'thousand-sunny', length: 46, beam: 17, hp: 230, armor: 1, maxSpeed: 25, accel: 6.2, turnRate: 0.8, mass: 600,
    broadsideGuns: 4, pickupRadius: 32, special: 'lionburst', ultimate: 'sunfire-barrage', startingWeapon: 'broadside',
    unlock: { kind: 'start' }, accent: 0xf5a524,
  },
  yellowfin: {
    id: 'yellowfin', name: 'Yellowfin', epithet: 'The Diving Blade',
    description: 'A yellow submersible that fights from below. Fragile on the surface, deadly when it rises.',
    modelKey: 'polar-tang', length: 44, beam: 13, hp: 200, armor: 1, maxSpeed: 26, accel: 7, turnRate: 0.85, mass: 520,
    broadsideGuns: 3, pickupRadius: 32, special: 'deep-dive', ultimate: 'torpedo-swarm', startingWeapon: 'broadside',
    unlock: { kind: 'doubloons', cost: 600 }, accent: 0xffd23a,
  },
  'grand-galley': {
    id: 'grand-galley', name: 'Grand Galley', epithet: 'The Floating Feast',
    description: 'A restaurant fortress with gun decks on its wide wings. Slow, stubborn and generous.',
    modelKey: 'baratie', length: 56, beam: 30, hp: 320, armor: 3, maxSpeed: 19, accel: 4.2, turnRate: 0.55, mass: 1400,
    broadsideGuns: 5, pickupRadius: 38, special: 'chefs-banquet', ultimate: 'kitchen-inferno', startingWeapon: 'broadside',
    unlock: { kind: 'doubloons', cost: 1500 }, accent: 0xe9745b,
  },
  seawarden: {
    id: 'seawarden', name: 'Seawarden', epithet: 'The Captured Warship',
    description: 'An Admiralty ship-of-the-line under a new flag. Heavy armour, heavier artillery.',
    modelKey: 'navy-galleon', length: 58, beam: 17, hp: 290, armor: 3, maxSpeed: 22, accel: 5, turnRate: 0.62, mass: 1100,
    broadsideGuns: 5, pickupRadius: 32, special: 'signal-flare', ultimate: 'admirals-judgment', startingWeapon: 'broadside',
    unlock: { kind: 'achievement', achievement: 'defeat-iron-warden', text: 'Defeat the Iron Warden' }, accent: 0x6fa8ff,
  },
  'white-leviathan': {
    id: 'white-leviathan', name: 'White Leviathan', epithet: 'The Old Titan',
    description: 'A whale-bowed titan with a broadside like a landslide. Turns like an island.',
    modelKey: 'moby-dick', length: 84, beam: 24, hp: 420, armor: 4, maxSpeed: 20, accel: 3.6, turnRate: 0.42, mass: 2600,
    broadsideGuns: 7, pickupRadius: 40, special: 'seaquake', ultimate: 'tidal-colossus', startingWeapon: 'broadside',
    unlock: { kind: 'achievement', achievement: 'win-run', text: 'Win a run on any sea' }, accent: 0xe8eef2,
  },
};
