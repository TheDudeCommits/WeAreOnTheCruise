/**
 * Render contract (lead-owned). Every render module is a RenderSystem updated once per frame with a FrameContext.
 * Cross-module calls go through RenderServices so modules never import each other's internals.
 *
 * Update order (GameApp): sky → ocean → world → ships → fx → camera → post.render().
 */
import type * as THREE from 'three';
import type { RunState, SeaState, Settings, SimEvent, WorldQuery } from '../game/types';

export type AppScreen = 'boot' | 'title' | 'harbor' | 'run' | 'results';
export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

/** Written by the sky system each frame before other systems update; read by ocean, world, ships, fx. */
export interface AtmosphereState {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  ambientColor: THREE.Color;
  skyColor: THREE.Color;
  horizonColor: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  /** 0 = day, 1 = full night. */
  night: number;
  /** 0..1 storm darkness. */
  storm: number;
  /** Lightning flash 0..1 this frame. */
  flash: number;
}

export interface OceanServices {
  /** Visual water height at world (x, z) for this frame (includes sea state). */
  heightAt(x: number, z: number): number;
  /** Visual water normal at (x, z). */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Wake/foam stamps (visual only; never gameplay). */
  stampWake(x: number, z: number, dirX: number, dirZ: number, width: number, strength: number): void;
  stampRing(x: number, z: number, radius: number, strength: number): void;
  stampFoam(x: number, z: number, radius: number, strength: number): void;
  /** Pushes the surface down (negative) or up (positive) around a point, e.g. bow wave, whirlpool. */
  stampDisplace(x: number, z: number, radius: number, height: number): void;
}

export interface CameraServices {
  shake(strength: number, duration?: number): void;
  kick(fovDegrees: number, duration?: number): void;
  /** Keeps the target in frame for a moment (boss intro, special). */
  focusOn(x: number, z: number, duration: number): void;
}

export interface PostServices {
  impactFrame(strength?: number): void;
  speedLines(strength: number, duration: number): void;
  flash(color: number, strength: number, duration?: number): void;
  chromatic(strength: number, duration?: number): void;
}

export type ShipAnchor = 'bow' | 'stern' | 'port' | 'starboard' | 'mast' | 'deck';

export interface ShipServices {
  /** World position of an anchor on a ship (0 = player). Returns false if unknown. */
  anchor(shipId: number, name: ShipAnchor, out: THREE.Vector3): boolean;
  /** Visual world transform of a ship (0 = player). Returns false if unknown. */
  transform(shipId: number, out: THREE.Matrix4): boolean;
}

export interface RenderServices {
  ocean: OceanServices;
  camera: CameraServices;
  post: PostServices;
  ships: ShipServices;
  /** Requests sim slow-motion (hit-stop/kill-cam); the runtime decides. */
  requestSlowMo(scale: number, duration: number): void;
}

export interface FrameContext {
  /** Render clock in seconds; keeps running in menus. The ocean and ship heave use this clock. */
  time: number;
  dt: number;
  screen: AppScreen;
  run: Readonly<RunState> | null;
  /** Sim events drained this frame (empty in menus). */
  events: readonly SimEvent[];
  sea: Readonly<SeaState>;
  /** Point the camera and streaming follow (player ship in runs, showcase ship in menus). */
  focus: { x: number; z: number; heading: number; speed: number };
  /** Ship model shown in menus (harbor showcase). */
  menuShip: string | null;
  aim: { x: number; z: number };
  world: WorldQuery;
  quality: QualityTier;
  settings: Readonly<Settings>;
  viewport: { width: number; height: number; dpr: number };
  atmosphere: AtmosphereState;
  services: RenderServices;
}

export interface RenderHostHandles {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export interface RenderSystem {
  readonly name: string;
  init(host: RenderHostHandles): void | Promise<void>;
  update(ctx: FrameContext): void;
  dispose(): void;
}
