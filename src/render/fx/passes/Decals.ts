/**
 * Water-surface decals (one draw call): enemy telegraphs (circle / ring / line / cone), the player's aim reticle
 * and broadside firing wedge, splash foam rings, shock rings, whirlpool and sinking spirals, fire glow on the
 * water, seaquake cracks, torpedo wakes, shadows. The grid is displaced by the same Gerstner waves as the
 * ocean (src/core/waves.ts) so decals hug the swell. Premultiplied alpha lets one pass mix translucent paint
 * with additive glow.
 */
import * as THREE from 'three';
import { GERSTNER_GLSL } from '../../../core/waves';
import { FOG_UNIFORMS_GLSL, NOISE_GLSL, OUTPUT_GLSL, gerstnerUniforms, type FxSharedUniforms } from '../core/glsl';
import { InstancePool } from '../core/InstancePool';
import { hexToLinear } from '../core/palette';

export const Decal = {
  Circle: 0, Ring: 1, Line: 2, Cone: 3, Foam: 4, Shock: 5, Whirl: 6, Glow: 7, Reticle: 8, Wedge: 9, Cracks: 10,
  Torpedo: 11, Shadow: 12, Blot: 13,
} as const;

export const DECAL_STRIDE = 20;
const GRID = 22;

const vertexShader = /* glsl */ `
${GERSTNER_GLSL}
uniform float uWaveTime;
uniform float uTime;
attribute vec4 dA; // center.xz, angle, lift
attribute vec4 dB; // half.xz, shape, seed
attribute vec4 dC; // t0, life, p1, p2
attribute vec4 dD; // color.rgb, alpha
attribute vec4 dE; // color2.rgb, add
varying vec2 vUv;
varying vec2 vHalf;
varying float vT;
varying float vShape;
varying float vSeed;
varying vec2 vP;
varying vec4 vColor;
varying vec4 vColor2;
varying float vFogDepth;
void main() {
  float age = uTime - dC.x;
  float t = age / max(dC.y, 1e-4);
  if (age < 0.0 || t >= 1.0 || dB.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 local = position.xz;
  float ca = cos(dA.z); float sa = sin(dA.z);
  vec2 off = local * dB.xy;
  vec2 world = dA.xy + vec2(off.x * ca + off.y * sa, -off.x * sa + off.y * ca);
  vec3 disp; vec3 nrm; float crest;
  sampleGerstnerWaves(world, uWaveTime, disp, nrm, crest);
  vec3 wp = disp + nrm * dA.w;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = local;
  vHalf = dB.xy;
  vT = t;
  vShape = dB.z;
  vSeed = dB.w;
  vP = dC.zw;
  vColor = dD;
  vColor2 = dE;
  vFogDepth = -mv.z;
}
`;

