/**
 * Allocation-free water height for high-frequency FX queries (every projectile, emitter and debris plank each
 * frame). Evaluates the shared Gerstner waves from src/core/waves.ts (the same set the ocean, the decals and
 * the ship buoyancy use), then adds a per-frame correction measured against OceanServices.heightAt at the
 * camera focus, so a sea-level change in the OCEAN implementation still lines up.
 */
import { DEFAULT_GERSTNER_WAVES } from '../../../core/waves';
import type { OceanServices } from '../../frame';

const N = DEFAULT_GERSTNER_WAVES.length;
const DX = new Float64Array(N);
const DZ = new Float64Array(N);
const AMP = new Float64Array(N);
const K = new Float64Array(N);
const W = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const w = DEFAULT_GERSTNER_WAVES[i]!;
  const l = Math.hypot(w.directionX, w.directionZ) || 1;
  DX[i] = w.directionX / l; DZ[i] = w.directionZ / l;
  AMP[i] = w.amplitude;
  K[i] = (Math.PI * 2) / Math.max(0.001, w.wavelength);
  W[i] = K[i]! * w.speed;
}

export class WaterSampler {
  time = 0;
  strength = 1;
  offset = 0;

  /** Call once per frame with the ocean clock/strength; measures the offset against the real service. */
  sync(time: number, strength: number, ocean: OceanServices | null, fx: number, fz: number): void {
    this.time = time;
    this.strength = Math.max(0, strength);
    this.offset = 0;
    if (ocean) {
      const real = ocean.heightAt(fx, fz);
      if (Number.isFinite(real)) this.offset = real - this.raw(fx, fz);
      if (Math.abs(this.offset) > 30) this.offset = 0;
    }
  }

  private raw(x: number, z: number): number {
    let h = 0;
    const t = this.time;
    for (let i = 0; i < N; i++) h += AMP[i]! * Math.sin(K[i]! * (DX[i]! * x + DZ[i]! * z) - W[i]! * t);
    return h * this.strength;
  }

  height(x: number, z: number): number { return this.raw(x, z) + this.offset; }
}
