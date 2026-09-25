/** Ship stat bars derived from the content table (normalised against the whole fleet, never hand-typed). */
import { knots } from '../core/format';
import { CONTENT } from '../../game/content';
import { SHIP_IDS } from '../../game/ids';
import type { ShipDef } from '../../game/types';
import type { GlyphId } from '../core/icons';

export interface ShipStatDef { key: string; label: string; glyph: GlyphId; get(s: ShipDef): number; fmt(v: number): string }

export const SHIP_STATS: readonly ShipStatDef[] = [
  { key: 'hull', label: 'Hull', glyph: 'shield', get: (s) => s.hp, fmt: (v) => `${v}` },
  { key: 'armor', label: 'Armour', glyph: 'anchor', get: (s) => s.armor, fmt: (v) => `${v}` },
  { key: 'speed', label: 'Speed', glyph: 'sail', get: (s) => s.maxSpeed, fmt: (v) => `${knots(v)} kn` },
  { key: 'turn', label: 'Turning', glyph: 'wheel', get: (s) => s.turnRate, fmt: (v) => `${Math.round((v * 180) / Math.PI)}°/s` },
  { key: 'guns', label: 'Broadside', glyph: 'cannon', get: (s) => s.broadsideGuns, fmt: (v) => `${v} guns` },
];

const ranges = SHIP_STATS.map((stat) => {
  let lo = Infinity, hi = -Infinity;
  for (const id of SHIP_IDS) { const v = stat.get(CONTENT.ships[id]); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return { lo, hi };
});

/** 0.15..1 bar fill for a stat of a ship relative to the fleet. */
export function statFill(index: number, ship: ShipDef): number {
  const r = ranges[index]!;
  const v = SHIP_STATS[index]!.get(ship);
  return r.hi > r.lo ? 0.15 + 0.85 * ((v - r.lo) / (r.hi - r.lo)) : 1;
}

export const thumbFor = (ship: ShipDef): string => `/assets/sketchfab/thumbnails/${ship.modelKey}.jpg`;
