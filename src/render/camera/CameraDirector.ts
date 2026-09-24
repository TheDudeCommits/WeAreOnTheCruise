/**
 * Camera director (LOOK-owned; RenderSystem + CameraServices surface is contract).
 *
 * Run: a readable survivor-game tactical camera — pitch ~47°, 115–175 m, zooming out as the fleet around you grows —
 * with velocity look-ahead, a lazy heading follow (turns read on screen, then the view catches up), smooth
 * critically-damped motion, island occlusion avoidance (the camera rises over cliffs), RMB orbit and wheel zoom.
 * Shake is applied AFTER damping as trauma-shaped positional + rotational noise (respecting settings.cameraShake);
 * FOV kicks punch in and settle; focusOn(x, z, t) frames the player with a point of interest (boss intros).
 * Title/harbor: a slow, low showcase orbit close to the ship in golden light.
 * Every smoothing step runs on the render clock, so sim slow-motion never stalls or jerks the camera.
 */
import * as THREE from 'three';
import { SHIPS } from '../../game/content';
import type { ShipId } from '../../game/ids';
import type { IslandDef } from '../../game/types';
import type { CameraServices, FrameContext, RenderHostHandles, RenderSystem } from '../frame';

const TACTICAL_PITCH = THREE.MathUtils.degToRad(47);
const MIN_PITCH = THREE.MathUtils.degToRad(22);
const MAX_PITCH = THREE.MathUtils.degToRad(72);
const TACTICAL_FOV = 50;
const SHOWCASE_FOV = 36;

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Smooth pseudo-noise in [-1, 1] (sum of incommensurate sines; allocation-free). */
function wobble(t: number, seed: number): number {
  return (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.73 + seed * 2.9) * 0.2);
}

export class CameraDirector implements RenderSystem, CameraServices {
  readonly name = 'camera';
  private camera!: THREE.PerspectiveCamera;
  private canvas!: HTMLCanvasElement;
  // User input.
  private userYaw = 0;
  private userPitch = 0;
  private zoom = 1;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  // Smoothed state.
  private followYaw = 0;
  private yaw = 0;
  private pitch = TACTICAL_PITCH;
  private distance = 140;
  private fov = TACTICAL_FOV;
  private pressure = 0;
  private liftPitch = 0;
  private readonly target = new THREE.Vector3();
  private readonly lookAhead = new THREE.Vector2();
  private readonly position = new THREE.Vector3(0, 90, 150);
  private initialized = false;
  private lastScreen = '';
  private showcaseYaw = 0.6;
  // Effects.
  private shakeAmp = 0;
  private shakeTime = 0;
  private shakeDuration = 0.35;
  private shakeClock = 0;
  private kickAmount = 0;
  private kickTime = 0;
  private kickDuration = 0.35;
  private readonly focusPoint = new THREE.Vector2();
  private focusTime = 0;
  private focusDuration = 0;
  // Scratch.
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly quat = new THREE.Quaternion();
  private readonly islands: IslandDef[] = [];

