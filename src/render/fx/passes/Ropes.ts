/**
 * Opaque inked lines with sag: harpoon ropes, tow lines, chains. Immediate only (rebuilt every frame from
 * RunState). One draw call.
 */
import * as THREE from 'three';
import { FOG_UNIFORMS_GLSL, OUTPUT_GLSL, type FxSharedUniforms } from '../core/glsl';
import { InstancePool } from '../core/InstancePool';

const SEGMENTS = 18;

const vertexShader = /* glsl */ `
attribute vec2 seg;
attribute vec4 rA; // p1.xyz, sag
attribute vec4 rB; // p2.xyz, width
attribute vec4 rC; // color.rgb, style
uniform float uPixelWorld;
varying vec2 vSeg;
varying float vLen;
varying vec3 vColor;
varying float vStyle;
varying float vFogDepth;
void main() {
  float s = seg.x;
  vec3 p1 = rA.xyz; vec3 p2 = rB.xyz;
  vec3 p = mix(p1, p2, s) - vec3(0.0, rA.w * 4.0 * s * (1.0 - s), 0.0);
  vec3 tang = (p2 - p1) + vec3(0.0, -rA.w * 4.0 * (1.0 - 2.0 * s), 0.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec3 tv = (viewMatrix * vec4(tang, 0.0)).xyz;
  vec3 side = cross(normalize(tv + vec3(1e-6)), normalize(-mv.xyz));
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
  float w = max(rB.w, 1.6 * uPixelWorld * max(1.0, -mv.z));
  mv.xyz += side * seg.y * w;
  gl_Position = projectionMatrix * mv;
  vSeg = seg;
  vLen = length(p2 - p1);
  vColor = rC.rgb;
  vStyle = rC.w;
  vFogDepth = -mv.z;
}
`;

const fragmentShader = /* glsl */ `
${FOG_UNIFORMS_GLSL}
varying vec2 vSeg;
varying float vLen;
varying vec3 vColor;
varying float vStyle;
varying float vFogDepth;
const vec3 INK = vec3(0.0116, 0.0168, 0.0513);
void main() {
  float a = abs(vSeg.y);
  float along = vSeg.x * vLen;
  vec3 col;
  if (vStyle < 0.5) {
    float twist = step(0.5, fract(along / 0.7 + vSeg.y * 0.35));
    col = vColor * mix(0.75, 1.1, twist);
  } else {
    float link = step(0.5, fract(along / 0.9));
    col = vColor * mix(0.55, 1.15, link);
  }
  col = mix(col, INK, step(0.62, a));
  col = mix(col, uFogColor, fxFog(vFogDepth));
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
}
`;

export class RopePass {
  readonly mesh: THREE.Mesh;
  readonly pool: InstancePool;
  private readonly geometry: THREE.InstancedBufferGeometry;

  constructor(shared: FxSharedUniforms, capacity: number) {
    this.pool = new InstancePool(12, 0, capacity);
    const g = new THREE.InstancedBufferGeometry();
    const segs: number[] = []; const pos: number[] = []; const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS;
      segs.push(s, -1, s, 1); pos.push(0, 0, 0, 0, 0, 0);
      if (i < SEGMENTS) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('seg', new THREE.Float32BufferAttribute(segs, 2));
    g.setIndex(index);
    this.pool.attach(g, 'rA', 4, 0);
    this.pool.attach(g, 'rB', 4, 4);
    this.pool.attach(g, 'rC', 4, 8);
    g.instanceCount = 0;
    this.geometry = g;
    const material = new THREE.ShaderMaterial({
      name: 'fx-ropes', vertexShader, fragmentShader, uniforms: { ...shared }, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'fx-ropes';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 1;
  }

  beginFrame(): void { this.pool.beginFrame(); }

  add(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, sag: number, width: number,
    r: number, g: number, b: number, style = 0): void {
    const o = this.pool.allocImm();
    if (o < 0) return;
    const d = this.pool.data;
    d[o] = x1; d[o + 1] = y1; d[o + 2] = z1; d[o + 3] = sag;
    d[o + 4] = x2; d[o + 5] = y2; d[o + 6] = z2; d[o + 7] = width;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = style;
  }

  endFrame(): void { this.geometry.instanceCount = this.pool.flush(); }

  dispose(): void { this.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
