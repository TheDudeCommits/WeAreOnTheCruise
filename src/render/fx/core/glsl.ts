/**
 * Shared GLSL for every FX pass: hashes/noise, fog, analytic particle motion and billboarding.
 *
 * Particle motion is stateless and analytic, so ring-buffer particles never need per-frame uploads:
 *   drag k > 0 : v(t) = vT + (v0 - vT) e^{-kt},  x(t) = x0 + vT t + (v0 - vT)(1 - e^{-kt}) / k
 *   drag k = 0 : the third vector is a constant acceleration (gravity): x(t) = x0 + v0 t + a t^2 / 2
 * Strong drag gives the anime "fast burst → hang" timing for free.
 */
import * as THREE from 'three';
import { DEFAULT_GERSTNER_WAVES } from '../../../core/waves';

export const NOISE_GLSL = /* glsl */ `
float fxHash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float fxHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float fxNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash12(i), fxHash12(i + vec2(1.0, 0.0)), u.x), mix(fxHash12(i + vec2(0.0, 1.0)), fxHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fxFbm(vec2 p) { return fxNoise(p) * 0.62 + fxNoise(p * 2.07 + 13.1) * 0.28 + fxNoise(p * 4.13 + 41.7) * 0.1; }
`;

export const FOG_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform vec2 uFogRange;
float fxFog(float depth) { return smoothstep(uFogRange.x, uFogRange.y, depth); }
`;

/**
 * Sprite vertex core. Expects per-vertex `corner` (vec2 in [-1,1]) and the 7 per-instance vec4s described in
 * InstancePool/SpriteSpec. Produces: vUv, vT, vSeed, vShape, vPal, vFogDepth, vTint, vAge, vErode, vSpeed.
 */
export const SPRITE_VERTEX_GLSL = /* glsl */ `
attribute vec2 corner;
attribute vec4 iA; // pos.xyz, t0
attribute vec4 iB; // vel.xyz, life
attribute vec4 iC; // vTerm (k>0) or accel (k=0) .xyz, drag k
attribute vec4 iD; // size0, size1, rot0, rotSpeed
attribute vec4 iE; // shape, palette, seed, mode (+4 = pivot at bottom)
attribute vec4 iF; // stretch, speedStretch, growCurve, erodeStart
attribute vec4 iG; // tint.rgb, intensity
uniform float uTime;
uniform float uPixelWorld; // world metres per pixel at 1 m depth
uniform float uMinPixels;
uniform float uSightline;  // 1 = apply the smoke rules below (cel pass), 0 = off
uniform vec4 uGuards[4];   // protected hulls (xyz centre, w radius; w = 0 unused): [0] = hero, then live bosses
uniform float uSmokeThin;  // 0..1 from the smoke coverage governor (SmokeGovernor)
varying vec2 vUv;
varying float vT;
varying float vSeed;
varying float vShape;
varying float vPal;
varying float vFogDepth;
varying vec3 vTint;
varying float vIntensity;
varying float vAge;
varying float vErode;
varying float vSpeed;
varying float vStretch;
varying float vOccl;

