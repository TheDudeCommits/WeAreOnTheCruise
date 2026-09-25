/**
 * Shared atmosphere uniforms and GLSL (LOOK-owned; other render modules may import this file).
 *
 * The sky system writes these once per frame (see SkySystem.update → publishAtmosphere) before any other system
 * updates, so every shader in the frame reads one sun, one ambient, one fog curve and one cloud-shadow field.
 * The uniform objects are shared by reference: add them to a ShaderMaterial with
 *
 *   uniforms: { ...atmosphereUniforms, ...yourUniforms }        // or Object.assign(shader.uniforms, atmosphereUniforms)
 *
 * and paste ATMOSPHERE_GLSL at the top of the fragment (and/or vertex) shader to get:
 *   cruiseFogFactor(viewDistance)            0..1 aerial perspective (same curve three's fog chunks use)
 *   cruiseApplyFog(color, viewDistance)      mixes toward uCruiseFogColor
 *   cruiseCloudShadow(worldXZ)               0..1 moving cloud shadow (multiply your sun term by 1 - it)
 *   cruiseSkyColor(worldDir)                 cheap sky gradient for reflections (zenith → horizon → haze)
 *   cruiseSunDisc(worldDir)                  0..1 sun (or moon) disc mask for sharp glints
 *
 * Colours are linear (working colour space); uCruiseSunColor already includes intensity (1.0 ≈ noon).
 * The directional light the sky system adds to the scene shares this direction and is used for shadow maps.
 */
import * as THREE from 'three';
import { ensureFactionResources, factionUniforms } from './faction';

/** A tileable 2-channel fbm noise (R: cloud field, G: detail), generated once on the CPU. Repeat-wrapped, mipmapped. */
function createNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const lattice = (period: number, seed: number) => {
    const values = new Float32Array(period * period);
    let s = seed >>> 0;
    for (let i = 0; i < values.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      values[i] = s / 4294967296;
    }
    return (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
      const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
      const a = values[y0 * period + x0]!, b = values[y0 * period + x1]!;
      const c = values[y1 * period + x0]!, d = values[y1 * period + x1]!;
      return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
    };
  };
  const octavesR = [lattice(4, 11), lattice(8, 23), lattice(16, 37), lattice(32, 53), lattice(64, 71)];
  const octavesG = [lattice(16, 91), lattice(32, 113), lattice(64, 131)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let r = 0, amp = 0.5, norm = 0;
      for (let o = 0; o < octavesR.length; o++) {
        const period = 4 << o;
        r += octavesR[o]!(u * period, v * period) * amp;
        norm += amp; amp *= 0.5;
      }
      r /= norm;
      let g = 0; amp = 0.5; norm = 0;
      for (let o = 0; o < octavesG.length; o++) {
        const period = 16 << o;
        g += octavesG[o]!(u * period, v * period) * amp;
        norm += amp; amp *= 0.5;
      }
      g /= norm;
      const i = (y * size + x) * 4;
      data[i] = Math.round(THREE.MathUtils.clamp((r - 0.5) * 1.6 + 0.5, 0, 1) * 255);
      data[i + 1] = Math.round(THREE.MathUtils.clamp((g - 0.5) * 1.5 + 0.5, 0, 1) * 255);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.name = 'cruise-noise';
  texture.needsUpdate = true;
  return texture;
}

let noise: THREE.DataTexture | null = null;
/** Shared tileable noise (R = broad fbm, G = fine fbm). */
export function cruiseNoiseTexture(): THREE.DataTexture {
  noise ??= createNoiseTexture();
  return noise;
}

