import type { BossId, EnemyId } from '../ids';
import type { BossDef } from '../types';

/**
 * Bosses (META). `hp` is the Sunward (difficulty 1) value; the director multiplies it by
 * `DIRECTOR.bossHpScale` for the sea's difficulty and endless loops. Attack names in `phases` are the
 * strings emitted in 'boss-attack' events (FX/audio key off them) and are implemented in src/game/sim/bosses.ts.
 */
export const BOSSES: Readonly<Record<BossId, BossDef>> = {
  'iron-warden': {
    id: 'iron-warden', name: 'The Iron Warden', title: "Commodore Vane's Dreadnought", modelKey: 'dreadnought',
    length: 90, radius: 30, hp: 3000, armor: 3, speed: 8.5, turnRate: 0.35, mass: 6000, contactDamage: 18, xp: 150, doubloons: 60,
    phases: [
      { hpFraction: 1, name: 'Line of Battle', attacks: ['broadside-volley', 'mortar-barrage', 'summon-cutters'] },
      { hpFraction: 0.5, name: 'Plates Off', attacks: ['broadside-volley', 'mortar-barrage', 'ram-charge'] },
    ],
  },
  tidewyrm: {
    id: 'tidewyrm', name: 'The Tidewyrm', title: 'Serpent of the Deep', modelKey: 'tidewyrm',
    length: 140, radius: 16, hp: 6000, armor: 2, speed: 21, turnRate: 1.1, mass: 5000, contactDamage: 18, xp: 240, doubloons: 100,
    phases: [
      { hpFraction: 1, name: 'Hunting', attacks: ['submerge-lunge', 'tail-slam', 'water-bolts'] },
      { hpFraction: 0.5, name: 'Brood', attacks: ['submerge-lunge', 'tail-slam', 'water-bolts', 'summon-wyrmlings'] },
    ],
  },
  sovereign: {
    id: 'sovereign', name: 'The Sovereign', title: "The Fleet Admiral's Flagship", modelKey: 'sovereign',
    length: 120, radius: 38, hp: 22000, armor: 5, speed: 7.5, turnRate: 0.3, mass: 9000, contactDamage: 34, xp: 400, doubloons: 200,
    phases: [
      { hpFraction: 1, name: 'Broadside Storm', attacks: ['broadside-storm', 'summon-man-o-war', 'broadside-storm'] },
      { hpFraction: 0.6, name: 'Judgment', attacks: ['broadside-storm', 'judgment-line', 'mortar-barrage'] },
      { hpFraction: 0.25, name: 'Last Stand', attacks: ['broadside-storm', 'judgment-line', 'ram-charge', 'summon-man-o-war'] },
    ],
  },
};

export interface VolleyKit {
  /** Guns (= line telegraphs) per side, per phase index (last value repeats). */
  lines: readonly number[];
  /** Waves per attack, per phase. */
  waves: readonly number[];
  /** Fire both sides at once. */
  bothSides: boolean;
  telegraph: number;
  /** Seconds between waves. */
  waveGap: number;
  damage: number;
  speed: number;
  length: number;
  /** Half-width of each line telegraph / ball radius. */
  width: number;
}

export interface MortarKit {
  shells: readonly number[];
  damage: number;
  area: number;
  /** Scatter radius around the player's predicted position. */
  spread: number;
  flight: number;
  salvos: number;
  salvoGap: number;
}

export interface SummonKit { units: readonly { enemy: EnemyId; count: number }[]; cap: number }

export interface RamKit { telegraph: number; speed: number; duration: number; damage: number; length: number; width: number }

export interface LungeKit {
  dive: number;
  travelSpeed: number;
  startDist: number;
  telegraph: number;
  length: number;
  width: number;
  speed: number;
  damage: number;
  recover: number;
}

export interface TailSlamKit { telegraph: number; radius: number; damage: number; waves: number; waveSpeed: number; waveDamage: number; maxDist: number }

export interface BoltKit { fans: readonly number[]; bolts: readonly number[]; spread: number; speed: number; damage: number; windup: number; fanGap: number }

