/**
 * Kraken Rising visuals (EVENTS): every live 'kraken-arm' becomes a tentacle posed from its sim state (see
 * src/game/sim/events/kraken.ts): swaying while idle, rearing back over a line telegraph and whipping down along it,
 * dipping under the water while a tentacle erupts beneath a circle, reaching for and wrapping a caught ship, rising
 * out of and sinking back into the sea. Sunk arms flop over into an ink cloud. The ring's centre churns with a dark
 * foam whirl and bubbles. Everything is allocation-free: poses write into two scratch spines.
 */
import { ARM_CIRCLE, ARM_GRAB, ARM_GRAB_WINDUP, ARM_LINE, ARM_RETRACT, ARM_SLAM } from '../../../game/sim/events/kraken';
import type { EnemyState, RunState } from '../../../game/types';
import { CelPal, GlowPal } from '../core/palette';
import { hash01, rand, range, spread } from '../core/rand';
import type { FxKit } from '../Kit';
import { Decal } from '../passes/Decals';
import type { Sakuga } from '../Sakuga';
import { SPINE, type TentacleLook, type Tentacles } from './Tentacles';

const TAU = Math.PI * 2;
/** Visual arm length (m) and radii. */
const L = 36;
const BASE_R = 3.8;
const TIP_R = 0.35;
const SLOTS = 8;
const DEATH = 1.3;
const INK = 0x160a24;
const INK_EDGE = 0x3b1d52;

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeOut = (x: number): number => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

export class KrakenFx {
  private readonly spine = new Float32Array(SPINE * 3);
  private readonly spineB = new Float32Array(SPINE * 3);
  private readonly look: TentacleLook = { base: BASE_R, tip: TIP_R, flash: 0, swell: 1 };
  // Per-arm memory (slot table keyed by enemy id): last pose inputs, state transitions, one-shot flags.
  private readonly slotId = new Int32Array(SLOTS).fill(-1);
  private readonly seen = new Uint8Array(SLOTS);
  private readonly lastX = new Float32Array(SLOTS);
  private readonly lastZ = new Float32Array(SLOTS);
  private readonly lastH = new Float32Array(SLOTS);
  private readonly lastSub = new Float32Array(SLOTS);
  private readonly prevSt = new Int8Array(SLOTS);
  private readonly prevT = new Float32Array(SLOTS);
  private readonly fired = new Uint8Array(SLOTS);
  private readonly foamT = new Float32Array(SLOTS);
  // Dying arms (flop over and sink into ink).
  private readonly dieX = new Float32Array(SLOTS);
  private readonly dieZ = new Float32Array(SLOTS);
  private readonly dieH = new Float32Array(SLOTS);
  private readonly dieT = new Float32Array(SLOTS).fill(99);
  // The ring's whirl (fades in and out around the event).
  private whirl = 0;
  private cx = 0;
  private cz = 0;
  private whirlT = 0;

  constructor(private readonly k: FxKit, private readonly fx: Sakuga, private readonly tentacles: Tentacles) {}

  reset(): void {
    this.slotId.fill(-1);
    this.dieT.fill(99);
    this.whirl = 0;
  }

  update(run: Readonly<RunState>, dt: number): void {
    this.seen.fill(0);
    for (const e of run.enemies) {
      if (e.defId !== 'kraken-arm' || e.life !== 'alive') continue;
      const slot = this.slotFor(e.id);
      if (slot < 0) continue;
      this.seen[slot] = 1;
      this.arm(e, slot, dt);
    }
    // Arms that vanished: sunk ones (they were above water) flop over into ink.
    for (let i = 0; i < SLOTS; i++) {
      if (this.slotId[i] === -1 || this.seen[i]) continue;
      if (this.lastSub[i]! < 0.5) this.die(i);
      this.slotId[i] = -1;
    }
    for (let i = 0; i < SLOTS; i++) if (this.dieT[i]! < DEATH) this.dying(i, dt);
    this.ringWhirl(run, dt);
  }

