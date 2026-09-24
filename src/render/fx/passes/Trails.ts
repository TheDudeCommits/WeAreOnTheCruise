/**
 * Analytic projectile trails: one instanced ribbon per projectile, reconstructed on the GPU from the head
 * position, velocity and gravity (x(t-τ) = x - vτ - ½gτ²), so mortar arcs curve correctly with no history.
 * Additive, tapered, HDR core — the glowing shot arcs of T3. One draw call for every trail in the game.
 */
import * as THREE from 'three';
import { GLOW_PALETTE_COUNT, GLOW_PALETTE_LINEAR } from '../core/palette';
import { FOG_UNIFORMS_GLSL, OUTPUT_GLSL, type FxSharedUniforms } from '../core/glsl';
import { InstancePool } from '../core/InstancePool';

const SEGMENTS = 14;
export const TRAIL_STRIDE = 16;

const vertexShader = /* glsl */ `
attribute vec2 seg; // x: 0 head .. 1 tail, y: side -1..1
attribute vec4 tA;  // head.xyz, age
attribute vec4 tB;  // vel.xyz, gravity
attribute vec4 tC;  // duration, width, palette, headSwell
attribute vec4 tD;  // tint.rgb, intensity
uniform float uPixelWorld;
varying vec2 vSeg;
varying float vFogDepth;
varying float vPal;
varying vec3 vTint;
varying float vIntensity;
void main() {
  float T = min(tC.x, max(tA.w, 0.0));
  if (T <= 1e-4 || tD.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float tau = seg.x * T;
  vec3 v = tB.xyz;
  float g = tB.w;
  vec3 p = tA.xyz - v * tau - vec3(0.0, 0.5 * g * tau * tau, 0.0);
  vec3 tang = v + vec3(0.0, g * tau, 0.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec3 tanV = (viewMatrix * vec4(tang, 0.0)).xyz;
  vec3 side = cross(normalize(tanV + vec3(1e-6)), normalize(-mv.xyz));
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
  float taper = pow(1.0 - seg.x, 0.85);
  float swell = 1.0 + tC.w * (1.0 - smoothstep(0.0, 0.12, seg.x));
  float w = max(tC.y * taper * swell, 1.1 * uPixelWorld * max(1.0, -mv.z) * taper);
  mv.xyz += side * w * seg.y;
  gl_Position = projectionMatrix * mv;
  vSeg = seg;
  vFogDepth = -mv.z;
  vPal = tC.z;
  vTint = tD.rgb;
  vIntensity = tD.w;
}
`;

const fragmentShader = /* glsl */ `
#define GLOW_COUNT ${GLOW_PALETTE_COUNT}
uniform vec3 uGlowPal[GLOW_COUNT * 3];
${FOG_UNIFORMS_GLSL}
varying vec2 vSeg;
varying float vFogDepth;
varying float vPal;
varying vec3 vTint;
varying float vIntensity;
void main() {
  int p = int(vPal + 0.5);
  vec3 core = uGlowPal[p * 3];
  vec3 mid = uGlowPal[p * 3 + 1];
  vec3 outer = uGlowPal[p * 3 + 2];
  float a = abs(vSeg.y);
  float along = vSeg.x;
  float body = 1.0 - a;
  float coreBand = smoothstep(0.62, 0.2, a);
  float fade = pow(1.0 - along, 1.25);
  vec3 col = mix(outer * 0.9, mid * 1.5, smoothstep(0.1, 0.7, body)) * body;
  col += core * 2.6 * coreBand * (1.0 - along * 0.6);
  col *= fade * vTint * vIntensity * (1.0 - fxFog(vFogDepth));
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
}
`;

export class TrailPass {
  readonly mesh: THREE.Mesh;
  readonly pool: InstancePool;
  private readonly geometry: THREE.InstancedBufferGeometry;

  constructor(shared: FxSharedUniforms, capacity: number) {
    this.pool = new InstancePool(TRAIL_STRIDE, 0, capacity);
    const g = new THREE.InstancedBufferGeometry();
    const segs: number[] = [];
    const pos: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS;
      segs.push(s, -1, s, 1);
      pos.push(0, 0, 0, 0, 0, 0);
      if (i < SEGMENTS) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('seg', new THREE.Float32BufferAttribute(segs, 2));
    g.setIndex(index);
    this.pool.attach(g, 'tA', 4, 0);
    this.pool.attach(g, 'tB', 4, 4);
    this.pool.attach(g, 'tC', 4, 8);
    this.pool.attach(g, 'tD', 4, 12);
    g.instanceCount = 0;
    this.geometry = g;
    const material = new THREE.ShaderMaterial({
      name: 'fx-trails',
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, uGlowPal: { value: GLOW_PALETTE_LINEAR } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'fx-trails';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 18;
  }

  beginFrame(): void { this.pool.beginFrame(); }

  /** Adds one trail. `duration` seconds of flight shown behind the head (clamped to `age`). */
  add(x: number, y: number, z: number, age: number, vx: number, vy: number, vz: number, gravity: number,
    duration: number, width: number, palette: number, swell: number, r: number, g: number, b: number, intensity: number): void {
    const o = this.pool.allocImm();
    if (o < 0) return;
    const d = this.pool.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = age;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = gravity;
    d[o + 8] = duration; d[o + 9] = width; d[o + 10] = palette; d[o + 11] = swell;
    d[o + 12] = r; d[o + 13] = g; d[o + 14] = b; d[o + 15] = intensity;
  }

  endFrame(): void { this.geometry.instanceCount = this.pool.flush(); }

  dispose(): void { this.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
