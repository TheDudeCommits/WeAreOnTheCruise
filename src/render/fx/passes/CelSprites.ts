/**
 * Cel sprites: inked two/three-tone smoke, cel fire, fireballs that cool into smoke, splash columns, crown
 * spikes, droplets, bubbles, spray sheets, rock chips. Alpha-tested (+ alpha-to-coverage), depth-writing, so
 * thousands of puffs need no sorting. Shapes erode (noise holes eat them) instead of fading.
 */
import * as THREE from 'three';
import { CEL_PALETTE_COUNT, CEL_PALETTE_LINEAR } from '../core/palette';
import { FOG_UNIFORMS_GLSL, NOISE_GLSL, OUTPUT_GLSL, SPRITE_VERTEX_GLSL, type FxSharedUniforms } from '../core/glsl';
import { SpritePass } from '../core/SpritePass';

export const Cel = {
  Puff: 0, Flame: 1, Column: 2, Droplet: 3, Spike: 4, Bubble: 5, Cloud: 6, Fireball: 7, Chunk: 8, Sheet: 9,
} as const;

const vertexShader = /* glsl */ `
${SPRITE_VERTEX_GLSL}
void main() { fxSprite(); }
`;

const fragmentShader = /* glsl */ `
#define CEL_COUNT ${CEL_PALETTE_COUNT}
uniform vec3 uCelPal[CEL_COUNT * 4];
uniform vec3 uSunView;
uniform vec3 uLitTint;
uniform vec3 uShadeTint;
uniform float uFlash;
${FOG_UNIFORMS_GLSL}
${NOISE_GLSL}
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

vec3 celPal(int p, int i) { return uCelPal[p * 4 + i]; }

vec3 litTone(int p, int tone) {
  if (tone <= 0) return celPal(p, 0) * (uLitTint + uFlash * 0.6);
  if (tone == 1) return celPal(p, 1) * (mix(uLitTint, uShadeTint, 0.45) + uFlash * 0.4);
  return celPal(p, 2) * (uShadeTint + uFlash * 0.25);
}

void main() {
  vec2 uv = vUv;
  int shape = int(vShape + 0.5);
  int p = int(vPal + 0.5);
  float seed = vSeed * 43.0;
  float t = vT;
  float m = 0.0;
  float n1 = 0.5;
  float n2 = 0.5;
  vec3 nrm = vec3(0.0, 0.0, 1.0);
  int tone = -1;          // -1: shade from nrm; 0..2 fixed palette tone
  int heatMode = 0;       // 1: flame, 2: fireball (cools into smoke)
  float heat = 0.0;
  float erodeAmp = 1.0;

  if (shape == 0 || shape == 6 || shape == 7) {
    float d = length(uv);
    float sc = shape == 6 ? 1.45 : 2.2;
    n1 = fxNoise(uv * sc + seed);
    n2 = fxNoise(uv * 4.6 + seed * 1.37 + 5.0);
    m = (1.0 - d) + (n1 - 0.5) * (shape == 6 ? 0.6 : 0.34);
    nrm = normalize(vec3(uv * 1.1 + (vec2(n1, n2) - 0.5) * 0.7, sqrt(max(0.04, 1.0 - d * d))));
    if (shape == 7) { heatMode = 2; heat = m * 1.4 - t * 1.35 + 0.32; }
  } else if (shape == 1) {
    float st = floor(vAge * 12.0) / 12.0; // boil on twos
    vec2 q = uv;
    float h = q.y * 0.5 + 0.5;
    q.x -= (fxNoise(vec2(q.y * 1.6 - st * 5.0, seed)) - 0.5) * 0.62 * h;
    float halfW = mix(0.82, 0.05, pow(h, 0.85));
    float body = 1.0 - abs(q.x) / halfW;
    float base = smoothstep(-1.0, -0.62, q.y);
    n1 = fxNoise(vec2(q.x * 3.2 + seed, q.y * 2.3 - st * 7.0));
    n2 = fxNoise(uv * 4.3 + seed * 1.7 + st * 3.0);
    m = min(body, base) * (1.0 - h * 0.42) + (n1 - 0.5) * 0.6 * h;
    heatMode = 1;
    heat = m * 1.55 + 0.1;
  } else if (shape == 2) {
    float h = uv.y * 0.5 + 0.5;
    float x = uv.x;
    float halfW = mix(0.34, 0.94, pow(h, 0.75));
    float jag = fxNoise(vec2(x * 4.5 + seed, seed * 0.37));
    float jag2 = fxNoise(vec2(x * 12.0 + seed * 1.9, 3.0));
    float fing = pow(1.0 - abs(fract(x * 2.3 + seed * 0.13) * 2.0 - 1.0), 4.0);
    float top = 0.58 + 0.28 * jag + 0.1 * jag2 + fing * 0.32 - smoothstep(0.38, 1.0, t) * 0.62;
    m = min((halfW - abs(x)) * 1.8, (top - h) * 2.4);
    n1 = fxNoise(vec2(x * 6.0 + seed, h * 1.4 - t * 1.6));
    n2 = fxNoise(uv * vec2(3.0, 6.0) + seed * 1.3 + t * 2.0);
    float sx = uSunView.x >= 0.0 ? x : -x;
    float lit = sx * 0.85 + (n1 - 0.5) * 1.1 + (h - 0.45) * 0.6;
    tone = lit > 0.02 ? 0 : lit > -0.42 ? 1 : 2;
  } else if (shape == 3) {
    float d = length(vec2(uv.x, uv.y * (uv.y > 0.0 ? 0.8 : 1.2)));
    m = 1.0 - d;
    n2 = fxNoise(uv * 3.0 + seed);
    float hl = length(uv - vec2(-0.28, 0.32));
    tone = hl < 0.3 ? 0 : 1;
    erodeAmp = 0.6;
  } else if (shape == 4) {
    float h = uv.y * 0.5 + 0.5;
    float x = uv.x + (fxNoise(vec2(h * 2.0, seed)) - 0.5) * 0.3 * h;
    m = (1.0 - h) * 1.05 - abs(x) / 0.5;
    n1 = fxNoise(vec2(x * 5.0 + seed, h * 3.0));
    n2 = fxNoise(uv * 3.5 + seed * 1.5);
    float sx = uSunView.x >= 0.0 ? x : -x;
    tone = sx + (n1 - 0.5) * 0.7 > 0.02 ? 0 : 1;
  } else if (shape == 5) {
    float d = length(uv);
    m = (0.16 - abs(d - 0.72)) * 6.0;
    n2 = fxNoise(uv * 3.0 + seed);
    tone = (uv.y > 0.15 && uv.x < 0.1) ? 0 : 1;
    erodeAmp = 0.5;
  } else if (shape == 8) {
    float d = length(uv);
    float a = atan(uv.y, uv.x);
    float r0 = 0.72 + 0.2 * sin(a * 3.0 + seed * 6.0) + 0.08 * sin(a * 7.0 + seed);
    m = (r0 - d) / r0;
    nrm = normalize(vec3(uv * 0.9, 0.75));
    erodeAmp = 0.4;
  } else {
    float h = uv.y * 0.5 + 0.5;
    float x = uv.x;
    float jag = fxNoise(vec2(x * 6.0 + seed, 0.5));
    float fing = pow(1.0 - abs(fract(x * 3.1 + seed * 0.21) * 2.0 - 1.0), 3.0);
    float top = 0.42 + 0.34 * jag + fing * 0.28 - smoothstep(0.45, 1.0, t) * 0.55;
    float halfW = mix(0.5, 1.0, h);
    m = min((halfW - abs(x)) * 2.0, (top - h) * 2.5);
    n1 = fxNoise(vec2(x * 7.0 + seed, h * 2.0 - t));
    n2 = fxNoise(uv * vec2(4.0, 6.0) + seed * 1.1);
    float lit = (n1 - 0.5) * 1.2 + (h - 0.3);
    tone = lit > -0.05 ? 0 : lit > -0.42 ? 1 : 2;
  }

  // Erosion: holes open where n2 is high, then the whole silhouette is eaten — never an opacity fade.
  float e = clamp((t - vErode) / max(1e-3, 1.0 - vErode), 0.0, 1.0);
  float eaten = e * e * 3.6 * erodeAmp * (0.28 + 0.72 * n2);
  m -= eaten;
  if (heatMode == 2) heat -= eaten * 0.5;
  float w = max(fwidth(m), 1e-4);
  if (m < -w * 0.5) discard;
  float alpha = smoothstep(-w * 0.5, w * 0.5, m);
  float inkW = min(w * 1.7, 0.16);
  float inkMask = 1.0 - smoothstep(inkW - w * 0.5, inkW + w * 0.5, m);

  vec3 col;
  if (heatMode == 1) {
    vec3 c = heat > 0.78 ? celPal(p, 0) * 2.6 : heat > 0.5 ? celPal(p, 1) * 1.7 : heat > 0.22 ? celPal(p, 2) * 1.25 : celPal(p, 3) * 1.05;
    col = mix(c, celPal(p, 3) * 0.9, inkMask * 0.85) * vIntensity;
  } else if (heatMode == 2 && heat > 0.0) {
    vec3 c = heat > 0.75 ? celPal(p, 0) * 2.8 : heat > 0.46 ? celPal(p, 1) * 1.8 : heat > 0.2 ? celPal(p, 2) * 1.3 : celPal(p, 3) * 1.05;
    col = mix(c, celPal(p, 3), inkMask * 0.7) * vIntensity;
  } else {
    int sp = heatMode == 2 ? 1 : p; // fireballs cool into dark smoke
    int tn = tone;
    if (tn < 0) {
      float ndl = dot(nrm, uSunView) + (n1 - 0.5) * 0.3;
      tn = ndl > 0.3 ? 0 : ndl > -0.16 ? 1 : 2;
    }
    col = mix(litTone(sp, tn), celPal(sp, 3), inkMask);
  }
  col *= vTint;
  col = mix(col, uFogColor, fxFog(vFogDepth));
  gl_FragColor = vec4(col, alpha);
  ${OUTPUT_GLSL}
}
`;

export function createCelSprites(shared: FxSharedUniforms, ringCap: number, immCap: number): SpritePass {
  const material = new THREE.ShaderMaterial({
    name: 'fx-cel-sprites',
    vertexShader,
    fragmentShader,
    uniforms: {
      ...shared,
      uMinPixels: { value: 0 },
      uCelPal: { value: CEL_PALETTE_LINEAR },
    },
    transparent: false,
    depthWrite: true,
    depthTest: true,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
  });
  const pass = new SpritePass('fx-cel', material, ringCap, immCap);
  pass.mesh.renderOrder = 2;
  return pass;
}
