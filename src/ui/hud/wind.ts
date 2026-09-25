/** Points of sail for the HUD (wind arrow, in-irons warning, coach): the same convention as the sim's polar. */
import type { SeaState } from '../../game/types';

/** Below this angle between bow and wind source the ship is "in irons" (the polar gives ≤ ~0.6 speed). */
export const IRONS_ANGLE = 0.62;

/**
 * Angle between the bow and where the wind comes from: 0 = bow into the wind (in irons) … π = running dead downwind.
 * `sea.windDir` is the direction the wind blows TOWARD (sin, cos in world XZ); a heading equal to it points into it.
 */
export function angleOffWind(heading: number, sea: Readonly<SeaState>): number {
  let off = (heading - sea.windDir) % (Math.PI * 2);
  if (off < 0) off += Math.PI * 2;
  if (off > Math.PI) off = Math.PI * 2 - off;
  return off;
}

export const inIrons = (heading: number, sea: Readonly<SeaState>): boolean => angleOffWind(heading, sea) < IRONS_ANGLE;
