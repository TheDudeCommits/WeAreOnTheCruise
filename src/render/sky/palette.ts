/**
 * Time-of-day and weather palette (LOOK-owned). Everything the frame's light depends on — sky gradient, key light,
 * cool shadow tint, rim, clouds, ink, fog — keyed by hour and blended with the storm and fog looks.
 * Colours are authored as sRGB hex (converted to linear on load); light/shadow multipliers are linear triples.
 */
import * as THREE from 'three';

export interface SkyLook {
  zenith: THREE.Color;
  horizon: THREE.Color;
  haze: THREE.Color;
  /** Key light colour (linear) and intensity (1 ≈ noon). */
  key: THREE.Color;
  keyIntensity: number;
  /** Albedo multiplier in shadow (linear, cool blue-violet). */
  shadow: THREE.Color;
  /** Rim colour × strength (linear). */
  rim: THREE.Color;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  ink: THREE.Color;
  fogNear: number;
  fogFar: number;
  /** Star visibility 0..1. */
  stars: number;
}

interface LookSpec {
  zenith: number; horizon: number; haze: number;
  key: [number, number, number]; keyIntensity: number;
  shadow: [number, number, number];
  rim: [number, number, number];
  cloudLit: number; cloudShade: number; ink: number;
  fogNear: number; fogFar: number; stars: number;
}

const lin = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

function look(spec: LookSpec): SkyLook {
  return {
    zenith: new THREE.Color(spec.zenith), horizon: new THREE.Color(spec.horizon), haze: new THREE.Color(spec.haze),
    key: lin(...spec.key), keyIntensity: spec.keyIntensity,
    shadow: lin(...spec.shadow), rim: lin(...spec.rim),
    cloudLit: new THREE.Color(spec.cloudLit), cloudShade: new THREE.Color(spec.cloudShade), ink: new THREE.Color(spec.ink),
    fogNear: spec.fogNear, fogFar: spec.fogFar, stars: spec.stars,
  };
}

const NIGHT: LookSpec = {
  zenith: 0x040b2a, horizon: 0x172a5e, haze: 0x1b2d5e, key: [0.5, 0.62, 1.0], keyIntensity: 0.62,
  shadow: [0.12, 0.15, 0.34], rim: [0.45, 0.62, 1.0], cloudLit: 0x5d74bb, cloudShade: 0x1a2553, ink: 0x0b1030,
  fogNear: 240, fogFar: 2100, stars: 1,
};

