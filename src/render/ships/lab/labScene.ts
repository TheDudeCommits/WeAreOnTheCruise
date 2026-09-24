/**
 * Shared scaffolding for the ships lab (SHIPS-owned): renderer, lights, a toon water plane, an OceanServices stand-in
 * driven by the shared Gerstner waves, orbit controls and a gameplay-style chase camera.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sampleGerstnerWaves, DEFAULT_GERSTNER_WAVES } from '../../../core/waves';
import type { OceanServices } from '../../frame';
import { createToonMaterial } from '../../materials/toon';

export class LabOcean implements OceanServices {
  time = 0;
  strength = 0.35;
  heightAt(x: number, z: number): number { return sampleGerstnerWaves(x, z, this.time, DEFAULT_GERSTNER_WAVES, this.strength).height; }
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const n = sampleGerstnerWaves(x, z, this.time, DEFAULT_GERSTNER_WAVES, this.strength).normal;
    return out.set(n.x, n.y, n.z);
  }
  stampWake(): void {}
  stampRing(): void {}
  stampFoam(): void {}
  stampDisplace(): void {}
}

export class LabScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly ocean = new LabOcean();
  readonly sun = new THREE.DirectionalLight(0xfff0d6, 2.3);
  readonly hemi = new THREE.HemisphereLight(0xdff2ff, 0x2a4f6a, 1.15);
  readonly water: THREE.Mesh;
  night = 0;
  /** When set, the camera follows this point like the game's tactical camera. */
  chase: { target: THREE.Object3D; distance: number; pitch: number; yaw: number } | null = null;

  constructor(root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    this.renderer.setSize(root.clientWidth || innerWidth, root.clientHeight || innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    root.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, (root.clientWidth || innerWidth) / (root.clientHeight || innerHeight), 0.5, 6000);
    this.camera.position.set(0, 120, 220);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.background = new THREE.Color(0x8fcbe8);
    this.scene.fog = new THREE.Fog(0x9fd3ea, 700, 3200);
    this.sun.position.set(160, 260, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -260; cam.right = cam.top = 260; cam.near = 1; cam.far = 900;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000, 1, 1).rotateX(-Math.PI / 2), createToonMaterial({ color: 0x1f78c0, name: 'lab-water' }));
    this.water.receiveShadow = true;
    this.water.position.y = -0.2;
    this.scene.add(this.water);
    addEventListener('resize', () => {
      const w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
  }

  setNight(v: number): void {
    this.night = v;
    const day = new THREE.Color(0x8fcbe8), night = new THREE.Color(0x0b1a33);
    (this.scene.background as THREE.Color).copy(day).lerp(night, v);
    (this.scene.fog as THREE.Fog).color.copy(day).lerp(night, v);
    this.sun.intensity = THREE.MathUtils.lerp(2.3, 0.3, v);
    this.sun.color.set(0xfff0d6).lerp(new THREE.Color(0x9fb8ff), v);
    this.hemi.intensity = THREE.MathUtils.lerp(1.15, 0.35, v);
    ((this.water.material as THREE.MeshToonMaterial).color).set(0x1f78c0).lerp(new THREE.Color(0x0a2748), v);
  }

  /** Places the camera like the game's tactical chase camera (distance, pitch, yaw relative to the heading). */
  chaseCamera(target: THREE.Object3D, distance = 150, pitch = 0.62, yaw = 0): void {
    this.chase = { target, distance, pitch, yaw };
  }

  frame(dt: number): void {
    this.ocean.time += dt;
    if (this.chase) {
      const t = this.chase.target;
      const heading = t.rotation.y;
      const orbit = heading + this.chase.yaw;
      const tp = t.getWorldPosition(new THREE.Vector3());
      tp.y = 0;
      this.camera.position.set(
        tp.x + Math.sin(orbit) * Math.cos(this.chase.pitch) * this.chase.distance,
        tp.y + Math.sin(this.chase.pitch) * this.chase.distance,
        tp.z + Math.cos(orbit) * Math.cos(this.chase.pitch) * this.chase.distance,
      );
      this.camera.lookAt(tp);
      this.controls.target.copy(tp);
    } else this.controls.update();
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
  }
}
