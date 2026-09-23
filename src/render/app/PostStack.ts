/**
 * Post-processing stack (LOOK-owned). Contract: `render(scene, camera)` draws the final frame and the
 * PostServices methods trigger screen effects. Stub: plain render, effects are no-ops.
 */
import type * as THREE from 'three';
import type { FrameContext, PostServices, QualityTier } from '../frame';

export class PostStack implements PostServices {
  constructor(protected readonly renderer: THREE.WebGLRenderer) {}

  setQuality(_tier: QualityTier): void {}
  setSize(_width: number, _height: number, _dpr: number): void {}
  /** Called once per frame before render with the frame context (grading reads atmosphere/sea). */
  update(_ctx: FrameContext): void {}
  render(scene: THREE.Scene, camera: THREE.Camera): void { this.renderer.render(scene, camera); }

  impactFrame(_strength = 1): void {}
  speedLines(_strength: number, _duration: number): void {}
  flash(_color: number, _strength: number, _duration = 0.15): void {}
  chromatic(_strength: number, _duration = 0.2): void {}
  dispose(): void {}
}