  private slotFor(id: number): number {
    let free = -1;
    for (let i = 0; i < SLOTS; i++) {
      if (this.slotId[i] === id) return i;
      if (free < 0 && this.slotId[i] === -1) free = i;
    }
    if (free >= 0) {
      this.slotId[free] = id;
      this.prevSt[free] = -1; this.prevT[free] = 0; this.fired[free] = 0; this.foamT[free] = 0; this.lastSub[free] = 1;
    }
    return free;
  }

  // ───────────── one arm ─────────────

  private arm(e: EnemyState, slot: number, dt: number): void {
    const k = this.k, fx = this.fx;
    const ai = e.ai;
    const st = ai.kSt ?? 1, kt = ai.kT ?? 0, last = ai.kLast ?? ARM_LINE;
    const sub = Math.min(1, Math.max(0, ai.sub ?? 0));
    const wy = fx.wy(e.x, e.z);
    const phase = hash01(e.id, 11) * TAU;
    const t = k.clock + phase;
    // Transitions.
    const entered = st !== this.prevSt[slot] || kt < this.prevT[slot]!;
    if (entered) this.fired[slot] = 0;
    this.prevSt[slot] = st; this.prevT[slot] = kt;
    this.lastX[slot] = e.x; this.lastZ[slot] = e.z; this.lastH[slot] = e.heading;
    const wasSub = this.lastSub[slot]!;
    this.lastSub[slot] = sub;
    if (wasSub >= 0.95 && sub < 0.95) this.breach(e.x, e.z);

    const bx = e.x, bz = e.z, by = wy - 2 - sub * (L + 6);
    let dx = -Math.sin(e.heading), dz = -Math.cos(e.heading);
    const ax = -Math.sin(ai.kAng ?? e.heading), az = -Math.cos(ai.kAng ?? e.heading);
    // Idle sway.
    let bendA = 0.5 + 0.18 * Math.sin(t * 0.9), curl = 1.5 + 0.35 * Math.sin(t * 1.3 + 1), sway = 0.4 * Math.sin(t * 0.7), len = L;
    let vx = dx, vy = -0.25, vz = dz;
    const look = this.look;
    look.base = BASE_R; look.tip = TIP_R; look.flash = e.hitFlash * 0.8; look.swell = 1;
    const out = this.spine;

    if (st === ARM_LINE || (st === ARM_GRAB_WINDUP)) {
      // Rear back (line) or rise into a hook (grab) over the telegraph.
      const grab = st === ARM_GRAB_WINDUP;
      const kk = Math.min(1, kt / (grab ? 0.9 : 1.25));
      const e2 = easeOut(kk);
      dx = ax; dz = az; vx = ax; vz = az;
      bendA = bendA + ((grab ? 0.95 : -0.45) - bendA) * e2;
      curl = curl + ((grab ? 2.9 : 2.7) - curl) * e2;
      sway *= 1 - kk;
      len = L * (1 + (grab ? 0.22 : 0.12) * e2);
      bendA += Math.sin(k.clock * 38 + phase) * 0.025 * kk;
      bendSpine(out, bx, by, bz, dx, dz, len, bendA, curl, sway);
      if (!grab && rand() < dt * 10) fx.droplets(bx + dx * 4, wy + len * 0.8, bz + dz * 4, 1, 3, 2, 0.8);
    } else if (st === ARM_CIRCLE) {
      // Dip the tip under: the strike comes up beneath the circle.
      const kk = ease(Math.min(1, kt / 1.35));
      dx = ax; dz = az; vx = ax; vz = az;
      bendSpine(out, bx, by, bz, dx, dz, L * (1 + 0.1 * kk), bendA + (1.3 - bendA) * kk, curl + (0.5 - curl) * kk, sway * (1 - kk));
      this.churn(ai.kTx ?? bx, ai.kTz ?? bz, kk, dt);
    } else if (st === ARM_SLAM && (last === ARM_LINE || last === ARM_GRAB_WINDUP)) {
      // Whip down along the strip, lie on the water, then lift back to idle.
      const reach = last === ARM_LINE ? Math.max(30, ai.kLen ?? 60) : Math.hypot((ai.kTx ?? bx) - bx, (ai.kTz ?? bz) - bz) + 4;
      bendSpine(this.spineB, bx, by, bz, ax, az, L * 1.12, -0.45, 2.7, 0);
      const ex = bx + ax * reach, ez = bz + az * reach, ey = fx.wy(ex, ez) + 0.6 - Math.max(0, kt - 0.12) * 1.6;
      bezierSpine(out, bx, by, bz, bx + ax * reach * 0.1, wy + 12, bz + az * reach * 0.1,
        bx + ax * reach * 0.62, wy + 3.5, bz + az * reach * 0.62, ex, ey, ez);
      let w: number;
      if (kt < 0.12) w = ease(kt / 0.12);
      else if (kt < 0.45) w = 1;
      else w = 1 - ease((kt - 0.45) / 0.45);
      if (kt >= 0.45) {
        bendSpine(this.spineB, bx, by, bz, ax, az, L, bendA, curl, sway);
      }
      lerpSpine(out, this.spineB, out, w);
      vx = 0; vy = -1; vz = 0;
      look.base = BASE_R * (1 - 0.2 * w);
      if (kt >= 0.1 && !this.fired[slot]) { this.fired[slot] = 1; this.slamSplash(bx, bz, ax, az, reach); }
    } else if (st === ARM_SLAM && last === ARM_CIRCLE) {
      // Recover from the dip while a tentacle erupts under the circle.
      const w = 1 - ease(kt / 0.9);
      bendSpine(out, bx, by, bz, ax, az, L, bendA + (1.3 - bendA) * w, curl + (0.5 - curl) * w, sway * (1 - w));
      vx = ax; vz = az;
      this.erupt(ai.kTx ?? bx, ai.kTz ?? bz, ax, az, kt, slot);
    } else if (st === ARM_GRAB) {
      // Reach over and wrap the caught ship; squeeze pulses.
      const tx = ai.kTx ?? bx, tz = ai.kTz ?? bz;
      const d = Math.hypot(tx - bx, tz - bz) || 1;
      const gx = (tx - bx) / d, gz = (tz - bz) / d;
      const ty = fx.wy(tx, tz) + 3.5 + Math.sin(k.clock * 9) * 0.8;
      bezierSpine(out, bx, by, bz, bx + gx * d * 0.12, wy + 20, bz + gz * d * 0.12, tx - gx * 8, ty + 14, tz - gz * 8, tx + gx * 4, ty, tz + gz * 4);
      vx = gx; vy = -0.6; vz = gz;
      look.swell = 1 + 0.1 * Math.sin(k.clock * 10);
      if (entered || rand() < dt * 3) { fx.crown(tx, tz, 6, 8, 9, 1.4); fx.foam(tx, tz, 12, 1.4); }
      if (rand() < dt * 14) fx.droplets(tx + spread(5), ty, tz + spread(5), 1, 4, 5, 0.9);
    } else {
      bendSpine(out, bx, by, bz, dx, dz, len, bendA, curl, sway);
      if (st === ARM_RETRACT && rand() < dt * 12) fx.bubbles(bx, bz, 2, 6, 1.6);
    }
    this.tentacles.add(out, vx, vy, vz, look);

    // Foam collar and wet drips while the arm is up.
    if (sub < 0.9) {
      k.decals.imm(Decal.Blot, bx, bz, 7.5, 7.5, 0, 0, 0, 0xffffff, 0.8 * (1 - sub), 0x8fc3d9, 0, hash01(e.id, 3));
      this.foamT[slot] = this.foamT[slot]! - dt;
      if (this.foamT[slot]! <= 0) { this.foamT[slot] = 0.18; k.ocean?.stampFoam(bx, bz, 6, 0.35); }
      if (sub > 0.05 && rand() < dt * 30) fx.droplets(bx + spread(3), wy + (1 - sub) * L * 0.6, bz + spread(3), 1, 3, 3, 1);
    }
  }

