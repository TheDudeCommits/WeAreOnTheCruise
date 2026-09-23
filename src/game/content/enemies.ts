import type { BossId, EnemyId } from '../ids';
import type { BossDef, EnemyDef } from '../types';

/** Initial balance — META tunes these. modelKey is resolved by src/render/ships via /assets/fleet/manifest.json. */
export const ENEMIES: Readonly<Record<EnemyId, EnemyDef>> = {
  skiff: {
    id: 'skiff', name: 'Raider Skiff', faction: 'corsair', modelKey: 'skiff', length: 12, radius: 5, hp: 22, armor: 0,
    speed: 17, turnRate: 1.6, mass: 40, behavior: 'swarm', contactDamage: 8, xp: 1, doubloonChance: 0.02, firstMinute: 0,
  },
  cutter: {
    id: 'cutter', name: 'Admiralty Cutter', faction: 'admiralty', modelKey: 'sloop', length: 20, radius: 7, hp: 55, armor: 0,
    speed: 14, turnRate: 1.1, mass: 120, behavior: 'chaser', contactDamage: 10, xp: 2, doubloonChance: 0.03, firstMinute: 1,
    attack: { projectile: 'enemy-chaser', damage: 7, cooldown: 3.2, range: 150, count: 1, spread: 0.04, speed: 85, lead: 0.2, telegraph: 0 },
  },
  brig: {
    id: 'brig', name: 'Admiralty Brig', faction: 'admiralty', modelKey: 'brig', length: 28, radius: 10, hp: 120, armor: 1,
    speed: 12, turnRate: 0.8, mass: 260, behavior: 'broadside', contactDamage: 12, xp: 4, doubloonChance: 0.05, firstMinute: 2,
    attack: { projectile: 'enemy-cannonball', damage: 9, cooldown: 3.8, range: 140, count: 3, spread: 0.12, speed: 80, lead: 0.35, telegraph: 0 },
  },
  fireship: {
    id: 'fireship', name: 'Fire Ship', faction: 'corsair', modelKey: 'fireship', length: 22, radius: 8, hp: 70, armor: 0,
    speed: 16, turnRate: 1.0, mass: 150, behavior: 'kamikaze', contactDamage: 38, xp: 3, doubloonChance: 0.03, firstMinute: 3,
  },
  'mortar-barge': {
    id: 'mortar-barge', name: 'Mortar Barge', faction: 'admiralty', modelKey: 'mortar-barge', length: 24, radius: 10, hp: 150, armor: 2,
    speed: 7, turnRate: 0.6, mass: 400, behavior: 'artillery', contactDamage: 10, xp: 6, doubloonChance: 0.08, firstMinute: 4,
    attack: { projectile: 'enemy-mortar', damage: 22, cooldown: 5, range: 300, count: 1, spread: 0, speed: 55, lead: 0.5, telegraph: 1.6 },
  },
  frigate: {
    id: 'frigate', name: 'Admiralty Frigate', faction: 'admiralty', modelKey: 'frigate', length: 38, radius: 13, hp: 320, armor: 3,
    speed: 11, turnRate: 0.6, mass: 700, behavior: 'broadside', contactDamage: 18, xp: 10, doubloonChance: 0.12, firstMinute: 6,
    attack: { projectile: 'enemy-cannonball', damage: 11, cooldown: 3.4, range: 160, count: 5, spread: 0.1, speed: 85, lead: 0.5, telegraph: 0 },
  },
  'man-o-war': {
    id: 'man-o-war', name: "Man-o'-War", faction: 'admiralty', modelKey: 'man-o-war', length: 50, radius: 17, hp: 900, armor: 5,
    speed: 9, turnRate: 0.45, mass: 1600, behavior: 'broadside', contactDamage: 26, xp: 25, doubloonChance: 0.35, firstMinute: 9,
    attack: { projectile: 'enemy-cannonball', damage: 14, cooldown: 3.2, range: 175, count: 8, spread: 0.1, speed: 90, lead: 0.65, telegraph: 0.5 },
  },
  'corsair-brig': {
    id: 'corsair-brig', name: 'Redtide Brig', faction: 'corsair', modelKey: 'corsair-brig', length: 28, radius: 10, hp: 140, armor: 1,
    speed: 15, turnRate: 0.9, mass: 280, behavior: 'broadside', contactDamage: 16, xp: 5, doubloonChance: 0.08, firstMinute: 3,
    attack: { projectile: 'enemy-cannonball', damage: 9, cooldown: 3.2, range: 130, count: 3, spread: 0.14, speed: 80, lead: 0.3, telegraph: 0 },
  },
  'corsair-galleon': {
    id: 'corsair-galleon', name: 'Redtide Galleon', faction: 'corsair', modelKey: 'corsair-galleon', length: 44, radius: 15, hp: 520, armor: 3,
    speed: 10, turnRate: 0.5, mass: 1100, behavior: 'broadside', contactDamage: 22, xp: 14, doubloonChance: 0.2, firstMinute: 7,
    attack: { projectile: 'enemy-cannonball', damage: 12, cooldown: 3.6, range: 165, count: 6, spread: 0.12, speed: 85, lead: 0.45, telegraph: 0 },
  },
  wraith: {
    id: 'wraith', name: 'Gloam Wraith', faction: 'wraith', modelKey: 'wraith', length: 30, radius: 11, hp: 180, armor: 1,
    speed: 14, turnRate: 1.0, mass: 200, behavior: 'phase', contactDamage: 18, xp: 7, doubloonChance: 0.08, firstMinute: 2,
    attack: { projectile: 'enemy-cannonball', damage: 10, cooldown: 3.5, range: 140, count: 3, spread: 0.15, speed: 80, lead: 0.4, telegraph: 0 },
  },
  wyrmling: {
    id: 'wyrmling', name: 'Wyrmling', faction: 'deep', modelKey: 'wyrmling', length: 16, radius: 6, hp: 90, armor: 0,
    speed: 18, turnRate: 1.8, mass: 80, behavior: 'lunge', contactDamage: 20, xp: 4, doubloonChance: 0.04, firstMinute: 5,
  },
  fort: {
    id: 'fort', name: 'Cliff Battery', faction: 'admiralty', modelKey: 'fort', length: 20, radius: 12, hp: 600, armor: 4,
    speed: 0, turnRate: 0, mass: 1e6, behavior: 'stationary', contactDamage: 0, xp: 18, doubloonChance: 0.4, firstMinute: 4,
    attack: { projectile: 'enemy-mortar', damage: 18, cooldown: 4.5, range: 280, count: 2, spread: 0.2, speed: 55, lead: 0.4, telegraph: 1.4 },
  },
};

