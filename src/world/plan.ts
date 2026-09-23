/**
 * Island dressing plans (WORLD-owned, pure): where palms, trees, rocks, kit pieces, waterfalls and battery sites go.
 */
import type { IslandDef } from '../game/types';

export interface BatterySite { islandId: string; x: number; y: number; z: number; facing: number }

export function batterySites(_island: IslandDef): BatterySite[] { return []; }