export interface JudgmentKit { lines: readonly number[]; telegraph: number; length: number; width: number; shells: number; damage: number; area: number; stagger: number }

export interface BossKitDef {
  /** Preferred distance from the player while cruising. */
  orbitRange: number;
  /** Attacks start only when the player is within this distance. */
  engageRange: number;
  /** Seconds between attacks per phase (min, max). */
  gap: readonly (readonly [number, number])[];
  /** Speed multiplier per phase. */
  phaseSpeed: readonly number[];
  /** Armour per phase (Iron Warden drops its plates at phase 2). */
  phaseArmor: readonly number[];
  /** Beyond this distance the boss surges to catch up (multiplier grows with distance). */
  catchUpRange: number;
  volley?: VolleyKit;
  storm?: VolleyKit;
  mortar?: MortarKit;
  summonCutters?: SummonKit;
  summonWyrmlings?: SummonKit;
  summonManOWar?: SummonKit;
  ram?: RamKit;
  lunge?: LungeKit;
  tailSlam?: TailSlamKit;
  bolts?: BoltKit;
  judgment?: JudgmentKit;
}

export const BOSS_KITS: Readonly<Record<BossId, BossKitDef>> = {
  'iron-warden': {
    orbitRange: 140, engageRange: 260, gap: [[3, 4.2], [2.4, 3.4]], phaseSpeed: [1, 1.35], phaseArmor: [3, 0], catchUpRange: 300,
    volley: { lines: [5, 6], waves: [1, 2], bothSides: false, telegraph: 1.35, waveGap: 1.3, damage: 11, speed: 88, length: 250, width: 5 },
    mortar: { shells: [5, 7], damage: 11, area: 15, spread: 80, flight: 2.4, salvos: 3, salvoGap: 0.35 },
    summonCutters: { units: [{ enemy: 'cutter', count: 3 }, { enemy: 'skiff', count: 4 }], cap: 80 },
    ram: { telegraph: 1.6, speed: 34, duration: 2.4, damage: 22, length: 300, width: 24 },
  },
  tidewyrm: {
    orbitRange: 130, engageRange: 240, gap: [[2.4, 3.4], [1.8, 2.8]], phaseSpeed: [1, 1.15], phaseArmor: [2, 2], catchUpRange: 280,
    lunge: { dive: 0.8, travelSpeed: 42, startDist: 150, telegraph: 1.2, length: 280, width: 18, speed: 85, damage: 20, recover: 2.2 },
    tailSlam: { telegraph: 1.4, radius: 55, damage: 18, waves: 10, waveSpeed: 26, waveDamage: 4, maxDist: 115 },
    bolts: { fans: [2, 2], bolts: [7, 9], spread: 0.95, speed: 66, damage: 5, windup: 0.7, fanGap: 0.6 },
    summonWyrmlings: { units: [{ enemy: 'wyrmling', count: 4 }], cap: 80 },
  },
  sovereign: {
    orbitRange: 170, engageRange: 300, gap: [[2.4, 3.4], [2, 3], [1.4, 2.2]], phaseSpeed: [1, 1.1, 1.6], phaseArmor: [5, 5, 1], catchUpRange: 330,
    storm: { lines: [5, 6, 7], waves: [3, 3, 4], bothSides: true, telegraph: 1.25, waveGap: 1.3, damage: 20, speed: 92, length: 280, width: 5 },
    mortar: { shells: [10, 12, 14], damage: 20, area: 17, spread: 95, flight: 2.5, salvos: 3, salvoGap: 0.3 },
    judgment: { lines: [1, 1, 2], telegraph: 1.8, length: 520, width: 22, shells: 14, damage: 28, area: 18, stagger: 0.09 },
    summonManOWar: { units: [{ enemy: 'man-o-war', count: 2 }], cap: 84 },
    ram: { telegraph: 1.5, speed: 34, duration: 2.6, damage: 40, length: 320, width: 32 },
  },
};