export const BOSSES: Readonly<Record<BossId, BossDef>> = {
  'iron-warden': {
    id: 'iron-warden', name: 'The Iron Warden', title: "Commodore Vane's Dreadnought", modelKey: 'dreadnought',
    length: 90, radius: 30, hp: 7000, armor: 6, speed: 8, turnRate: 0.35, mass: 6000, contactDamage: 40, xp: 160, doubloons: 120,
    phases: [
      { hpFraction: 1, name: 'Line of Battle', attacks: ['broadside-volley', 'mortar-barrage', 'summon-cutters'] },
      { hpFraction: 0.5, name: 'Plates Off', attacks: ['broadside-volley', 'mortar-barrage', 'ram-charge'] },
    ],
  },
  tidewyrm: {
    id: 'tidewyrm', name: 'The Tidewyrm', title: 'Serpent of the Deep', modelKey: 'tidewyrm',
    length: 140, radius: 16, hp: 14000, armor: 4, speed: 20, turnRate: 1.0, mass: 5000, contactDamage: 45, xp: 260, doubloons: 200,
    phases: [
      { hpFraction: 1, name: 'Hunting', attacks: ['submerge-lunge', 'tail-slam', 'water-bolts'] },
      { hpFraction: 0.5, name: 'Brood', attacks: ['submerge-lunge', 'tail-slam', 'water-bolts', 'summon-wyrmlings'] },
    ],
  },
  sovereign: {
    id: 'sovereign', name: 'The Sovereign', title: "The Fleet Admiral's Flagship", modelKey: 'sovereign',
    length: 120, radius: 38, hp: 26000, armor: 8, speed: 7, turnRate: 0.3, mass: 9000, contactDamage: 60, xp: 400, doubloons: 400,
    phases: [
      { hpFraction: 1, name: 'Broadside Storm', attacks: ['broadside-storm', 'summon-man-o-war'] },
      { hpFraction: 0.6, name: 'Judgment', attacks: ['broadside-storm', 'judgment-line', 'mortar-barrage'] },
      { hpFraction: 0.25, name: 'Last Stand', attacks: ['broadside-storm', 'judgment-line', 'ram-charge', 'summon-man-o-war'] },
    ],
  },
};
