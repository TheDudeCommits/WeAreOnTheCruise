/**
 * Projectile heads as inked cel impostors (one draw call): iron balls with a hard highlight, spinning
 * chain-shot pairs, chaser slugs, harpoon spears, striped rockets, glowing water orbs, mortar shells, pellets.
 */
import * as THREE from 'three';
import { FOG_UNIFORMS_GLSL, NOISE_GLSL, OUTPUT_GLSL, SPRITE_VERTEX_GLSL, type FxSharedUniforms } from '../core/glsl';
import { SpritePass } from '../core/SpritePass';

export const Head = { Ball: 0, Chain: 1, Slug: 2, Spear: 3, Rocket: 4, Orb: 5, Shell: 6, Pellet: 7, Torpedo: 8 } as const;

const vertexShader = /* glsl */ `
${SPRITE_VERTEX_GLSL}
void main() { fxSprite(); }
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSunView;
uniform vec3 uLitTint;
uniform vec3 uShadeTint;
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
varying float vOccl;

const vec3 INK = vec3(0.0116, 0.0168, 0.0513);

float ball(vec2 uv, vec2 c, float r, out vec3 n) {
  vec2 q = (uv - c) / r;
  float d = length(q);
  n = normalize(vec3(q, sqrt(max(0.0, 1.0 - min(1.0, d * d)))));
  return (1.0 - d) * r;
}

vec3 shadeBall(vec3 base, vec3 n, vec2 q) {
  float ndl = dot(n, uSunView);
  vec3 c = base * (ndl > 0.25 ? uLitTint : mix(uShadeTint, uLitTint, 0.25) * 0.62);
  float spec = step(length(q - vec2(-0.32, 0.38)), 0.2);
  return mix(c, vec3(1.25), spec * step(0.0, ndl));
}

void main() {
  vec2 uv = vUv;
  int shape = int(vShape + 0.5);
  vec3 base = vTint;
  float m = -1.0;
  vec3 col = base;
  bool emissive = false;
  vec3 n;
  if (shape == 0 || shape == 6 || shape == 7) {
    float r = shape == 7 ? 0.7 : 0.92;
    m = ball(uv, vec2(0.0), r, n);
    col = shape == 7 ? base * 2.2 : shadeBall(base, n, uv / r);
    emissive = shape == 7;
    if (shape == 6) {
      // lit fuse spark on top
      float s = length(uv - vec2(0.5, 0.62));
      float spark = step(s, 0.18 + 0.05 * sin(vAge * 40.0));
      col = mix(col, vec3(3.0, 2.2, 0.8), spark);
      m = max(m, (0.2 - s));
    }
  } else if (shape == 1) {
    vec3 n1; vec3 n2;
    float a = ball(uv, vec2(-0.55, 0.0), 0.42, n1);
    float b = ball(uv, vec2(0.55, 0.0), 0.42, n2);
    float chain = min(0.07 - abs(uv.y + sin(uv.x * 9.0) * 0.03), 0.5 - abs(uv.x));
    m = max(max(a, b), chain);
    if (a >= b && a >= chain) col = shadeBall(base, n1, (uv - vec2(-0.55, 0.0)) / 0.42);
    else if (b >= chain) col = shadeBall(base, n2, (uv - vec2(0.55, 0.0)) / 0.42);
    else col = base * 0.55 * uShadeTint;
  } else if (shape == 2) {
    vec2 q = vec2(uv.x / 0.5, max(abs(uv.y) - 0.45, 0.0) / 0.5);
    float d = length(q);
    m = (1.0 - d) * 0.5;
    col = base * (uv.x < 0.1 ? uLitTint : uShadeTint * 0.7);
    col = mix(col, vec3(1.6, 1.3, 0.7), step(0.72, uv.y) * step(abs(uv.x), 0.3)); // hot tip
  } else if (shape == 3) {
    float shaft = min(0.09 - abs(uv.x), 0.55 - uv.y);
    shaft = min(shaft, uv.y + 1.0);
    float headW = (1.0 - uv.y) / 0.55 * 0.34;
    float head = min(headW - abs(uv.x), uv.y - 0.4);
    float barb = min(0.36 - abs(abs(uv.x) - 0.2) * 2.0 - (uv.y - 0.4) * 0.0, min(uv.y - 0.36, 0.52 - uv.y) * 2.0);
    m = max(max(shaft, head), barb * 0.5);
    col = head >= shaft ? vec3(0.62, 0.66, 0.74) * uLitTint : vec3(0.36, 0.21, 0.1) * uLitTint;
  } else if (shape == 4) {
    float body = min(0.26 - abs(uv.x), min(0.62 - uv.y, uv.y + 0.78));
    float nose = min((1.0 - uv.y) * 0.4 - abs(uv.x), uv.y - 0.55);
    float fin = min(0.55 - abs(uv.x) - (uv.y + 0.95) * 0.8, min(-0.45 - uv.y, uv.y + 1.0));
    m = max(max(body, nose), fin);
    float stripe = step(0.5, fract(uv.y * 2.2));
    col = (nose > body ? vec3(0.95, 0.2, 0.15) : mix(vec3(0.95, 0.92, 0.85), vec3(0.85, 0.12, 0.1), stripe)) * (uv.x < 0.05 ? uLitTint : uShadeTint * 0.75);
    if (fin > body && fin > nose) col = vec3(0.2, 0.2, 0.26) * uLitTint;
  } else if (shape == 5) {
    float r = length(uv);
    float swirl = fxNoise(vec2(atan(uv.y, uv.x) * 1.6 + vAge * 6.0, r * 4.0 - vAge * 5.0) + vSeed * 20.0);
    m = 0.95 - r + (swirl - 0.5) * 0.18;
    col = r < 0.42 ? vec3(2.6, 3.0, 3.2) : mix(base * 1.9, vec3(1.5, 2.2, 2.6), step(0.55, swirl));
    emissive = true;
  } else {
    // torpedo body (surface-hugging dark shape)
    vec2 q = vec2(uv.x / 0.3, max(abs(uv.y) - 0.6, 0.0) / 0.3);
    m = (1.0 - length(q)) * 0.3;
    col = base * uShadeTint * 0.6;
  }
  float w = max(fwidth(m), 1e-4);
  if (m < -w * 0.5) discard;
  float alpha = smoothstep(-w * 0.5, w * 0.5, m);
  float inkW = min(w * 1.5, 0.14);
  float ink = emissive ? 0.0 : 1.0 - smoothstep(inkW - w * 0.5, inkW + w * 0.5, m);
  col = mix(col, INK, ink);
  col = mix(col, uFogColor, fxFog(vFogDepth) * (emissive ? 0.6 : 1.0));
  gl_FragColor = vec4(col, alpha);
  ${OUTPUT_GLSL}
}
`;

export function createHeads(shared: FxSharedUniforms, capacity: number): SpritePass {
  const material = new THREE.ShaderMaterial({
    name: 'fx-heads',
    vertexShader,
    fragmentShader,
    uniforms: { ...shared, uMinPixels: { value: 3.0 } },
    transparent: false,
    depthWrite: true,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
  });
  const pass = new SpritePass('fx-heads', material, 0, capacity);
  pass.mesh.renderOrder = 3;
  return pass;
}
