/**
 * Deterministic endless island field (WORLD-owned). Implements the WorldQuery contract used by the simulation for
 * collision, spawning and projectile blocking, and by the renderer for meshing and shore foam.
 *
 * Truth: every IslandDef.outline is the collision polygon AND the waterline ring of its render mesh (see
 * src/render/world/terrainGeometry.ts), so ships stop exactly where rock meets water.
 *
 * Layout: 600 m cells, at most one feature per cell (see features.ts); features stay 45 m inside their cell, the
 * start area (300 m around the origin) is open water. Optional `sea` biases biomes/landmarks (see seas.ts);
 * optional `menuHarbor` adds the title-screen harbour set around the origin as real collision/shore geometry.
 */
import { hashString } from '../core/rng';
import type { CircleHit, IslandDef, WorldQuery } from '../game/types';
import { CELL, type WorldFeature, generateCellFeature } from './features';
import { harborSetFeatures } from './harborSet';
import { type BatterySite, batterySites } from './plan';
import { signedDistance as polygonSignedDistance, signedDistanceValue, type SignedDistance } from './polygon';
import { type PaletteId, type SeaBias, seaBias } from './seas';

export { CELL, START_CLEAR } from './features';
export type { WorldFeature } from './features';

export interface IslandFieldOptions {
  /** Sea id (e.g. 'stormwrack-reach') biasing biomes, landmarks and palettes. Default: Sunward mix. */
  sea?: string | null;
  /** Include the menu harbour set (title/harbour screens) as collision + shore geometry around the origin. */
  menuHarbor?: boolean;
}

const MISS: CircleHit = Object.freeze({ hit: false, nx: 0, nz: 0, depth: 0 }) as CircleHit;
const CACHE_LIMIT = 4096;

const cellKey = (cx: number, cz: number): number => ((cx + 32768) & 0xffff) * 65536 + ((cz + 32768) & 0xffff);

export class IslandField implements WorldQuery {
  readonly seed: string;
  readonly sea: string | null;
  readonly palette: PaletteId;
  readonly includesHarborSet: boolean;
  private readonly seedNumber: number;
  private readonly bias: SeaBias;
  private readonly cache = new Map<number, WorldFeature | null>();
  private readonly extras: readonly WorldFeature[];
  private readonly scratch: IslandDef[] = [];
  private readonly sd: SignedDistance = { distance: 0, nx: 0, nz: 0 };

  constructor(seed: string, options: IslandFieldOptions = {}) {
    this.seed = seed;
    this.sea = options.sea ?? null;
    this.bias = seaBias(this.sea);
    this.palette = this.bias.palette;
    this.seedNumber = hashString(`islands:${seed}`);
    this.includesHarborSet = options.menuHarbor === true;
    this.extras = this.includesHarborSet ? harborSetFeatures() : [];
  }

  /** Feature of one cell (cached). */
  cellFeature(cx: number, cz: number): WorldFeature | null {
    const key = cellKey(cx, cz);
    let f = this.cache.get(key);
    if (f === undefined) {
      if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
      f = generateCellFeature(this.seedNumber, cx, cz, this.bias);
      if (f && this.extras.length) {
        // The harbour set owns the origin; drop generated features that would overlap it.
        for (const e of this.extras) if (Math.hypot(e.x - f.x, e.z - f.z) < e.radius + f.radius + 60) { f = null; break; }
      }
      this.cache.set(key, f);
    }
    return f;
  }

  /** Features (islands with satellites, clusters, landmarks) whose bounds intersect the circle. */
  featuresNear(x: number, z: number, radius: number, out: WorldFeature[] = []): WorldFeature[] {
    out.length = 0;
    const minX = Math.floor((x - radius) / CELL), maxX = Math.floor((x + radius) / CELL);
    const minZ = Math.floor((z - radius) / CELL), maxZ = Math.floor((z + radius) / CELL);
    for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
      const f = this.cellFeature(cx, cz);
      if (f && Math.hypot(f.x - x, f.z - z) <= f.radius + radius) out.push(f);
    }
    for (const f of this.extras) if (Math.hypot(f.x - x, f.z - z) <= f.radius + radius) out.push(f);
    return out;
  }

  islandsNear(x: number, z: number, radius: number, out: IslandDef[] = []): IslandDef[] {
    out.length = 0;
    const minX = Math.floor((x - radius) / CELL), maxX = Math.floor((x + radius) / CELL);
    const minZ = Math.floor((z - radius) / CELL), maxZ = Math.floor((z + radius) / CELL);
    for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
      const f = this.cellFeature(cx, cz);
      if (f) pushIslands(f, x, z, radius, out);
    }
    for (const f of this.extras) pushIslands(f, x, z, radius, out);
    return out;
  }

  collideCircle(x: number, z: number, radius: number): CircleHit {
    let best: CircleHit = MISS;
    for (const island of this.islandsNear(x, z, radius, this.scratch)) {
      const d = polygonSignedDistance(island.outline, x, z, this.sd);
      if (d.distance < radius) {
        const depth = radius - d.distance;
        if (depth > best.depth) best = { hit: true, nx: d.nx, nz: d.nz, depth, islandId: island.id };
      }
    }
    return best;
  }

  isWater(x: number, z: number, margin: number): boolean {
    for (const island of this.islandsNear(x, z, margin, this.scratch)) {
      if (signedDistanceValue(island.outline, x, z) < margin) return false;
    }
    return true;
  }

  shoreDistance(x: number, z: number, max: number): number {
    let best = max;
    for (const island of this.islandsNear(x, z, max, this.scratch)) {
      // Bounding-circle lower bound: skip islands that cannot beat the current best.
      if (Math.hypot(island.x - x, island.z - z) - island.radius >= best) continue;
      const d = signedDistanceValue(island.outline, x, z);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Cliff Battery sites near a point: tower tops of Admiralty forts (see plan.ts). META can spawn stationary
   * 'fort' enemies here; `y` is the platform height and `facing` the seaward yaw (contract heading convention).
   */
  batterySitesNear(x: number, z: number, radius: number, out: BatterySite[] = []): BatterySite[] {
    out.length = 0;
    for (const island of this.islandsNear(x, z, radius, this.scratch)) {
      if (island.landmark !== 'fort') continue;
      for (const site of batterySites(island)) if (Math.hypot(site.x - x, site.z - z) <= radius) out.push(site);
    }
    return out;
  }
}

function pushIslands(f: WorldFeature, x: number, z: number, radius: number, out: IslandDef[]): void {
  const dx = f.x - x, dz = f.z - z, reach = f.radius + radius;
  if (dx * dx + dz * dz > reach * reach) return;
  for (const island of f.islands) {
    const ix = island.x - x, iz = island.z - z, r = island.radius + radius;
    if (ix * ix + iz * iz <= r * r) out.push(island);
  }
}

/** Signed distance from (x,z) to a closed polygon (negative inside) and the outward normal at the closest point. */
export function signedDistance(outline: IslandDef['outline'], x: number, z: number): { distance: number; nx: number; nz: number } {
  return polygonSignedDistance(outline, x, z);
}
