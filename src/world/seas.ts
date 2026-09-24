/**
 * Sea flavour for world generation (WORLD-owned).
 *
 * How a sea biases the world: `new IslandField(seed, { sea })` looks up a SeaBias here. The bias changes (1) how
 * often a 600 m cell holds a feature, (2) the feature-kind mix (islands, rock clusters, sea stacks, landmarks),
 * (3) the island size mix, (4) the biome mix, and (5) how often islands carry ruins. The render side reads
 * `palette` (via IslandField.palette or the run's seaId) to pick colour scripts. Without a sea the field uses
 * Sunward's mix, so old callers (`new IslandField(seed)`) keep working.
 */
import type { IslandBiome } from '../game/types';

export type FeatureKind = 'island' | 'rocks' | 'stacks' | 'arch' | 'lighthouse' | 'giant-tree' | 'shipwreck' | 'ruins' | 'harbor-set';
export type SizeClass = 'small' | 'medium' | 'large';
export type PaletteId = 'sunward' | 'stormwrack' | 'gloam';

export interface SeaBias {
  id: string;
  palette: PaletteId;
  /** Chance that a cell holds a feature at all (the rest is open water for fleet battles). */
  density: number;
  kinds: Partial<Record<FeatureKind, number>>;
  sizes: Record<SizeClass, number>;
  biomes: Partial<Record<IslandBiome, number>>;
  /** Chance a plain island also carries ruins (The Gloam is full of them). */
  ruinsChance: number;
}

export const SEA_BIAS: Readonly<Record<string, SeaBias>> = {
  'sunward-shallows': {
    id: 'sunward-shallows', palette: 'sunward', density: 0.85,
    kinds: { island: 0.56, rocks: 0.11, stacks: 0.08, arch: 0.06, lighthouse: 0.05, 'giant-tree': 0.04, shipwreck: 0.07, ruins: 0.03 },
    sizes: { small: 0.32, medium: 0.44, large: 0.24 },
    biomes: { tropical: 0.46, rocky: 0.14, harbor: 0.12, fort: 0.12, volcanic: 0.06, reef: 0.1 },
    ruinsChance: 0.03,
  },
  'stormwrack-reach': {
    id: 'stormwrack-reach', palette: 'stormwrack', density: 0.86,
    kinds: { island: 0.5, rocks: 0.14, stacks: 0.16, arch: 0.06, lighthouse: 0.07, 'giant-tree': 0.01, shipwreck: 0.05, ruins: 0.01 },
    sizes: { small: 0.3, medium: 0.44, large: 0.26 },
    biomes: { rocky: 0.44, fort: 0.18, volcanic: 0.16, tropical: 0.1, harbor: 0.06, reef: 0.06 },
    ruinsChance: 0.06,
  },
  'the-gloam': {
    id: 'the-gloam', palette: 'gloam', density: 0.84,
    kinds: { island: 0.46, rocks: 0.12, stacks: 0.12, arch: 0.04, lighthouse: 0.04, 'giant-tree': 0.08, shipwreck: 0.08, ruins: 0.06 },
    sizes: { small: 0.32, medium: 0.44, large: 0.24 },
    biomes: { rocky: 0.36, tropical: 0.22, volcanic: 0.12, fort: 0.1, harbor: 0.06, reef: 0.14 },
    ruinsChance: 0.4,
  },
};

export function seaBias(sea?: string | null): SeaBias {
  return (sea && SEA_BIAS[sea]) || SEA_BIAS['sunward-shallows']!;
}

export function paletteForSea(sea?: string | null): PaletteId { return seaBias(sea).palette; }