  /** The arm breaks the surface: column, crown, foam and a ring in the water. */
  private breach(x: number, z: number): void {
    const fx = this.fx;
    fx.column(x, z, 8, 3.2, 1.1);
    fx.crown(x, z, 3, 12, 15, 2.4);
    fx.droplets(x, fx.wy(x, z) + 2, z, 16, 8, 20, 1.1);
    fx.foam(x, z, 14, 2.4, 0, 1.2);
    fx.shock(x, z, 20, 0.5, 0xeaf8ff, 0.7, 1);
    this.k.ocean?.stampRing(x, z, 16, 1);
    this.k.ocean?.stampDisplace(x, z, 8, 2);
  }

  /** Splashes all along a line slam. */
  private slamSplash(bx: number, bz: number, ax: number, az: number, reach: number): void {
    const fx = this.fx, k = this.k;
    const n = Math.max(3, Math.min(10, Math.round(reach / 9)));
    for (let i = 0; i < n; i++) {
      const s = 0.18 + (i / (n - 1)) * 0.82;
      const x = bx + ax * reach * s + spread(2), z = bz + az * reach * s + spread(2);
      fx.crown(x, z, 2.2, 7, 12, 2, i * 0.012);
      fx.foam(x, z, 9, 2, i * 0.012, 1);
      if (i % 2 === 0) { fx.column(x, z, 5, 2, 0.8, i * 0.012); k.ocean?.stampRing(x, z, 9, 0.8); }
    }
    const ex = bx + ax * reach, ez = bz + az * reach;
    k.decals.emit(Decal.Blot, ex, ez, 9, 3.2, INK, 0.55, INK_EDGE, 0, 1);
    k.juice.shakeAt(0.35, Math.hypot(ex - k.focusX, ez - k.focusZ), 0.35);
  }

