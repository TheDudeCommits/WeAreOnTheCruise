import * as THREE from "three";
import type { ShipState } from "../../core/contracts";
import type { AimState } from "../../input/controls";
import { AimGuide, aimTargetSolution } from "./AimGuide";
import { getShipSpec } from "../../content/shipSpecs";

export type CameraPreset =
  | "chase"
  | "broadside"
  | "bow"
  | "deck"
  | "cinematic"
  | "overhead";

const OFFSETS: Record<CameraPreset, THREE.Vector3> = {
  chase: new THREE.Vector3(23, 36, 110),
  broadside: new THREE.Vector3(88, 26, 16),
  bow: new THREE.Vector3(0, 10, -24),
  deck: new THREE.Vector3(-20, 10.5, -20),
  cinematic: new THREE.Vector3(-48, 24, -50),
  overhead: new THREE.Vector3(0, 150, 62),
};

export class CameraRig {
  private preset: CameraPreset = "chase";
  private orbitYaw = 0;
  private orbitPitch = 0;
  private shake = 0;
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private interactionEnabled = true;
  private shakeScale = 0.65;
  private aim: AimState = { adjustment: 0 };
  private aimTarget?: ShipState;
  private aimAssist = true;
  private readonly guide?: AimGuide;
  private readonly smoothedLookAt = new THREE.Vector3();
  private hasLookTarget = false;
  private aimTransition = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    scene?: THREE.Scene,
    private readonly seaHeight?: (x:number,z:number,time:number)=>number,
  ) {
    if (scene) this.guide = new AimGuide(scene, canvas.parentElement ?? undefined);
    canvas.addEventListener("pointerdown", (event) => {
      if (!this.interactionEnabled || this.aim.side || event.button !== 0)
        return;
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.interactionEnabled || event.pointerId !== this.pointerId)
        return;
      this.orbitYaw -= (event.clientX - this.lastX) * 0.004;
      this.orbitPitch = THREE.MathUtils.clamp(
        this.orbitPitch + (event.clientY - this.lastY) * 0.0025,
        -0.25,
        0.42,
      );
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    });
    const release = (event: PointerEvent) => {
      if (event.pointerId === this.pointerId) this.pointerId = null;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
  }

  setPreset(preset: CameraPreset): void {
    this.preset = preset;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  setInteractionEnabled(enabled: boolean): void {
    this.interactionEnabled = enabled;
    if (!enabled) this.pointerId = null;
  }

  setComfort(shakeScale: number): void {
    this.shakeScale = Math.max(0, Math.min(1, shakeScale));
    if (this.shakeScale === 0) this.shake = 0;
  }

  setAim(
    side?: "port" | "starboard",
    adjustment = 0,
    target?: ShipState,
    assist = true,
  ): void {
    if(side !== this.aim.side) this.aimTransition = true;
    this.aim = { side, adjustment };
    this.aimTarget = target;
    this.aimAssist = assist;
  }

  getAimDebug(){return {...this.aim,targetId:this.aimTarget?.id,markerTargetId:this.guide?.root.visible?this.guide.root.userData.targetId as string|undefined:undefined,impact:this.guide?.root.visible?this.guide.root.userData.impact as {x:number;y:number;z:number}|undefined:undefined,guideVisible:Boolean(this.guide?.root.visible)};}
  dispose(): void {
    this.guide?.dispose();
  }

  impulse(amount: number): void {
    this.shake = Math.max(this.shake, amount * this.shakeScale);
  }

  update(
    ship: ShipState,
    dt: number,
    elapsed: number,
    immediate = false,
  ): void {
    // A rail-to-rail cut avoids sweeping through our own sails while entering
    // aim. Normal sailing and small aim adjustments retain camera damping.
    immediate ||= this.aimTransition;
    this.aimTransition = false;
    const heading = ship.heading + (this.aim.side ? 0 : this.orbitYaw);
    const base = OFFSETS[this.preset];
    const scale =
      this.preset === "deck"
        ? 1
        : THREE.MathUtils.clamp(Math.sqrt(ship.mass / 860), 0.75, 2.15);
    this.offset.copy(base).multiplyScalar(scale);
    if (this.preset === "deck")
      this.offset.y += getShipSpec(ship.kind).draft * 0.38;
    const referenceSpecial = !this.aim.side && this.aimAssist && this.pointerId === null
      && Math.abs(this.orbitYaw) < .02 && Math.abs(this.orbitPitch) < .02
      && (this.preset === "cinematic" || this.preset === "chase")
      ? ship.specialPhase : undefined;
    const specialFraming = referenceSpecial
      ? referenceSpecial.phase === "windup"
        ? THREE.MathUtils.smoothstep(referenceSpecial.elapsed / referenceSpecial.duration, 0, .75)
        : referenceSpecial.phase === "active" ? 1
          : 1 - THREE.MathUtils.smoothstep(referenceSpecial.elapsed / referenceSpecial.duration, .2, 1)
      : 0;
    if (ship.kind === "thousand-sunny" && specialFraming > 0) {
      const length = getShipSpec(ship.kind).length;
      // An arc around the hull exposes the actual stern nozzles without
      // sweeping the camera through the mast. Aim and manual orbit take priority.
      const angle = THREE.MathUtils.lerp(Math.atan2(this.offset.x, this.offset.z), -.76, specialFraming);
      const radius = THREE.MathUtils.lerp(Math.hypot(this.offset.x, this.offset.z), length * 1.45, specialFraming);
      this.offset.set(Math.sin(angle) * radius,
        THREE.MathUtils.lerp(this.offset.y, length * .53, specialFraming), Math.cos(angle) * radius);
    }
    if (ship.kind === "polar-tang" && referenceSpecial) {
      const surface = this.seaHeight?.(ship.position.x, ship.position.z, elapsed) ?? 0;
      this.offset.y += Math.max(0, surface - ship.position.y);
    }
    if (this.preset === "broadside" && !this.aim.side && this.aimTarget) {
      const spec=getShipSpec(ship.kind);
      const dx=this.aimTarget.position.x-ship.position.x, dz=this.aimTarget.position.z-ship.position.z;
      const sign=dx*Math.cos(ship.heading)-dz*Math.sin(ship.heading)>=0?1:-1;
      this.offset.set(-sign*spec.beam*3.5,spec.length*.65,spec.length*1.7);
    }
    if (this.aim.side) {
      const spec = getShipSpec(ship.kind);
      // Aim from the firing rail: the hero hull cannot occlude the firing lane.
      this.offset.set(
        (this.aim.side === "port" ? -1 : 1) * spec.beam * 0.9,
        17 + spec.draft * 0.55,
        spec.length * 0.22,
      );
    }
    this.offset.applyAxisAngle(
      new THREE.Vector3(1, 0, 0),
      this.aim.side ? 0 : this.orbitPitch,
    );
    this.offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.desiredPosition
      .set(ship.position.x, ship.position.y, ship.position.z)
      .add(this.offset);

    if (this.shake > 0.001) {
      this.desiredPosition.x += Math.sin(elapsed * 83) * this.shake;
      this.desiredPosition.y += Math.cos(elapsed * 67) * this.shake * 0.55;
      this.shake *= Math.exp(-8 * dt);
    }

    const follow = immediate ? 1 : 1 - Math.exp(-4.8 * dt);
    this.camera.position.lerp(this.desiredPosition, follow);
    const forward = new THREE.Vector3(
      -Math.sin(ship.heading),
      0,
      -Math.cos(ship.heading),
    );
    const lookDistance =
      this.preset === "overhead"
        ? 68
        : this.preset === "bow"
          ? 78
          : this.preset === "broadside" || this.preset === "cinematic"
            ? 2
            : this.preset === "deck"
              ? 0
              : 12 + ship.speed * 0.7;
    const lookHeight =
      this.preset === "deck"
        ? 5.4 + getShipSpec(ship.kind).draft * 0.38
        : this.preset === "overhead"
          ? 0
          : this.preset === "cinematic" ? 17 : 11;
    this.lookAt
      .set(ship.position.x, ship.position.y + lookHeight, ship.position.z)
      .addScaledVector(forward, lookDistance);
    if(this.preset === "broadside" && !this.aim.side && this.aimTarget && Math.hypot(this.aimTarget.position.x-ship.position.x,this.aimTarget.position.z-ship.position.z)<220){
      this.lookAt.lerp(new THREE.Vector3(this.aimTarget.position.x,this.aimTarget.position.y+9,this.aimTarget.position.z),.3);
    }
    if (this.aim.side) {
      const solution = aimTargetSolution(ship, this.aim, this.aimTarget);
      const shot = solution.shot;
      this.lookAt.set(
        THREE.MathUtils.lerp(ship.position.x, shot.impact.x, 0.78),
        ship.position.y + 6,
        THREE.MathUtils.lerp(ship.position.z, shot.impact.z, 0.78),
      );
      if (
        this.aimAssist &&
        this.aimTarget &&
        solution.correctSide &&
        solution.distance < Math.max(260, solution.range * 1.5)
      ) {
        // Framing assistance never changes the projectile bearing or lead.
        this.lookAt.lerp(
          new THREE.Vector3(
            this.aimTarget.position.x,
            this.aimTarget.position.y + 10,
            this.aimTarget.position.z,
          ),
          0.42,
        );
      }
    }
    if (!this.hasLookTarget || immediate) {
      this.smoothedLookAt.copy(this.lookAt);
      this.hasLookTarget = true;
    } else this.smoothedLookAt.lerp(this.lookAt, 1 - Math.exp(-5 * dt));
    this.camera.lookAt(this.smoothedLookAt);
    this.guide?.update(ship, this.aim, this.aimTarget, this.camera,elapsed,this.seaHeight);
  }
}
