import * as THREE from 'three';
import type { Vec3 } from '../../core/contracts';
import type { OceanSampler } from '../../simulation';

export interface RaceCourseViewOptions {
  waveSampler?: OceanSampler;
  ribbonWidth?: number;
  samples?: number;
  gateEvery?: number;
}

/** Closed Catmull-Rom race ribbon and checkpoint gates that follow the sampled ocean. */
export class RaceCourseView {
  readonly root = new THREE.Group();

  private readonly material = new THREE.MeshBasicMaterial({
    color: 0x49ff9a,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly gateMaterial = new THREE.MeshBasicMaterial({ color: 0x5cffaa, transparent: true, opacity: 0.84 });
  private readonly ribbon: THREE.Mesh;
  private readonly gates: THREE.Group[] = [];
  private readonly samples: number;
  private readonly ribbonWidth: number;
  private readonly gateEvery: number;
  private course: Vec3[] = [];
  private curve?: THREE.CatmullRomCurve3;
  private waveSampler?: OceanSampler;

  constructor(scene: THREE.Scene, course: readonly Vec3[] = [], options: RaceCourseViewOptions = {}) {
    this.samples = Math.max(32, options.samples ?? 180);
    this.ribbonWidth = options.ribbonWidth ?? 4.5;
    this.gateEvery = Math.max(1, options.gateEvery ?? 1);
    this.waveSampler = options.waveSampler;
    this.root.name = 'race-course';
    scene.add(this.root);
    const geometry = this.createRibbonGeometry();
    this.ribbon = new THREE.Mesh(geometry, this.material);
    this.ribbon.name = 'wave-riding-race-ribbon';
    this.ribbon.frustumCulled = false;
    this.root.add(this.ribbon);
    this.setCourse(course);
  }

  setCourse(course: readonly Vec3[]): void {
    this.course = course.map((point) => ({ ...point }));
    this.curve = this.course.length >= 3
      ? new THREE.CatmullRomCurve3(this.course.map((point) => new THREE.Vector3(point.x, point.y, point.z)), true, 'catmullrom', 0.5)
      : undefined;
    this.rebuildGates();
    this.root.visible = Boolean(this.curve);
  }

  setWaveSampler(sampler: OceanSampler | undefined): void {
    this.waveSampler = sampler;
  }

  update(time: number): void {
    if (!this.curve) return;
    const positions = this.ribbon.geometry.getAttribute('position') as THREE.BufferAttribute;
    const point = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    for (let index = 0; index <= this.samples; index += 1) {
      const t = index / this.samples;
      this.curve.getPointAt(t, point);
      this.curve.getTangentAt(t, tangent);
      const sideX = -tangent.z * this.ribbonWidth * 0.5;
      const sideZ = tangent.x * this.ribbonWidth * 0.5;
      const waterY = this.waveSampler?.sample(point.x, point.z, time).height ?? point.y;
      positions.setXYZ(index * 2, point.x + sideX, waterY + 0.2, point.z + sideZ);
      positions.setXYZ(index * 2 + 1, point.x - sideX, waterY + 0.2, point.z - sideZ);
    }
    positions.needsUpdate = true;
    this.ribbon.geometry.computeBoundingSphere();
    for (let index = 0; index < this.gates.length; index += 1) {
      const gate = this.gates[index];
      const courseIndex = index * this.gateEvery;
      const coursePoint = this.course[courseIndex];
      const next = this.course[(courseIndex + 1) % this.course.length];
      const waterY = this.waveSampler?.sample(coursePoint.x, coursePoint.z, time).height ?? coursePoint.y;
      gate.position.set(coursePoint.x, waterY + 0.35, coursePoint.z);
      gate.rotation.y = Math.atan2(-(next.x - coursePoint.x), -(next.z - coursePoint.z));
      gate.position.y += Math.sin(time * 1.4 + index * 0.8) * 0.18;
    }
  }

  setActiveCheckpoint(checkpoint: number): void {
    for (let index = 0; index < this.gates.length; index += 1) {
      const active = index === Math.floor(checkpoint / this.gateEvery) % this.gates.length;
      this.gates[index].scale.setScalar(active ? 1.15 : 1);
      this.gates[index].userData.active = active;
    }
  }

  dispose(): void {
    this.ribbon.geometry.dispose();
    this.material.dispose();
    this.gateMaterial.dispose();
    for (const gate of this.gates) {
      gate.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    }
    this.gates.length = 0;
    this.root.removeFromParent();
  }

  private createRibbonGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((this.samples + 1) * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    for (let index = 0; index < this.samples; index += 1) {
      const offset = index * 2;
      indices.push(offset, offset + 2, offset + 1, offset + 2, offset + 3, offset + 1);
    }
    geometry.setIndex(indices);
    return geometry;
  }

  private rebuildGates(): void {
    for (const gate of this.gates) {
      gate.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      gate.removeFromParent();
    }
    this.gates.length = 0;
    if (!this.curve) return;
    for (let index = 0; index < this.course.length; index += this.gateEvery) {
      const gate = new THREE.Group();
      gate.name = `checkpoint-gate:${index}`;
      const width = index === 0 ? 230 : 22;
      const height = index === 0 ? 16 : 11;
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.15, height, 7), this.gateMaterial);
      const starboard = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.15, height, 7), this.gateMaterial);
      const top = new THREE.Mesh(new THREE.BoxGeometry(width, 0.85, 0.85), this.gateMaterial);
      port.position.set(-width * 0.5, height * 0.5, 0);
      starboard.position.set(width * 0.5, height * 0.5, 0);
      top.position.set(0, height, 0);
      gate.add(port, starboard, top);
      this.root.add(gate);
      this.gates.push(gate);
    }
  }
}