  /** Boiling water over a circle about to erupt. */
  private churn(x: number, z: number, kk: number, dt: number): void {
    const fx = this.fx;
    if (rand() < dt * 24 * kk) fx.bubbles(x, z, 2, 9, 1.8);
    if (rand() < dt * 5 * kk) fx.foam(x, z, 10 + kk * 4, 1, 0, 0.8);
    this.k.ocean?.stampDisplace(x, z, 10, 0.8 * kk);
  }

  /** A tentacle bursting up under a circle slam and sinking again. */
  private erupt(x: number, z: number, ax: number, az: number, kt: number, slot: number): void {
    const fx = this.fx;
    const up = kt < 0.18 ? easeOut(kt / 0.18) : kt < 0.45 ? 1 : 1 - ease((kt - 0.45) / 0.45);
    if (up <= 0.02) return;
    const wy = fx.wy(x, z);
    const len = 24;
    bendSpine(this.spineB, x, wy - 2 - (1 - up) * (len + 4), z, ax, az, len, 0.25 + 0.6 * (1 - up), 2.4, 0.3);
    const look = this.look;
    look.base = 2.4; look.tip = 0.3; look.flash = 0; look.swell = 1;
    this.tentacles.add(this.spineB, ax, -0.2, az, look);
    if (kt < 0.1 && !this.fired[slot]) {
      this.fired[slot] = 1;
      fx.column(x, z, 9, 3.4, 1.2);
      fx.crown(x, z, 4, 14, 17, 2.6);
      fx.droplets(x, wy + 3, z, 18, 9, 22, 1.2);
    }
  }

  // ───────────── deaths ─────────────

  private die(slot: number): void {
    const x = this.lastX[slot]!, z = this.lastZ[slot]!;
    for (let i = 0; i < SLOTS; i++) {
      if (this.dieT[i]! < DEATH) continue;
      this.dieT[i] = 0; this.dieX[i] = x; this.dieZ[i] = z; this.dieH[i] = this.lastH[slot]!;
      break;
    }
    const fx = this.fx, k = this.k;
    const wy = fx.wy(x, z);
    // Ink cloud: a dark bloom on the water, inked puffs, a gout of spray.
    k.decals.emit(Decal.Blot, x, z, 22, 5, INK, 0.85, INK_EDGE, 0, 1);
    k.decals.emit(Decal.Blot, x + spread(6), z + spread(6), 14, 4, INK, 0.7, INK_EDGE, 0, 1, 0, 0.15);
    fx.smoke(x, wy + 1, z, 7, 4, 13, CelPal.DarkSmoke, 2.6, 0, 3, 0, 6, 0.6, 5, 0, 0.5);
    fx.column(x, z, 7, 2.6, 1);
    fx.sparkles(x, wy + 6, z, 10, 10, GlowPal.Magic, 1.1);
    k.ocean?.stampRing(x, z, 22, 1);
    k.ocean?.stampFoam(x, z, 10, 0.6);
  }