  init(host: RenderHostHandles): void {
    this.camera = host.camera;
    this.canvas = host.renderer.domElement;
    this.canvas.addEventListener('contextmenu', this.onContext);
    this.canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  update(ctx: FrameContext): void {
    const dt = Math.min(0.1, Math.max(0, ctx.dt));
    const menu = ctx.screen === 'title' || ctx.screen === 'harbor' || ctx.screen === 'boot';
    if (ctx.screen !== this.lastScreen) {
      if (!menu && (this.lastScreen === 'title' || this.lastScreen === 'harbor' || this.lastScreen === '')) {
        // Entering a run: start the follow yaw behind the ship so the dolly-in reads.
        this.followYaw = ctx.focus.heading;
      }
      this.lastScreen = ctx.screen;
    }
    if (menu) this.updateShowcase(ctx, dt);
    else this.updateTactical(ctx, dt);
    this.applyEffects(ctx, dt);
  }

  // ───────────── Tactical ─────────────

  private updateTactical(ctx: FrameContext, dt: number): void {
    const run = ctx.run;
    const focus = ctx.focus;
    const shipLength = run ? SHIPS[run.shipId]?.length ?? 40 : 40;
    const enemies = run ? run.enemies.length + run.bosses.length * 12 : 0;
    this.pressure = damp(this.pressure, THREE.MathUtils.clamp(enemies / 60, 0, 1), 0.6, dt);

    // Lazy heading follow: turns read on screen before the view catches up.
    const headingError = wrapAngle(focus.heading - this.followYaw);
    this.followYaw = wrapAngle(this.followYaw + headingError * (1 - Math.exp(-dt * 0.9)));
    const yawTarget = this.followYaw + this.userYaw;
    this.yaw = wrapAngle(this.yaw + wrapAngle(yawTarget - this.yaw) * (1 - Math.exp(-dt * 5)));

    // Look-ahead along the direction of travel.
    const speed = Math.max(0, focus.speed);
    const ahead = Math.min(38, speed * 1.35);
    const fx = -Math.sin(focus.heading) * ahead, fz = -Math.cos(focus.heading) * ahead;
    this.lookAhead.x = damp(this.lookAhead.x, fx, 1.6, dt);
    this.lookAhead.y = damp(this.lookAhead.y, fz, 1.6, dt);

    // Framing: zoom out with the fight and the ship's size.
    let distance = (THREE.MathUtils.lerp(118, 172, this.pressure) + Math.max(0, shipLength - 40) * 0.7) * this.zoom;
    let tx = focus.x + this.lookAhead.x, tz = focus.z + this.lookAhead.y;
    if (this.focusTime > 0) {
      const k = this.focusEnvelope();
      const px = this.focusPoint.x, pz = this.focusPoint.y;
      tx = THREE.MathUtils.lerp(tx, focus.x * 0.4 + px * 0.6, k);
      tz = THREE.MathUtils.lerp(tz, focus.z * 0.4 + pz * 0.6, k);
      distance = Math.max(distance, THREE.MathUtils.lerp(distance, Math.hypot(px - focus.x, pz - focus.z) * 1.05 + 60, k));
    }
    this.distance = damp(this.distance, distance, 2.2, dt);
    this.target.x = damp(this.target.x, tx, 5.5, dt);
    this.target.z = damp(this.target.z, tz, 5.5, dt);
    this.target.y = damp(this.target.y, 2, 4, dt);
    if (!this.initialized) { this.target.set(tx, 2, tz); this.initialized = true; }

    // Occlusion: rise over islands between the camera and the ship.
    const basePitch = THREE.MathUtils.clamp(TACTICAL_PITCH + this.userPitch, MIN_PITCH, MAX_PITCH);
    const needed = this.occlusionPitch(ctx, basePitch);
    const lift = Math.max(0, needed - basePitch);
    this.liftPitch = damp(this.liftPitch, lift, lift > this.liftPitch ? 6 : 1.2, dt);
    this.pitch = damp(this.pitch, Math.min(MAX_PITCH, basePitch + this.liftPitch), 4, dt);
    this.fov = damp(this.fov, TACTICAL_FOV, 2.5, dt);

    this.place(ctx, dt, 4.5);
  }

  /** Minimum pitch that keeps the line of sight from the camera to the target clear of island tops. */
  private occlusionPitch(ctx: FrameContext, pitch: number): number {
    const world = ctx.world;
    const cosP = Math.cos(pitch);
    const dirX = Math.sin(this.yaw), dirZ = Math.cos(this.yaw);
    const horizontal = this.distance * cosP;
    world.islandsNear(this.target.x + dirX * horizontal * 0.5, this.target.z + dirZ * horizontal * 0.5, horizontal * 0.5 + 40, this.islands);
    if (!this.islands.length) return pitch;
    let required = pitch;
    const samples = 14;
    for (let i = 1; i <= samples; i++) {
      const d = (i / samples) * horizontal;
      const x = this.target.x + dirX * d, z = this.target.z + dirZ * d;
      if (world.shoreDistance(x, z, 30) > 12) continue;
      let height = 0;
      for (const island of this.islands) {
        if (Math.hypot(x - island.x, z - island.z) < island.radius + 12) height = Math.max(height, island.height);
      }
      if (height <= 0) continue;
      const clearance = height + 18 - this.target.y;
      required = Math.max(required, Math.atan2(clearance, d));
    }
    return required;
  }

  // ───────────── Showcase ─────────────

  private updateShowcase(ctx: FrameContext, dt: number): void {
    const id = (ctx.menuShip ?? 'sunlion') as ShipId;
    const length = SHIPS[id]?.length ?? 46;
    this.showcaseYaw += dt * 0.07;
    this.yaw = wrapAngle(this.yaw + wrapAngle(this.showcaseYaw + this.userYaw - this.yaw) * (1 - Math.exp(-dt * 1.5)));
    this.pitch = damp(this.pitch, THREE.MathUtils.clamp(0.13 + this.userPitch * 0.5, 0.04, 0.6), 1.5, dt);
    this.distance = damp(this.distance, (length * 1.35 + 26) * THREE.MathUtils.clamp(this.zoom, 0.7, 1.6), 1.5, dt);
    this.fov = damp(this.fov, SHOWCASE_FOV, 1.5, dt);
    this.target.x = damp(this.target.x, ctx.focus.x, 3, dt);
    this.target.z = damp(this.target.z, ctx.focus.z, 3, dt);
    this.target.y = damp(this.target.y, length * 0.2 + 2, 3, dt);
    if (!this.initialized) { this.target.set(ctx.focus.x, length * 0.2 + 2, ctx.focus.z); this.initialized = true; }
    this.place(ctx, dt, 2.2);
  }

  // ───────────── Placement + effects ─────────────

  private place(ctx: FrameContext, dt: number, rate: number): void {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.desired.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + sp * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    const water = ctx.services.ocean.heightAt(this.desired.x, this.desired.z);
    this.desired.y = Math.max(this.desired.y, water + 3.5);
    if (!Number.isFinite(this.position.x) || this.position.distanceToSquared(this.desired) > 1e7) this.position.copy(this.desired);
    this.position.x = damp(this.position.x, this.desired.x, rate, dt);
    this.position.y = damp(this.position.y, this.desired.y, rate, dt);
    this.position.z = damp(this.position.z, this.desired.z, rate, dt);
    this.lookTarget.copy(this.target);
  }

  private applyEffects(ctx: FrameContext, dt: number): void {
    const cam = this.camera;
    cam.position.copy(this.position);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.lookTarget);

    // Shake after damping: trauma² envelope, positional + rotational (roll strongest).
    this.shakeClock += dt;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const setting = THREE.MathUtils.clamp(ctx.settings.cameraShake ?? 1, 0, 1.5);
      const k = this.shakeTime / this.shakeDuration;
      const trauma = this.shakeAmp * k * k * setting;
      if (trauma > 1e-4) {
        const t = this.shakeClock * 22;
        this.right.setFromMatrixColumn(cam.matrixWorld, 0);
        this.up.setFromMatrixColumn(cam.matrixWorld, 1);
        const scale = 0.012 * this.distance;
        cam.position.addScaledVector(this.right, wobble(t, 1.3) * trauma * scale);
        cam.position.addScaledVector(this.up, wobble(t, 7.1) * trauma * scale * 0.8);
        this.euler.set(wobble(t, 3.7) * trauma * 0.012, wobble(t, 5.3) * trauma * 0.012, wobble(t * 0.8, 9.1) * trauma * 0.045);
        this.quat.setFromEuler(this.euler);
        cam.quaternion.multiply(this.quat);
      }
    } else {
      this.shakeAmp = 0;
    }

