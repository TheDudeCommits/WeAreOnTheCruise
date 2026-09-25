/**
 * Sea set-piece visuals (EVENTS): the rogue wave and the maelstrom, drawn from their hazards.
 *  - Rogue wave ('rogue-wave'): a towering curl from the shared WaveWalls pass (plus a lower back swell), spray off
 *    the lip and a foam trail, with the ocean lifted under the front (stampDisplace) — spray and stamps are only
 *    spent near the camera. The red strip ahead of it is the sim's line telegraph (StateFx draws it).
 *  - Maelstrom ('maelstrom', `armed` = spin direction): two counter-scaled whirl decals turning the way the sim's
 *    current turns, a dark eye, the ocean dragged down in the middle (stampDisplace), foam laid along rotating
 *    spiral arms (stampFoam, so it trails), rim rings (stampRing), spray, mist and planks circling the eye.
 * All decal/sprite work goes through the shared passes (no draw calls of its own); nothing allocates per frame.
 */
import { EVENT_TUNING } from '../../../game/content/director';
import type { HazardState } from '../../../game/types';
import { CelPal } from '../core/palette';
import { hash01, rand, range, spread } from '../core/rand';
import { Mode } from '../core/SpritePass';
import type { FxKit } from '../Kit';
import { Cel } from '../passes/CelSprites';
import { Decal } from '../passes/Decals';
import type { Sakuga } from '../Sakuga';

