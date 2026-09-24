/**
 * Curling wave walls for wave-front hazards (Tidal Colossus, rogue fronts). A procedural curl profile swept
 * across the front, cel-shaded water with a foam lip and ink edge. Instanced, one draw call.
 */
import * as THREE from 'three';
import { FOG_UNIFORMS_GLSL, NOISE_GLSL, OUTPUT_GLSL, type FxSharedUniforms } from '../core/glsl';
import { InstancePool } from '../core/InstancePool';

const ACROSS = 40;
const PROFILE: readonly [number, number][] = [
  // [forward, up] at unit height; back slope → crest → curling lip
  [-2.4, -0.15], [-1.5, 0.22], [-0.8, 0.62], [-0.25, 0.92], [0.2, 1.02], [0.55, 0.98], [0.82, 0.84], [0.92, 0.66], [0.8, 0.5],
];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function buildGeometry(): THREE.InstancedBufferGeometry {
  const prof: [number, number][] = [];
  const steps = 6;
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const p0 = PROFILE[Math.max(0, i - 1)]!, p1 = PROFILE[i]!, p2 = PROFILE[i + 1]!, p3 = PROFILE[Math.min(PROFILE.length - 1, i + 2)]!;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      prof.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  prof.push(PROFILE[PROFILE.length - 1]!);
  const pos: number[] = [];
  const wave: number[] = [];
  const nrm: number[] = [];
  const index: number[] = [];
  const rows = prof.length;
  for (let a = 0; a <= ACROSS; a++) {
    const u = (a / ACROSS) * 2 - 1;
    for (let r = 0; r < rows; r++) {
      const [f, h] = prof[r]!;
      const prev = prof[Math.max(0, r - 1)]!, next = prof[Math.min(rows - 1, r + 1)]!;
      const tf = next[0] - prev[0], th = next[1] - prev[1];
      const tl = Math.hypot(tf, th) || 1;
      pos.push(0, 0, 0);
      wave.push(u, f, h, r / (rows - 1));
      nrm.push(0, -tf / tl, th / tl); // profile normal in (up, forward) — rotated in the shader
      if (a < ACROSS && r < rows - 1) {
        const i0 = a * rows + r, i1 = (a + 1) * rows + r;
        index.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('wave', new THREE.Float32BufferAttribute(wave, 4));
  g.setAttribute('pnormal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(index);
  return g;
}

const vertexShader = /* glsl */ `
attribute vec4 wave;   // u across -1..1, forward, up, v 0..1 along the profile
attribute vec3 pnormal;
attribute vec4 wA;     // x, z, angle, halfWidth
attribute vec4 wB;     // height, rise 0..1, seed, depthScale
uniform float uTime;
${NOISE_GLSL}
varying float vV;
varying float vU;
varying float vFacing;
varying float vFogDepth;
varying float vSeed;
varying float vRise;
void main() {
  float u = wave.x;
  float taper = 1.0 - pow(abs(u), 5.0);
  float H = wB.x * wB.y * (0.75 + 0.25 * taper) * taper;
  float wob = (fxNoise(vec2(u * 6.0 + wB.z * 10.0, uTime * 0.8)) - 0.5) * 0.12;
  float f = wave.y * H * wB.w + wob * H;
  float h = wave.z * H;
  vec2 local = vec2(u * wA.w, f);
  float ca = cos(wA.z); float sa = sin(wA.z);
  vec3 world = vec3(wA.x + local.x * ca + local.y * sa, h, wA.y - local.x * sa + local.y * ca);
  vec3 n = normalize(vec3(pnormal.z * sa, pnormal.y, pnormal.z * ca));
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vec3 nv = normalize((viewMatrix * vec4(n, 0.0)).xyz);
  vFacing = abs(dot(nv, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
  vV = wave.w;
  vU = u;
  vFogDepth = -mv.z;
  vSeed = wB.z;
  vRise = wB.y;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uLitTint;
${FOG_UNIFORMS_GLSL}
${NOISE_GLSL}
varying float vV;
varying float vU;
varying float vFacing;
varying float vFogDepth;
varying float vSeed;
varying float vRise;
void main() {
  float streak = fxNoise(vec2(vU * 26.0 + vSeed * 7.0, vV * 3.0 + uTime * 1.6));
  float foamLine = 0.72 - (streak - 0.5) * 0.18;
  vec3 deep = vec3(0.012, 0.18, 0.33);
  vec3 body = vec3(0.03, 0.46, 0.62);
  vec3 lite = vec3(0.35, 0.86, 0.92);
  vec3 foam = vec3(1.0);
  vec3 col = vV < 0.3 ? deep : vV < 0.55 ? body : lite;
  float streaks = step(0.62, streak) * step(vV, foamLine);
  col = mix(col, lite, streaks * 0.8);
  float isFoam = step(foamLine, vV);
  col = mix(col, foam, isFoam);
  float ink = 1.0 - smoothstep(0.12, 0.2, vFacing);
  col = mix(col, vec3(0.02, 0.1, 0.24), ink * (1.0 - isFoam * 0.6));
  float endErode = smoothstep(0.82, 1.0, abs(vU)) * 1.2 + (1.0 - vRise) * 0.8;
  if (fxNoise(vec2(vU * 18.0, vV * 9.0 + uTime)) < endErode - 0.2) discard;
  col *= uLitTint;
  col = mix(col, uFogColor, fxFog(vFogDepth));
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
}
`;

export class WaveWallPass {
  readonly mesh: THREE.Mesh;
  private readonly pool: InstancePool;
  private readonly geometry: THREE.InstancedBufferGeometry;

  constructor(shared: FxSharedUniforms, capacity: number) {
    this.pool = new InstancePool(8, 0, capacity);
    const g = buildGeometry();
    this.pool.attach(g, 'wA', 4, 0);
    this.pool.attach(g, 'wB', 4, 4);
    g.instanceCount = 0;
    this.geometry = g;
    const material = new THREE.ShaderMaterial({
      name: 'fx-wave-walls', vertexShader, fragmentShader, uniforms: { ...shared }, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'fx-wave-walls';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  beginFrame(): void { this.pool.beginFrame(); }

  /** angle: travel direction as (sin a, cos a). */
  add(x: number, z: number, angle: number, halfWidth: number, height: number, rise: number, seed: number, depth = 1): void {
    const o = this.pool.allocImm();
    if (o < 0) return;
    const d = this.pool.data;
    d[o] = x; d[o + 1] = z; d[o + 2] = angle; d[o + 3] = halfWidth;
    d[o + 4] = height; d[o + 5] = rise; d[o + 6] = seed; d[o + 7] = depth;
  }

  endFrame(): void { this.geometry.instanceCount = this.pool.flush(); }

  dispose(): void { this.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
