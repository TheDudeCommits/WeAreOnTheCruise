import type { EnemyId } from '../ids';
import type { EnemyDef } from '../types';

export { BOSSES } from './bosses';

/**
 * Enemy classes (META tunes these with scripts/balance-sim.ts). modelKey is resolved by src/render/ships via
 * /assets/fleet/manifest.json. HP here is the minute-0 value; the director scales it with heat
 * (content/director.ts `hpScale`). `contactDamage` of a kamikaze is its blast damage.
 * Mortar `attack.speed` is the shell's horizontal speed (it sets the flight time = telegraph time).
 */
export const ENEMIES: Readonly<Record<EnemyId, EnemyDef>> = {
  skiff: {
    id: 'skiff', name: 'Raider Skiff', faction: 'corsair', modelKey: 'skiff', length: 12, radius: 5, hp: 20, armor: 0,
    speed: 19, turnRate: 1.7, mass: 40, behavior: 'swarm', contactDamage: 7, xp: 1, doubloonChance: 0.015, firstMinute: 0,
  },
  cutter: {
    id: 'cutter', name: 'Admiralty Cutter', faction: 'admiralty', modelKey: 'sloop', length: 20, radius: 7, hp: 48, armor: 0,
    speed: 15, turnRate: 1.15, mass: 120, behavior: 'chaser', contactDamage: 9, xp: 2, doubloonChance: 0.025, firstMinute: 1,
    attack: { projectile: 'enemy-chaser', damage: 7, cooldown: 2.6, range: 170, count: 1, spread: 0.03, speed: 110, lead: 0.35, telegraph: 0 },
  },
  brig: {
    id: 'brig', name: 'Admiralty Brig', faction: 'admiralty', modelKey: 'brig', length: 28, radius: 10, hp: 110, armor: 1,
    speed: 12.5, turnRate: 0.85, mass: 260, behavior: 'broadside', contactDamage: 12, xp: 4, doubloonChance: 0.04, firstMinute: 2,
    attack: { projectile: 'enemy-cannonball', damage: 8, cooldown: 4.2, range: 150, count: 3, spread: 0.09, speed: 90, lead: 0.35, telegraph: 0 },
  },
  fireship: {
    id: 'fireship', name: 'Fire Ship', faction: 'corsair', modelKey: 'fireship', length: 22, radius: 8, hp: 55, armor: 0,
    speed: 17, turnRate: 1.05, mass: 150, behavior: 'kamikaze', contactDamage: 34, xp: 2, doubloonChance: 0.03, firstMinute: 3,
  },
  'mortar-barge': {
    id: 'mortar-barge', name: 'Mortar Barge', faction: 'admiralty', modelKey: 'mortar-barge', length: 24, radius: 10, hp: 140, armor: 2,
    speed: 7.5, turnRate: 0.6, mass: 400, behavior: 'artillery', contactDamage: 10, xp: 5, doubloonChance: 0.07, firstMinute: 4,
    attack: { projectile: 'enemy-mortar', damage: 20, cooldown: 5.5, range: 300, count: 1, spread: 0, speed: 120, lead: 0.6, telegraph: 2 },
  },
  frigate: {
    id: 'frigate', name: 'Admiralty Frigate', faction: 'admiralty', modelKey: 'frigate', length: 38, radius: 13, hp: 300, armor: 3,
    speed: 11, turnRate: 0.62, mass: 700, behavior: 'broadside', contactDamage: 18, xp: 9, doubloonChance: 0.1, firstMinute: 6,
    attack: { projectile: 'enemy-cannonball', damage: 10, cooldown: 4.4, range: 170, count: 5, spread: 0.08, speed: 95, lead: 0.45, telegraph: 0 },
  },
  'man-o-war': {
    id: 'man-o-war', name: "Man-o'-War", faction: 'admiralty', modelKey: 'man-o-war', length: 50, radius: 17, hp: 850, armor: 5,
    speed: 9, turnRate: 0.45, mass: 1600, behavior: 'broadside', contactDamage: 26, xp: 24, doubloonChance: 0.35, firstMinute: 9,
    attack: { projectile: 'enemy-cannonball', damage: 13, cooldown: 5, range: 190, count: 8, spread: 0.07, speed: 100, lead: 0.55, telegraph: 0.7 },
  },
  'corsair-brig': {
    id: 'corsair-brig', name: 'Redtide Brig', faction: 'corsair', modelKey: 'corsair-brig', length: 28, radius: 10, hp: 130, armor: 1,
    speed: 15, turnRate: 0.95, mass: 280, behavior: 'broadside', contactDamage: 16, xp: 4, doubloonChance: 0.07, firstMinute: 3,
    attack: { projectile: 'enemy-cannonball', damage: 8, cooldown: 3.6, range: 135, count: 3, spread: 0.12, speed: 88, lead: 0.3, telegraph: 0 },
  },
  'corsair-galleon': {
    id: 'corsair-galleon', name: 'Redtide Galleon', faction: 'corsair', modelKey: 'corsair-galleon', length: 44, radius: 15, hp: 480, armor: 3,
    speed: 10, turnRate: 0.5, mass: 1100, behavior: 'broadside', contactDamage: 22, xp: 12, doubloonChance: 0.2, firstMinute: 7,
    attack: { projectile: 'enemy-cannonball', damage: 11, cooldown: 4.6, range: 165, count: 6, spread: 0.1, speed: 92, lead: 0.4, telegraph: 0 },
  },
  wraith: {
    id: 'wraith', name: 'Gloam Wraith', faction: 'wraith', modelKey: 'wraith', length: 30, radius: 11, hp: 160, armor: 1,
    speed: 14, turnRate: 1.0, mass: 200, behavior: 'phase', contactDamage: 18, xp: 5, doubloonChance: 0.07, firstMinute: 2,
    attack: { projectile: 'enemy-cannonball', damage: 10, cooldown: 5, range: 150, count: 4, spread: 0.1, speed: 95, lead: 0.45, telegraph: 0.45 },
  },
  wyrmling: {
    id: 'wyrmling', name: 'Wyrmling', faction: 'deep', modelKey: 'wyrmling', length: 16, radius: 6, hp: 80, armor: 0,
    speed: 18, turnRate: 1.8, mass: 80, behavior: 'lunge', contactDamage: 18, xp: 3, doubloonChance: 0.04, firstMinute: 5,
  },
  fort: {
    id: 'fort', name: 'Cliff Battery', faction: 'admiralty', modelKey: 'fort', length: 20, radius: 12, hp: 600, armor: 4,
    speed: 0, turnRate: 0, mass: 1e6, behavior: 'stationary', contactDamage: 0, xp: 15, doubloonChance: 0.4, firstMinute: 4,
    attack: { projectile: 'enemy-mortar', damage: 18, cooldown: 5, range: 300, count: 2, spread: 0.2, speed: 120, lead: 0.4, telegraph: 2 },
  },
};