    // FOV kick: fast attack, eased release.
    let kick = 0;
    if (this.kickTime > 0) {
      this.kickTime = Math.max(0, this.kickTime - dt);
      const elapsed = this.kickDuration - this.kickTime;
      const attack = Math.min(1, elapsed / 0.05);
      const release = Math.pow(this.kickTime / this.kickDuration, 1.4);
      kick = this.kickAmount * attack * release;
    }
    if (this.focusTime > 0) this.focusTime = Math.max(0, this.focusTime - dt);
    const fov = this.fov + kick;
    const near = ctx.screen === 'run' || ctx.screen === 'results' ? 2 : 0.8;
    if (Math.abs(cam.fov - fov) > 0.001 || cam.near !== near || cam.far !== 6000) {
      cam.fov = fov; cam.near = near; cam.far = 6000;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  private focusEnvelope(): number {
    const elapsed = this.focusDuration - this.focusTime;
    const inK = Math.min(1, elapsed / 0.6);
    const outK = Math.min(1, this.focusTime / 0.8);
    const k = Math.min(inK, outK);
    return k * k * (3 - 2 * k);
  }

  // ───────────── CameraServices ─────────────

  shake(strength: number, duration = 0.35): void {
    if (!(strength > 0)) return;
    const current = this.shakeTime > 0 ? this.shakeAmp * (this.shakeTime / this.shakeDuration) ** 2 : 0;
    const next = Math.min(1.6, Math.max(strength, current + strength * 0.35));
    this.shakeAmp = next;
    this.shakeDuration = Math.max(0.08, duration);
    this.shakeTime = this.shakeDuration;
  }

  kick(fovDegrees: number, duration = 0.35): void {
    if (!(Math.abs(fovDegrees) > 0)) return;
    const current = this.kickTime > 0 ? this.kickAmount * Math.pow(this.kickTime / this.kickDuration, 1.4) : 0;
    this.kickAmount = THREE.MathUtils.clamp(Math.max(fovDegrees, current + fovDegrees * 0.4), -12, 14);
    this.kickDuration = Math.max(0.08, duration);
    this.kickTime = this.kickDuration;
  }

  focusOn(x: number, z: number, duration: number): void {
    this.focusPoint.set(x, z);
    this.focusDuration = Math.max(0.5, duration);
    this.focusTime = this.focusDuration;
  }

  /** Lab/QA: resets user orbit/zoom. */
  resetView(): void { this.userYaw = 0; this.userPitch = 0; this.zoom = 1; }

  /** Lab/QA: pins the showcase orbit angle (radians, world yaw of the camera offset) and snaps to it. */
  setShowcaseAngle(yaw: number, snap = true): void {
    this.showcaseYaw = yaw;
    if (snap) { this.yaw = yaw + this.userYaw; this.initialized = false; }
  }

  private readonly onContext = (event: Event) => event.preventDefault();
  private readonly onDown = (event: PointerEvent) => {
    if (event.button !== 2) return;
    this.dragging = true; this.lastX = event.clientX; this.lastY = event.clientY;
  };
  private readonly onUp = (event: PointerEvent) => { if (event.button === 2) this.dragging = false; };
  private readonly onMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.userYaw = wrapAngle(this.userYaw - (event.clientX - this.lastX) * 0.005);
    this.userPitch = THREE.MathUtils.clamp(this.userPitch + (event.clientY - this.lastY) * 0.004, MIN_PITCH - TACTICAL_PITCH, MAX_PITCH - TACTICAL_PITCH);
    this.lastX = event.clientX; this.lastY = event.clientY;
  };
  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom * (1 + Math.sign(event.deltaY) * 0.08), 0.6, 1.9);
  };

  dispose(): void {
    this.canvas.removeEventListener('contextmenu', this.onContext);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
