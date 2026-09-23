/**
 * Allocation-free spatial grid for ship queries (CORE-owned). Rebuilt every tick.
 *
 * Enemies are inserted once, into the cell that holds their centre; buckets are hashed linked lists stored in typed
 * arrays, so a rebuild or a query never allocates. Queries expand by the largest inserted radius, dedupe hashed
 * bucket collisions with a per-item stamp, and fall back to a linear scan when that is cheaper (huge radii).
 * Bosses are few and very large, so SimContext.targetsNear checks them linearly instead of through the grid.
 */
import type { LifeState } from '../types';

/** Anything the grid can hold: a ship circle with a life state. */
export interface GridItem { x: number; z: number; radius: number; life: LifeState }

export class SpatialGrid<T extends GridItem> {
  private readonly mask: number;
  private readonly head: Int32Array;
  private next = new Int32Array(256);
  private stamp = new Int32Array(256);
  private readonly items: T[] = [];
  private count = 0;
  private queryId = 0;
  private maxRadius = 0;

  constructor(private readonly cell = 48, bits = 10) {
    this.mask = (1 << bits) - 1;
    this.head = new Int32Array(1 << bits).fill(-1);
  }

  get size(): number { return this.count; }

  clear(): void {
    this.head.fill(-1);
    this.count = 0;
    this.maxRadius = 0;
  }

  insert(item: T): void {
    if (this.count >= this.next.length) this.grow();
    const i = this.count++;
    this.items[i] = item;
    const h = this.hash(Math.floor(item.x / this.cell), Math.floor(item.z / this.cell));
    this.next[i] = this.head[h]!;
    this.head[h] = i;
    if (item.radius > this.maxRadius) this.maxRadius = item.radius;
  }

  /**
   * Writes live items whose circles intersect the query circle into `out[start..]` (no length changes, no
   * allocation) and returns the new count. Stops when a fixed-size buffer is full.
   */
  collect(x: number, z: number, radius: number, out: T[], start: number): number {
    let n = start;
    if (this.count === 0) return n;
    const cap = out.length;
    const reach = radius + this.maxRadius + 4;
    const cell = this.cell;
    const cx0 = Math.floor((x - reach) / cell), cx1 = Math.floor((x + reach) / cell);
    const cz0 = Math.floor((z - reach) / cell), cz1 = Math.floor((z + reach) / cell);
    const cells = (cx1 - cx0 + 1) * (cz1 - cz0 + 1);
    const items = this.items;
    if (cells >= this.count || cells > 96) {
      for (let i = 0; i < this.count && n < cap; i++) {
        const t = items[i]!;
        if (t.life !== 'alive') continue;
        const dx = t.x - x, dz = t.z - z, rr = t.radius + radius;
        if (dx * dx + dz * dz <= rr * rr) out[n++] = t;
      }
      return n;
    }
    let q = ++this.queryId;
    if (q > 0x3fffffff) { this.stamp.fill(0); this.queryId = q = 1; }
    const stamp = this.stamp, next = this.next, head = this.head;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let i = head[this.hash(cx, cz)]!; i >= 0; i = next[i]!) {
          if (stamp[i] === q) continue;
          stamp[i] = q;
          const t = items[i]!;
          if (t.life !== 'alive') continue;
          const dx = t.x - x, dz = t.z - z, rr = t.radius + radius;
          if (dx * dx + dz * dz <= rr * rr) {
            if (n >= cap) return n;
            out[n++] = t;
          }
        }
      }
    }
    return n;
  }

  private hash(cx: number, cz: number): number {
    return (Math.imul(cx, 0x8da6b343) ^ Math.imul(cz, 0xd8163841)) & this.mask;
  }

  private grow(): void {
    const size = this.next.length * 2;
    const next = new Int32Array(size); next.set(this.next); this.next = next;
    const stamp = new Int32Array(size); stamp.set(this.stamp); this.stamp = stamp;
  }
}
