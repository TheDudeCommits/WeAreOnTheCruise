/** Voice categories: caps, routing and distance models (AUDIO-owned). */
import type { CategoryId } from './types';

export type BusId = 'ui' | 'music' | 'world' | 'worldDucked' | 'ambience';

export interface CategorySpec {
  /** Max simultaneous voices; extra triggers steal the weakest voice or are dropped. */
  cap: number;
  bus: BusId;
  /** Positioned relative to the listener (pan, distance gain, air absorption). */
  spatial: boolean;
  /** Distance (m) at full level. */
  ref: number;
  /** Beyond this distance the cue is culled. */
  maxDistance: number;
  /** Inverse-distance rolloff factor. */
  rolloff: number;
  /** Density compensation: each already-active voice lowers a new voice by 1/sqrt(1 + k·n). */
  density: number;
  /** Default stealing priority (cue priority overrides). */
  priority: number;
}

export const CATEGORIES: Readonly<Record<CategoryId, CategorySpec>> = {
  ui:        { cap: 4,  bus: 'ui',          spatial: false, ref: 1,   maxDistance: 1,    rolloff: 1,   density: 0.35, priority: 70 },
  stinger:   { cap: 3,  bus: 'music',       spatial: false, ref: 1,   maxDistance: 1,    rolloff: 1,   density: 0,    priority: 95 },
  cannon:    { cap: 12, bus: 'worldDucked', spatial: true,  ref: 55,  maxDistance: 950,  rolloff: 0.9, density: 0.16, priority: 55 },
  weapon:    { cap: 10, bus: 'worldDucked', spatial: true,  ref: 45,  maxDistance: 700,  rolloff: 1,   density: 0.2,  priority: 45 },
  impact:    { cap: 16, bus: 'worldDucked', spatial: true,  ref: 35,  maxDistance: 520,  rolloff: 1,   density: 0.22, priority: 35 },
  explosion: { cap: 8,  bus: 'world',       spatial: true,  ref: 70,  maxDistance: 1200, rolloff: 0.9, density: 0.3,  priority: 65 },
  pickup:    { cap: 6,  bus: 'worldDucked', spatial: false, ref: 1,   maxDistance: 1,    rolloff: 1,   density: 0.45, priority: 30 },
  player:    { cap: 6,  bus: 'world',       spatial: false, ref: 1,   maxDistance: 1,    rolloff: 1,   density: 0.2,  priority: 80 },
  boss:      { cap: 4,  bus: 'world',       spatial: true,  ref: 160, maxDistance: 2400, rolloff: 0.7, density: 0.1,  priority: 90 },
  world:     { cap: 8,  bus: 'world',       spatial: true,  ref: 80,  maxDistance: 1400, rolloff: 0.8, density: 0.15, priority: 40 },
  ambience:  { cap: 12, bus: 'ambience',    spatial: false, ref: 40,  maxDistance: 320,  rolloff: 1,   density: 0,    priority: 20 },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];

/** Global voice ceiling across every category (CPU guard). */
export const MAX_VOICES = 72;
