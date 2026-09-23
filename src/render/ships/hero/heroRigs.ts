/**
 * Hand-tuned hints for the six downloaded hero models (SHIPS-owned), in each model's normalized source space
 * (metres; bow −Z; waterline y = 0; see HERO_SOURCE_LENGTH). The hints only choose WHERE to look: every height, rail
 * line, hull side and mast top is measured from the real geometry at load time by HullSampler (heroProfile.ts).
 */
import type { HeroModelKey } from '../../../game/ids';

/** A deck zone for rail-mounted items: stations between z0..z1, deck surface searched in yMin..yMax. */
export interface RailBand { z0: number; z1: number; yMin: number; yMax: number; /** Inboard inset from the rail edge (m). */ inset: number }
/** A point hint: (x, z) plus the height to search downward from (snaps to the first deck-like surface below). */
export interface PointHint { x: number; y: number; z: number; /** Skip snapping (use y as is). */ fixed?: boolean }

export interface HeroRig {
  /** Rail zones, main deck first (deck cannons, lanterns, swivels, trim). */
  rails: RailBand[];
  /** Broadside gun line: stations z0..z1 at height y (guns sprout from the hull side). */
  guns: { z0: number; z1: number; y: number };
  /** Iron plating band on the hull sides. */
  plating: { z0: number; z1: number; y0: number; y1: number };
  stern: PointHint;
  /** Port/starboard stern pads for fire barrels / mines (mirrored x). */
  sternSide: PointHint;
  sternFlag: PointHint;
  sternLantern: PointHint;
  bow: PointHint;
  /** Stem height used to find the prow tip (iron ram / reinforced prow). */
  prowY: number;
  figurehead: { x: number; y: number; z: number; r: number };
  mid: PointHint;
  totem: PointHint;
  /** Stern sun crest (tier 4): height and radius; z is measured on the transom. */
  crest: { y: number; r: number };
  /** Mast (x, z) positions; the first is the main mast (storm rod). Tops are measured. */
  masts: { x: number; z: number }[];
  /** Extra multiplier on part size for this model. */
  partScale: number;
}

