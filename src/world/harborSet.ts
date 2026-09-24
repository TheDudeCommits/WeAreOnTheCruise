/**
 * Menu harbour set (WORLD-owned): the hand-placed port that frames the title/harbour showcase ship at the origin.
 * The menu camera orbits the origin, so the set is a loose ring (150–480 m out) that reads from every angle:
 * a terraced harbour town with a hilltop keep and piers reaching toward the ship (north), a lighthouse rock (NE),
 * a sea arch (south), a waterfall cliff (NW), sea stacks (E) and a palm island (W). Nothing comes within 140 m of the
 * origin so the orbiting camera never clips it.
 *
 * Deterministic (fixed seeds). Used by WorldVisuals in 'title'/'harbor' screens, and by IslandField when built with
 * `{ menuHarbor: true }` so collision and shore foam match the set.
 */
import { createSeededRandom } from '../core/rng';
import { FeatureBuilder, type WorldFeature } from './features';
import { shapeOf } from './shape';

/** No harbour-set geometry within this radius of the origin (showcase ship + camera orbit). */
export const HARBOR_SET_CLEAR = 140;
/** Radius around the origin the harbour set owns (menus hide streamed features inside it). */
export const HARBOR_SET_RADIUS = 800;

let cached: WorldFeature[] | null = null;

const at = (theta: number, dist: number) => ({ x: Math.sin(theta) * dist, z: Math.cos(theta) * dist });
/** Outline angle pointing from (x, z) back to the origin. */
const toOrigin = (x: number, z: number) => Math.atan2(-x, -z);

export function harborSetFeatures(): readonly WorldFeature[] {
  if (cached) return cached;
  const out: WorldFeature[] = [];
  const builder = (id: string, seed: number) => new FeatureBuilder(`menu:${id}`, seed, createSeededRandom(seed), 'sunward');

  // Harbour town: big gentle hill, bay facing the ship, piers pointing at it, keep on the summit.
  {
    const b = builder('town', 0x4a17);
    const p = at(Math.PI, 300);
    const bay = toOrigin(p.x, p.z);
    const town = b.add(p.x, p.z, { biome: 'harbor', archetype: 'dome', radius: 142, height: 52, bay, stretch: 0.28, axis: bay + Math.PI / 2, beachBias: 0.2 }, 'harbor-town');
    const shape = shapeOf(town);
    for (let j = 0; j < 3; j++) {
      const t = bay + (j - 1) * 0.17;
      const r = shape.coastRadius(t);
      const dx = Math.sin(t), dz = Math.cos(t);
      b.addRect(town.x + dx * (r - 8), town.z + dz * (r - 8), dx, dz, 34 + j * 3, 10, 'harbor', 'pier', 2.6);
    }
    out.push(b.finish('harbor-set'));
  }
  // Lighthouse rock.
  {
    const b = builder('lighthouse', 0x51a3);
    const p = at(Math.PI - 0.95, 250);
    b.add(p.x, p.z, { biome: 'rocky', archetype: 'stack', radius: 20, height: 24 }, 'lighthouse');
    const q = at(Math.PI - 0.8, 300);
    b.add(q.x, q.z, { biome: 'rocky', archetype: 'rock', radius: 7, height: 8 });
    out.push(b.finish('harbor-set'));
  }
  // Waterfall cliff with jungle.
  {
    const b = builder('cliff', 0x6c21);
    const p = at(Math.PI + 1.05, 330);
    b.add(p.x, p.z, { biome: 'tropical', archetype: 'mesa', radius: 95, height: 58, stretch: 0.3, axis: toOrigin(p.x, p.z) + Math.PI / 2, beachBias: -0.3 });
    out.push(b.finish('harbor-set'));
  }
  // Sea stacks to the east.
  {
    const b = builder('stacks', 0x7d33);
    const specs: [number, number, number, number][] = [[Math.PI / 2 - 0.15, 250, 13, 44], [Math.PI / 2 + 0.12, 290, 9, 30], [Math.PI / 2 + 0.35, 235, 7, 22], [Math.PI / 2 - 0.4, 300, 10, 36]];
    for (const [t, d, r, h] of specs) {
      const p = at(t, d);
      b.add(p.x, p.z, { biome: 'tropical', archetype: 'stack', radius: r, height: h });
    }
    out.push(b.finish('harbor-set'));
  }
  // Palm island to the west.
  {
    const b = builder('palms', 0x8e45);
    const p = at(-Math.PI / 2 + 0.1, 300);
    b.add(p.x, p.z, { biome: 'tropical', archetype: 'dome', radius: 62, height: 22, beachBias: 0.8 });
    const q = at(-Math.PI / 2 - 0.35, 250);
    b.add(q.x, q.z, { biome: 'rocky', archetype: 'rock', radius: 6, height: 7 });
    out.push(b.finish('harbor-set'));
  }
  // Sea arch to the south, opening facing the ship.
  {
    const b = builder('arch', 0x9f57);
    const c = at(0.25, 430);
    const axis = toOrigin(c.x, c.z) + Math.PI / 2;
    const radius = 36, height = 74, gap = 70, faceDistance = radius * 0.7;
    const dx = Math.sin(axis), dz = Math.cos(axis);
    const off = gap / 2 + faceDistance;
    const common = { biome: 'tropical' as const, archetype: 'pillar' as const, radius, height, faceDistance, stretch: 0.22, axis: axis + Math.PI / 2 };
    const a = b.add(c.x - dx * off, c.z - dz * off, { ...common, face: axis }, 'arch');
    const d = b.add(c.x + dx * off, c.z + dz * off, { ...common, face: axis + Math.PI }, 'arch');
    b.arch = { ax: a.x, az: a.z, bx: d.x, bz: d.z, crown: height * 1.03, clearance: Math.max(50, height * 0.68), width: radius * 1.05 };
    out.push(b.finish('harbor-set'));
  }
  // A few foreground rocks just outside the camera orbit.
  {
    const b = builder('rocks', 0xa069);
    for (const [t, d, r] of [[0.9, 170, 5], [2.3, 185, 4], [4.1, 160, 4.5], [5.4, 195, 6]] as const) {
      const p = at(t, d);
      b.add(p.x, p.z, { biome: 'rocky', archetype: 'rock', radius: r, height: r * 1.4 + 1 });
    }
    out.push(b.finish('harbor-set'));
  }
  cached = out;
  return out;
}
