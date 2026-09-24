/**
 * Screen/camera juice aggregator. Effects request shake/kick/flash/impact frames freely; once per frame the
 * strongest request of each kind is forwarded to the camera/post services, with cooldowns so dense combat
 * stays readable (the camera director applies the player's shake setting).
 */
import type { RenderServices } from '../frame';

export class Juice {
  private shakeS = 0; private shakeD = 0;
  private kickS = 0; private kickD = 0;
  private impactS = 0;
  private flashS = 0; private flashC = 0xffffff; private flashD = 0.12;
  private chromS = 0; private chromD = 0.2;
  private linesS = 0; private linesD = 0;
  private slowS = 1; private slowD = 0;
  private impactCooldown = 0;
  private flashCooldown = 0;
  private slowCooldown = 0;
  /** Diagnostics for the lab. */
  readonly last = { shake: 0, kick: 0, impact: 0, flash: 0, chromatic: 0, speedLines: 0, slowMo: 0 };

  shake(strength: number, duration = 0.35): void {
    if (strength > this.shakeS) { this.shakeS = strength; this.shakeD = Math.max(this.shakeD, duration); }
  }

  /** Shake attenuated by distance from the camera focus. */
  shakeAt(strength: number, dist: number, duration = 0.35, near = 45, far = 330): void {
    const k = dist <= near ? 1 : dist >= far ? 0 : 1 - (dist - near) / (far - near);
    if (k > 0) this.shake(strength * k * k, duration);
  }

  kick(fov: number, duration = 0.3): void { if (fov > this.kickS) { this.kickS = fov; this.kickD = duration; } }

  impactFrame(strength = 1): void { if (strength > this.impactS) this.impactS = strength; }

  flash(color: number, strength: number, duration = 0.12): void {
    if (strength > this.flashS) { this.flashS = strength; this.flashC = color; this.flashD = duration; }
  }

  chromatic(strength: number, duration = 0.2): void { if (strength > this.chromS) { this.chromS = strength; this.chromD = duration; } }

  speedLines(strength: number, duration: number): void {
    if (strength > this.linesS || duration > this.linesD) { this.linesS = Math.max(this.linesS, strength); this.linesD = Math.max(this.linesD, duration); }
  }

  slowMo(scale: number, duration: number): void { if (scale < this.slowS) { this.slowS = scale; this.slowD = duration; } }

  flush(services: RenderServices, realDt: number): void {
    this.impactCooldown -= realDt; this.flashCooldown -= realDt; this.slowCooldown -= realDt;
    const l = this.last;
    l.shake = l.kick = l.impact = l.flash = l.chromatic = l.speedLines = l.slowMo = 0;
    if (this.shakeS > 0.02) { services.camera.shake(Math.min(1.2, this.shakeS), this.shakeD); l.shake = this.shakeS; }
    if (this.kickS > 0) { services.camera.kick(this.kickS, this.kickD); l.kick = this.kickS; }
    if (this.impactS > 0 && this.impactCooldown <= 0) { services.post.impactFrame(Math.min(1, this.impactS)); this.impactCooldown = 0.3; l.impact = this.impactS; }
    if (this.flashS > 0 && this.flashCooldown <= 0) { services.post.flash(this.flashC, Math.min(1, this.flashS), this.flashD); this.flashCooldown = 0.07; l.flash = this.flashS; }
    if (this.chromS > 0) { services.post.chromatic(Math.min(1, this.chromS), this.chromD); l.chromatic = this.chromS; }
    if (this.linesS > 0) { services.post.speedLines(Math.min(1, this.linesS), this.linesD); l.speedLines = this.linesS; }
    if (this.slowS < 1 && this.slowCooldown <= 0) { services.requestSlowMo(this.slowS, this.slowD); this.slowCooldown = this.slowD + 0.4; l.slowMo = this.slowS; }
    this.shakeS = this.shakeD = this.kickS = this.kickD = this.impactS = this.flashS = this.chromS = this.linesS = this.linesD = 0;
    this.slowS = 1; this.slowD = 0;
  }
}
