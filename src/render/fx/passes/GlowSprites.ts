/**
 * Additive HDR sprites: starburst flashes (2–4 frames, hollowing out), directional muzzle blasts, sparks,
 * glints, sparkles, rings, embers, light shafts, speed streaks. Cores exceed 1.0 so they bloom under HDR post.
 */
import * as THREE from 'three';
import { GLOW_PALETTE_COUNT, GLOW_PALETTE_LINEAR } from '../core/palette';
import { FOG_UNIFORMS_GLSL, NOISE_GLSL, OUTPUT_GLSL, SPRITE_VERTEX_GLSL, type FxSharedUniforms } from '../core/glsl';
import { SpritePass } from '../core/SpritePass';

export const Glow = {
  Burst: 0, DirFlash: 1, Soft: 2, Spark: 3, Glint: 4, Ring: 5, Ember: 6, Sparkle: 7, Shaft: 8, Streak: 9, Bolt: 10,
} as const;

const vertexShader = /* glsl */ `
${SPRITE_VERTEX_GLSL}
void main() { fxSprite(); }
`;

const fragmentShader = /* glsl */ `
#define GLOW_COUNT ${GLOW_PALETTE_COUNT}
uniform vec3 uGlowPal[GLOW_COUNT * 3];
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

void main() {
  vec2 uv = vUv;
  int shape = int(vShape + 0.5);
  int p = int(vPal + 0.5);
  vec3 core = uGlowPal[p * 3];
  vec3 mid = uGlowPal[p * 3 + 1];
  vec3 outer = uGlowPal[p * 3 + 2];
  float t = vT;
  float seed = vSeed * 57.0;
  float r = length(uv);
  vec3 col = vec3(0.0);

  if (shape == 0 || shape == 1) {
    vec2 q = uv;
    if (shape == 1) q.y += 0.62;
    float rr = length(q);
    float a = atan(q.y, q.x);
    float N = 7.0 + floor(fxHash11(seed) * 6.0);
    float fa = a / 6.2831853 * N + seed;
    float cell = floor(fa);
    float tri = 1.0 - abs(fract(fa) * 2.0 - 1.0);
    float len = mix(0.42, 1.0, fxHash11(cell + seed * 3.1));
    float spike = mix(0.33, len, pow(tri, 2.4));
    if (shape == 1) spike *= mix(0.22, 1.5, smoothstep(-0.35, 1.0, q.y / max(rr, 1e-3)));
    spike *= 1.0 + t * 0.14;
    float m = spike - rr;
    float hollow = smoothstep(0.3, 1.0, t) * spike * 0.94;
    float w = max(fwidth(m), 1e-4);
    float cover = smoothstep(0.0, w, m) * smoothstep(0.0, w, rr - hollow);
    float rel = rr / max(spike, 1e-3);
    col = (rel < 0.42 ? core * 3.4 : rel < 0.72 ? mid * 2.1 : outer * 1.4) * cover;
  } else if (shape == 2) {
    float g = max(0.0, 1.0 - r);
    col = mix(outer, mid, g) * g * g * 1.6 * pow(1.0 - t, 1.3);
  } else if (shape == 3) {
    float m = (1.0 - abs(uv.y)) * 0.34 - abs(uv.x);
    float w = max(fwidth(m), 1e-4);
    float cover = smoothstep(0.0, w, m);
    col = mix(outer * 1.4, core * 3.0, smoothstep(0.0, 0.16, m)) * cover * (1.0 - t * t);
  } else if (shape == 4 || shape == 7) {
    float tw = shape == 7 ? 0.5 + 0.5 * sin(vAge * 22.0 + seed * 3.0) : 0.75 + 0.25 * sin(vAge * 9.0 + seed * 2.0);
    float k = shape == 7 ? 10.0 : 7.5;
    float star = max(0.0, 1.0 - abs(uv.x) * k - abs(uv.y) * 1.05) + max(0.0, 1.0 - abs(uv.y) * k - abs(uv.x) * 1.05);
    float dot0 = max(0.0, 1.0 - r * 2.8);
    float v = max(star, dot0);
    col = mix(mid * 1.6, core * 3.2, dot0) * v * v * tw * (1.0 - smoothstep(0.7, 1.0, t));
  } else if (shape == 5) {
    float m = 0.1 - abs(r - 0.86);
    float w = max(fwidth(m), 1e-4);
    float cover = smoothstep(0.0, w, m);
    float inner = max(0.0, 0.3 - abs(r - 0.78)) * 1.5;
    col = (mid * 2.0 * cover + outer * inner) * pow(1.0 - t, 1.4);
  } else if (shape == 6) {
    float fl = 0.7 + 0.3 * sin(vAge * 30.0 + seed * 5.0);
    float m = 1.0 - r;
    col = mix(outer, core * 2.4, smoothstep(0.3, 0.8, m)) * smoothstep(0.0, 0.25, m) * fl * (1.0 - t);
  } else if (shape == 8) {
    float h = uv.y * 0.5 + 0.5;
    float x = abs(uv.x);
    float body = pow(max(0.0, 1.0 - x), 2.2);
    float coreLine = pow(max(0.0, 1.0 - x * 3.0), 2.0);
    float pulse = 0.8 + 0.2 * sin(vAge * 6.0 + seed);
    col = (mid * body + core * coreLine * 1.5) * pow(1.0 - h, 0.7) * pulse * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.75, 1.0, t)) * 1.3;
  } else if (shape == 9) {
    float along = 1.0 - abs(uv.y);
    float across = max(0.0, 1.0 - abs(uv.x) * 1.6);
    col = mid * smoothstep(0.0, 0.6, along) * across * across * 1.2 * (1.0 - t);
  } else {
    // 10: bolt glow node (bright core + electric fringe)
    float fl = step(0.35, fxHash11(floor(vAge * 24.0) + seed));
    float g = max(0.0, 1.0 - r);
    col = (core * 3.0 * pow(g, 6.0) + mid * g * g) * (0.6 + 0.4 * fl) * (1.0 - t);
  }

  col *= vTint * vIntensity * (1.0 - fxFog(vFogDepth));
  if (col.r + col.g + col.b < 0.002) discard;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
}
`;

export function createGlowSprites(shared: FxSharedUniforms, ringCap: number, immCap: number): SpritePass {
  const material = new THREE.ShaderMaterial({
    name: 'fx-glow-sprites',
    vertexShader,
    fragmentShader,
    uniforms: {
      ...shared,
      uMinPixels: { value: 1.5 },
      uGlowPal: { value: GLOW_PALETTE_LINEAR },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const pass = new SpritePass('fx-glow', material, ringCap, immCap);
  pass.mesh.renderOrder = 20;
  return pass;
}
