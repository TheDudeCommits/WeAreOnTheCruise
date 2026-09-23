/**
 * Camera director (LOOK-owned; RenderSystem + CameraServices surface is contract).
 * Stub: tactical 3/4 follow with look-ahead, RMB orbit, wheel zoom, shake applied after damping, FOV kick,
 * slow showcase orbit in menus.
 */
import * as THREE from 'three';
import type { CameraServices, FrameContext, RenderHostHandles, RenderSystem } from '../frame';

export class CameraDirector implements RenderSystem, CameraServices {
  readonly name = 'camera';
  private camera!: THREE.PerspectiveCamera;
  private canvas!: HTMLCanvasElement;
  private yaw = 0;
  private pitch = 0.62;
  private distance = 150;
  private readonly target = new THREE.Vector3();
  private readonly position = new THREE.Vector3(0, 90, 150);
  private shakeAmount = 0;
  private shakeTime = 0;
  private fovKick = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

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
    const dt = Math.min(0.1, ctx.dt);
    const menu = ctx.screen !== 'run';
    const shake = ctx.settings.cameraShake;
    if (menu) this.yaw += dt * 0.08;
    const dist = menu ? 95 : this.distance + Math.min(60, (ctx.run?.enemies.length ?? 0) * 0.5);
    const pitch = menu ? 0.28 : this.pitch;
    const heading = ctx.focus.heading;
    const ahead = menu ? 0 : Math.min(40, ctx.focus.speed * 1.2);
    this.target.set(ctx.focus.x - Math.sin(heading) * ahead, menu ? 10 : 0, ctx.focus.z - Math.cos(heading) * ahead);
    const orbit = (menu ? this.yaw : heading + this.yaw);
    const desired = new THREE.Vector3(
      this.target.x + Math.sin(orbit) * Math.cos(pitch) * dist,
      this.target.y + Math.sin(pitch) * dist,
      this.target.z + Math.cos(orbit) * Math.cos(pitch) * dist,
    );
    this.position.lerp(desired, 1 - Math.exp(-dt * 3.5));
    this.camera.position.copy(this.position);
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const s = this.shakeAmount * shake * Math.max(0, this.shakeTime) * 2.5;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.target);
    this.fovKick *= Math.exp(-dt * 6);
    const fov = 50 + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  shake(strength: number, duration = 0.35): void {
    this.shakeAmount = Math.max(this.shakeAmount * (this.shakeTime > 0 ? 1 : 0), strength * 4);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  kick(fovDegrees: number): void { this.fovKick = Math.max(this.fovKick, fovDegrees); }

  focusOn(): void {}

  private readonly onContext = (event: Event) => event.preventDefault();
  private readonly onDown = (event: PointerEvent) => { if (event.button === 2) { this.dragging = true; this.lastX = event.clientX; this.lastY = event.clientY; } };
  private readonly onUp = (event: PointerEvent) => { if (event.button === 2) this.dragging = false; };
  private readonly onMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.yaw -= (event.clientX - this.lastX) * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + (event.clientY - this.lastY) * 0.004, 0.25, 1.35);
    this.lastX = event.clientX; this.lastY = event.clientY;
  };
  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.distance = THREE.MathUtils.clamp(this.distance * (1 + Math.sign(event.deltaY) * 0.08), 70, 320);
  };

  dispose(): void {
    this.canvas.removeEventListener('contextmenu', this.onContext);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