/** Hour keyframes. */
const KEYS: readonly [number, LookSpec][] = [
  [0, NIGHT],
  [4.6, NIGHT],
  [5.5, {
    zenith: 0x101c50, horizon: 0x4c4f90, haze: 0x4a4e88, key: [0.62, 0.62, 0.95], keyIntensity: 0.4,
    shadow: [0.2, 0.2, 0.42], rim: [0.6, 0.6, 1.0], cloudLit: 0x8a86c8, cloudShade: 0x2c2f6c, ink: 0x11163a,
    fogNear: 240, fogFar: 2100, stars: 0.5,
  }],
  [6.5, {
    zenith: 0x3a62c0, horizon: 0xffc08c, haze: 0xf2c8a6, key: [1.0, 0.74, 0.5], keyIntensity: 0.95,
    shadow: [0.42, 0.4, 0.7], rim: [1.0, 0.72, 0.48], cloudLit: 0xffe2c4, cloudShade: 0x8d84c6, ink: 0x1b1f42,
    fogNear: 300, fogFar: 2400, stars: 0,
  }],
  [8.8, {
    zenith: 0x2a6ddc, horizon: 0xa7d7f0, haze: 0xbfe3f3, key: [1.0, 0.95, 0.86], keyIntensity: 1.02,
    shadow: [0.45, 0.49, 0.76], rim: [1.0, 0.95, 0.84], cloudLit: 0xffffff, cloudShade: 0xa3b6e6, ink: 0x1b2340,
    fogNear: 340, fogFar: 2700, stars: 0,
  }],
  [12.4, {
    zenith: 0x1e5ed6, horizon: 0x9fd4f2, haze: 0xb6dff3, key: [1.0, 0.97, 0.9], keyIntensity: 1.05,
    shadow: [0.44, 0.49, 0.78], rim: [1.0, 0.97, 0.9], cloudLit: 0xffffff, cloudShade: 0x9fb4e8, ink: 0x1b2340,
    fogNear: 360, fogFar: 2800, stars: 0,
  }],
  [15.2, {
    zenith: 0x2462cf, horizon: 0xb5d8ee, haze: 0xc3def0, key: [1.0, 0.93, 0.8], keyIntensity: 1.03,
    shadow: [0.44, 0.46, 0.76], rim: [1.0, 0.92, 0.78], cloudLit: 0xfffaf0, cloudShade: 0xa0aee2, ink: 0x1b2340,
    fogNear: 340, fogFar: 2700, stars: 0,
  }],
  // Late-afternoon gold: blue overhead, a pale-gold horizon and a warm key light. Without it the lerp from blue to
  // amber passes through grey (the menu showcase sits at 16.5 h).
  [16.5, {
    zenith: 0x2a5cc6, horizon: 0xffdca0, haze: 0xf6ddb2, key: [1.0, 0.82, 0.58], keyIntensity: 1.06,
    shadow: [0.43, 0.4, 0.72], rim: [1.0, 0.8, 0.52], cloudLit: 0xfff0d4, cloudShade: 0x9a98d8, ink: 0x1d2142,
    fogNear: 320, fogFar: 2600, stars: 0,
  }],
  [17.6, {
    zenith: 0x3456ae, horizon: 0xffc48a, haze: 0xf0c49c, key: [1.0, 0.7, 0.4], keyIntensity: 1.05,
    shadow: [0.42, 0.35, 0.66], rim: [1.0, 0.68, 0.36], cloudLit: 0xffdcb0, cloudShade: 0x8d7cc6, ink: 0x21193e,
    fogNear: 300, fogFar: 2500, stars: 0,
  }],
  [18.9, {
    zenith: 0x252c6e, horizon: 0xff8a6a, haze: 0xc47a8c, key: [1.0, 0.5, 0.34], keyIntensity: 0.72,
    shadow: [0.3, 0.24, 0.5], rim: [1.0, 0.52, 0.4], cloudLit: 0xffa888, cloudShade: 0x5a4a96, ink: 0x1a1236,
    fogNear: 280, fogFar: 2300, stars: 0.1,
  }],
  [19.9, {
    zenith: 0x0f184a, horizon: 0x3a3d86, haze: 0x383c7a, key: [0.6, 0.62, 1.0], keyIntensity: 0.5,
    shadow: [0.16, 0.17, 0.38], rim: [0.55, 0.6, 1.0], cloudLit: 0x6f72bc, cloudShade: 0x22285e, ink: 0x0e1234,
    fogNear: 250, fogFar: 2100, stars: 0.7,
  }],
  [21, NIGHT],
  [24, NIGHT],
];

const LOOKS: [number, SkyLook][] = KEYS.map(([h, spec]) => [h, look(spec)]);

export const STORM_LOOK = look({
  zenith: 0x1d2b33, horizon: 0x4a5f66, haze: 0x5b6e73, key: [0.66, 0.76, 0.8], keyIntensity: 0.62,
  shadow: [0.3, 0.37, 0.42], rim: [0.7, 0.85, 0.9], cloudLit: 0x6c7f86, cloudShade: 0x243238, ink: 0x0d1a22,
  fogNear: 150, fogFar: 1400, stars: 0,
});

export const FOG_LOOK = look({
  zenith: 0x9fb2c2, horizon: 0xd2dbe0, haze: 0xd9e0e2, key: [0.95, 0.94, 0.9], keyIntensity: 0.72,
  shadow: [0.58, 0.61, 0.68], rim: [0.9, 0.92, 0.95], cloudLit: 0xf2f4f5, cloudShade: 0xaab6c2, ink: 0x2a3348,
  fogNear: 60, fogFar: 700, stars: 0,
});

/** Night fog (The Gloam): darker pearl. */
export const NIGHT_FOG_LOOK = look({
  zenith: 0x0e1a30, horizon: 0x2a3d56, haze: 0x2e4058, key: [0.5, 0.62, 0.9], keyIntensity: 0.5,
  shadow: [0.14, 0.18, 0.3], rim: [0.5, 0.7, 0.95], cloudLit: 0x4a5f80, cloudShade: 0x1a2438, ink: 0x0a1222,
  fogNear: 50, fogFar: 620, stars: 0.1,
});

