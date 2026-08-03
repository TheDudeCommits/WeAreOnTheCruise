import * as THREE from 'three';
import type { ShipState } from '../../core/contracts';

export type CameraPreset = 'chase' | 'broadside' | 'bow' | 'deck' | 'cinematic' | 'overhead';

const OFFSETS: Record<CameraPreset, THREE.Vector3> = {
  chase: new THREE.Vector3(0, 24, 70),
  broadside: new THREE.Vector3(64, 20, 8),
  bow: new THREE.Vector3(0, 10, -24),
  deck: new THREE.Vector3(-24, 14, 18),
  cinematic: new THREE.Vector3(-55, 20, -48),
  overhead: new THREE.Vector3(0, 150, 62),
};

export class CameraRig {
  private preset: CameraPreset = 'chase';
  private orbitYaw = 0;
  private orbitPitch = 0;
  private shake = 0;
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (event) => {
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.pointerId) return;
      this.orbitYaw -= (event.clientX - this.lastX) * 0.004;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + (event.clientY - this.lastY) * 0.0025, -0.25, 0.42);
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    });
    const release = (event: PointerEvent) => { if (event.pointerId === this.pointerId) this.pointerId = null; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  setPreset(preset: CameraPreset): void {
    this.preset = preset;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  impulse(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  update(ship: ShipState, dt: number, elapsed: number, immediate = false): void {
    const heading = ship.heading + this.orbitYaw;
    const base = OFFSETS[this.preset];
    const scale = this.preset === 'deck'
      ? 1
      : THREE.MathUtils.clamp(Math.sqrt(ship.mass / 860), 0.75, 2.15);
    this.offset.copy(base).multiplyScalar(scale);
    this.offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.orbitPitch);
    this.offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.desiredPosition.set(ship.position.x, ship.position.y, ship.position.z).add(this.offset);

    if (this.shake > 0.001) {
      this.desiredPosition.x += Math.sin(elapsed * 83) * this.shake;
      this.desiredPosition.y += Math.cos(elapsed * 67) * this.shake * 0.55;
      this.shake *= Math.exp(-8 * dt);
    }

    const follow = immediate ? 1 : 1 - Math.exp(-4.8 * dt);
    this.camera.position.lerp(this.desiredPosition, follow);
    const forward = new THREE.Vector3(-Math.sin(ship.heading), 0, -Math.cos(ship.heading));
    const lookDistance = this.preset === 'overhead' ? 68
      : this.preset === 'bow' ? 78
        : this.preset === 'broadside' || this.preset === 'cinematic' ? 2
          : this.preset === 'deck' ? 8
            : 12 + ship.speed * 0.7;
    const lookHeight = this.preset === 'deck' ? 5.4 : this.preset === 'overhead' ? 0 : 4;
    this.lookAt.set(ship.position.x, ship.position.y + lookHeight, ship.position.z)
      .addScaledVector(forward, lookDistance);
    this.camera.lookAt(this.lookAt);
  }
}