/** AI tuning per class (META, read by src/game/sim/ai.ts). */
export interface EnemyAiDef {
  /** 0..1 gunnery/seamanship: lead growth over the run, spread tightening, T-crossing and stern rakes. */
  skill: number;
  /** Preferred engagement distance as a fraction of the attack range. */
  rangeFrac: number;
  /** Turn and run below this HP fraction (0 = never). Retreats once per ship. */
  retreatBelow: number;
  /** Area radius (m) for mortars and blasts. */
  area: number;
  /** Chance per engagement cycle to break off and ram (aggressive corsairs). */
  ramChance: number;
  /** Hull fraction the guns are spread over (visual origin of a volley). */
  gunSpan: number;
  /** Kamikaze: ignition distance (m), fuse (s) and burn speed multiplier. */
  igniteRange: number;
  fuse: number;
  burnSpeed: number;
  /** Line-abreast formation spacing (m) when spawned as a group; 0 = no formation. */
  formation: number;
  /** Doubloon pieces value when a doubloon drops. */
  doubloons: number;
}

const AI = (o: Partial<EnemyAiDef>): EnemyAiDef => ({
  skill: 0.3, rangeFrac: 0.75, retreatBelow: 0, area: 0, ramChance: 0, gunSpan: 0.6,
  igniteRange: 0, fuse: 0, burnSpeed: 1, formation: 0, doubloons: 1, ...o,
});

export const ENEMY_AI: Readonly<Record<EnemyId, EnemyAiDef>> = {
  skiff: AI({ skill: 0.2 }),
  cutter: AI({ skill: 0.35, rangeFrac: 0.62 }),
  brig: AI({ skill: 0.45, rangeFrac: 0.78, retreatBelow: 0.25 }),
  fireship: AI({ skill: 0.3, area: 26, igniteRange: 75, fuse: 1.7, burnSpeed: 1.4 }),
  'mortar-barge': AI({ skill: 0.5, area: 14, retreatBelow: 0.3, doubloons: 2 }),
  frigate: AI({ skill: 0.6, rangeFrac: 0.8, retreatBelow: 0.2, formation: 46, doubloons: 2 }),
  'man-o-war': AI({ skill: 0.75, rangeFrac: 0.8, gunSpan: 0.7, doubloons: 5 }),
  'corsair-brig': AI({ skill: 0.35, rangeFrac: 0.6, ramChance: 0.35, retreatBelow: 0.2 }),
  'corsair-galleon': AI({ skill: 0.5, rangeFrac: 0.75, retreatBelow: 0.25, gunSpan: 0.7, doubloons: 3 }),
  wraith: AI({ skill: 0.6, rangeFrac: 0.7 }),
  wyrmling: AI({ skill: 0.5 }),
  fort: AI({ skill: 0.55, area: 13, doubloons: 4 }),
};
