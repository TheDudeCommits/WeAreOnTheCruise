import type { EliteAffixId, EnemyId } from '../ids';
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
    speed: 17, turnRate: 1.7, mass: 40, behavior: 'swarm', contactDamage: 4, xp: 1, doubloonChance: 0.015, firstMinute: 0,
  },
  cutter: {
    id: 'cutter', name: 'Admiralty Cutter', faction: 'admiralty', modelKey: 'sloop', length: 20, radius: 7, hp: 48, armor: 0,
    speed: 15, turnRate: 1.15, mass: 120, behavior: 'chaser', contactDamage: 6, xp: 3, doubloonChance: 0.025, firstMinute: 1,
    attack: { projectile: 'enemy-chaser', damage: 3, cooldown: 3.4, range: 170, count: 1, spread: 0.13, speed: 95, lead: 0.1, telegraph: 0 },
  },
  brig: {
    id: 'brig', name: 'Admiralty Brig', faction: 'admiralty', modelKey: 'brig', length: 28, radius: 10, hp: 110, armor: 1,
    speed: 12.5, turnRate: 0.85, mass: 260, behavior: 'broadside', contactDamage: 8, xp: 5, doubloonChance: 0.04, firstMinute: 2,
    attack: { projectile: 'enemy-cannonball', damage: 5, cooldown: 4.6, range: 150, count: 3, spread: 0.21, speed: 78, lead: 0.25, telegraph: 0 },
  },
  fireship: {
    id: 'fireship', name: 'Fire Ship', faction: 'corsair', modelKey: 'fireship', length: 22, radius: 8, hp: 55, armor: 0,
    speed: 17, turnRate: 1.05, mass: 150, behavior: 'kamikaze', contactDamage: 18, xp: 2, doubloonChance: 0.03, firstMinute: 3,
  },
  'mortar-barge': {
    id: 'mortar-barge', name: 'Mortar Barge', faction: 'admiralty', modelKey: 'mortar-barge', length: 24, radius: 10, hp: 140, armor: 2,
    speed: 7.5, turnRate: 0.6, mass: 400, behavior: 'artillery', contactDamage: 10, xp: 5, doubloonChance: 0.07, firstMinute: 4,
    attack: { projectile: 'enemy-mortar', damage: 9, cooldown: 6.5, range: 300, count: 1, spread: 0, speed: 120, lead: 0.5, telegraph: 2 },
  },
  frigate: {
    id: 'frigate', name: 'Admiralty Frigate', faction: 'admiralty', modelKey: 'frigate', length: 38, radius: 13, hp: 300, armor: 3,
    speed: 11, turnRate: 0.62, mass: 700, behavior: 'broadside', contactDamage: 10, xp: 9, doubloonChance: 0.1, firstMinute: 6,
    attack: { projectile: 'enemy-cannonball', damage: 7, cooldown: 4.8, range: 170, count: 5, spread: 0.17, speed: 82, lead: 0.4, telegraph: 0 },
  },
  'man-o-war': {
    id: 'man-o-war', name: "Man-o'-War", faction: 'admiralty', modelKey: 'man-o-war', length: 50, radius: 17, hp: 850, armor: 5,
    speed: 9, turnRate: 0.45, mass: 1600, behavior: 'broadside', contactDamage: 14, xp: 24, doubloonChance: 0.35, firstMinute: 9,
    attack: { projectile: 'enemy-cannonball', damage: 10, cooldown: 5.5, range: 190, count: 8, spread: 0.13, speed: 88, lead: 0.5, telegraph: 0.7 },
  },
  'corsair-brig': {
    id: 'corsair-brig', name: 'Redtide Brig', faction: 'corsair', modelKey: 'corsair-brig', length: 28, radius: 10, hp: 130, armor: 1,
    speed: 15, turnRate: 0.95, mass: 280, behavior: 'broadside', contactDamage: 9, xp: 5, doubloonChance: 0.07, firstMinute: 3,
    attack: { projectile: 'enemy-cannonball', damage: 5, cooldown: 4.2, range: 135, count: 3, spread: 0.23, speed: 76, lead: 0.2, telegraph: 0 },
  },
  'corsair-galleon': {
    id: 'corsair-galleon', name: 'Redtide Galleon', faction: 'corsair', modelKey: 'corsair-galleon', length: 44, radius: 15, hp: 480, armor: 3,
    speed: 10, turnRate: 0.5, mass: 1100, behavior: 'broadside', contactDamage: 12, xp: 12, doubloonChance: 0.2, firstMinute: 7,
    attack: { projectile: 'enemy-cannonball', damage: 7, cooldown: 5, range: 165, count: 6, spread: 0.18, speed: 80, lead: 0.35, telegraph: 0 },
  },
  wraith: {
    id: 'wraith', name: 'Gloam Wraith', faction: 'wraith', modelKey: 'wraith', length: 30, radius: 11, hp: 160, armor: 1,
    speed: 14, turnRate: 1.0, mass: 200, behavior: 'phase', contactDamage: 10, xp: 5, doubloonChance: 0.07, firstMinute: 2,
    attack: { projectile: 'enemy-cannonball', damage: 7, cooldown: 5, range: 150, count: 4, spread: 0.18, speed: 82, lead: 0.4, telegraph: 0.45 },
  },
  wyrmling: {
    id: 'wyrmling', name: 'Wyrmling', faction: 'deep', modelKey: 'wyrmling', length: 16, radius: 6, hp: 80, armor: 0,
    speed: 18, turnRate: 1.8, mass: 80, behavior: 'lunge', contactDamage: 10, xp: 3, doubloonChance: 0.04, firstMinute: 5,
  },
  fort: {
    id: 'fort', name: 'Cliff Battery', faction: 'admiralty', modelKey: 'fort', length: 20, radius: 12, hp: 600, armor: 4,
    speed: 0, turnRate: 0, mass: 1e6, behavior: 'stationary', contactDamage: 0, xp: 15, doubloonChance: 0.4, firstMinute: 4,
    attack: { projectile: 'enemy-mortar', damage: 9, cooldown: 6.5, range: 300, count: 2, spread: 0.2, speed: 120, lead: 0.4, telegraph: 2 },
  },
  // ── Round 1 (FOES): seven new classes. modelKey is the base hull; src/render/ships/fleet/foeLooks.ts dresses it
  // (props, plating, liveries). Behaviours live in src/game/sim/ai-foes.ts (dispatched by id); tuning in FOES below.
  'signal-cutter': {
    id: 'signal-cutter', name: 'Signal Cutter', faction: 'admiralty', modelKey: 'sloop', length: 20, radius: 7, hp: 46, armor: 0,
    speed: 18.5, turnRate: 1.25, mass: 110, behavior: 'chaser', contactDamage: 5, xp: 5, doubloonChance: 0.05, firstMinute: 3,
    // The flare marks its target; it deals no damage itself (see FOES.signal).
    attack: { projectile: 'enemy-flare', damage: 0, cooldown: 10, range: 260, count: 1, spread: 0, speed: 60, lead: 0.6, telegraph: 1.1 },
  },
  ironclad: {
    id: 'ironclad', name: 'Ironclad', faction: 'admiralty', modelKey: 'brig', length: 30, radius: 11, hp: 300, armor: 3,
    speed: 10.5, turnRate: 0.42, mass: 1100, behavior: 'ram', contactDamage: 18, xp: 9, doubloonChance: 0.1, firstMinute: 6,
  },
  harpooner: {
    id: 'harpooner', name: 'Redtide Harpooner', faction: 'corsair', modelKey: 'corsair-brig', length: 26, radius: 9, hp: 125, armor: 1,
    speed: 14.5, turnRate: 0.95, mass: 240, behavior: 'broadside', contactDamage: 8, xp: 6, doubloonChance: 0.07, firstMinute: 4,
    attack: { projectile: 'enemy-cannonball', damage: 4, cooldown: 5, range: 130, count: 2, spread: 0.2, speed: 76, lead: 0.2, telegraph: 0 },
  },
  'bomb-ketch': {
    id: 'bomb-ketch', name: 'Bomb Ketch', faction: 'corsair', modelKey: 'mortar-barge', length: 24, radius: 9.5, hp: 130, armor: 1,
    speed: 8.5, turnRate: 0.7, mass: 380, behavior: 'artillery', contactDamage: 8, xp: 6, doubloonChance: 0.08, firstMinute: 5,
    // `telegraph` is the shortest keg flight (the circles on the water); `count` kegs per cluster.
    attack: { projectile: 'enemy-bomb', damage: 7, cooldown: 7.5, range: 280, count: 3, spread: 0, speed: 95, lead: 0.45, telegraph: 1.9 },
  },
  'smoke-runner': {
    id: 'smoke-runner', name: 'Smoke Runner', faction: 'corsair', modelKey: 'skiff', length: 14, radius: 5.5, hp: 38, armor: 0,
    speed: 21, turnRate: 1.9, mass: 55, behavior: 'swarm', contactDamage: 4, xp: 3, doubloonChance: 0.03, firstMinute: 2,
    attack: { projectile: 'enemy-chaser', damage: 3, cooldown: 5, range: 130, count: 2, spread: 0.1, speed: 100, lead: 0.3, telegraph: 0 },
  },
  'lantern-wisp': {
    // One hit sinks a wisp: 1 HP before heat scaling (a few HP late in the run; elite wisps a little more).
    id: 'lantern-wisp', name: 'Lantern Wisp', faction: 'wraith', modelKey: 'lantern-wisp', length: 6, radius: 2.6, hp: 1, armor: 0,
    speed: 13, turnRate: 2.2, mass: 20, behavior: 'swarm', contactDamage: 3, xp: 1, doubloonChance: 0.01, firstMinute: 3,
  },
  'drowned-galleon': {
    id: 'drowned-galleon', name: 'Drowned Galleon', faction: 'wraith', modelKey: 'corsair-galleon', length: 44, radius: 15, hp: 560, armor: 3,
    speed: 8.5, turnRate: 0.45, mass: 1300, behavior: 'broadside', contactDamage: 12, xp: 16, doubloonChance: 0.25, firstMinute: 9,
    attack: { projectile: 'enemy-cannonball', damage: 7, cooldown: 5.2, range: 170, count: 6, spread: 0.17, speed: 82, lead: 0.4, telegraph: 0.6 },
  },
  'kraken-arm': {
    id: 'kraken-arm', name: "Kraken's Arm", faction: 'deep', modelKey: 'kraken-arm', length: 26, radius: 6, hp: 220, armor: 1,
    speed: 0, turnRate: 0, mass: 1e6, behavior: 'stationary', contactDamage: 14, xp: 6, doubloonChance: 0.05, firstMinute: 99,
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
  /** Fire-control tokens one attack costs (see DIRECTOR.fireRate). */
  fireCost: number;
}

