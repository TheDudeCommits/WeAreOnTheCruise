/**
 * Colour script (LOOK-owned): per time-of-day and per-weather grades for the final composite.
 * Six looks from the style bible — dawn gold, noon cobalt, golden-hour amber/violet, night indigo with lantern
 * orange, storm teal-grey with lightning white, fog pearl — as parametric grades blended by hour and weather.
 * Values are display-space (after the tone map).
 */
import * as THREE from 'three';

export interface Grade {
  exposure: number;
  lift: THREE.Color;
  gamma: THREE.Vector3;
  gain: THREE.Color;
  saturation: number;
  contrast: number;
  shadowTint: THREE.Color;
  highlightTint: THREE.Color;
  split: number;
  vignette: number;
  vignetteColor: THREE.Color;
  bloomStrength: number;
  bloomThreshold: number;
}

interface GradeSpec {
  exposure: number; lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number];
  saturation: number; contrast: number; shadowTint: number; highlightTint: number; split: number;
  vignette: number; vignetteColor: number; bloomStrength: number; bloomThreshold: number;
}

const SPECS: Record<'night' | 'dawn' | 'noon' | 'golden' | 'dusk' | 'storm' | 'fog', GradeSpec> = {
  night: {
    exposure: 1.08, lift: [0.02, 0.035, 0.08], gamma: [1, 1.02, 1.06], gain: [0.93, 1.0, 1.12], saturation: 0.95, contrast: 1.06,
    shadowTint: 0x2a3a86, highlightTint: 0xffc98a, split: 0.28, vignette: 0.42, vignetteColor: 0x040818, bloomStrength: 1.0, bloomThreshold: 0.75,
  },
  dawn: {
    exposure: 1.0, lift: [0.025, 0.012, 0.035], gamma: [1.02, 1, 0.98], gain: [1.05, 0.99, 0.93], saturation: 1.06, contrast: 1.03,
    shadowTint: 0x5b5ca8, highlightTint: 0xffd6a0, split: 0.22, vignette: 0.26, vignetteColor: 0x1a1236, bloomStrength: 0.7, bloomThreshold: 0.98,
  },
  noon: {
    exposure: 1.0, lift: [0.0, 0.006, 0.02], gamma: [1, 1, 1.01], gain: [1.0, 1.0, 1.02], saturation: 1.1, contrast: 1.05,
    shadowTint: 0x3553b4, highlightTint: 0xfff4e2, split: 0.12, vignette: 0.2, vignetteColor: 0x0a1a44, bloomStrength: 0.55, bloomThreshold: 1.05,
  },
  golden: {
    exposure: 1.03, lift: [0.022, 0.012, 0.03], gamma: [1.03, 1.0, 0.97], gain: [1.08, 0.99, 0.86], saturation: 1.1, contrast: 1.05,
    shadowTint: 0x4c58a8, highlightTint: 0xffc070, split: 0.28, vignette: 0.3, vignetteColor: 0x1a1430, bloomStrength: 0.85, bloomThreshold: 0.92,
  },
  // Dusk (round 2): warm amber highlights over blue shadows. The old green-cut gain (0.92) and violet lift/shadows
  // turned the whole sea magenta.
  dusk: {
    exposure: 1.05, lift: [0.028, 0.02, 0.042], gamma: [1.02, 1.0, 1.0], gain: [1.05, 0.97, 0.9], saturation: 1.05, contrast: 1.05,
    shadowTint: 0x33428c, highlightTint: 0xffb070, split: 0.3, vignette: 0.32, vignetteColor: 0x0e1230, bloomStrength: 0.9, bloomThreshold: 0.86,
  },
  storm: {
    exposure: 1.0, lift: [0.03, 0.05, 0.05], gamma: [1, 1.02, 1.02], gain: [0.92, 1.0, 0.98], saturation: 0.62, contrast: 1.08,
    shadowTint: 0x2a4a50, highlightTint: 0xe2f2ea, split: 0.24, vignette: 0.4, vignetteColor: 0x06161a, bloomStrength: 0.85, bloomThreshold: 0.88,
  },
  fog: {
    exposure: 1.03, lift: [0.07, 0.07, 0.075], gamma: [1, 1, 1], gain: [0.97, 0.98, 1.0], saturation: 0.82, contrast: 0.9,
    shadowTint: 0x7f8fa6, highlightTint: 0xfff4e6, split: 0.16, vignette: 0.22, vignetteColor: 0x3a4452, bloomStrength: 0.65, bloomThreshold: 0.95,
  },
};

