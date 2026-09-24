/**
 * Instanced stamp batch (OCEAN-owned). Each instance is an oriented quad drawn into an interaction render target
 * with MAX blending, so overlapping stamps never sum up and the result is frame-rate independent.
 *
 * Shapes are analytic (evaluated per texel in the fragment shader) and output four profiles:
 *   raise (m), lower (m), foam (0..1), aeration (0..1)
 * The transient target stores them as RGBA directly. The persistent target stores (foam, aeration, fresh foam) in
 * RGB. Per-instance channel weights scale the four profiles.
 *
 * Coverage-aware foam: the foam profile is scaled by the neighbourhood's existing persistent foam (last frame's
 * coverage target, mip 2): persistent deposits by (1 − c) with a shaped cutoff, transient stamps (except the hull
 * contact, which must always read) more gently. A pile-up therefore stops growing instead of carpeting the sea.
 */
import * as THREE from 'three';

export const SHAPE_BLOB = 0;
export const SHAPE_RING = 1;
export const SHAPE_HULL = 2;
export const SHAPE_CAPSULE = 3;
export const SHAPE_WHIRL = 4;
export const SHAPE_FRONT = 5;
export const SHAPE_WAKE = 6;

const FLOATS_PER_STAMP = 16;

const STAMP_VERT = /* glsl */ `
attribute vec4 iA; // centre.xz (metres, relative to the target origin), axis.xz (unit, local +U)
attribute vec4 iB; // half size U, half size V, shape id, p0
attribute vec4 iC; // p1, p2, p3, p4
attribute vec4 iD; // channel weights (raise, lower, foam, aeration)
uniform float uInvSize;
uniform vec2 uNoiseOrigin;
uniform vec2 uCovShift;
varying vec2 vLocal;
varying vec2 vHalf;
varying float vShape;
varying vec4 vP;
varying float vP4;
varying vec4 vChan;
varying vec2 vNoise;
varying vec2 vCovUv;
void main() {
  vec2 axis = iA.zw;
  vec2 perp = vec2(-axis.y, axis.x);
  vLocal = position.xy * iB.xy;
  vec2 rel = iA.xy + axis * vLocal.x + perp * vLocal.y;
  vHalf = iB.xy;
  vShape = iB.z;
  vP = vec4(iB.w, iC.xyz);
  vP4 = iC.w;
  vChan = iD;
  vNoise = rel + uNoiseOrigin;
  vCovUv = rel * uInvSize + uCovShift;
  gl_Position = vec4(rel * uInvSize * 2.0 - 1.0, 0.0, 1.0);
}
`;

const STAMP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vLocal;
varying vec2 vHalf;
varying float vShape;
varying vec4 vP;
varying float vP4;
varying vec4 vChan;
varying vec2 vNoise;
varying vec2 vCovUv;
uniform float uHullHole;
uniform sampler2D uCoverage;
uniform vec4 uCovGain;           // persistent lo, hi; transient lo, hi (on persistent neighbourhood coverage)

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float rag(float amount) {
  if (amount <= 0.0) return 0.0;
  float n = vnoise(vNoise * 0.21) * 0.65 + vnoise(vNoise * 0.53) * 0.35;
  return (n - 0.5) * amount;
}

// Waterline half-width profile along the hull, t = -1 (stern) .. 1 (bow): fine entry, full midships, round stern.
float hullHalfWidth(float t) {
  float bow = clamp((t - 0.12) / 0.88, 0.0, 1.0);
  float wBow = pow(max(1.0 - pow(bow, 1.8), 0.0), 0.6);
  float stern = clamp((-t - 0.5) / 0.5, 0.0, 1.0);
  float wStern = 1.0 - 0.32 * stern * stern;
  return min(wBow, wStern);
}
float hullSd(vec2 p, float halfL, float halfB) {
  float t = clamp(p.x / halfL, -1.0, 1.0);
  float w = halfB * hullHalfWidth(t);
  float dSide = abs(p.y) - w;
  float dEnd = abs(p.x) - halfL;
  vec2 q = vec2(max(dEnd, 0.0), max(dSide, 0.0));
  return length(q) + min(max(dEnd, dSide), 0.0);
}