export const HERO_RIGS: Readonly<Record<HeroModelKey, HeroRig>> = {
  'going-merry': {
    rails: [
      { z0: -4.2, z1: 3.8, yMin: 0.4, yMax: 3.4, inset: 1.3 },
      { z0: 9.8, z1: 15.2, yMin: 3.0, yMax: 5.6, inset: 1.1 },
      { z0: -10.2, z1: -6.2, yMin: 2.4, yMax: 5.2, inset: 1.1 },
    ],
    guns: { z0: -6.5, z1: 8.5, y: 1.5 },
    plating: { z0: -9.5, z1: 12.5, y0: 0.2, y1: 1.5 },
    stern: { x: 0, y: 8, z: 15.2 },
    sternSide: { x: 3.2, y: 8, z: 13.2 },
    sternFlag: { x: 0, y: 9, z: 16.3 },
    sternLantern: { x: 0, y: 9, z: 16.4 },
    bow: { x: 0, y: 8, z: -8.6 },
    prowY: 1.2,
    figurehead: { x: 0, y: 7.4, z: -14.6, r: 2.4 },
    mid: { x: 0, y: 5, z: 2.6 },
    totem: { x: 0, y: 9, z: 7.6 },
    crest: { y: 3.4, r: 2.3 },
    masts: [{ x: 0, z: -1.6 }, { x: 0, z: 12.7 }],
    partScale: 1,
  },
  'thousand-sunny': {
    rails: [
      { z0: -5.2, z1: 6.2, yMin: 4.5, yMax: 8.2, inset: 1.6 },
      { z0: -17, z1: -8.8, yMin: 7, yMax: 12.5, inset: 1.5 },
      { z0: 8.6, z1: 16.5, yMin: 10, yMax: 14.2, inset: 1.5 },
    ],
    guns: { z0: -14, z1: 16, y: 3.6 },
    plating: { z0: -17, z1: 19, y0: 0.8, y1: 3.2 },
    stern: { x: 0, y: 18, z: 16.4 },
    sternSide: { x: 6.2, y: 18, z: 15.5 },
    sternFlag: { x: 0, y: 30, z: 27.3 },
    sternLantern: { x: 5.5, y: 18, z: 20.5 },
    bow: { x: 0, y: 16, z: -15.5 },
    prowY: 3,
    figurehead: { x: 0, y: 15.2, z: -26.2, r: 5.4 },
    mid: { x: 0, y: 9, z: 1.8 },
    totem: { x: -5.5, y: 9, z: -2.5 },
    crest: { y: 9.6, r: 3.6 },
    masts: [{ x: 0, z: -5.4 }, { x: 0, z: 13.5 }],
    partScale: 0.95,
  },
  'navy-galleon': {
    rails: [
      { z0: -19.5, z1: 15.5, yMin: 7, yMax: 11, inset: 1.8 },
      { z0: 18.5, z1: 31, yMin: 13, yMax: 17.5, inset: 1.6 },
    ],
    guns: { z0: -19, z1: 18, y: 7.3 },
    plating: { z0: -24, z1: 27, y0: 2.2, y1: 4.8 },
    stern: { x: 0, y: 19, z: 27.5 },
    sternSide: { x: 6, y: 19, z: 25 },
    sternFlag: { x: 0, y: 19, z: 33.2 },
    sternLantern: { x: 6.5, y: 19, z: 32 },
    bow: { x: 0, y: 14, z: -16.5 },
    prowY: 4,
    figurehead: { x: 0, y: 7.6, z: -30.8, r: 3.2 },
    mid: { x: 0, y: 12, z: 8.6 },
    totem: { x: -7, y: 12, z: -14 },
    crest: { y: 12.5, r: 3.4 },
    masts: [{ x: 0, z: 1 }, { x: 0, z: 13 }, { x: 0, z: 20.4 }, { x: 0, z: -11.6 }],
    partScale: 1,
  },
  'moby-dick': {
    rails: [
      { z0: -21, z1: 38, yMin: 9, yMax: 14.5, inset: 2.4 },
    ],
    guns: { z0: -18, z1: 44, y: 8.5 },
    plating: { z0: -22, z1: 48, y0: 3.2, y1: 6.8 },
    stern: { x: 0, y: 28, z: 47.5 },
    sternSide: { x: 9, y: 28, z: 44 },
    sternFlag: { x: 0, y: 28, z: 53.5 },
    sternLantern: { x: 8.5, y: 28, z: 52 },
    bow: { x: 0, y: 32, z: -38 },
    prowY: 6,
    figurehead: { x: 0, y: 11, z: -57.5, r: 8 },
    mid: { x: 0, y: 16, z: 17 },
    totem: { x: -9, y: 16, z: -6 },
    crest: { y: 15, r: 5.5 },
    masts: [{ x: 0, z: 7.2 }, { x: 0, z: 26.9 }, { x: 0, z: -21.8 }, { x: 0, z: 42.4 }],
    partScale: 1.05,
  },
  baratie: {
    rails: [
      { z0: -24, z1: 24, yMin: 8, yMax: 24, inset: 2.6 },
    ],
    guns: { z0: -20, z1: 20, y: 13.2 },
    plating: { z0: -19, z1: 19, y0: 10.4, y1: 13.8 },
    stern: { x: 0, y: 26, z: 23 },
    sternSide: { x: 9, y: 26, z: 21 },
    sternFlag: { x: 0, y: 26, z: 30.5 },
    sternLantern: { x: 7, y: 26, z: 25.5 },
    bow: { x: 0, y: 30, z: -24.5 },
    prowY: 14,
    figurehead: { x: 0, y: 20.5, z: -35.5, r: 5.2 },
    mid: { x: 0, y: 34, z: 0 },
    totem: { x: 32, y: 26, z: 0 },
    crest: { y: 21, r: 4.4 },
    masts: [{ x: 0, z: -16.3 }, { x: 0, z: 15.3 }],
    partScale: 1.1,
  },
  'polar-tang': {
    rails: [
      { z0: -20.5, z1: -2.5, yMin: 7.2, yMax: 11, inset: 1.4 },
      { z0: 1, z1: 14.5, yMin: 1.2, yMax: 5.2, inset: 1.2 },
    ],
    guns: { z0: -19, z1: 13, y: 3.8 },
    plating: { z0: -21, z1: 15, y0: 0.4, y1: 2.6 },
    stern: { x: 0, y: 8, z: 13.2 },
    sternSide: { x: 4.8, y: 8, z: 11.5 },
    sternFlag: { x: 0, y: 8, z: 16.2 },
    sternLantern: { x: -4.8, y: 8, z: 15.5 },
    bow: { x: 0, y: 14, z: -19.5 },
    prowY: 3,
    figurehead: { x: 0, y: 3.2, z: -25.2, r: 3.4 },
    mid: { x: 0, y: 14, z: -7.2 },
    totem: { x: -5, y: 8, z: 4.2 },
    crest: { y: 4.6, r: 2.6 },
    masts: [{ x: 0, z: -15.4 }, { x: 0, z: 6.6 }],
    partScale: 1,
  },
};