function toGrade(spec: GradeSpec): Grade {
  return {
    exposure: spec.exposure,
    lift: new THREE.Color().setRGB(...spec.lift, THREE.LinearSRGBColorSpace),
    gamma: new THREE.Vector3(...spec.gamma),
    gain: new THREE.Color().setRGB(...spec.gain, THREE.LinearSRGBColorSpace),
    saturation: spec.saturation, contrast: spec.contrast,
    // Tints are display-space multipliers: keep their sRGB values as-is.
    shadowTint: new THREE.Color().setHex(spec.shadowTint, THREE.LinearSRGBColorSpace),
    highlightTint: new THREE.Color().setHex(spec.highlightTint, THREE.LinearSRGBColorSpace),
    split: spec.split, vignette: spec.vignette,
    vignetteColor: new THREE.Color().setHex(spec.vignetteColor, THREE.LinearSRGBColorSpace),
    bloomStrength: spec.bloomStrength, bloomThreshold: spec.bloomThreshold,
  };
}

export const GRADES = Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k, toGrade(v)])) as Record<keyof typeof SPECS, Grade>;

/** Hour keyframes (0–24) for the time-of-day grade. */
const HOUR_KEYS: readonly [number, keyof typeof SPECS][] = [
  [0, 'night'], [4.9, 'night'], [6.4, 'dawn'], [8.6, 'noon'], [15.0, 'noon'], [17.3, 'golden'], [19.0, 'dusk'], [20.3, 'night'], [24, 'night'],
];

export function createGrade(): Grade { return toGrade(SPECS.noon); }

export function copyGrade(out: Grade, a: Grade): Grade {
  out.exposure = a.exposure; out.lift.copy(a.lift); out.gamma.copy(a.gamma); out.gain.copy(a.gain);
  out.saturation = a.saturation; out.contrast = a.contrast; out.shadowTint.copy(a.shadowTint); out.highlightTint.copy(a.highlightTint);
  out.split = a.split; out.vignette = a.vignette; out.vignetteColor.copy(a.vignetteColor);
  out.bloomStrength = a.bloomStrength; out.bloomThreshold = a.bloomThreshold;
  return out;
}

export function lerpGrade(out: Grade, b: Grade, t: number): Grade {
  if (t <= 0) return out;
  const L = THREE.MathUtils.lerp;
  out.exposure = L(out.exposure, b.exposure, t); out.lift.lerp(b.lift, t); out.gamma.lerp(b.gamma, t); out.gain.lerp(b.gain, t);
  out.saturation = L(out.saturation, b.saturation, t); out.contrast = L(out.contrast, b.contrast, t);
  out.shadowTint.lerp(b.shadowTint, t); out.highlightTint.lerp(b.highlightTint, t);
  out.split = L(out.split, b.split, t); out.vignette = L(out.vignette, b.vignette, t); out.vignetteColor.lerp(b.vignetteColor, t);
  out.bloomStrength = L(out.bloomStrength, b.bloomStrength, t); out.bloomThreshold = L(out.bloomThreshold, b.bloomThreshold, t);
  return out;
}

/** Grade for an hour of the day (smoothstepped between keyframes). */
export function gradeForHour(out: Grade, hour: number): Grade {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < HOUR_KEYS.length - 1; i++) {
    const [h0, k0] = HOUR_KEYS[i]!;
    const [h1, k1] = HOUR_KEYS[i + 1]!;
    if (h >= h0 && h <= h1) {
      const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
      copyGrade(out, GRADES[k0]);
      return lerpGrade(out, GRADES[k1], t * t * (3 - 2 * t));
    }
  }
  return copyGrade(out, GRADES.night);
}
