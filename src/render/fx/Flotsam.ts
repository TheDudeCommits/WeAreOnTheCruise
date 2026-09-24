/**
 * Floating wreckage (T11): crates and barrels that pop out of a destroyed ship, bob on the swell, drift apart
 * and finally sink. CPU pool rendered through the prop instancer (no extra draw calls).
 */
import { rand, range, spread } from './core/rand';
import type { WaterSampler } from './core/water';
import { Prop, type PropPass } from './passes/Props';

const CAP = 96;

export class Flotsam {
  private n = 0;
  private readonly x = new Float32Array(CAP);
  private readonly z = new Float32Array(CAP);
  private readonly y = new Float32Array(CAP);
  private readonly vx = new Float32Array(CAP);
  private readonly vy = new Float32Array(CAP);
  private readonly vz = new Float32Array(CAP);
  private readonly yaw = new Float32Array(CAP);
  private readonly spin = new Float32Array(CAP);
  private readonly age = new Float32Array(CAP);
  private readonly life = new Float32Array(CAP);
  private readonly kind = new Uint8Array(CAP);
  private readonly scale = new Float32Array(CAP);
  private readonly floating = new Uint8Array(CAP);

  spawn(x: number, y: number, z: number, count: number, spreadV: number): void {
    for (let c = 0; c < count; c++) {
      let i = this.n;
      if (i >= CAP) i = (rand() * CAP) | 0; else this.n++;
      this.x[i] = x + spread(2); this.z[i] = z + spread(2); this.y[i] = y;
      this.vx[i] = spread(spreadV); this.vz[i] = spread(spreadV); this.vy[i] = range(6, 13);
      this.yaw[i] = rand() * Math.PI * 2; this.spin[i] = spread(4);
      this.age[i] = 0; this.life[i] = range(8, 12);
      this.kind[i] = rand() < 0.55 ? Prop.Crate : Prop.Barrel;
      this.scale[i] = this.kind[i] === Prop.Crate ? range(0.8, 1.15) : range(0.85, 1.1);
      this.floating[i] = 0;
    }
  }

  update(dt: number, clock: number, water: WaterSampler, props: PropPass): void {
    let i = 0;
    while (i < this.n) {
      this.age[i]! += dt;
      const age = this.age[i]!;
      if (age >= this.life[i]!) { this.kill(i); continue; }
      const wy = water.height(this.x[i]!, this.z[i]!);
      if (!this.floating[i]) {
        this.vy[i]! -= 22 * dt;
        this.x[i]! += this.vx[i]! * dt; this.y[i]! += this.vy[i]! * dt; this.z[i]! += this.vz[i]! * dt;
        this.yaw[i]! += this.spin[i]! * dt;
        if (this.y[i]! <= wy && this.vy[i]! < 0) { this.floating[i] = 1; this.vx[i]! *= 0.35; this.vz[i]! *= 0.35; this.spin[i]! *= 0.2; }
      } else {
        const drag = Math.exp(-0.9 * dt);
        this.vx[i]! *= drag; this.vz[i]! *= drag;
        this.x[i]! += this.vx[i]! * dt; this.z[i]! += this.vz[i]! * dt;
        this.yaw[i]! += this.spin[i]! * dt;
        const sinkT = Math.max(0, age - (this.life[i]! - 1.6)) / 1.6;
        this.y[i] = wy + (this.kind[i] === Prop.Crate ? 0.2 : 0.35) - sinkT * sinkT * 2.5;
      }
      const bobP = Math.sin(clock * 1.7 + i * 1.3) * 0.12;
      const bobR = Math.cos(clock * 1.3 + i * 0.7) * 0.12;
      const s = this.scale[i]! * Math.min(1, age * 8);
      if (this.kind[i] === Prop.Crate) props.add(Prop.Crate, this.x[i]!, this.y[i]!, this.z[i]!, this.yaw[i]!, bobP, bobR, s, 0xffffff);
      else props.add(Prop.Barrel, this.x[i]!, this.y[i]!, this.z[i]!, this.yaw[i]!, Math.PI / 2 + bobP, bobR, s, 0xc0874a);
      i++;
    }
  }

  private kill(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.x[i] = this.x[l]!; this.z[i] = this.z[l]!; this.y[i] = this.y[l]!;
    this.vx[i] = this.vx[l]!; this.vy[i] = this.vy[l]!; this.vz[i] = this.vz[l]!;
    this.yaw[i] = this.yaw[l]!; this.spin[i] = this.spin[l]!; this.age[i] = this.age[l]!; this.life[i] = this.life[l]!;
    this.kind[i] = this.kind[l]!; this.scale[i] = this.scale[l]!; this.floating[i] = this.floating[l]!;
  }

  get active(): number { return this.n; }

  clear(): void { this.n = 0; }
}
