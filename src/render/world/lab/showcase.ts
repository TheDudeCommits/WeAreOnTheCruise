/**
 * Showcase features for the world lab and world tests (WORLD-owned): one feature per biome and landmark, laid out
 * 900 m apart so each can be framed on its own.
 */
import { buildFeatureAt, type FeatureRecipe, type WorldFeature } from '../../../world/features';
import { seaBias, type PaletteId } from '../../../world/seas';
import { StaticWorld } from '../../../world/StaticWorld';

export interface Showcase {
  name: string;
  label: string;
  recipe: FeatureRecipe;
  /** Camera azimuth (radians, outline convention) for the hero view. */
  view: number;
}

export const SHOWCASES: readonly Showcase[] = [
  { name: 'tropical', label: 'Tropical', recipe: { kind: 'island', biome: 'tropical', size: 'large', seed: 1101 }, view: 0.6 },
  { name: 'rocky', label: 'Rocky mesa', recipe: { kind: 'island', biome: 'rocky', size: 'large', seed: 2207 }, view: 2.2 },
  { name: 'stacks', label: 'Sea stacks', recipe: { kind: 'stacks', seed: 3303 }, view: 1.1 },
  { name: 'volcanic', label: 'Volcanic', recipe: { kind: 'island', biome: 'volcanic', size: 'large', seed: 4409 }, view: 3.6 },
  { name: 'fort', label: 'Fort', recipe: { kind: 'island', biome: 'fort', size: 'medium', seed: 5501 }, view: 0.2 },
  { name: 'harbor', label: 'Harbour', recipe: { kind: 'island', biome: 'harbor', size: 'large', seed: 6607 }, view: 0 },
  { name: 'arch', label: 'Sea arch', recipe: { kind: 'arch', seed: 7703 }, view: 1.57 },
  { name: 'lighthouse', label: 'Lighthouse', recipe: { kind: 'lighthouse', seed: 8809 }, view: 4.2 },
  { name: 'giant-tree', label: 'Giant tree', recipe: { kind: 'giant-tree', seed: 9901 }, view: 5.2 },
  { name: 'shipwreck', label: 'Shipwreck reef', recipe: { kind: 'shipwreck', seed: 1013 }, view: 0.9 },
  { name: 'rocks', label: 'Rock cluster', recipe: { kind: 'rocks', seed: 1117 }, view: 2.9 },
  { name: 'storm', label: 'Stormwrack', recipe: { kind: 'island', biome: 'rocky', size: 'large', seed: 1219, palette: 'stormwrack' }, view: 1.9 },
  { name: 'gloam', label: 'Gloam ruins', recipe: { kind: 'ruins', seed: 1321, palette: 'gloam' }, view: 4.8 },
];

export const SHOWCASE_SPACING = 900;

export function showcasePosition(index: number): { x: number; z: number } {
  const cols = 5;
  return { x: (index % cols) * SHOWCASE_SPACING - 1800, z: -Math.floor(index / cols) * SHOWCASE_SPACING - 1200 };
}

export function buildShowcaseWorld(palette: PaletteId = 'sunward'): { world: StaticWorld; features: Map<string, WorldFeature> } {
  const features = new Map<string, WorldFeature>();
  const list: WorldFeature[] = [];
  SHOWCASES.forEach((s, i) => {
    const p = showcasePosition(i);
    const bias = seaBias(s.recipe.palette === 'stormwrack' ? 'stormwrack-reach' : s.recipe.palette === 'gloam' ? 'the-gloam' : null);
    const f = buildFeatureAt(`lab:${s.name}`, p.x, p.z, { ...s.recipe, palette: s.recipe.palette ?? palette }, bias);
    features.set(s.name, f);
    list.push(f);
  });
  return { world: new StaticWorld(list, 'world-lab', palette), features };
}
