/**
 * One interleaved instance buffer split into two regions:
 *  - ring  [0, ringCap): fire-and-forget particles. Written once at spawn (partial upload), then animated
 *          analytically on the GPU until they expire. The whole ring is always drawn; dead slots cull in the
 *          vertex shader.
 *  - immediate [ringCap, ringCap + immCap): rebuilt every frame from RunState (projectiles, hazards, pickups...).
 * No per-frame allocations: update ranges are preallocated objects.
 */
import * as THREE from 'three';

interface Range { start: number; count: number }

export class InstancePool {
  readonly data: Float32Array;
  readonly buffer: THREE.InstancedInterleavedBuffer;
  private ringHead = 0;
  private ringWritten = 0;
  private ringFrameStart = 0;
  private immCount = 0;
  private fullRing = false;
  private readonly ranges: Range[] = [{ start: 0, count: 0 }, { start: 0, count: 0 }, { start: 0, count: 0 }];
  /** Instances dropped this frame because the immediate region was full (diagnostics). */
  overflow = 0;
  /** Total ring allocations since creation (for spawn-rate / pressure estimates). */
  allocated = 0;

  constructor(readonly stride: number, readonly ringCap: number, readonly immCap: number) {
    this.data = new Float32Array(stride * Math.max(1, ringCap + immCap));
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, stride, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
  }

  /** Adds `size` floats at `offset` as an interleaved attribute on `geometry`. */
  attach(geometry: THREE.BufferGeometry, name: string, size: number, offset: number): void {
    geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, size, offset));
  }

  /** Float offset of the next ring slot (overwrites the oldest when full). */
  allocRing(): number {
    if (this.ringCap === 0) return -1;
    const i = this.ringHead;
    this.allocated++;
    this.ringHead = i + 1 === this.ringCap ? 0 : i + 1;
    if (this.ringWritten < this.ringCap) this.ringWritten++;
    return i * this.stride;
  }

  /** Float offset of the next immediate slot, or -1 when full. */
  allocImm(): number {
    if (this.immCount >= this.immCap) { this.overflow++; return -1; }
    const i = this.ringCap + this.immCount++;
    return i * this.stride;
  }

  get immediateCount(): number { return this.immCount; }

  /** Call once per frame before writing immediate instances. */
  beginFrame(): void {
    this.immCount = 0;
    this.overflow = 0;
    this.ringFrameStart = this.ringHead;
    this.ringWritten = 0;
  }

  /** Uploads what changed this frame and returns the instance count to draw. */
  flush(): number {
    const b = this.buffer;
    const s = this.stride;
    let n = 0;
    if (this.fullRing) {
      this.fullRing = false;
      this.setRange(n++, 0, this.ringCap * s);
    } else if (this.ringWritten > 0) {
      const start = this.ringFrameStart;
      const end = start + this.ringWritten;
      if (end <= this.ringCap) {
        this.setRange(n++, start * s, this.ringWritten * s);
      } else {
        this.setRange(n++, start * s, (this.ringCap - start) * s);
        this.setRange(n++, 0, (end - this.ringCap) * s);
      }
    }
    if (this.immCount > 0) this.setRange(n++, this.ringCap * s, this.immCount * s);
    if (n > 0) {
      b.clearUpdateRanges();
      for (let i = 0; i < n; i++) b.updateRanges.push(this.ranges[i]!);
      b.needsUpdate = true;
    }
    return this.ringCap + this.immCount;
  }

  private setRange(i: number, start: number, count: number): void {
    const r = this.ranges[i]!;
    r.start = start; r.count = count;
  }

  /** Kills every ring particle (new run / lab reset). `lifeOffset` = float index of the life field. */
  clearRing(lifeOffset: number): void {
    const s = this.stride;
    for (let i = 0; i < this.ringCap; i++) this.data[i * s + lifeOffset] = 0;
    this.ringHead = 0;
    this.ringFrameStart = 0;
    this.ringWritten = 0;
    this.fullRing = true;
  }
}