export interface AtmosphereUniforms {
  [name: string]: THREE.IUniform;
  /** World-space direction TO the key light (sun by day, moon at night), normalized. */
  uCruiseSunDir: THREE.IUniform<THREE.Vector3>;
  /** Key light colour × intensity (linear, 1 ≈ noon sun). */
  uCruiseSunColor: THREE.IUniform<THREE.Color>;
  /** Albedo multiplier in shadow (cool blue-violet; already includes ambient level). */
  uCruiseShadowTint: THREE.IUniform<THREE.Color>;
  /** Ambient multipliers for up-facing / down-facing surfaces in shadow (sky / sea bounce). */
  uCruiseSkyAmbient: THREE.IUniform<THREE.Color>;
  uCruiseGroundAmbient: THREE.IUniform<THREE.Color>;
  /** Lit-side rim light colour (linear, HDR allowed). */
  uCruiseRimColor: THREE.IUniform<THREE.Color>;
  /** Navy ink colour for outlines and crevices. */
  uCruiseInkColor: THREE.IUniform<THREE.Color>;
  uCruiseSkyColor: THREE.IUniform<THREE.Color>;
  uCruiseHorizonColor: THREE.IUniform<THREE.Color>;
  uCruiseFogColor: THREE.IUniform<THREE.Color>;
  /** Fog start / full distances in metres (same numbers as scene.fog). */
  uCruiseFogNear: THREE.IUniform<number>;
  uCruiseFogFar: THREE.IUniform<number>;
  /** 0 day … 1 full night. */
  uCruiseNight: THREE.IUniform<number>;
  /** 0 … 1 storm darkness. */
  uCruiseStorm: THREE.IUniform<number>;
  /** 0 … 1 lightning flash this frame. */
  uCruiseFlash: THREE.IUniform<number>;
  /** Render clock (seconds). */
  uCruiseTime: THREE.IUniform<number>;
  /** Cloud shadow: xy = world offset (m), z = 1/scale (1/m), w = strength 0..1. */
  uCruiseCloudShadow: THREE.IUniform<THREE.Vector4>;
  /** Cloud-shadow coverage 0..1 (fraction of the sea under cloud shadow). */
  uCruiseCloudCover: THREE.IUniform<number>;
  /** Wind: xy = direction (unit, world XZ), z = strength 0..1. */
  uCruiseWind: THREE.IUniform<THREE.Vector3>;
  /** Shared tileable noise (R broad, G fine), repeat-wrapped. */
  uCruiseNoise: THREE.IUniform<THREE.Texture>;
  /** Faction light (faction.ts): enemy centre → faction map, its window, rim strength/exposure, faction colours. */
  uCruiseFactionMap: THREE.IUniform<THREE.DataTexture | null>;
  uCruiseFactionRect: THREE.IUniform<THREE.Vector4>;
  uCruiseFactionRim: THREE.IUniform<THREE.Vector4>;
  uCruiseFactionColors: THREE.IUniform<THREE.Vector3[]>;
}

/** The single shared instance. Never replace the objects; write `.value` (the sky system does this each frame). */
export const atmosphereUniforms: AtmosphereUniforms = {
  uCruiseSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uCruiseSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
  uCruiseShadowTint: { value: new THREE.Color(0.42, 0.46, 0.72) },
  uCruiseSkyAmbient: { value: new THREE.Color(1, 1, 1) },
  uCruiseGroundAmbient: { value: new THREE.Color(0.85, 0.95, 1) },
  uCruiseRimColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uCruiseInkColor: { value: new THREE.Color(0x1b2340) },
  uCruiseSkyColor: { value: new THREE.Color(0x1a6fd0) },
  uCruiseHorizonColor: { value: new THREE.Color(0xa9dbef) },
  uCruiseFogColor: { value: new THREE.Color(0xa9dbef) },
  uCruiseFogNear: { value: 260 },
  uCruiseFogFar: { value: 2600 },
  uCruiseNight: { value: 0 },
  uCruiseStorm: { value: 0 },
  uCruiseFlash: { value: 0 },
  uCruiseTime: { value: 0 },
  uCruiseCloudShadow: { value: new THREE.Vector4(0, 0, 1 / 1400, 0.35) },
  uCruiseCloudCover: { value: 0.35 },
  uCruiseWind: { value: new THREE.Vector3(0.8, 0.6, 0.5) },
  uCruiseNoise: { value: null as unknown as THREE.Texture },
  ...factionUniforms,
};

/** Lazily binds the noise texture (keeps module import free of GPU/CPU work until a material needs it). */
export function ensureAtmosphereResources(): AtmosphereUniforms {
  if (!atmosphereUniforms.uCruiseNoise.value) atmosphereUniforms.uCruiseNoise.value = cruiseNoiseTexture();
  ensureFactionResources();
  return atmosphereUniforms;
}