const AI = (o: Partial<EnemyAiDef>): EnemyAiDef => ({
  skill: 0.3, rangeFrac: 0.75, retreatBelow: 0, area: 0, ramChance: 0, gunSpan: 0.6,
  igniteRange: 0, fuse: 0, burnSpeed: 1, formation: 0, doubloons: 1, fireCost: 1, ...o,
});

export const ENEMY_AI: Readonly<Record<EnemyId, EnemyAiDef>> = {
  skiff: AI({ skill: 0.2 }),
  cutter: AI({ skill: 0.35, rangeFrac: 0.62, fireCost: 0.5 }),
  brig: AI({ skill: 0.45, rangeFrac: 0.78, retreatBelow: 0.25 }),
  fireship: AI({ skill: 0.3, area: 24, igniteRange: 70, fuse: 1.7, burnSpeed: 1.35 }),
  'mortar-barge': AI({ skill: 0.5, area: 14, retreatBelow: 0.3, doubloons: 2 }),
  frigate: AI({ skill: 0.6, rangeFrac: 0.8, retreatBelow: 0.2, formation: 46, doubloons: 2, fireCost: 1.5 }),
  'man-o-war': AI({ skill: 0.75, rangeFrac: 0.8, gunSpan: 0.7, doubloons: 5, fireCost: 2 }),
  'corsair-brig': AI({ skill: 0.35, rangeFrac: 0.6, ramChance: 0.35, retreatBelow: 0.2 }),
  'corsair-galleon': AI({ skill: 0.5, rangeFrac: 0.75, retreatBelow: 0.25, gunSpan: 0.7, doubloons: 3, fireCost: 1.5 }),
  wraith: AI({ skill: 0.6, rangeFrac: 0.7 }),
  wyrmling: AI({ skill: 0.5 }),
  fort: AI({ skill: 0.55, area: 13, doubloons: 4 }),
  // Round 1 (FOES).
  'signal-cutter': AI({ skill: 0.45, rangeFrac: 0.73, doubloons: 2 }),
  ironclad: AI({ skill: 0.55, doubloons: 2 }),
  harpooner: AI({ skill: 0.4, rangeFrac: 0.62, retreatBelow: 0.2 }),
  'bomb-ketch': AI({ skill: 0.5, area: 10, retreatBelow: 0.3, doubloons: 2, fireCost: 1.2 }),
  'smoke-runner': AI({ skill: 0.3, fireCost: 0.4 }),
  'lantern-wisp': AI({ skill: 0.3, area: 12 }),
  'drowned-galleon': AI({ skill: 0.6, rangeFrac: 0.72, gunSpan: 0.7, doubloons: 4, fireCost: 1.5 }),
  'kraken-arm': AI({ skill: 0.5, area: 12 }),
};