const TAU = Math.PI * 2;
const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export class SeaFx {
  private stampT = 0;
  private foamT = 0;
  private ringT = 0;
  /** Maelstroms seen last frame (for the collapse burst). */
  private readonly maelId = new Int32Array(2).fill(-1);
  private readonly maelX = new Float32Array(2);
  private readonly maelZ = new Float32Array(2);
  private readonly maelR = new Float32Array(2);
  private readonly maelSeen = new Uint8Array(2);

  constructor(private readonly k: FxKit, private readonly fx: Sakuga) {}

  reset(): void { this.maelId.fill(-1); }

  beginFrame(dt: number): void {
    this.stampT -= dt; this.foamT -= dt; this.ringT -= dt;
    this.maelSeen.fill(0);
  }

  endFrame(): void {
    if (this.stampT <= 0) this.stampT = 0.05;
    if (this.foamT <= 0) this.foamT = 0.08;
    if (this.ringT <= 0) this.ringT = 1.4;
    for (let i = 0; i < 2; i++) {
      if (this.maelId[i] === -1 || this.maelSeen[i]) continue;
      this.collapse(this.maelX[i]!, this.maelZ[i]!, this.maelR[i]!);
      this.maelId[i] = -1;
    }
  }

  // ───────────── rogue wave ─────────────

  wave(h: Readonly<HazardState>, dt: number): void {
    const k = this.k, fx = this.fx;
    const sp = Math.hypot(h.vx, h.vz) || 1;
    const dx = h.vx / sp, dz = h.vz / sp;
    const px = dz, pz = -dx;
    const ang = Math.atan2(h.vx, h.vz);
    const env = ease(h.age / 2.5) * Math.min(1, Math.max(0, (h.ttl - h.age) / 1.5));
    if (env <= 0.01) return;
    const H = EVENT_TUNING.rogueWaveHeight * Math.min(1.2, h.radius / EVENT_TUNING.rogueWaveHalfWidth);
    // The curl's lip lands on the sim's warning strip; the face (crest) meets ships at the hazard line.
    const back = 8;
    const cx = h.x - dx * back, cz = h.z - dz * back;
    k.walls.add(cx, cz, ang, h.radius, H, env, hash01(h.id, 9), 1.0);
    k.walls.add(cx - dx * H * 1.7, cz - dz * H * 1.7, ang, h.radius * 0.97, H * 0.4, env, hash01(h.id, 10), 0.9);
    // Foam skirt on the water just ahead of the lip.
    k.decals.imm(Decal.Blot, h.x + dx * H * 0.9, h.z + dz * H * 0.9, h.radius * 1.02, H * 0.45, ang, 0, 0, 0xffffff, 0.7 * env, 0x8fc3d9, 0, hash01(h.id, 2));
    // Work near the camera only: the front is ~500 m wide.
    const rel = (k.focusX - h.x) * px + (k.focusZ - h.z) * pz;
    const span = 160;
    const lo = Math.max(-h.radius, rel - span), hi = Math.min(h.radius, rel + span);
    if (hi <= lo) return;
    const wyC = fx.wy(h.x, h.z);
    const nd = Math.round(dt * 110 * k.q * env);
    for (let j = 0; j < nd; j++) {
      const u = range(lo, hi);
      const lip = H * range(0.9, 1.35);
      const x = h.x + px * u + dx * lip * 0.6, z = h.z + pz * u + dz * lip * 0.6;
      const c = k.cel.spec.reset();
      c.at(x, wyC + H * range(0.55, 0.9), z).vel(dx * range(8, 18) + h.vx * 0.9, range(3, 12), dz * range(8, 18) + h.vz * 0.9).accel(0, -20, 0)
        .look(Cel.Droplet, CelPal.Water, Mode.Velocity).sized(range(0.8, 1.6), 0.9).stretched(1, 0.05).lived(range(0.6, 1.1), 0.75);
      k.cel.emit();
    }
    k.spawned += nd;
    if (rand() < dt * 5 * env) {
      const u = range(lo, hi);
      fx.sheet(h.x + px * u + dx * 6, wyC + H * 0.35, h.z + pz * u + dz * 6, H * 0.8, 1.2, 0.9, h.vx * 0.6, h.vz * 0.6);
    }
    const o = k.ocean;
    if (!o) return;
    if (this.stampT <= 0) {
      for (let j = 0; j <= 6; j++) {
        const u = lo + ((hi - lo) * j) / 6;
        o.stampDisplace(h.x + px * u, h.z + pz * u, H * 0.9, 3.2 * env);
      }
    }
    if (this.foamT <= 0) {
      for (let j = 0; j < 5; j++) {
        const u = range(lo, hi);
        o.stampFoam(h.x + px * u - dx * 16, h.z + pz * u - dz * 16, range(8, 14), 0.55 * env);
      }
    }
  }

  // ───────────── maelstrom ─────────────

  maelstrom(h: Readonly<HazardState>, dt: number): void {
    const k = this.k, fx = this.fx;
    this.track(h);
    const R = h.radius;
    const env = Math.max(0, Math.min(1, h.age / 3, (h.ttl - h.age) / 3));
    if (env <= 0.01) return;
    const spin = h.armed ? 1 : -1;
    const eye = EVENT_TUNING.maelstromEye;
    // Whirl decals: mirrored with the spin so the arms trail and turn the way the current carries ships. Round 3: thin
    // foam streaks (add = 1) at lower opacity (were broad arms at 0.78 / 0.95); the dark eye still marks the danger.
    const hz = -spin * R;
    k.decals.imm(Decal.Whirl, h.x, h.z, R, hz, 0, -0.9, 5, 0xe4f5fc, 0.5 * env, 0x05283a, 1, hash01(h.id, 3));
    k.decals.imm(Decal.Whirl, h.x, h.z, R * 0.42, -spin * R * 0.42, 0, -2.2, 3, 0xffffff, 0.7 * env, 0x031a28, 1, hash01(h.id, 4));
    k.decals.imm(Decal.Shadow, h.x, h.z, eye * 1.5, eye * 1.5, 0, 0, 0, 0x010a12, 0.8 * env, 0x010a12, 0, 0.5);
    const wy = fx.wy(h.x, h.z);
    // Spray flung off the inner rim, mist over the eye, planks circling.
    const t = k.clock;
    const nd = Math.round(dt * 40 * k.q * env);
    for (let j = 0; j < nd; j++) {
      const a = rand() * TAU, r = eye * range(0.9, 1.6);
      const x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r;
      // Tangent of the current at that point (the sim's: spin × (sin θ, −cos θ)).
      const tx = Math.sin(a) * spin, tz = -Math.cos(a) * spin;
      const c = k.cel.spec.reset();
      c.at(x, wy + 0.5, z).vel(tx * range(10, 18), range(4, 9), tz * range(10, 18)).accel(0, -22, 0)
        .look(Cel.Droplet, CelPal.Water, Mode.Velocity).sized(range(0.6, 1.2), 0.8).stretched(1, 0.05).lived(range(0.5, 0.9), 0.75);
      k.cel.emit();
    }
    k.spawned += nd;
    if (rand() < dt * 3 * env) fx.smoke(h.x + spread(eye * 0.5), wy + 2, h.z + spread(eye * 0.5), 1, 6, 16, CelPal.Steam, 2.2, 0, 5, 0, 2, 2.5, 4, 0, 0.4);
    for (let j = 0; j < 8; j++) {
      const r = eye * 0.8 + (R * 0.55 - eye * 0.8) * hash01(h.id, j + 20);
      const w = (EVENT_TUNING.maelstromSwirl * 0.8) / Math.max(12, r);
      const a = hash01(h.id, j + 40) * TAU - spin * h.age * w;
      const x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r;
      k.debris.imm(x, fx.wy(x, z) + 0.2, z, Math.sin(t + j) * 0.2, -a * spin, Math.cos(t * 1.3 + j) * 0.15, 2.2 + hash01(h.id, j + 60) * 2.5, 0.9, j % 3 === 0 ? 0x3a2a24 : 0x6b4226);
    }
    const o = k.ocean;
    if (!o) return;
    if (this.stampT <= 0) {
      o.stampDisplace(h.x, h.z, eye * 2.2, -6 * env);
      o.stampDisplace(h.x, h.z, R * 0.45, -2.2 * env);
    }
    if (this.foamT <= 0) {
      // Foam laid along three spiral arms that turn with the current: they trail in the persistent field.
      for (let arm = 0; arm < 3; arm++) {
        for (let j = 0; j < 5; j++) {
          const r = eye * 1.2 + (R * 0.95 - eye * 1.2) * ((j + rand() * 0.5) / 5);
          const a = arm * (TAU / 3) - spin * t * 0.5 + spin * Math.log(r / eye) * 1.4;
          o.stampFoam(h.x + Math.cos(a) * r, h.z + Math.sin(a) * r, 3 + r * 0.03, 0.2 * env);
        }
      }
    }
    if (this.ringT <= 0) o.stampRing(h.x, h.z, R * 0.9, 0.7 * env);
  }

  private track(h: Readonly<HazardState>): void {
    let slot = -1;
    for (let i = 0; i < 2; i++) if (this.maelId[i] === h.id) slot = i;
    if (slot < 0) for (let i = 0; i < 2; i++) if (this.maelId[i] === -1) { slot = i; this.maelId[i] = h.id; break; }
    if (slot < 0) return;
    this.maelSeen[slot] = 1;
    this.maelX[slot] = h.x; this.maelZ[slot] = h.z; this.maelR[slot] = h.radius;
  }

  /** The maelstrom closes: the eye heaves up in a column and a ring runs out across the water. */
  private collapse(x: number, z: number, R: number): void {
    const fx = this.fx;
    fx.column(x, z, 16, 3.6, 1.4);
    fx.crown(x, z, 8, 16, 18, 3);
    fx.foam(x, z, R * 0.6, 3, 0, 1.4);
    fx.shock(x, z, R, 0.8, 0xeaf8ff, 0.8, 1.2);
    this.k.ocean?.stampRing(x, z, R * 0.8, 1);
  }
}
