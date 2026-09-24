/**
 * A fixed set of features behind the WorldQuery contract (WORLD-owned): labs, captures and tests use it to show
 * hand-picked islands with exactly the same collision/shore semantics as the endless IslandField.
 */
import type { CircleHit, IslandDef, WorldQuery } from '../game/types';
import type { WorldFeature } from './features';
import { signedDistance, signedDistanceValue, type SignedDistance } from './polygon';
import type { PaletteId } from './seas';

const MISS: CircleHit = Object.freeze({ hit: false, nx: 0, nz: 0, depth: 0 }) as CircleHit;

export class StaticWorld implements WorldQuery {
  readonly seed: string;
  readonly palette: PaletteId;
  readonly features: WorldFeature[];
  private readonly sd: SignedDistance = { distance: 0, nx: 0, nz: 0 };
  private readonly scratch: IslandDef[] = [];

  constructor(features: WorldFeature[], seed = 'static', palette: PaletteId = 'sunward') {
    this.features = features;
    this.seed = seed;
    this.palette = palette;
  }

  featuresNear(x: number, z: number, radius: number, out: WorldFeature[] = []): WorldFeature[] {
    out.length = 0;
    for (const f of this.features) if (Math.hypot(f.x - x, f.z - z) <= f.radius + radius) out.push(f);
    return out;
  }

  islandsNear(x: number, z: number, radius: number, out: IslandDef[] = []): IslandDef[] {
    out.length = 0;
    for (const f of this.features) {
      if (Math.hypot(f.x - x, f.z - z) > f.radius + radius) continue;
      for (const i of f.islands) if (Math.hypot(i.x - x, i.z - z) <= i.radius + radius) out.push(i);
    }
    return out;
  }

  collideCircle(x: number, z: number, radius: number): CircleHit {
    let best = MISS;
    for (const island of this.islandsNear(x, z, radius, this.scratch)) {
      const d = signedDistance(island.outline, x, z, this.sd);
      if (d.distance < radius && radius - d.distance > best.depth) best = { hit: true, nx: d.nx, nz: d.nz, depth: radius - d.distance, islandId: island.id };
    }
    return best;
  }

  isWater(x: number, z: number, margin: number): boolean {
    for (const island of this.islandsNear(x, z, margin, this.scratch)) if (signedDistanceValue(island.outline, x, z) < margin) return false;
    return true;
  }

  shoreDistance(x: number, z: number, max: number): number {
    let best = max;
    for (const island of this.islandsNear(x, z, max, this.scratch)) {
      if (Math.hypot(island.x - x, island.z - z) - island.radius >= best) continue;
      best = Math.min(best, signedDistanceValue(island.outline, x, z));
    }
    return best;
  }
}
