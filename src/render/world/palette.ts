/**
 * World colour script (WORLD-owned). Terrain and kit carry their paint in vertex colours (linear space, converted
 * from the sRGB hex below), so one shared toon material draws a whole island. Palettes: sea (sunward / stormwrack /
 * gloam) × biome. Warm sandstone strata and lush tops for Sunward (T2), slate for Stormwrack, cool mossy stone
 * for The Gloam.
 */
import * as THREE from 'three';
import type { IslandBiome } from '../../game/types';
import type { PaletteId } from '../../world/seas';

export interface TerrainPalette {
  /** Cliff strata tones (indexed by StrataBand.tone). */
  strata: THREE.Color[];
  wet: THREE.Color;
  sand: THREE.Color;
  sandWet: THREE.Color;
  grass: THREE.Color;
  grassLight: THREE.Color;
  grassDark: THREE.Color;
  moss: THREE.Color;
  underside: THREE.Color;
  /** Lush (jungle) vs sparse vegetation 0..1. */
  lush: number;
  /** Average strata tone (for calmer, low-contrast cliffs). */
  strataMean: THREE.Color;
}

const c = (hex: number) => new THREE.Color(hex);
const tones = (...hex: number[]) => hex.map(c);

type Recipe = Omit<TerrainPalette, 'lush' | 'strataMean'> & { lush?: number };

const SANDSTONE = tones(0xe49c55, 0xf1cf96, 0xcb7a41, 0xe8b374, 0xb66239);
const PALE_SANDSTONE = tones(0xe0ad78, 0xefd4a4, 0xcd9663, 0xe7c08b, 0xbd8356);
const BASALT = tones(0x4d4450, 0x5f5460, 0x3c353f, 0x6e5a55, 0x332d36);
const LIMESTONE = tones(0xa89a7c, 0x8e8068, 0xc2b18d, 0x7d705c, 0xb5a582);
const SLATE = tones(0x847f7b, 0x9a948c, 0x6f6a67, 0x8f877d, 0x5f5a58);
const GLOAM_STONE = tones(0x7c8886, 0x93a09c, 0x687372, 0x88938e, 0x5b6564);
const GLOAM_BASALT = tones(0x4a4f55, 0x5a6066, 0x3d4247, 0x5f5a5c, 0x34383d);

const SUN_GRASS = { grass: c(0x63b544), grassLight: c(0x98d35a), grassDark: c(0x3b8a3a), moss: c(0x5d9a3b) };
const STORM_GRASS = { grass: c(0x5a8a45), grassLight: c(0x7fa55a), grassDark: c(0x3c6437), moss: c(0x4f7a40) };
const GLOAM_GRASS = { grass: c(0x4f7458), grassLight: c(0x6f927a), grassDark: c(0x34503f), moss: c(0x46664f) };

function recipe(palette: PaletteId, biome: IslandBiome): Recipe {
  const grass = palette === 'sunward' ? SUN_GRASS : palette === 'stormwrack' ? STORM_GRASS : GLOAM_GRASS;
  const sand = palette === 'gloam' ? c(0xb7b3a0) : palette === 'stormwrack' ? c(0xcfc3a4) : c(0xf6e2a8);
  const sandWet = palette === 'gloam' ? c(0x8d8b7c) : palette === 'stormwrack' ? c(0xa39679) : c(0xd6b77e);
  const base = { sand, sandWet, ...grass, underside: c(0x4a3b2d) };
  switch (biome) {
    case 'volcanic':
      return {
        ...base, strata: palette === 'gloam' ? GLOAM_BASALT : BASALT, wet: c(0x241f26), sand: c(0x4b4548), sandWet: c(0x302b2f),
        grass: c(0x7b8a47), grassLight: c(0x9aa75c), grassDark: c(0x56633a), moss: c(0x6b7a45), underside: c(0x1f1a20), lush: 0.25,
      };
    case 'reef':
      return { ...base, strata: LIMESTONE, wet: c(0x4a4a3a), grass: c(0x7a8a4a), grassLight: c(0x9aa95c), grassDark: c(0x5a6a3c), moss: c(0x6f7f45), lush: 0 };
    case 'rocky':
    case 'fort':
      return {
        ...base, strata: palette === 'sunward' ? PALE_SANDSTONE : palette === 'stormwrack' ? SLATE : GLOAM_STONE,
        wet: palette === 'sunward' ? c(0x5e4735) : c(0x33383b), lush: biome === 'fort' ? 0.5 : 0.45,
      };
    default:
      return {
        ...base, strata: palette === 'sunward' ? SANDSTONE : palette === 'stormwrack' ? SLATE : GLOAM_STONE,
        wet: palette === 'sunward' ? c(0x6b4632) : c(0x33383b), lush: 1,
      };
  }
}

const cache = new Map<string, TerrainPalette>();

export function terrainPalette(palette: PaletteId, biome: IslandBiome): TerrainPalette {
  const key = `${palette}:${biome}`;
  let p = cache.get(key);
  if (!p) {
    const r = recipe(palette, biome);
    const mean = new THREE.Color(0, 0, 0);
    for (const t of r.strata) { mean.r += t.r / r.strata.length; mean.g += t.g / r.strata.length; mean.b += t.b / r.strata.length; }
    p = { ...r, lush: r.lush ?? 1, strataMean: mean };
    cache.set(key, p);
  }
  return p;
}

/** Kit colours (linear), shared by forts, towns, docks and lighthouses. */
export const KIT = {
  whiteStone: c(0xf2efe6),
  whiteShade: c(0xd9d5ca),
  navy: c(0x243a6e),
  navyDark: c(0x172750),
  gold: c(0xe2b24a),
  stone: c(0xb9ad98),
  stoneDark: c(0x8f846f),
  wood: c(0x8a5a36),
  woodDark: c(0x5a3a24),
  woodLight: c(0xb07a4a),
  rope: c(0xcdb58a),
  iron: c(0x3a3a40),
  glass: c(0x2b3346),
  lamp: c(0xffd08a),
  thatch: c(0xc9a55e),
  lighthouseRed: c(0xc8423a),
  ruin: c(0xb8b4a2),
  ruinDark: c(0x8c8a7c),
  lava: c(0x3a1a12),
  walls: [c(0xf4ecd8), c(0xf2dcae), c(0xe9c6a8), c(0xd9e4e8), c(0xf1e1c4), c(0xe7d3b6)],
  roofs: [c(0xc4513b), c(0x3f8f7a), c(0x2f4f86), c(0xd9a53a), c(0xa84a3a), c(0x5a7a3a)],
} as const;