const fragmentShader = /* glsl */ `
uniform float uRealTime;
${FOG_UNIFORMS_GLSL}
${NOISE_GLSL}
varying vec2 vUv;
varying vec2 vHalf;
varying float vT;
varying float vShape;
varying float vSeed;
varying vec2 vP;
varying vec4 vColor;
varying vec4 vColor2;
varying float vFogDepth;

float band(float d, float halfWidth, float aa) { return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, abs(d)); }

void main() {
  vec2 uv = vUv;
  int shape = int(vShape + 0.5);
  float r = length(uv);
  float aa = max(fwidth(r), 1e-4);
  float t = vT;
  float seed = vSeed * 37.0;
  vec3 c1 = vColor.rgb;
  vec3 c2 = vColor2.rgb;
  float alpha = 0.0;
  vec3 paint = vec3(0.0);
  vec3 add = vec3(0.0);
  float pulse = 0.5 + 0.5 * sin(uRealTime * 9.0);

  if (shape == 0 || shape == 1) {
    if (r > 1.0 + aa) discard;
    float prog = clamp(vP.x, 0.0, 1.0);
    float inner = shape == 1 ? clamp(vP.y, 0.0, 0.95) : 0.0;
    float blink = prog > 0.82 ? step(0.5, fract(uRealTime * 7.0)) : 0.0;
    float outline = band(r - 0.965, 0.035, aa);
    float ink = band(r - 0.995, 0.012, aa);
    float innerLine = shape == 1 ? band(r - inner - 0.02, 0.02, aa) : 0.0;
    float inside = step(inner, r) * (1.0 - smoothstep(1.0 - aa, 1.0, r));
    float frontR = mix(inner, 1.0, prog);
    float fill = inside * (1.0 - smoothstep(frontR - aa, frontR, r));
    float front = band(r - frontR + 0.02, 0.02, aa) * inside * step(0.02, prog);
    float hatch = step(0.55, fract((uv.x - uv.y) * 3.2 * max(vHalf.x, 1.0) / 8.0 - uRealTime * 0.8));
    float a = (inside * 0.1 + fill * (0.24 + 0.1 * hatch) + outline * (0.78 + 0.22 * pulse) + innerLine * 0.7) * vColor.a;
    vec3 col = c1 * (1.0 + blink * 0.8);
    paint = col * a;
    alpha = a;
    add = c1 * (front * 0.7 + outline * blink * 0.5) * vColor.a;
    paint = mix(paint, c2 * alpha, ink * vColor.a);
    alpha = max(alpha, ink * 0.9 * vColor.a);
  } else if (shape == 2) {
    float along = uv.y * 0.5 + 0.5;
    float across = abs(uv.x);
    float aax = max(fwidth(uv.x), 1e-4);
    float aay = max(fwidth(uv.y), 1e-4);
    float prog = clamp(vP.x, 0.0, 1.0);
    float edge = 1.0 - smoothstep(0.86 - aax, 0.86 + aax, across);
    float outline = (1.0 - edge) * (1.0 - smoothstep(1.0 - aax, 1.0, across));
    float ends = 1.0 - smoothstep(0.03 - aay, 0.03 + aay, min(along, 1.0 - along));
    float fill = step(along, prog);
    float ratio = vHalf.y / max(vHalf.x, 0.5);
    float chev = step(0.6, fract(along * ratio * 0.9 - across * 0.45 - uRealTime * 1.8));
    float a = (0.1 + fill * (0.22 + 0.1 * chev) + (outline + ends * edge) * (0.8 + 0.2 * pulse)) * vColor.a;
    paint = c1 * a;
    alpha = a;
    add = c1 * band(along - prog, 0.012, aay) * 1.3 * vColor.a;
  } else if (shape == 3) {
    float along = uv.y * 0.5 + 0.5;
    vec2 q = vec2(uv.x * vHalf.x, along * vHalf.y * 2.0);
    float halfAngle = atan(vHalf.x, vHalf.y * 2.0);
    float ang = atan(abs(q.x), q.y);
    float rr = length(q) / (vHalf.y * 2.0);
    float aa2 = max(fwidth(ang), 1e-4);
    float aar = max(fwidth(rr), 1e-4);
    float inside = (1.0 - smoothstep(halfAngle - aa2, halfAngle, ang)) * (1.0 - smoothstep(1.0 - aar, 1.0, rr));
    if (inside <= 0.0) discard;
    float prog = clamp(vP.x, 0.0, 1.0);
    float edge = max(1.0 - smoothstep(halfAngle - aa2 * 3.0 - 0.02, halfAngle - 0.02, ang) * 0.0, 0.0);
    float sideLine = smoothstep(halfAngle - 0.05, halfAngle - 0.02, ang);
    float arc = smoothstep(0.95, 0.975, rr);
    float fill = step(rr, prog);
    float a = inside * (0.1 + fill * 0.26 + max(sideLine, arc) * (0.75 + 0.25 * pulse)) * vColor.a;
    paint = c1 * a;
    alpha = a;
    add = c1 * band(rr - prog, 0.01, aar) * inside * 1.2 + edge * 0.0;
  } else if (shape == 4 || shape == 13) {
    float n = fxNoise(vec2(atan(uv.y, uv.x) * 3.0 + seed, r * 7.0 + seed));
    float n2 = fxNoise(uv * 6.0 + seed * 1.7);
    float m;
    float n3 = fxNoise(uv * 13.0 + seed * 2.3);
    if (shape == 4) {
      // expanding lace ring + a thinner inner ring; only a small footprint blot at the impact point
      float R = mix(0.22, 1.0, 1.0 - pow(1.0 - t, 3.0));
      float th = min(mix(0.11, 0.03, t) * vP.x, 3.0 * vP.x / max(vHalf.x, 1.0));
      m = th - abs(r - R) + (n - 0.5) * 0.12;
      float inner = th * 0.55 - abs(r - R * 0.6) + (n2 - 0.5) * 0.1;
      m = max(m, inner - (1.0 - smoothstep(0.05, 0.2, t)) * 0.2);
      float blot = (0.14 - r) + (n2 - 0.5) * 0.26 - t * 1.1;
      m = max(m, blot);
      m -= (n3 - 0.35) * 0.08; // lace holes
    } else {
      m = (0.62 - r) + (n - 0.5) * 0.55 - (n3 - 0.45) * 0.3;
    }
    m -= t * t * 1.2 * (0.25 + 0.75 * n2);
    float w = max(fwidth(m), 1e-4);
    if (m < -w) discard;
    float cover = smoothstep(-w, w, m);
    float shadowEdge = 1.0 - smoothstep(0.0, 0.07, m);
    vec3 foam = mix(c1, c2, shadowEdge);
    alpha = cover * vColor.a;
    paint = foam * alpha;
  } else if (shape == 5) {
    // thin, fast shock line (anime timing: out fast, thin out, gone) with a brief inner wash
    float R = 1.0 - pow(1.0 - t, 3.0);
    float thick = max(vP.x, 0.2);
    float th = min(0.03 * thick, 1.6 * thick / max(vHalf.x, 1.0)) * mix(1.0, 0.25, t);
    float ring = band(r - R, th, aa);
    float wash = step(r, R) * smoothstep(R - 0.16, R, r) * (1.0 - smoothstep(0.0, 0.22, t)) * 0.18;
    float fade = pow(1.0 - t, 1.2);
    alpha = (ring * 0.7 + wash * 0.4) * fade * vColor.a;
    paint = c1 * alpha;
    add = c2 * vColor2.a * (ring * 1.2 + wash * 0.25) * fade;
  } else if (shape == 6) {
    if (r > 1.0) discard;
    float ang = atan(uv.y, uv.x);
    float arms = max(vP.y, 2.0);
    float spin = uRealTime * vP.x;
    float sp = sin(ang * arms + log(r + 0.04) * 7.0 + spin + seed);
    float n = fxNoise(vec2(ang * 2.0 + seed, r * 6.0 - spin * 0.2));
    float foamM = sp - 0.35 + (n - 0.5) * 0.7 - smoothstep(0.7, 1.0, r) * 1.2 - t * t * 1.5;
    float w = max(fwidth(foamM), 1e-4);
    float foam = smoothstep(-w, w, foamM);
    float dark = (1.0 - smoothstep(0.0, 0.55, r)) * 0.55 * (1.0 - t);
    float lace = band(foamM, 0.06, w) * 0.6;
    alpha = max(foam * 0.92, dark) * vColor.a;
    paint = mix(c2 * dark, c1, foam) * vColor.a + c1 * lace * 0.2;
    alpha = max(alpha, lace * 0.4);
  } else if (shape == 7) {
    float g = max(0.0, 1.0 - r);
    float flick = 0.85 + 0.15 * sin(uRealTime * vP.x + seed);
    add = c1 * g * g * g * 0.55 * vColor2.a * flick * (1.0 - smoothstep(0.6, 1.0, t)) * smoothstep(0.0, 0.08, t);
    alpha = 0.0;
  } else if (shape == 8) {
    if (r > 1.0 + aa) discard;
    float ang = atan(uv.y, uv.x);
    float gaps = step(0.14, abs(fract(ang / 1.5707963 + 0.5) - 0.5));
    float ring = band(r - 0.9, 0.06, aa) * gaps;
    float ink = band(r - 0.9, 0.1, aa) * gaps - ring;
    float dashes = band(r - 0.62, 0.03, aa) * step(0.5, fract(ang * 1.9099 + uRealTime * 0.6));
    float dotc = 1.0 - smoothstep(0.08 - aa, 0.08 + aa, r);
    float ticks = band(uv.x, 0.025, aa) * step(0.35, abs(uv.y)) * step(abs(uv.y), 0.55) + band(uv.y, 0.025, aa) * step(0.35, abs(uv.x)) * step(abs(uv.x), 0.55);
    float a = (ring + dashes * 0.8 + dotc + ticks) * (0.65 + 0.35 * vP.x);
    alpha = max(a, max(ink, 0.0) * 0.5);
    paint = c1 * a + c2 * max(ink, 0.0) * 0.5;
    add = c1 * (ring + dotc) * 0.35 * vP.x;
  } else if (shape == 9) {
    vec2 q = uv;
    float rr = length(q);
    float ang = abs(atan(q.x, q.y));
    float halfA = vP.y;
    float aa2 = max(fwidth(ang), 1e-4);
    float inside = (1.0 - smoothstep(halfA - aa2, halfA, ang)) * (1.0 - smoothstep(1.0 - aa, 1.0, rr)) * smoothstep(0.08, 0.12, rr);
    if (inside <= 0.0) discard;
    // compact fan at the hull (which side fires) + a faint dotted arc at the gun range
    float near = 1.0 - smoothstep(0.14, 0.27, rr);
    float edgeA = band(ang - halfA + 0.01, 0.01, aa2) * smoothstep(0.08, 0.14, rr) * near;
    float arc = band(rr - 0.99, 0.0035, aa) * step(0.6, fract(ang * 16.0));
    float ready = clamp(vP.x, 0.0, 1.0);
    float fill = (0.05 + 0.09 * ready) * near * smoothstep(0.08, 0.3, rr);
    float chev = band(fract(rr * 12.0 - uRealTime * 1.2) - 0.5, 0.03, 0.02) * near * smoothstep(0.1, 0.16, rr) * ready;
    float a = inside * (fill + chev * 0.2 + edgeA * (0.3 + 0.45 * ready) + arc * (0.08 + 0.12 * ready));
    alpha = a;
    paint = c1 * a;
    add = c1 * (edgeA + arc) * inside * 0.25 * ready;
  } else if (shape == 10) {
    if (r > 1.0) discard;
    float ang = atan(uv.y, uv.x);
    float N = 13.0;
    float cell = floor((ang / 6.2831853 + 0.5) * N);
    float center = (cell + 0.5 + (fxHash11(cell + seed) - 0.5) * 0.5) / N * 6.2831853 - 3.14159265;
    float wob = (fxNoise(vec2(r * 9.0, cell + seed)) - 0.5) * 0.12;
    float da = abs(mod(ang - center + wob + 3.14159265, 6.2831853) - 3.14159265) * r;
    float reach = t * 1.6 * mix(0.6, 1.0, fxHash11(cell * 3.1 + seed));
    float wCore = mix(0.9, 0.3, r) / max(vHalf.x, 1.0);
    float live = step(r, reach) * step(0.06, r);
    float daa = max(fwidth(da), 1e-4);
    float crack = band(da, wCore, daa) * live;
    float inkLine = band(da, wCore * 2.6, daa) * live;
    float ringR = 1.0 - pow(1.0 - t, 2.0);
    float ring = band(r - ringR, (1.4 * (1.0 - t) + 0.4) / max(vHalf.x, 1.0), aa);
    float fade = 1.0 - smoothstep(0.6, 1.0, t);
    alpha = max(inkLine * 0.85, ring * 0.5) * fade;
    paint = (c2 * inkLine * 0.85 * (1.0 - crack) + c1 * ring * 0.5) * fade;
    add = c1 * (crack * 1.5 + ring * 0.6) * fade;
  } else if (shape == 11) {
    vec2 q = vec2(uv.x / 0.22, max(abs(uv.y - 0.45) - 0.35, 0.0) / 0.22);
    float body = 1.0 - length(q);
    float wakeY = 0.1 - uv.y;
    float vW = wakeY * 0.55;
    float wake = step(0.0, wakeY) * band(abs(uv.x) - vW, 0.05 + wakeY * 0.04, max(fwidth(uv.x), 1e-4)) * (1.0 - smoothstep(0.6, 1.1, wakeY));
    float aab = max(fwidth(body), 1e-4);
    float b = smoothstep(-aab, aab, body);
    alpha = max(b * 0.55, wake * 0.85);
    paint = c2 * b * 0.55 + c1 * wake * 0.85 * (1.0 - b);
  } else if (shape == 12) {
    float g = 1.0 - smoothstep(0.4, 1.0, r);
    alpha = g * vColor.a * (1.0 - smoothstep(0.7, 1.0, t));
    paint = c1 * alpha;
  }

  float fog = fxFog(vFogDepth);
  paint = mix(paint, uFogColor * alpha, fog);
  add *= 1.0 - fog;
  if (alpha <= 0.001 && dot(add, vec3(1.0)) <= 0.001) discard;
  // Colour-space conversion must see straight (un-premultiplied) colour, then we premultiply.
  gl_FragColor = vec4(alpha > 1e-4 ? paint / alpha : vec3(0.0), 1.0);
  ${OUTPUT_GLSL}
  vec3 paintOut = gl_FragColor.rgb;
  gl_FragColor = vec4(add, 1.0);
  ${OUTPUT_GLSL}
  gl_FragColor = vec4(paintOut * alpha + gl_FragColor.rgb, alpha);
}
`;

