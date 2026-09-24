/**
 * Procedural ocean textures (OCEAN-owned), generated once on the GPU at init — no third-party files.
 *
 * - detailA / detailB: tileable, wind-aligned ripple normal maps (RGB = unit normal, A = height). Built from a
 *   sum of sines with integer wave numbers (so they tile) whose directions cluster around +U (the wind axis;
 *   the ocean shader rotates U onto ctx.sea.windDir). Mipmapped + anisotropic, so distance filtering is done by
 *   the hardware and the averaged normal length feeds a Toksvig factor (no sparkle crawl at distance).
 * - foam: tileable shape texture. R = foam network (Worley cell borders; thresholding gives solid → lace with
 *   round holes → threads), G = bubble dots, B = soft value-noise patches, A = wind streaks (stretched along U).
 */
import * as THREE from 'three';

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const DETAIL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uSeed;
uniform float uFreqMin;
uniform float uFreqMax;
uniform float uSpread;
uniform float uSlope;
uniform float uCusp;

float hash1(float n) { return fract(sin(n * 12.9898 + uSeed * 78.233) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  float h = 0.0;
  vec2 g = vec2(0.0);
  float ampSum = 0.0;
  for (int i = 0; i < 64; i++) {
    float fi = float(i);
    float r1 = hash1(fi * 3.17 + 1.3);
    float r2 = hash1(fi * 5.71 + 2.9);
    float r3 = hash1(fi * 7.33 + 4.1);
    float r4 = hash1(fi * 9.13 + 6.7);
    float freq = mix(uFreqMin, uFreqMax, pow(r1, 1.35));
    float ang = (r2 - 0.5) * 2.0 * uSpread * (0.35 + 0.65 * r4);
    vec2 kk = floor(vec2(cos(ang), sin(ang)) * freq + 0.5);
    if (abs(kk.x) + abs(kk.y) < 0.5) kk = vec2(1.0, 0.0);
    float kl = length(kk);
    float amp = 1.0 / pow(kl, 1.6);
    float ph = 6.2831853 * (dot(kk, uv) + r3);
    h += amp * sin(ph);
    g += amp * 6.2831853 * kk * cos(ph);
    ampSum += amp;
  }
  h /= ampSum;
  g /= ampSum;
  // Cusp shaping: sharper crests / broader troughs read as painted ripples rather than noise.
  float shaped = h + uCusp * h * h;
  vec2 gs = g * (1.0 + 2.0 * uCusp * h);
  vec3 n = normalize(vec3(-gs.x * uSlope, 1.0, -gs.y * uSlope));
  gl_FragColor = vec4(n * 0.5 + 0.5, clamp(shaped * 0.5 + 0.5, 0.0, 1.0));
}
`;

const FOAM_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uSeed;

vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))) + uSeed;
  return fract(sin(p) * 43758.5453);
}
float hash12(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1)) + uSeed * 3.7) * 43758.5453); }

vec2 worley(vec2 uv, float cells) {
  vec2 p = uv * cells;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 cell = mod(i + o, cells);
      vec2 pt = o + 0.1 + 0.8 * hash22(cell);
      float d = length(pt - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2(f1, f2);
}

float vnoise(vec2 uv, vec2 cells) {
  vec2 p = uv * cells;
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, cells));
  float b = hash12(mod(i + vec2(1.0, 0.0), cells));
  float c = hash12(mod(i + vec2(0.0, 1.0), cells));
  float d = hash12(mod(i + vec2(1.0, 1.0), cells));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = vUv;
  // R: foam network — high along Worley cell borders, low at feature points. Thresholding it against coverage
  // gives solid foam → lace with round holes → thin threads as foam dissolves.
  vec2 w1 = worley(uv, 6.0);
  vec2 w2 = worley(uv + 0.37, 13.0);
  float net = 0.7 * smoothstep(0.0, 0.62, w1.x) + 0.3 * smoothstep(0.0, 0.6, w2.x);
  net = clamp(net + (vnoise(uv, vec2(24.0)) - 0.5) * 0.1, 0.0, 1.0);
  // G: bubbles — small round dots for the fringe of dissolving foam.
  vec2 w3 = worley(uv + 0.71, 21.0);
  float bubbles = 1.0 - smoothstep(0.08, 0.3, w3.x);
  bubbles *= smoothstep(0.35, 0.6, vnoise(uv, vec2(7.0)));
  // B: soft patches (cloud-shadow / painterly variation / crest segment breakup).
  float patches = vnoise(uv, vec2(3.0)) * 0.55 + vnoise(uv, vec2(7.0)) * 0.3 + vnoise(uv, vec2(15.0)) * 0.15;
  // A: wind streaks, long along U.
  float streak = vnoise(uv, vec2(3.0, 26.0)) * 0.65 + vnoise(uv, vec2(6.0, 52.0)) * 0.35;
  gl_FragColor = vec4(net, bubbles, patches, streak);
}
`;

export interface OceanTextureSet {
  detailA: THREE.Texture;
  detailB: THREE.Texture;
  foam: THREE.Texture;
  dispose(): void;
}

function makeTarget(size: number, anisotropy: number): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    anisotropy,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

/** Renders the three textures once. Safe to call during init (restores the renderer's target/clear state). */
export function createOceanTextures(renderer: THREE.WebGLRenderer, seed = 1): OceanTextureSet {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(geometry);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const detailMaterial = (freqMin: number, freqMax: number, spread: number, slope: number, cusp: number, s: number) =>
    new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT, fragmentShader: DETAIL_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        uSeed: { value: s }, uFreqMin: { value: freqMin }, uFreqMax: { value: freqMax },
        uSpread: { value: spread }, uSlope: { value: slope }, uCusp: { value: cusp },
      },
    });
  const detailA = makeTarget(512, anisotropy);
  const detailB = makeTarget(512, anisotropy);
  const foam = makeTarget(512, anisotropy);
  const materials = [
    detailMaterial(5, 22, 1.0, 0.07, 0.35, seed * 1.37 + 0.11),
    detailMaterial(5, 24, 1.3, 0.06, 0.25, seed * 2.91 + 0.53),
    new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VERT, fragmentShader: FOAM_FRAG, depthTest: false, depthWrite: false, uniforms: { uSeed: { value: seed * 0.77 + 0.2 } } }),
  ];
  const targets = [detailA, detailB, foam];

  const previousTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  for (let i = 0; i < targets.length; i++) {
    mesh.material = materials[i]!;
    renderer.setRenderTarget(targets[i]!);
    renderer.render(scene, camera);
  }
  renderer.setRenderTarget(previousTarget);
  renderer.autoClear = previousAutoClear;
  for (const material of materials) material.dispose();
  geometry.dispose();

  return {
    detailA: detailA.texture,
    detailB: detailB.texture,
    foam: foam.texture,
    dispose() { detailA.dispose(); detailB.dispose(); foam.dispose(); },
  };
}
