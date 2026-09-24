/**
 * Shore distance field (OCEAN-owned). A low-res, world-anchored signed-distance texture around the focus built
 * from WorldQuery.shoreDistance, used for teal shallows and animated shore foam.
 *
 * The texture is toroidal: texel (i, j) holds world cell (I, J) with i = I mod N, j = J mod N, and the shader
 * samples it with RepeatWrapping at uv = world / (N * texel). Moving the window therefore only recomputes the
 * newly exposed strips. New strips are filled with "deep" immediately, then refined near islands under a
 * per-frame time budget (open ocean costs nothing: islandsNear() culls whole strips).
 */
import * as THREE from 'three';
import type { IslandDef, WorldQuery } from '../../game/types';

const toHalf = THREE.DataUtils.toHalfFloat;

interface Rect { x0: number; z0: number; x1: number; z1: number; row: number }

export class ShoreField {
  readonly texture: THREE.DataTexture;
  readonly n: number;
  readonly texel: number;
  readonly maxDistance: number;
  /** Vector4(windowCentreX, windowCentreZ, validHalfSpan, 1 / (n * texel)) for shaders. */
  readonly rect = new THREE.Vector4();
  private readonly data: Uint16Array;
  private readonly deep: number;
  private world: WorldQuery | null = null;
  private wx0 = 0;
  private wz0 = 0;
  private hasWindow = false;
  private readonly queue: Rect[] = [];
  private readonly rectPool: Rect[] = [];
  private readonly islands: IslandDef[] = [];
  private dirty = false;

  constructor(n = 256, texel = 5, maxDistance = 180) {
    this.n = n;
    this.texel = texel;
    this.maxDistance = maxDistance;
    this.deep = toHalf(maxDistance);
    this.data = new Uint16Array(n * n).fill(this.deep);
    this.texture = new THREE.DataTexture(this.data, n, n, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
  }

  /** True once no refinement work is pending. */
  get settled(): boolean { return this.queue.length === 0; }
  /** True when any island is within reach of the window (the shader skips the fetch otherwise). */
  active = false;

  update(world: WorldQuery, focusX: number, focusZ: number, budgetMs = 1.2): void {
    const n = this.n;
    const wx0 = Math.floor(focusX / this.texel) - (n >> 1);
    const wz0 = Math.floor(focusZ / this.texel) - (n >> 1);
    if (world !== this.world || !this.hasWindow || Math.abs(wx0 - this.wx0) >= n || Math.abs(wz0 - this.wz0) >= n) {
      this.world = world;
      this.hasWindow = true;
      this.wx0 = wx0;
      this.wz0 = wz0;
      this.data.fill(this.deep);
      this.dirty = true;
      this.releaseQueue();
      this.enqueue(wx0, wz0, wx0 + n, wz0 + n);
    } else if (wx0 !== this.wx0 || wz0 !== this.wz0) {
      // Newly exposed columns (x) over the new z range, then newly exposed rows.
      if (wx0 > this.wx0) this.exposeStrip(this.wx0 + n, wz0, wx0 + n, wz0 + n);
      else if (wx0 < this.wx0) this.exposeStrip(wx0, wz0, this.wx0, wz0 + n);
      const keepX0 = Math.max(wx0, this.wx0);
      const keepX1 = Math.min(wx0 + n, this.wx0 + n);
      if (wz0 > this.wz0) this.exposeStrip(keepX0, this.wz0 + n, keepX1, wz0 + n);
      else if (wz0 < this.wz0) this.exposeStrip(keepX0, wz0, keepX1, this.wz0);
      this.wx0 = wx0;
      this.wz0 = wz0;
      // Drop queued work that slid out of the window.
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const r = this.queue[i]!;
        r.x0 = Math.max(r.x0, wx0); r.z0 = Math.max(r.z0, wz0);
        r.x1 = Math.min(r.x1, wx0 + n); r.z1 = Math.min(r.z1, wz0 + n);
        if (r.row < r.z0) r.row = r.z0;
        if (r.x0 >= r.x1 || r.row >= r.z1) { this.rectPool.push(r); this.queue.splice(i, 1); }
      }
    }
    this.refine(world, budgetMs);
    const half = (n >> 1) * this.texel;
    this.active = world.islandsNear((wx0 + (n >> 1)) * this.texel, (wz0 + (n >> 1)) * this.texel, half * 1.42 + this.maxDistance, this.islands).length > 0;
    this.rect.set((wx0 + (n >> 1)) * this.texel, (wz0 + (n >> 1)) * this.texel, half - this.texel * 2, 1 / (n * this.texel));
    if (this.dirty) {
      this.texture.needsUpdate = true;
      this.dirty = false;
    }
  }