export class DecalPass {
  readonly mesh: THREE.Mesh;
  readonly pool: InstancePool;
  readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  clock = 0;
  private readonly c1 = new Float32Array(3);
  private readonly c2 = new Float32Array(3);

  constructor(shared: FxSharedUniforms, ringCap: number, immCap: number) {
    this.pool = new InstancePool(DECAL_STRIDE, ringCap, immCap);
    const plane = new THREE.PlaneGeometry(2, 2, GRID, GRID);
    plane.rotateX(-Math.PI / 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', plane.getAttribute('position'));
    g.setIndex(plane.getIndex());
    plane.dispose();
    this.pool.attach(g, 'dA', 4, 0);
    this.pool.attach(g, 'dB', 4, 4);
    this.pool.attach(g, 'dC', 4, 8);
    this.pool.attach(g, 'dD', 4, 12);
    this.pool.attach(g, 'dE', 4, 16);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      name: 'fx-decals',
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, ...gerstnerUniforms() },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'fx-decals';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 10;
  }

  setWaves(time: number, strength: number): void {
    this.material.uniforms.uWaveTime!.value = time;
    this.material.uniforms.uWaveStrength!.value = strength;
  }

  beginFrame(clock: number): void { this.clock = clock; this.pool.beginFrame(); }

  private write(o: number, x: number, z: number, angle: number, halfX: number, halfZ: number, shape: number, t0: number,
    life: number, p1: number, p2: number, hex1: number, a1: number, hex2: number, add: number, seed: number): void {
    const d = this.pool.data;
    hexToLinear(hex1, this.c1, 0);
    hexToLinear(hex2, this.c2, 0);
    const lift = 0.28 + Math.max(halfX, halfZ) * 0.0045;
    d[o] = x; d[o + 1] = z; d[o + 2] = angle; d[o + 3] = lift;
    d[o + 4] = halfX; d[o + 5] = halfZ; d[o + 6] = shape; d[o + 7] = seed;
    d[o + 8] = t0; d[o + 9] = life; d[o + 10] = p1; d[o + 11] = p2;
    d[o + 12] = this.c1[0]!; d[o + 13] = this.c1[1]!; d[o + 14] = this.c1[2]!; d[o + 15] = a1;
    d[o + 16] = this.c2[0]!; d[o + 17] = this.c2[1]!; d[o + 18] = this.c2[2]!; d[o + 19] = add;
  }