void main() {
  int shape = int(vShape + 0.5);
  vec4 prof = vec4(0.0); // raise, lower, foam, aeration
  if (shape == 0) {
    // BLOB: p0 = edge exponent, p1 = ragged amount, p2 = flat-top fraction.
    float e = length(vLocal / vHalf) + rag(vP.y);
    float w = 1.0 - smoothstep(vP.z, 1.0, e);
    w = pow(max(w, 0.0), max(vP.x, 0.05));
    prof = vec4(w);
  } else if (shape == 1) {
    // RING: p0 = radius, p1 = crest half-width. Ricker profile: crest up, troughs either side.
    float r = length(vLocal);
    float x = (r - vP.x) / max(vP.y, 0.2);
    float x2 = x * x;
    float ricker = (1.0 - 2.0 * x2) * exp(-x2);
    float crest = exp(-x2 * 1.6);
    float edge = 1.0 - smoothstep(0.85, 1.0, r / max(vHalf.x, 0.001));
    prof = vec4(max(ricker, 0.0), max(-ricker, 0.0) * 1.6, crest, crest) * edge;
  } else if (shape == 2) {
    // HULL contact: p0 = half length, p1 = half beam, p2 = speed factor, p3 = contact 0..1, p4 = bow wave height (m).
    float halfL = vP.x;
    float halfB = vP.y;
    float s = vP.z;
    float contact = vP.w;
    float bowH = vP4;
    float sd = hullSd(vLocal, halfL, halfB);
    float t = vLocal.x / halfL;
    float bowness = smoothstep(-0.15, 0.85, t);
    float moving = clamp(s * 2.5, 0.0, 1.0);
    // Contact foam hugging the waterline: from under the hull out to bw, heavier and wider at the bow.
    float bw = (mix(0.7, 2.6, bowness * bowness) * (0.6 + 0.5 * s) + halfB * 0.035) * (1.0 + rag(0.4));
    float band = (1.0 - smoothstep(0.0, bw, sd)) * smoothstep(-3.0, -0.6, sd);
    // Sides stay lacy (partial coverage), the bow is solid white.
    float contactFoam = band * mix(0.42, 1.0, bowness) * mix(0.55, 1.0, moving);
    // Bow wave: a ridge pushed ahead of the stem and along the shoulders.
    float ridgeOff = 0.2 + 1.2 * s + halfB * 0.05;
    float ridgeW = 1.2 + 2.0 * s + halfB * 0.08;
    float rd = (sd - ridgeOff) / ridgeW;
    // Pile-up is highest at the stem and runs back along the shoulders.
    float bowRidge = exp(-rd * rd) * pow(bowness, 1.25);
    float raise = bowH * bowRidge;
    // White water on the crest and the side piled against the hull; the outer face of the wave stays a smooth
    // turquoise (aeration) face, so the bow wave reads as a raised wave instead of a flat white slab.
    float outerFace = smoothstep(0.05, 0.7, rd);
    float bowFoam = smoothstep(0.3, 0.75, bowRidge) * (1.0 - outerFace * 0.85) * smoothstep(0.1, 0.5, s);
    // Trough along the sides and the hollow under the counter; the inside of the hull is pushed down so
    // wave crests never poke through the deck.
    float tr = (sd - (1.0 + 1.6 * s)) / (1.4 + 2.2 * s);
    float trough = exp(-tr * tr) * (1.0 - 0.75 * bowness) * (0.12 + 0.45 * s) * (0.6 + bowH * 0.35);
    float hole = smoothstep(-0.4, -3.0, sd) * uHullHole;
    // Stern turbulence (white water behind the transom).
    float sx = (vLocal.x + halfL * 0.92) / (halfB * 0.55 + 2.5 * s + 1.0);
    float sy = vLocal.y / (halfB * 0.8);
    float sternBlob = exp(-sx * sx - sy * sy) * step(vLocal.x, -halfL * 0.4) * moving;
    float sternFoam = sternBlob * (0.42 + 0.25 * s);
    float aer = max(max(bowRidge * moving, band * 0.55), sternBlob);
    prof = vec4(raise, trough + hole, max(max(contactFoam, bowFoam), sternFoam), aer) * contact;
  } else if (shape == 3) {
    // CAPSULE along local U: p0 = half segment length, p1 = ragged amount, p2 = flat-top fraction.
    vec2 q = vLocal;
    q.x = max(abs(q.x) - vP.x, 0.0);
    float e = length(q) / max(vHalf.y, 0.01) + rag(vP.y);
    float w = 1.0 - smoothstep(vP.z, 1.0, e);
    prof = vec4(w);
  } else if (shape == 4) {
    // WHIRL: p0 = spin angle, p1 = arm count, p2 = bowl depth (m), p3 = twist.
    float r = length(vLocal);
    float rn = r / max(vHalf.x, 0.01);
    float theta = atan(vLocal.y, vLocal.x);
    float env = (1.0 - smoothstep(0.55, 1.0, rn)) * smoothstep(0.02, 0.14, rn);
    float spiral = 0.5 + 0.5 * cos(vP.y * theta + vP.w * log(1.0 + rn * 6.0) * 3.0 - vP.x);
    float arms = smoothstep(0.4, 0.75, spiral + rag(0.3)) * env * 1.15;
    float bowl = pow(max(1.0 - rn * rn, 0.0), 2.0);
    float rim = exp(-pow((rn - 0.82) / 0.12, 2.0));
    prof = vec4(rim * vP.z * 0.15, bowl * vP.z, arms, env * 0.9);
  } else if (shape == 5) {
    // FRONT (moving wall of water): travels along +U. p0 = ridge half-width, p1 = height (m).
    float across = abs(vLocal.y) / max(vHalf.y, 0.01);
    float endFade = 1.0 - smoothstep(0.72, 1.0, across);
    float w = max(vP.x, 0.5);
    float along = vLocal.x;
    float ridge = exp(-pow(along / w, 2.0)) * endFade;
    float crest = exp(-pow((along - w * 0.3) / (w * 0.42), 2.0)) * endFade * (0.8 + rag(0.5));
    float trough = exp(-pow((along + w * 1.9) / (w * 0.9), 2.0)) * endFade * 0.35;
    prof = vec4(ridge * vP.y, trough * vP.y, clamp(crest, 0.0, 1.0), ridge);
  } else if (shape == 6) {
    // WAKE segment along local U (service stampWake): two crisp edge streaks plus lacy turquoise churn between
    // them, never a solid slab, whatever the caller's width. p0 = half segment length, p1 = half width,
    // p2 = streak half-width (m).
    vec2 q = vLocal;
    q.x = max(abs(q.x) - vP.x, 0.0);
    float hw = max(vP.y, 0.5);
    float lateral = length(q);
    float edgeD = abs(lateral - hw) / max(vP.z, 0.3);
    float streak = exp(-edgeD * edgeD) * (0.85 + rag(0.5));
    float inside = 1.0 - smoothstep(hw * 0.75, hw, lateral);
    float churn = inside * (0.28 + rag(0.35));
    prof = vec4(0.0, 0.0, clamp(max(streak, churn), 0.0, 1.0), max(inside, streak));
  }
  prof = max(prof, vec4(0.0)) * vChan;
  // Neighbourhood persistent foam (~25-50 m): crowded water takes less new foam.
  float cov = textureLod(uCoverage, vCovUv, 2.0).g;
#ifdef PERSISTENT
  prof.z *= (1.0 - cov) * (1.0 - smoothstep(uCovGain.x, uCovGain.y, cov));
  gl_FragColor = vec4(prof.z, prof.w, prof.z, 0.0);
#else
  if (shape != 2) prof.z *= 1.0 - 0.6 * smoothstep(uCovGain.z, uCovGain.w, cov);
  gl_FragColor = prof;
#endif
}
`;

export class StampBatch {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly capacity: number;
  count = 0;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly data: Float32Array;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  /** Reused every frame (addUpdateRange would allocate a new range object per call). */
  private readonly range = { start: 0, count: 0 };

  constructor(capacity: number, persistent: boolean) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * FLOATS_PER_STAMP);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, FLOATS_PER_STAMP, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.setAttribute('iA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    this.geometry.setAttribute('iB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    this.geometry.setAttribute('iC', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    this.geometry.setAttribute('iD', new THREE.InterleavedBufferAttribute(this.buffer, 4, 12));
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      name: persistent ? 'OceanStampPersistent' : 'OceanStampTransient',
      vertexShader: STAMP_VERT,
      fragmentShader: STAMP_FRAG,
      defines: persistent ? { PERSISTENT: '' } : {},
      uniforms: {
        uInvSize: { value: 1 / 768 },
        uNoiseOrigin: { value: new THREE.Vector2() },
        uHullHole: { value: 1.5 },
        uCoverage: { value: null },
        uCovShift: { value: new THREE.Vector2(4, 4) },
        uCovGain: { value: new THREE.Vector4(0.14, 0.42, 0.18, 0.5) },
      },
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendEquationAlpha: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  reset(): void { this.count = 0; }

  get full(): boolean { return this.count >= this.capacity; }

  /**
   * Appends one stamp. (cx, cz) are metres relative to the target origin; (ax, az) the unit local +U axis.
   * Returns false when the batch is full.
   */
  push(
    cx: number, cz: number, ax: number, az: number, halfU: number, halfV: number, shape: number,
    p0: number, p1: number, p2: number, p3: number, p4: number,
    raise: number, lower: number, foam: number, aeration: number,
  ): boolean {
    if (this.count >= this.capacity) return false;
    const d = this.data;
    const o = this.count * FLOATS_PER_STAMP;
    d[o] = cx; d[o + 1] = cz; d[o + 2] = ax; d[o + 3] = az;
    d[o + 4] = halfU; d[o + 5] = halfV; d[o + 6] = shape; d[o + 7] = p0;
    d[o + 8] = p1; d[o + 9] = p2; d[o + 10] = p3; d[o + 11] = p4;
    d[o + 12] = raise; d[o + 13] = lower; d[o + 14] = foam; d[o + 15] = aeration;
    this.count++;
    return true;
  }

  /** Uploads only the used part of the instance buffer. */
  commit(): void {
    this.geometry.instanceCount = this.count;
    if (this.count === 0) return;
    this.range.count = this.count * FLOATS_PER_STAMP;
    this.buffer.updateRanges.length = 0;
    this.buffer.updateRanges.push(this.range);
    this.buffer.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
