/** Allocation-free single update range for a BufferAttribute (three clears the list after each upload). */
import type * as THREE from 'three';

const cache = new WeakMap<object, { start: number; count: number }>();

export function uploadRange(attr: THREE.BufferAttribute | THREE.InterleavedBuffer, start: number, count: number): void {
  let r = cache.get(attr);
  if (!r) { r = { start: 0, count: 0 }; cache.set(attr, r); }
  r.start = start; r.count = count;
  attr.updateRanges.length = 0;
  if (count > 0) { attr.updateRanges.push(r); attr.needsUpdate = true; }
}