  /** Fire-and-forget decal animated by its own life (foam, shock rings, cracks, glows). */
  emit(shape: number, x: number, z: number, radius: number, life: number, hex1: number, a1: number, hex2: number, add: number,
    p1 = 1, p2 = 0, delay = 0, angle = 0, halfZ = radius): void {
    const o = this.pool.allocRing();
    if (o >= 0) this.write(o, x, z, angle, radius, halfZ, shape, this.clock + delay, life, p1, p2, hex1, a1, hex2, add, Math.random());
  }

  /** Per-frame decal (telegraphs, aim, hazards). `t` is the normalized age used by life-driven shapes. */
  imm(shape: number, x: number, z: number, halfX: number, halfZ: number, angle: number, p1: number, p2: number,
    hex1: number, a1: number, hex2: number, add: number, seed = 0.5, t = 0): void {
    const o = this.pool.allocImm();
    if (o >= 0) this.write(o, x, z, angle, halfX, halfZ, shape, this.clock - t * 1000, 1000, p1, p2, hex1, a1, hex2, add, seed);
  }

  endFrame(): void { this.geometry.instanceCount = this.pool.flush(); }

  clear(): void { this.pool.clearRing(9); }

  dispose(): void { this.geometry.dispose(); this.material.dispose(); }
}