/** Round 1 class mechanics (FOES, read by src/game/sim/ai-foes.ts). Distances in m, times in s. */
export const FOES = {
  signal: {
    /** Preferred range: flees inside `range − 40`, closes beyond `range + 50`. */
    range: 190,
    /** Flare flight (s), mark duration (s) and flare reload (s, min/max). */
    flight: 1.1, markTime: 6, cooldown: [9, 12] as const,
    /** Admiralty ships this close to the marked ship fire faster (×reload), tighter (×spread), lead more, cost fewer tokens. */
    buffRadius: 300, reload: 0.6, spread: 0.5, lead: 0.3, fireCost: 0.6,
  },
  ironclad: {
    /** Charges when the target is inside `lineUp` and roughly on the bow. */
    lineUp: 200, windup: 1.2, chargeSpeed: 2.6, chargeLength: 175, recover: [3, 4.5] as const,
    /** Half-angle (rad) of the armoured bow arc; hits taken while the target is inside it deal 30% (CORE's armour floor). */
    bowArc: 0.75, bowArmor: 999,
  },
  harpoon: {
    cooldown: [7, 10] as const, windup: 0.9, speed: 95, range: 165, minRange: 45, damage: 5,
    /** Tether: seconds, tow speed (m/s toward the harpooner), slow magnitude, snap distance. Boost breaks the line. */
    tether: 3.6, tow: 5.5, slow: 0.45, snap: 215,
  },
  bomb: {
    /** Kegs land in a flower: one on the predicted point, the rest on a ring of this radius. */
    ring: 17, blast: 10, patchRadius: 8, patchTtl: 4.5, patchDamage: 2.2, minFlight: 1.9, maxFlight: 3,
  },
  smoke: {
    radius: 24, ttl: 7.5, max: 8, reveal: 1.2,
    /** A screen only hides ships while it is thick (this fraction of its life). */
    thick: 0.8,
  },
  wisp: {
    /** Latch when this close to the hull edge; drain `drain` every 0.5 s for up to `latch` s, then burst. */
    reach: 2.5, latch: 4.5, drain: 1.6, burst: 9, burstRadius: 12,
    /** Inside `dartRange` a wisp darts at the hull at `dart` × its speed. */
    dartRange: 70, dart: 1.7,
  },
  drowned: {
    /** Ring + bubbles telegraph (s), surfacing time (s), breach ring as a fraction of the hull length, breach damage. */
    telegraph: 2.4, rise: 1.4, ring: 0.55, breach: 12, knock: 14,
    surface: [20, 26] as const, deep: [4, 7] as const, dive: 1.5, riseRange: [75, 105] as const,
  },
};

