/**
 * Horizon silhouettes (WORLD-owned): distant island and mountain profiles on a ring 2.2 km out that follows the
 * focus (no parallax, like the sky), tinted each frame from the atmosphere so they read as aerial-perspective
 * depth at any time of day. One mesh, one draw call, unlit.
 */
import * as THREE from 'three';
import { createSeededRandom } from '../../core/rng';
import { CircleNoise, TAU } from '../../world/noise';
import type { AtmosphereState } from '../frame';

const RADIUS = 2200;

export class HorizonRing {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly tmp = new THREE.Color();

  constructor(seed = 0x5eed) {
    const rng = createSeededRandom(seed);
    const noise = new CircleNoise(rng, 3, 40, 0.9);
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    // A dozen separate landmasses; farther ones lower and paler.
    const count = 12;
    for (let k = 0; k < count; k++) {
      const centre = (k / count) * TAU + rng.range(-0.15, 0.15);
      const span = rng.range(0.06, 0.2);
      const peak = rng.range(28, 110);
      const depth = rng.range(0, 1);
      const r = RADIUS + depth * 250;
      const steps = Math.max(8, Math.round(span * 180));
      const base = pos.length / 3;
      for (let i = 0; i <= steps; i++) {
        const t = centre - span / 2 + (span * i) / steps;
        const u = i / steps;
        const shape = Math.pow(Math.sin(Math.PI * u), 0.7);
        const h = peak * shape * (0.75 + 0.25 * noise.at(t * 3)) * (1 - depth * 0.35);
        const x = Math.sin(t) * r, z = Math.cos(t) * r;
        pos.push(x, -8, z, x, Math.max(2, h), z);
        const shade = 0.82 + depth * 0.18;
        col.push(shade, shade, shade, shade, shade, shade);
        if (i > 0) {
          const a = base + (i - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: false, name: 'world-horizon' });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'world-horizon';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -50;
  }

  update(x: number, z: number, a: AtmosphereState, visible: boolean): void {
    this.mesh.visible = visible;
    if (!visible) return;
    this.mesh.position.set(x, 0, z);
    // A hazy step darker/bluer than the horizon: land far away in the aerial perspective.
    this.tmp.copy(a.fogColor).lerp(a.skyColor, 0.18).multiplyScalar(0.84 - a.night * 0.2);
    this.material.color.copy(this.tmp);
  }

  dispose(): void { this.mesh.geometry.dispose(); this.material.dispose(); }
}
