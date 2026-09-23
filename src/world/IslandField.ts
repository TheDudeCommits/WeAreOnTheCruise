/**
 * Deterministic endless island field (WORLD-owned). Skeleton: one optional island per 560 m cell with a noisy
 * polygon coastline. Collision, spawn checks and shore distance all use the same outline the renderer meshes.
 */
import { createSeededRandom, hashCoordinates, hashString } from '../core/rng';
import type { CircleHit, IslandBiome, IslandDef, Vec2, WorldQuery } from '../game/types';

const CELL = 560;
const CLEAR_RADIUS = 220; // open water around the start

export class IslandField implements WorldQuery {
  readonly seed: string;
  private readonly seedNumber: number;
  private readonly cache = new Map<string, IslandDef | null>();
  private readonly scratch: IslandDef[] = [];

  constructor(seed: string) {
    this.seed = seed;
    this.seedNumber = hashString(`islands:${seed}`);
  }

  private cellIsland(cx: number, cz: number): IslandDef | null {
    const key = `${cx},${cz}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const rng = createSeededRandom(hashCoordinates(this.seedNumber, cx, cz, 17));
    let island: IslandDef | null = null;
    if (rng.chance(0.42)) {
      const radius = rng.range(38, 110);
      const x = (cx + 0.5) * CELL + rng.range(-1, 1) * (CELL / 2 - radius - 30);
      const z = (cz + 0.5) * CELL + rng.range(-1, 1) * (CELL / 2 - radius - 30);
      if (Math.hypot(x, z) > CLEAR_RADIUS + radius) {
        const points = 28;
        const outline: Vec2[] = [];
        const phase = rng.range(0, Math.PI * 2);
        const wobble = [rng.range(0.08, 0.22), rng.range(0.04, 0.12), rng.range(0.02, 0.07)];
        let maxR = 0;
        for (let i = 0; i < points; i++) {
          const a = (i / points) * Math.PI * 2;
          const r = radius * (1 + wobble[0]! * Math.sin(a * 2 + phase) + wobble[1]! * Math.sin(a * 5 + phase * 1.7) + wobble[2]! * Math.sin(a * 9 + phase * 2.3));
          maxR = Math.max(maxR, r);
          outline.push({ x: x + Math.sin(a) * r, z: z + Math.cos(a) * r });
        }
        const biomes: IslandBiome[] = ['tropical', 'tropical', 'rocky', 'tropical', 'volcanic', 'fort'];
        island = {
          id: `isl:${cx}:${cz}`, x, z, radius: maxR, outline, height: rng.range(18, 62), biome: rng.pick(biomes),
          seed: hashCoordinates(this.seedNumber, cx, cz, 91),
        };
      }
    }
    this.cache.set(key, island);
    if (this.cache.size > 4000) this.cache.clear();
    return island;
  }

  islandsNear(x: number, z: number, radius: number, out: IslandDef[] = []): IslandDef[] {
    out.length = 0;
    const minX = Math.floor((x - radius) / CELL), maxX = Math.floor((x + radius) / CELL);
    const minZ = Math.floor((z - radius) / CELL), maxZ = Math.floor((z + radius) / CELL);
    for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
      const island = this.cellIsland(cx, cz);
      if (island && Math.hypot(island.x - x, island.z - z) <= island.radius + radius) out.push(island);
    }
    return out;
  }

  collideCircle(x: number, z: number, radius: number): CircleHit {
    let best: CircleHit = { hit: false, nx: 0, nz: 0, depth: 0 };
    for (const island of this.islandsNear(x, z, radius, this.scratch)) {
      const d = signedDistance(island.outline, x, z);
      if (d.distance < radius) {
        const depth = radius - d.distance;
        if (depth > best.depth) best = { hit: true, nx: d.nx, nz: d.nz, depth, islandId: island.id };
      }
    }
    return best;
  }

  isWater(x: number, z: number, margin: number): boolean {
    for (const island of this.islandsNear(x, z, margin, this.scratch)) {
      if (signedDistance(island.outline, x, z).distance < margin) return false;
    }
    return true;
  }

  shoreDistance(x: number, z: number, max: number): number {
    let best = max;
    for (const island of this.islandsNear(x, z, max, this.scratch)) best = Math.min(best, signedDistance(island.outline, x, z).distance);
    return best;
  }
}

/** Signed distance from (x,z) to a closed polygon (negative inside) and the outward normal at the closest point. */
export function signedDistance(outline: readonly Vec2[], x: number, z: number): { distance: number; nx: number; nz: number } {
  let minSq = Infinity, nx = 0, nz = 0, inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j]!, b = outline[i]!;
    if ((b.z > z) !== (a.z > z) && x < ((a.x - b.x) * (z - b.z)) / (a.z - b.z) + b.x) inside = !inside;
    const ex = b.x - a.x, ez = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
    const px = a.x + ex * t, pz = a.z + ez * t;
    const dx = x - px, dz = z - pz, sq = dx * dx + dz * dz;
    if (sq < minSq) { minSq = sq; nx = dx; nz = dz; }
  }
  const d = Math.sqrt(minSq) || 1e-6;
  const sign = inside ? -1 : 1;
  return { distance: sign * d, nx: (nx / d) * sign, nz: (nz / d) * sign };
}