export function createLook(): SkyLook { return look(KEYS[4]![1]); }

function copyLook(out: SkyLook, a: SkyLook): SkyLook {
  out.zenith.copy(a.zenith); out.horizon.copy(a.horizon); out.haze.copy(a.haze);
  out.key.copy(a.key); out.keyIntensity = a.keyIntensity; out.shadow.copy(a.shadow); out.rim.copy(a.rim);
  out.cloudLit.copy(a.cloudLit); out.cloudShade.copy(a.cloudShade); out.ink.copy(a.ink);
  out.fogNear = a.fogNear; out.fogFar = a.fogFar; out.stars = a.stars;
  return out;
}

export function lerpLook(out: SkyLook, b: SkyLook, t: number): SkyLook {
  if (t <= 0) return out;
  const L = THREE.MathUtils.lerp;
  out.zenith.lerp(b.zenith, t); out.horizon.lerp(b.horizon, t); out.haze.lerp(b.haze, t);
  out.key.lerp(b.key, t); out.keyIntensity = L(out.keyIntensity, b.keyIntensity, t);
  out.shadow.lerp(b.shadow, t); out.rim.lerp(b.rim, t);
  out.cloudLit.lerp(b.cloudLit, t); out.cloudShade.lerp(b.cloudShade, t); out.ink.lerp(b.ink, t);
  out.fogNear = L(out.fogNear, b.fogNear, t); out.fogFar = L(out.fogFar, b.fogFar, t); out.stars = L(out.stars, b.stars, t);
  return out;
}

/** Look for an hour (0–24), smoothstepped between keyframes. */
export function lookForHour(out: SkyLook, hour: number): SkyLook {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < LOOKS.length - 1; i++) {
    const [h0, a] = LOOKS[i]!;
    const [h1, b] = LOOKS[i + 1]!;
    if (h >= h0 && h <= h1) {
      const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
      copyLook(out, a);
      return lerpLook(out, b, t * t * (3 - 2 * t));
    }
  }
  return copyLook(out, LOOKS[0]![1]);
}

/** Sunrise/sunset of the visual sun (hours). The sun sets late so golden hour keeps a usable elevation. */
export const SUNRISE = 5.8;
export const SUNSET = 19.1;
const SUN_MAX_ELEVATION = THREE.MathUtils.degToRad(58);
const MOON_MIN_ELEVATION = THREE.MathUtils.degToRad(24);
const MOON_MAX_ELEVATION = THREE.MathUtils.degToRad(44);

/** World direction to the sun for an hour (may point below the horizon at night). Rises east (+X), sets west (−X). */
export function sunDirection(hour: number, out: THREE.Vector3): THREE.Vector3 {
  const t = (hour - SUNRISE) / (SUNSET - SUNRISE); // 0 sunrise … 1 sunset
  const elevation = Math.sin(t * Math.PI) * SUN_MAX_ELEVATION;
  const azimuth = Math.PI * t; // east → south → west
  const c = Math.cos(elevation);
  return out.set(Math.cos(azimuth) * c, Math.sin(elevation), Math.sin(azimuth) * c * 0.55 + 0.35 * c).normalize();
}

/** World direction to the moon for an hour: always comfortably above the horizon at night, arcing east → west. */
export function moonDirection(hour: number, out: THREE.Vector3): THREE.Vector3 {
  const h = ((hour - SUNSET + 24) % 24) / (24 - (SUNSET - SUNRISE)); // 0 at sunset … 1 at sunrise
  const elevation = THREE.MathUtils.lerp(MOON_MIN_ELEVATION, MOON_MAX_ELEVATION, Math.sin(Math.min(1, Math.max(0, h)) * Math.PI));
  const azimuth = Math.PI * (0.15 + 0.7 * THREE.MathUtils.clamp(h, 0, 1));
  const c = Math.cos(elevation);
  return out.set(Math.cos(azimuth) * c, Math.sin(elevation), -Math.sin(azimuth) * c * 0.6 - 0.25 * c).normalize();
}
