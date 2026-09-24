/**
 * Additive camera-facing segments with round caps: lightning bolts (jagged polylines built on the CPU),
 * chest light pillars, lance cores, level-up shafts, electric tethers. One draw call.
 */
import * as THREE from 'three';
import { GLOW_PALETTE_COUNT, GLOW_PALETTE_LINEAR } from '../core/palette';
import { FOG_UNIFORMS_GLSL, NOISE_GLSL, OUTPUT_GLSL, type FxSharedUniforms } from '../core/glsl';
import { InstancePool } from '../core/InstancePool';

export const BEAM_STRIDE = 16;

const vertexShader = /* glsl */ `
attribute vec2 corner; // x: 0..1 along, y: -1..1 side
attribute vec4 bA; // p1.xyz, t0
attribute vec4 bB; // p2.xyz, life
attribute vec4 bC; // width, palette, seed, style
attribute vec4 bD; // tint.rgb, intensity
uniform float uTime;
uniform float uPixelWorld;
varying vec3 vBeam; // along metres, side, length
varying float vWidth;
varying float vT;
varying float vAge;
varying float vSeed;
varying float vStyle;
varying float vPal;
varying vec3 vTint;
varying float vIntensity;
varying float vFogDepth;
void main() {
  float age = uTime - bA.w;
  float t = age / max(bB.w, 1e-4);
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 a = viewMatrix * vec4(bA.xyz, 1.0);
  vec4 b = viewMatrix * vec4(bB.xyz, 1.0);
  vec3 dir = b.xyz - a.xyz;
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec3(0.0, 1.0, 0.0);
  vec3 mid = (a.xyz + b.xyz) * 0.5;
  vec3 side = cross(dir, normalize(-mid));
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  float width = max(bC.x, 1.4 * uPixelWorld * max(1.0, -mid.z));
  float along = mix(-width, len + width, corner.x);
  vec3 p = a.xyz + dir * along + side * corner.y * width;
  gl_Position = projectionMatrix * vec4(p, 1.0);
  vBeam = vec3(along, corner.y, len);
  vWidth = width;
  vT = t;
  vAge = age;
  vSeed = bC.z;
  vStyle = bC.w;
  vPal = bC.y;
  vTint = bD.rgb;
  vIntensity = bD.w;
  vFogDepth = -p.z;
}
`;

const fragmentShader = /* glsl */ `
#define GLOW_COUNT ${GLOW_PALETTE_COUNT}
uniform vec3 uGlowPal[GLOW_COUNT * 3];
${FOG_UNIFORMS_GLSL}
${NOISE_GLSL}
varying vec3 vBeam;
varying float vWidth;
varying float vT;
varying float vAge;
varying float vSeed;
varying float vStyle;
varying float vPal;
varying vec3 vTint;
varying float vIntensity;
varying float vFogDepth;
void main() {
  int p = int(vPal + 0.5);
  vec3 core = uGlowPal[p * 3];
  vec3 mid = uGlowPal[p * 3 + 1];
  vec3 outer = uGlowPal[p * 3 + 2];
  float beyond = max(max(-vBeam.x, vBeam.x - vBeam.z), 0.0) / max(vWidth, 1e-4);
  float d = length(vec2(beyond, vBeam.y));
  if (d >= 1.0) discard;
  int style = int(vStyle + 0.5);
  vec3 col;
  if (style == 0) {
    // lightning / energy: hard white core, electric fringe, stepped flicker
    float flick = 0.55 + 0.45 * step(0.3, fxHash11(floor(vAge * 24.0) + vSeed * 91.0));
    float coreB = 1.0 - smoothstep(0.18, 0.34, d);
    float glow = pow(1.0 - d, 2.0);
    col = (core * 3.6 * coreB + mix(outer, mid, glow) * glow * 1.4) * flick * (1.0 - smoothstep(0.55, 1.0, vT));
  } else if (style == 1) {
    // soft light shaft (fades toward p2)
    float h = clamp(vBeam.x / max(vBeam.z, 1e-3), 0.0, 1.0);
    float glow = pow(1.0 - d, 1.6);
    float pulse = 0.85 + 0.15 * sin(vAge * 5.0 + vSeed * 10.0);
    col = (mid * glow + core * pow(1.0 - d, 6.0)) * pow(1.0 - h, 0.8) * pulse * smoothstep(0.0, 0.1, vT) * (1.0 - smoothstep(0.7, 1.0, vT)) * 1.3;
  } else {
    // lance: steady hot core with a crisp band
    float coreB = 1.0 - smoothstep(0.3, 0.42, d);
    float band = 1.0 - smoothstep(0.62, 0.7, d);
    col = core * 3.2 * coreB + mid * 1.6 * band * (1.0 - coreB) + outer * pow(1.0 - d, 2.0) * 0.8;
    col *= 1.0 - smoothstep(0.6, 1.0, vT);
  }
  col *= vTint * vIntensity * (1.0 - fxFog(vFogDepth));
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
}
`;

export class BeamPass {
  readonly mesh: THREE.Mesh;
  readonly pool: InstancePool;
  private readonly geometry: THREE.InstancedBufferGeometry;
  clock = 0;

  constructor(shared: FxSharedUniforms, ringCap: number, immCap: number) {
    this.pool = new InstancePool(BEAM_STRIDE, ringCap, immCap);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0], 3));
    g.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pool.attach(g, 'bA', 4, 0);
    this.pool.attach(g, 'bB', 4, 4);
    this.pool.attach(g, 'bC', 4, 8);
    this.pool.attach(g, 'bD', 4, 12);
    g.instanceCount = 0;
    this.geometry = g;
    const material = new THREE.ShaderMaterial({
      name: 'fx-beams',
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, uGlowPal: { value: GLOW_PALETTE_LINEAR } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'fx-beams';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 21;
  }

  beginFrame(clock: number): void { this.clock = clock; this.pool.beginFrame(); }

  private write(o: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, t0: number, life: number,
    width: number, pal: number, seed: number, style: number, r: number, g: number, b: number, intensity: number): void {
    const d = this.pool.data;
    d[o] = x1; d[o + 1] = y1; d[o + 2] = z1; d[o + 3] = t0;
    d[o + 4] = x2; d[o + 5] = y2; d[o + 6] = z2; d[o + 7] = life;
    d[o + 8] = width; d[o + 9] = pal; d[o + 10] = seed; d[o + 11] = style;
    d[o + 12] = r; d[o + 13] = g; d[o + 14] = b; d[o + 15] = intensity;
  }

  /** Fire-and-forget segment. */
  emit(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, life: number, width: number, pal: number,
    style: number, intensity = 1, delay = 0, seed = Math.random()): void {
    const o = this.pool.allocRing();
    if (o >= 0) this.write(o, x1, y1, z1, x2, y2, z2, this.clock + delay, life, width, pal, seed, style, 1, 1, 1, intensity);
  }

  /** Per-frame segment of a given age within `life`. */
  imm(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, age: number, life: number, width: number,
    pal: number, style: number, intensity = 1, seed = 0.5): void {
    const o = this.pool.allocImm();
    if (o >= 0) this.write(o, x1, y1, z1, x2, y2, z2, this.clock - age, life, width, pal, seed, style, 1, 1, 1, intensity);
  }

  endFrame(): void { this.geometry.instanceCount = this.pool.flush(); }

  clear(): void { this.pool.clearRing(7); }

  dispose(): void { this.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
