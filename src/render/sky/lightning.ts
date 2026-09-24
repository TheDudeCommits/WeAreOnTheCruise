/**
 * Lightning bolt (LOOK-owned): a jagged, branching HDR ribbon from the storm deck to the sea, rebuilt per strike and
 * flickered over ~0.3 s. It blooms through the post stack; the sky system pairs it with atmosphere.flash.
 */
import * as THREE from 'three';

const VERTEX = /* glsl */ `
attribute vec3 aTangent;
attribute float aSide;
attribute float aWidth;
varying float vSide;
void main() {
	vec3 world = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	vec3 toCam = normalize( cameraPosition - world );
	vec3 side = normalize( cross( normalize( aTangent ), toCam ) );
	world += side * aSide * aWidth;
	vSide = aSide;
	gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vSide;
void main() {
	float core = 1.0 - smoothstep( 0.25, 1.0, abs( vSide ) );
	gl_FragColor = vec4( uColor * uIntensity * ( 0.6 + 2.4 * core ), 1.0 );
}
`;

const MAX_POINTS = 120;

export class LightningBolt {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly positions = new Float32Array(MAX_POINTS * 2 * 3);
  private readonly tangents = new Float32Array(MAX_POINTS * 2 * 3);
  private readonly sides = new Float32Array(MAX_POINTS * 2);
  private readonly widths = new Float32Array(MAX_POINTS * 2);
  private readonly indices = new Uint16Array((MAX_POINTS - 1) * 6);
  private age = 1;
  private life = 0.32;
  private seed = 1;

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aTangent', new THREE.BufferAttribute(this.tangents, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(this.sides, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aWidth', new THREE.BufferAttribute(this.widths, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      name: 'sky-lightning', vertexShader: VERTEX, fragmentShader: FRAGMENT,
      uniforms: { uColor: { value: new THREE.Color(0.8, 0.88, 1.0) }, uIntensity: { value: 0 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'sky-lightning';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    this.mesh.userData.inkSkip = true;
    this.mesh.userData.lookInternal = true;
    this.mesh.raycast = () => undefined;
  }

  private rnd(): number { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }

  /** Builds a new bolt from (x, top, z) down to the sea at (x2, 0, z2). */
  strike(x: number, z: number, top: number, seed: number): void {
    this.seed = (seed * 2654435761) >>> 0 || 1;
    let points = 0;
    let indexCount = 0;
    const addStrip = (sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, segments: number, width: number, jitter: number) => {
      const start = points;
      let px = sx, py = sy, pz = sz;
      for (let i = 0; i <= segments && points < MAX_POINTS; i++) {
        const t = i / segments;
        const jx = i === 0 || i === segments ? 0 : (this.rnd() - 0.5) * jitter;
        const jz = i === 0 || i === segments ? 0 : (this.rnd() - 0.5) * jitter;
        const x0 = sx + (ex - sx) * t + jx, y0 = sy + (ey - sy) * t, z0 = sz + (ez - sz) * t + jz;
        const tx = x0 - px, ty = y0 - py, tz = z0 - pz;
        const w = width * (1 - t * 0.55);
        for (let s = 0; s < 2; s++) {
          const v = points * 2 + s;
          this.positions.set([x0, y0, z0], v * 3);
          this.tangents.set(i === 0 ? [ex - sx, ey - sy, ez - sz] : [tx, ty, tz], v * 3);
          this.sides[v] = s === 0 ? -1 : 1;
          this.widths[v] = w;
        }
        if (i > 0) {
          const a = (points - 1) * 2, b = points * 2;
          this.indices.set([a, a + 1, b, a + 1, b + 1, b], indexCount);
          indexCount += 6;
        }
        px = x0; py = y0; pz = z0;
        points++;
      }
      return start;
    };
    const topX = x + (this.rnd() - 0.5) * 60, topZ = z + (this.rnd() - 0.5) * 60;
    const segments = 26;
    const mainStart = addStrip(topX, top, topZ, x, 0, z, segments, 3.2, 38);
    for (let b = 0; b < 3; b++) {
      const at = mainStart + 4 + Math.floor(this.rnd() * (segments - 10));
      const bx = this.positions[at * 6]!, by = this.positions[at * 6 + 1]!, bz = this.positions[at * 6 + 2]!;
      const len = 60 + this.rnd() * 90;
      const ang = this.rnd() * Math.PI * 2;
      addStrip(bx, by, bz, bx + Math.cos(ang) * len, by - len * (0.6 + this.rnd() * 0.5), bz + Math.sin(ang) * len, 8, 1.6, 22);
    }
    for (const name of ['position', 'aTangent', 'aSide', 'aWidth'] as const) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.index!.needsUpdate = true;
    this.geometry.setDrawRange(0, indexCount);
    this.age = 0;
    this.life = 0.34;
    this.mesh.visible = true;
  }

  /** Returns the bolt's flash contribution 0..1 this frame. */
  update(dt: number): number {
    if (this.age >= this.life) { this.mesh.visible = false; return 0; }
    this.age += dt;
    const t = this.age / this.life;
    // Stutter: bright, dip, re-strike, fade.
    const flicker = t < 0.18 ? 1 : t < 0.3 ? 0.25 : t < 0.5 ? 0.9 : Math.max(0, 1 - (t - 0.5) / 0.5);
    this.material.uniforms.uIntensity!.value = 4.5 * flicker;
    this.mesh.visible = this.age < this.life;
    return flicker;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