  private exposeStrip(x0: number, z0: number, x1: number, z1: number): void {
    if (x0 >= x1 || z0 >= z1) return;
    const n = this.n;
    for (let z = z0; z < z1; z++) {
      const row = ((z % n) + n) % n * n;
      for (let x = x0; x < x1; x++) this.data[row + (((x % n) + n) % n)] = this.deep;
    }
    this.dirty = true;
    this.enqueue(x0, z0, x1, z1);
  }

  private enqueue(x0: number, z0: number, x1: number, z1: number): void {
    // Skip strips with no island within reach (the common case on open water).
    const t = this.texel;
    const cx = (x0 + x1) * 0.5 * t;
    const cz = (z0 + z1) * 0.5 * t;
    const reach = Math.hypot(x1 - x0, z1 - z0) * 0.5 * t + this.maxDistance;
    if (this.world!.islandsNear(cx, cz, reach, this.islands).length === 0) return;
    const r = this.rectPool.pop() ?? { x0: 0, z0: 0, x1: 0, z1: 0, row: 0 };
    r.x0 = x0; r.z0 = z0; r.x1 = x1; r.z1 = z1; r.row = z0;
    this.queue.push(r);
  }

  private releaseQueue(): void {
    while (this.queue.length) this.rectPool.push(this.queue.pop()!);
  }

  private refine(world: WorldQuery, budgetMs: number): void {
    if (this.queue.length === 0) return;
    const start = performance.now();
    const n = this.n;
    const t = this.texel;
    const max = this.maxDistance;
    while (this.queue.length > 0) {
      const r = this.queue[0]!;
      const z = r.row;
      // Cull this row against the islands near it.
      const rowZ = (z + 0.5) * t;
      const rowCx = (r.x0 + r.x1) * 0.5 * t;
      const reach = (r.x1 - r.x0) * 0.5 * t + max + t;
      if (world.islandsNear(rowCx, rowZ, reach, this.islands).length > 0) {
        // Only texels within reach of an island's bounding circle can be closer than `max` to a coast.
        let spanMin = Infinity;
        let spanMax = -Infinity;
        for (const island of this.islands) {
          const dz = Math.abs(island.z - rowZ);
          const reachI = island.radius + max + t;
          if (dz > reachI) continue;
          const halfW = Math.sqrt(reachI * reachI - dz * dz);
          spanMin = Math.min(spanMin, island.x - halfW);
          spanMax = Math.max(spanMax, island.x + halfW);
        }
        const xs = Math.max(r.x0, Math.floor(spanMin / t));
        const xe = Math.min(r.x1, Math.ceil(spanMax / t) + 1);
        const rowBase = ((z % n) + n) % n * n;
        for (let x = xs; x < xe; x++) {
          const d = world.shoreDistance((x + 0.5) * t, rowZ, max);
          this.data[rowBase + (((x % n) + n) % n)] = toHalf(Math.max(-max, Math.min(max, d)));
        }
        if (xe > xs) this.dirty = true;
      }
      r.row++;
      if (r.row >= r.z1) { this.queue.shift(); this.rectPool.push(r); }
      if (performance.now() - start > budgetMs) break;
    }
  }

  dispose(): void { this.texture.dispose(); }
}