/**
 * GLSL shared by every shader that wants the frame's light. Declares the uniforms above and the helper functions.
 * Safe in vertex and fragment shaders (no derivatives).
 */
export const ATMOSPHERE_GLSL = /* glsl */ `
#ifndef CRUISE_ATMOSPHERE
#define CRUISE_ATMOSPHERE
uniform vec3 uCruiseSunDir;
uniform vec3 uCruiseSunColor;
uniform vec3 uCruiseShadowTint;
uniform vec3 uCruiseSkyAmbient;
uniform vec3 uCruiseGroundAmbient;
uniform vec3 uCruiseRimColor;
uniform vec3 uCruiseInkColor;
uniform vec3 uCruiseSkyColor;
uniform vec3 uCruiseHorizonColor;
uniform vec3 uCruiseFogColor;
uniform float uCruiseFogNear;
uniform float uCruiseFogFar;
uniform float uCruiseNight;
uniform float uCruiseStorm;
uniform float uCruiseFlash;
uniform float uCruiseTime;
uniform vec4 uCruiseCloudShadow;
uniform float uCruiseCloudCover;
uniform vec3 uCruiseWind;
uniform sampler2D uCruiseNoise;

/** The one aerial-perspective curve: nothing before fogNear, eased exponential-squared to ~97% at fogFar. */
float cruiseFogCurve(float dist, float nearD, float farD) {
  float t = max(dist - nearD, 0.0) / max(farD - nearD, 1.0);
  return 1.0 - exp(-3.4 * t * t - 0.35 * t);
}
float cruiseFogFactor(float viewDistance) {
  return cruiseFogCurve(viewDistance, uCruiseFogNear, uCruiseFogFar);
}
vec3 cruiseApplyFog(vec3 color, float viewDistance) {
  return mix(color, uCruiseFogColor, cruiseFogFactor(viewDistance));
}
/** 0..1 amount of cloud shadow at a world XZ position on the sea (big soft-edged blobs drifting with the wind). */
float cruiseCloudShadow(vec2 worldXZ) {
  if (uCruiseCloudShadow.w <= 0.001) return 0.0;
  vec2 uv = (worldXZ + uCruiseCloudShadow.xy) * uCruiseCloudShadow.z;
  float n = texture2D(uCruiseNoise, uv).r * 0.85 + texture2D(uCruiseNoise, uv * 1.9 + 0.37).r * 0.15;
  float edge = 1.0 - uCruiseCloudCover;
  return smoothstep(edge - 0.05, edge + 0.05, n) * uCruiseCloudShadow.w;
}
/** Cloud shadow for any surface: the point is projected to sea level along the key light (no streaks on sails). */
float cruiseCloudShadow(vec3 worldPos) {
  vec2 xz = worldPos.xz - uCruiseSunDir.xz * (worldPos.y / max(uCruiseSunDir.y, 0.2));
  return cruiseCloudShadow(xz);
}
/** Cheap sky gradient for reflections and glints (world direction, y up). */
vec3 cruiseSkyColor(vec3 dir) {
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 sky = mix(uCruiseHorizonColor, uCruiseSkyColor, pow(h, 0.5));
  return mix(uCruiseFogColor, sky, smoothstep(-0.02, 0.08, dir.y));
}
/** Hard-edged sun/moon disc mask (for glints and reflections). */
float cruiseSunDisc(vec3 dir) {
  float c = dot(normalize(dir), uCruiseSunDir);
  return smoothstep(0.9990, 0.9994, c);
}
#endif
`;

/**
 * Installs the unified fog curve into three's shared fog chunks, so every built-in material and every ShaderMaterial
 * with `fog: true` that includes <fog_fragment> uses cruiseFogCurve with scene.fog's near/far (three's Fog) — one
 * aerial perspective for ocean, islands, ships and FX. Idempotent.
 */
let fogPatched = false;
export function installUnifiedFog(): void {
  if (fogPatched) return;
  fogPatched = true;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogT = max( vFogDepth - fogNear, 0.0 ) / max( fogFar - fogNear, 1.0 );
		float fogFactor = 1.0 - exp( -3.4 * fogT * fogT - 0.35 * fogT );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}

/** Linear luminance (Rec.709). */
export function luminance(color: THREE.Color): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}