void fxSprite() {
  float age = uTime - iA.w;
  float life = max(iB.w, 1e-4);
  float t = age / life;
  if (age < 0.0 || t >= 1.0 || iD.y <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = iC.w;
  vec3 pos; vec3 vel;
  if (k > 1e-4) {
    float e = exp(-k * age);
    pos = iA.xyz + iC.xyz * age + (iB.xyz - iC.xyz) * ((1.0 - e) / k);
    vel = iC.xyz + (iB.xyz - iC.xyz) * e;
  } else {
    pos = iA.xyz + iB.xyz * age + 0.5 * iC.xyz * age * age;
    vel = iB.xyz + iC.xyz * age;
  }
  float grow = 1.0 - pow(1.0 - t, max(iF.z, 0.05));
  float size = mix(iD.x, iD.y, grow);
  float rot = iD.z + iD.w * age;
  float modeF = iE.w;
  // mode: 0 = screen-facing (rotatable), 1 = upright (world Y axis), 2 = along velocity; +4 = pivot at the base
  float pivot = step(3.5, modeF);
  int mode = int(modeF - pivot * 4.0 + 0.5);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  float speed = length(vel);
  vOccl = 0.0;
  if (uSightline > 0.5) {
    // Smoke rules (round 2). vOccl is extra erosion (0..1) the cel fragment eats the shape with, never a fade.
    int shp = int(iE.x + 0.5);
    int pl = int(iE.y + 0.5);
    // smoke = inked puffs with a smoke palette (gunsmoke, dark, dust, steam, wreck) + fireballs (they cool into smoke);
    // long-lived immediate puffs (FOES smoke screens, storm clouds) are gameplay/weather and keep their own rules
    bool isSmoke = life < 6.0 && (shp == 7 || (shp == 0 && (pl == 0 || pl == 1 || pl == 4 || pl == 5 || pl == 11)));
    float smoke = isSmoke ? 1.0 : 0.0;
    float occluder = (shp == 0 || shp == 6 || shp == 7) ? 1.0 : shp == 2 ? 0.45 : 0.0;
    vec4 pc = projectionMatrix * mv;
    float pw = max(pc.w, 1e-3);
    vec2 pn = pc.xy / pw;
    float aspect = projectionMatrix[1][1] / max(projectionMatrix[0][0], 1e-4);
    float rp = 0.45 * size * projectionMatrix[1][1] / pw;  // solid radius in NDC-y units
    float frac = 0.785 * rp * rp / aspect;                   // screen fraction of the puff disc
    // 1) coverage governor: when smoke covers more than ~4.5% of the screen, older and bigger puffs erode first
    float thin = uSmokeThin * smoke * (0.3 + 0.7 * t) * (0.6 + 0.4 * smoothstep(0.004, 0.03, frac));
    // 2) no single puff covers more than ~2% of the screen (round 3: was ~3%)
    float cap = smoke * smoothstep(0.015, 0.045, frac) * 0.85;
    vOccl = max(thin, cap);
    // 3) protected hulls: puffs in front of the hero or a boss break into wisps (never an opaque cover)
    if (occluder > 0.0) {
      for (int g = 0; g < 4; g++) {
        vec4 G = uGuards[g];
        if (G.w <= 0.0) continue;
        vec4 gc = projectionMatrix * viewMatrix * vec4(G.xyz, 1.0);
        if (gc.w <= 0.0) continue;
        vec2 d = (pn - gc.xy / gc.w) * vec2(aspect, 1.0);
        float rg = G.w * projectionMatrix[1][1] / gc.w;
        float over = 1.0 - smoothstep(rg * 0.5 + rp * 0.3, rg + rp * 0.9, length(d));
        float front = 1.0 - smoothstep(gc.w - G.w * 0.25, gc.w + G.w * 0.6, pw);
        float strength = (g == 0 ? 0.92 : 0.8) * (isSmoke ? 1.0 : 0.7);
        vOccl = max(vOccl, over * front * strength * occluder);
      }
    }
  }
  float stretch = max(1.0, iF.x * (1.0 + speed * iF.y));
  // Keep tiny far sprites readable: never below uMinPixels.
  float minSize = uMinPixels * uPixelWorld * max(1.0, -mv.z);
  size = max(size, minSize);
  vec2 c = corner * 0.5 * size;
  float along = c.y * stretch + pivot * 0.5 * size * stretch;
  if (mode == 0) {
    float cs = cos(rot); float sn = sin(rot);
    mv.xy += vec2(c.x * cs - along * sn, c.x * sn + along * cs);
  } else {
    vec3 axisW = mode == 1 ? vec3(0.0, 1.0, 0.0) : (speed > 1e-4 ? vel / speed : vec3(0.0, 1.0, 0.0));
    vec3 axisV = normalize((viewMatrix * vec4(axisW, 0.0)).xyz);
    vec3 toCam = normalize(-mv.xyz);
    vec3 right = cross(axisV, toCam);
    float rl = length(right);
    right = rl > 1e-4 ? right / rl : vec3(1.0, 0.0, 0.0);
    mv.xyz += right * c.x + axisV * along;
  }
  gl_Position = projectionMatrix * mv;
  vUv = corner;
  vT = t;
  vAge = age;
  vSeed = iE.z;
  vShape = iE.x;
  vPal = iE.y;
  vFogDepth = -mv.z;
  vTint = iG.rgb;
  vIntensity = iG.a;
  vErode = iF.w;
  vSpeed = speed;
  vStretch = stretch;
}
`;

/** Declares the Gerstner uniforms (shared with the ocean) — include before GERSTNER_GLSL. */
export function gerstnerUniforms(): Record<string, THREE.IUniform> {
  return {
    uWaveDirection: { value: DEFAULT_GERSTNER_WAVES.map((w) => new THREE.Vector2(w.directionX, w.directionZ)) },
    uWaveAmplitude: { value: DEFAULT_GERSTNER_WAVES.map((w) => w.amplitude) },
    uWaveLength: { value: DEFAULT_GERSTNER_WAVES.map((w) => w.wavelength) },
    uWaveSpeed: { value: DEFAULT_GERSTNER_WAVES.map((w) => w.speed) },
    uWaveSteepness: { value: DEFAULT_GERSTNER_WAVES.map((w) => w.steepness) },
    uWaveStrength: { value: 1 },
    uWaveTime: { value: 0 },
  };
}

/** Common per-frame uniforms shared by all FX materials (one object, referenced by every material). */
export interface FxSharedUniforms {
  uTime: THREE.IUniform<number>;
  uRealTime: THREE.IUniform<number>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogRange: THREE.IUniform<THREE.Vector2>;
  uPixelWorld: THREE.IUniform<number>;
  uMinPixels: THREE.IUniform<number>;
  uSunView: THREE.IUniform<THREE.Vector3>;
  uLitTint: THREE.IUniform<THREE.Color>;
  uShadeTint: THREE.IUniform<THREE.Color>;
  uViewport: THREE.IUniform<THREE.Vector2>;
  uFlash: THREE.IUniform<number>;
  uFocus: THREE.IUniform<THREE.Vector3>;
  uSightline: THREE.IUniform<number>;
  /** Protected hulls for the smoke rules: xyz centre, w radius (0 = unused). [0] = hero, [1..3] = bosses. */
  uGuards: THREE.IUniform<THREE.Vector4[]>;
  /** 0..1 smoke thinning from the coverage governor. */
  uSmokeThin: THREE.IUniform<number>;
}

export function createSharedUniforms(): FxSharedUniforms {
  return {
    uTime: { value: 0 },
    uRealTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0xa9dbef) },
    uFogRange: { value: new THREE.Vector2(400, 2400) },
    uPixelWorld: { value: 0.001 },
    uMinPixels: { value: 0 },
    uSunView: { value: new THREE.Vector3(0.3, 0.8, 0.4) },
    uLitTint: { value: new THREE.Color(1, 1, 1) },
    uShadeTint: { value: new THREE.Color(1, 1, 1) },
    uViewport: { value: new THREE.Vector2(1600, 900) },
    uFlash: { value: 0 },
    uFocus: { value: new THREE.Vector3() },
    uSightline: { value: 0 },
    uGuards: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uSmokeThin: { value: 0 },
  };
}

/** Output epilogue matching built-in materials (tone mapping + colour space). */
export const OUTPUT_GLSL = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;
