/** Uniform-grid spatial hash for ships (rebuilt every tick). CORE-owned. */
export interface SpatialItem { x: number; z: number; radius: number }

export class SpatialHash<T extends SpatialItem> {
  private readonly cells = new Map<number, T[]>();
  private readonly pool: T[][] = [];

  constructor(private readonly cellSize = 40) {}

  clear(): void {
    for (const bucket of this.cells.values()) { bucket.length = 0; this.pool.push(bucket); }
    this.cells.clear();
  }

  private key(cx: number, cz: number): number {
    return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
  }

  insert(item: T): void {
    const minX = Math.floor((item.x - item.radius) / this.cellSize), maxX = Math.floor((item.x + item.radius) / this.cellSize);
    const minZ = Math.floor((item.z - item.radius) / this.cellSize), maxZ = Math.floor((item.z + item.radius) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
      const k = this.key(cx, cz);
      let bucket = this.cells.get(k);
      if (!bucket) { bucket = this.pool.pop() ?? []; this.cells.set(k, bucket); }
      bucket.push(item);
    }
  }

  /** Items whose circles may intersect the query circle. Deduplicated. */
  query(x: number, z: number, radius: number, out: T[]): T[] {
    out.length = 0;
    const minX = Math.floor((x - radius) / this.cellSize), maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize), maxZ = Math.floor((z + radius) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
      const bucket = this.cells.get(this.key(cx, cz));
      if (!bucket) continue;
      for (const item of bucket) {
        const dx = item.x - x, dz = item.z - z, r = item.radius + radius;
        if (dx * dx + dz * dz <= r * r && !out.includes(item)) out.push(item);
      }
    }
    return out;
  }
}
