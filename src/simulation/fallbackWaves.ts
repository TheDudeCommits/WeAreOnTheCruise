import type { OceanSample, OceanSampler } from './types';

/** Lightweight deterministic wave field used until the renderer injects its shared sampler. */
export class FallbackWaveSampler implements OceanSampler {
  sample(x: number, z: number, time: number): OceanSample {
    const a = x * 0.032 + z * 0.019 + time * 0.72;
    const b = x * -0.071 + z * 0.046 + time * 1.18;
    const c = x * 0.018 + z * -0.055 + time * 0.44;
    const height = Math.sin(a) * 0.85 + Math.sin(b) * 0.32 + Math.sin(c) * 0.58;
    const dx = Math.cos(a) * 0.032 * 0.85 + Math.cos(b) * -0.071 * 0.32 + Math.cos(c) * 0.018 * 0.58;
    const dz = Math.cos(a) * 0.019 * 0.85 + Math.cos(b) * 0.046 * 0.32 + Math.cos(c) * -0.055 * 0.58;
    const invLength = 1 / Math.hypot(dx, 1, dz);
    return {
      height,
      normal: { x: -dx * invLength, y: invLength, z: -dz * invLength },
      velocity: { x: 0, y: Math.cos(a) * 0.612 + Math.cos(b) * 0.378 + Math.cos(c) * 0.255, z: 0 },
      crest: Math.max(0, Math.min(1, (height - 0.72) * 0.8)),
    };
  }
}