/** Elite affixes (FOES): display names, one-line rules for UI, ring colours for FX/UI, roll weights. */
export interface AffixDef { id: EliteAffixId; name: string; text: string; color: number; weight: number }

export const AFFIXES: Readonly<Record<EliteAffixId, AffixDef>> = {
  swift: { id: 'swift', name: 'Swift', text: 'Faster sails and quicker guns.', color: 0x7fe8ff, weight: 1 },
  armored: { id: 'armored', name: 'Armoured', text: 'Iron plating: small shots glance off.', color: 0xb8c4d6, weight: 1 },
  volatile: { id: 'volatile', name: 'Volatile', text: 'Blows up when sunk. Clear the red ring.', color: 0xff5a2a, weight: 1 },
  vampiric: { id: 'vampiric', name: 'Vampiric', text: 'Heals whenever it hits you.', color: 0xff2e6a, weight: 0.8 },
  shielded: { id: 'shielded', name: 'Shielded', text: 'A regenerating bubble: break it, then sink the ship.', color: 0x4fb4ff, weight: 1 },
  splitting: { id: 'splitting', name: 'Splitting', text: 'Its crew escapes in skiffs when it sinks.', color: 0x9dff5a, weight: 0.9 },
  burning: { id: 'burning', name: 'Burning', text: 'Leaves a trail of burning water.', color: 0xffa31a, weight: 1 },
  commander: { id: 'commander', name: 'Commander', text: 'Rallies nearby ships: faster, harder-hitting guns.', color: 0xc77dff, weight: 0.8 },
};

/** Affix mechanics (read by src/game/sim/affixes.ts; Swift and the Commander aura also by ai.ts / meta-spawn.ts). */
export const AFFIX_TUNING = {
  /** Elites roll one affix, two from this minute. */
  twoFrom: 10,
  armoredArmor: 3, armoredHp: 1.25,
  /** Volatile death blast: radius (m), telegraph (s), damage. */
  volatileRadius: 30, volatileFuse: 1.4, volatileDamage: 16,
  /** Vampiric: hull healed per landed hit (fraction of max hull). */
  vampHeal: 0.025,
  /** Shielded: bubble = fraction of max hull; regen per second (fraction of the bubble) after a delay (longer once broken). */
  shield: 0.35, shieldRegen: 0.14, shieldDelay: 5, shieldBreakDelay: 8,
  /** Splitting: skiffs (or wisps for Gloam ships) that escape the wreck. */
  splitMin: 2, splitMax: 3,
  /** Burning: fire patches dropped astern every `trailEvery` s while under way. */
  trailEvery: 0.8, trailRadius: 6.5, trailTtl: 3.2, trailDamage: 1.8,
};