  private dying(i: number, dt: number): void {
    const t = (this.dieT[i] = this.dieT[i]! + dt);
    if (t >= DEATH) return;
    const x = this.dieX[i]!, z = this.dieZ[i]!;
    const dx = -Math.sin(this.dieH[i]!), dz = -Math.cos(this.dieH[i]!);
    const kk = t / DEATH;
    const wy = this.fx.wy(x, z);
    bendSpine(this.spine, x, wy - 2 - ease(kk) * (L + 6), z, dx, dz, L, 0.5 + 1.5 * easeOut(kk), 1.5 + kk, 0);
    const look = this.look;
    look.base = BASE_R; look.tip = TIP_R; look.flash = Math.max(0, 0.6 - kk * 2); look.swell = 1 - kk * 0.2;
    this.tentacles.add(this.spine, dx, -0.3, dz, look);
    if (rand() < dt * 20) this.fx.bubbles(x, z, 1, 6, 1.5);
  }

  // ───────────── the ring's whirl ─────────────

  private ringWhirl(run: Readonly<RunState>, dt: number): void {
    const ev = run.worldEvent;
    const on = !!ev && ev.id === 'kraken-rising' && ev.x !== undefined;
    if (on) { this.cx = ev.x!; this.cz = ev.z!; }
    this.whirl += ((on ? 1 : 0) - this.whirl) * Math.min(1, dt * (on ? 1.2 : 0.8));
    if (this.whirl < 0.02) return;
    const k = this.k, fx = this.fx, a = this.whirl;
    k.decals.imm(Decal.Whirl, this.cx, this.cz, 50, 50, 0, -0.5, 3, 0xb9d9ea, 0.38 * a, 0x04182a, 0, 0.37);
    k.decals.imm(Decal.Shadow, this.cx, this.cz, 38, 38, 0, 0, 0, 0x0a0620, 0.5 * a, 0x0a0620, 0, 0.5);
    this.whirlT -= dt;
    if (this.whirlT <= 0) {
      this.whirlT = 0.1;
      k.ocean?.stampDisplace(this.cx, this.cz, 26, -2.4 * a);
      const ang = rand() * TAU, r = range(8, 40);
      k.ocean?.stampFoam(this.cx + Math.cos(ang) * r, this.cz + Math.sin(ang) * r, 5, 0.3 * a);
    }
    if (rand() < dt * 16 * a) fx.bubbles(this.cx + spread(20), this.cz + spread(20), 2, 6, 2);
  }
}

/** Integrates a bending spine: rises from the base, bends toward (dx, dz) by `bend` and curls the tip by `curl`. */
function bendSpine(out: Float32Array, bx: number, by: number, bz: number, dx: number, dz: number, len: number, bend: number, curl: number, sway: number): void {
  const px = -dz, pz = dx;
  let x = bx, y = by, z = bz;
  const step = len / (SPINE - 1);
  for (let i = 0; i < SPINE; i++) {
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
    const s = i / (SPINE - 1);
    const tipK = s > 0.55 ? (s - 0.55) / 0.45 : 0;
    const phi = bend * s + curl * tipK * tipK;
    const psi = sway * s;
    const cps = Math.cos(psi), sps = Math.sin(psi);
    const hx = dx * cps + px * sps, hz = dz * cps + pz * sps;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    x += hx * sp * step; y += cp * step; z += hz * sp * step;
  }
}

function bezierSpine(out: Float32Array, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number, x3: number, y3: number, z3: number): void {
  for (let i = 0; i < SPINE; i++) {
    const t = i / (SPINE - 1), u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out[i * 3] = a * x0 + b * x1 + c * x2 + d * x3;
    out[i * 3 + 1] = a * y0 + b * y1 + c * y2 + d * y3;
    out[i * 3 + 2] = a * z0 + b * z1 + c * z2 + d * z3;
  }
}

/** out = a + (b − a)·w (out may alias b). */
function lerpSpine(out: Float32Array, a: Float32Array, b: Float32Array, w: number): void {
  for (let i = 0; i < SPINE * 3; i++) out[i] = a[i]! + (b[i]! - a[i]!) * w;
}
