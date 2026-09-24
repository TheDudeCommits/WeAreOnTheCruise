/**
 * Wake system (OCEAN-owned): converts ships, hazards, sim events and OceanServices stamp calls into stamps on the
 * interaction targets. Allocation-free in steady state (pooled tracks, struct-of-arrays particle/effect pools).
 *
 * Per ship and frame:
 *   transient  — hull contact shape: bow-wave ridge (raise + white crest + turquoise aeration), contact foam
 *                hugging the waterline (heavier at the bow), side trough, hollow inside the hull, stern churn.
 *   persistent — wake deposits swept from last frame's pose to this one (stern churn + two side streaks), so the
 *                wake is continuous at any speed/frame rate and curves with the ship's path.
 *   particles  — Kelvin arm particles emitted per distance travelled at the hull sides with lateral velocity
 *                v·tan(19.47°): their live positions form the ±19.5° V, which curves with the path and tapers
 *                as particles age (foam thins into lace, crest ridge flattens).
 */
import type { ProjectileKind } from '../../game/ids';
import type { BossState, EnemyState, HazardState, RunState, SimEvent } from '../../game/types';
import type { InteractionField } from './InteractionField';
import { SHAPE_BLOB, SHAPE_CAPSULE, SHAPE_FRONT, SHAPE_HULL, SHAPE_RING, SHAPE_WHIRL } from './StampBatch';

const KELVIN = (19.47 * Math.PI) / 180;
const KELVIN_TAN = Math.tan(KELVIN);
const KELVIN_COS = Math.cos(KELVIN);
const KELVIN_SIN = Math.sin(KELVIN);

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/** One floating/moving body for this frame (scratch object; not retained). */
export interface WakeSource {
  key: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  length: number;
  beam: number;
  /** 0..1 hull in the water (fade for airborne/submerged/dead). */
  contact: number;
  submerged: number;
  airborne: number;
  /** 0..1 sinking progress (0 = afloat). */
  sink: number;
  /** Wake/foam multiplier (1 normal, ghost ships lighter). */
  wake: number;
  serpent: boolean;
}

export function createWakeSource(): WakeSource {
  return { key: 0, x: 0, z: 0, heading: 0, speed: 0, length: 20, beam: 6, contact: 1, submerged: 0, airborne: 0, sink: 0, wake: 1, serpent: false };
}

class Track {
  key = 0;
  used = false;
  hasPrev = false;
  prevX = 0;
  prevZ = 0;
  prevHeading = 0;
  emitAcc = 0;
  lastSub = 0;
  lastAir = 0;
  /** Serpent body path (head positions every HIST_STEP metres, ring buffer of x,z). */
  hist: Float32Array | null = null;
  histHead = 0;
  histCount = 0;
  histAcc = 0;
}

const HIST_LEN = 96;
const HIST_STEP = 2.5;

const EFFECT_SPLASH = 1;
const EFFECT_BURST = 2;
const EFFECT_RING = 3;
const EFFECT_FOAM = 4;
const EFFECT_DISPLACE = 5;
const EFFECT_WAKE = 6;
const EFFECT_SHOCK = 7;

const PARTICLE_CAP = 4096;
const EFFECT_CAP = 640;

const SPLASH_SIZE: Record<ProjectileKind, number> = {
  cannonball: 6, 'chain-shot': 6, 'heavy-shot': 8, 'chaser-shot': 6, lance: 7, 'mortar-shell': 11, bomblet: 5,
  'swivel-shot': 3, grapeshot: 3, harpoon: 3.5, rocket: 7, torpedo: 9, 'skiff-shot': 3, 'enemy-cannonball': 6,
  'enemy-chaser': 6, 'enemy-mortar': 11, 'water-bolt': 8, 'boss-shell': 10,
};

export class WakeSystem {
  private dt = 0;
  private time = 0;
  private readonly tracks: Track[] = [];
  private readonly trackByKey = new Map<number, Track>();
  private readonly trackPool: Track[] = [];
  readonly scratch = createWakeSource();

  // Kelvin particles (struct of arrays).
  private pn = 0;
  private readonly px = new Float32Array(PARTICLE_CAP);
  private readonly pz = new Float32Array(PARTICLE_CAP);
  private readonly pvx = new Float32Array(PARTICLE_CAP);
  private readonly pvz = new Float32Array(PARTICLE_CAP);
  private readonly pdx = new Float32Array(PARTICLE_CAP);
  private readonly pdz = new Float32Array(PARTICLE_CAP);
  private readonly page = new Float32Array(PARTICLE_CAP);
  private readonly plife = new Float32Array(PARTICLE_CAP);
  private readonly plen = new Float32Array(PARTICLE_CAP);
  private readonly pwid = new Float32Array(PARTICLE_CAP);
  private readonly pstr = new Float32Array(PARTICLE_CAP);
  private readonly praise = new Float32Array(PARTICLE_CAP);

  // Effects (struct of arrays).
  private en = 0;
  private readonly etype = new Uint8Array(EFFECT_CAP);
  private readonly ex = new Float64Array(EFFECT_CAP);
  private readonly ez = new Float64Array(EFFECT_CAP);
  private readonly er = new Float32Array(EFFECT_CAP);
  private readonly es = new Float32Array(EFFECT_CAP);
  private readonly eage = new Float32Array(EFFECT_CAP);
  private readonly elife = new Float32Array(EFFECT_CAP);
  private readonly edx = new Float32Array(EFFECT_CAP);
  private readonly edz = new Float32Array(EFFECT_CAP);

  constructor(private readonly field: InteractionField) {}

  get particleCount(): number { return this.pn; }
  get effectCount(): number { return this.en; }

  /** Starts a frame. `dt` is the interaction clock (0 while the run is paused). */
  begin(dt: number, time: number): void {
    this.dt = dt;
    this.time = time;
    for (let i = 0; i < this.tracks.length; i++) this.tracks[i]!.used = false;
  }

  // ───────────────────────────── Sources ─────────────────────────────

  private track(key: number): Track {
    let track = this.trackByKey.get(key);
    if (!track) {
      track = this.trackPool.pop() ?? new Track();
      track.key = key;
      track.hasPrev = false;
      track.emitAcc = 0;
      track.lastSub = 0;
      track.lastAir = 0;
      track.histHead = 0;
      track.histCount = 0;
      track.histAcc = 0;
      this.trackByKey.set(key, track);
      this.tracks.push(track);
    }
    track.used = true;
    return track;
  }

  /** Stamps one ship-like body for this frame. */
  source(src: WakeSource): void {
    const f = this.field;
    const track = this.track(src.key);
    const reach = src.length * 1.5 + 30;
    if (!f.contains(src.x, src.z, reach)) {
      this.remember(track, src);
      return;
    }
    const fwdX = -Math.sin(src.heading);
    const fwdZ = -Math.cos(src.heading);
    const rightX = Math.cos(src.heading);
    const rightZ = -Math.sin(src.heading);
    // Serpents push water with their head; the body trails along the path (see serpentBody).
    const hullLength = src.serpent ? Math.max(6, src.beam * 3.2) : src.length;
    const halfL = Math.max(2, hullLength * 0.4);
    // Visual waterlines run ~80% of the overall length and are often a little wider than the gameplay beam.
    const halfB = Math.max(0.8, src.beam * 0.5 * 1.12);
    const speed = Math.max(0, src.speed);
    const s = Math.min(1.45, speed / 18);
    const inWater = src.contact * (1 - smooth(0.25, 0.75, src.submerged)) * (1 - smooth(0.04, 0.3, src.airborne));
    const moving = smooth(0.8, 4, speed);
    const wakeK = src.wake;

    // Transitions: take-off / landing splashes, dive / surface rings.
    if (track.hasPrev) {
      if (track.lastAir > 0.25 && src.airborne < 0.05) this.burst(src.x, src.z, hullLength * 0.7, 1.7);
      else if (track.lastAir < 0.05 && src.airborne > 0.2) this.splash(src.x, src.z, hullLength * 0.45, 1.2);
      if ((track.lastSub < 0.5) !== (src.submerged < 0.5)) {
        this.ring(src.x, src.z, Math.max(hullLength, src.beam * 6) * 0.9, 1.1);
        this.foam(src.x, src.z, Math.max(hullLength, src.beam * 6) * 0.35, 0.8);
      }
    }

    if (src.serpent) this.serpentBody(track, src, fwdX, fwdZ, inWater, s);
    else if (inWater > 0.01) {
      const bowH = Math.min(3.6, 0.4 + 0.045 * src.length) * Math.min(s, 1.3) * wakeK;
      f.transientBatch.push(
        f.relX(src.x), f.relZ(src.z), fwdX, fwdZ, halfL + 6 + 5 * s + halfB * 0.4, halfB + 5 + 4 * s, SHAPE_HULL,
        halfL, halfB, s, inWater, bowH, 1, 1, wakeK, 1,
      );
    }

    // Submerged hull: a bulge riding above it and turbulent water, no foam.
    if (src.submerged > 0.35 && moving > 0) {
      const k = smooth(0.35, 0.8, src.submerged) * moving;
      f.transientBatch.push(f.relX(src.x), f.relZ(src.z), fwdX, fwdZ, halfL * 1.1, halfB * 1.6, SHAPE_BLOB, 1, 0.3, 0.2, 0, 0, 0.28 * s * k, 0, 0.12 * k, 0.45 * k);
      if (track.hasPrev) this.capsule(true, track.prevX, track.prevZ, src.x, src.z, halfB * 1.1, 0, 0, 0.5 * k, 0.4);
    }

    // Sinking: spinning foam whirl + depression; deposits persistent foam that outlives the hull.
    if (src.sink > 0) {
      const env = smooth(0, 0.12, src.sink) * (1 - smooth(0.82, 1, src.sink));
      const radius = src.length * (0.32 + 0.36 * src.sink) + 4;
      f.transientBatch.push(
        f.relX(src.x), f.relZ(src.z), 1, 0, radius, radius, SHAPE_WHIRL,
        this.time * (1.4 + src.sink * 1.2) + src.key * 1.7, 3, (0.5 + 0.022 * src.length) * env, 2.2, 0,
        1, 1, env, env,
      );
      f.persistentBatch.push(f.relX(src.x), f.relZ(src.z), 1, 0, radius * 0.8, radius * 0.8, SHAPE_BLOB, 1, 0.55, 0.3, 0, 0, 0, 0, 0.42 * env, env);
    }

    // Persistent wake deposits swept from the previous pose.
    const deposit = moving * inWater;
    if (track.hasPrev && deposit > 0.01 && !src.serpent) {
      const segment = Math.hypot(src.x - track.prevX, src.z - track.prevZ);
      if (segment < 40) {
        const pfX = -Math.sin(track.prevHeading);
        const pfZ = -Math.cos(track.prevHeading);
        const prX = Math.cos(track.prevHeading);
        const prZ = -Math.sin(track.prevHeading);
        const sternU = -halfL * 0.88;
        this.capsule(
          true,
          track.prevX + pfX * sternU, track.prevZ + pfZ * sternU, src.x + fwdX * sternU, src.z + fwdZ * sternU,
          halfB * (0.42 + 0.25 * Math.min(s, 1)), 0.5, 0.62 * deposit * wakeK, deposit, 0.25,
        );
        const shoulderU = halfL * 0.05;
        const sideR = 0.7 + 0.7 * Math.min(s, 1.2) + halfB * 0.06;
        const sideFoam = 0.38 * smooth(0.12, 0.65, s) * deposit * wakeK;
        for (let side = -1; side <= 1; side += 2) {
          const off = halfB * 1.02 * side;
          this.capsule(
            true,
            track.prevX + pfX * shoulderU + prX * off, track.prevZ + pfZ * shoulderU + prZ * off,
            src.x + fwdX * shoulderU + rightX * off, src.z + fwdZ * shoulderU + rightZ * off,
            sideR, 0.5, sideFoam, deposit * 0.5, 0.2,
          );
        }
      }
    }

    // Kelvin arm particles, emitted per metre travelled.
    const armStrength = Math.max(inWater, src.submerged > 0.35 ? 0.35 : 0) * moving;
    if (track.hasPrev && armStrength > 0.05 && speed > 2.5) {
      const travelled = Math.hypot(src.x - track.prevX, src.z - track.prevZ);
      if (travelled < 40) track.emitAcc += travelled;
      const spacing = clamp(hullLength * 0.1, 2.2, 7);
      const ue = Math.max(halfL - 2.83 * halfB, -halfL * 0.5);
      const life = clamp(2.2 + hullLength / 18, 2.2, 6.5) * (0.75 + 0.25 * Math.min(s, 1));
      const width = 1.1 + hullLength * 0.035;
      const strength = (0.45 + 0.55 * Math.min(s, 1)) * wakeK * armStrength * (src.submerged > 0.35 ? 0.4 : 1);
      const raise = (0.1 + 0.012 * hullLength) * Math.min(s, 1.2) * wakeK * armStrength;
      let guard = 0;
      while (track.emitAcc >= spacing && guard++ < 8) {
        track.emitAcc -= spacing;
        const back = track.emitAcc;
        const bx = src.x - fwdX * back;
        const bz = src.z - fwdZ * back;
        for (let side = -1; side <= 1; side += 2) {
          this.emitParticle(
            bx + fwdX * ue + rightX * side * halfB * 0.95, bz + fwdZ * ue + rightZ * side * halfB * 0.95,
            rightX * side * speed * KELVIN_TAN, rightZ * side * speed * KELVIN_TAN,
            -fwdX * KELVIN_COS + rightX * side * KELVIN_SIN, -fwdZ * KELVIN_COS + rightZ * side * KELVIN_SIN,
            life, spacing * 1.8, width, strength, raise,
          );
        }
      }
      if (track.emitAcc > spacing * 8) track.emitAcc = 0;
    } else {
      track.emitAcc = 0;
    }

    this.remember(track, src);
  }

  private remember(track: Track, src: WakeSource): void {
    track.prevX = src.x;
    track.prevZ = src.z;
    track.prevHeading = src.heading;
    track.lastAir = src.airborne;
    track.lastSub = src.submerged;
    track.hasPrev = true;
  }

  /** Sea serpents: the body follows the head's path, so body contact is stamped along the path history. */
  private serpentBody(track: Track, src: WakeSource, fwdX: number, fwdZ: number, inWater: number, s: number): void {
    const f = this.field;
    if (!track.hist) track.hist = new Float32Array(HIST_LEN * 2);
    const hist = track.hist;
    if (track.hasPrev) track.histAcc += Math.hypot(src.x - track.prevX, src.z - track.prevZ);
    if (track.histCount === 0 || track.histAcc >= HIST_STEP) {
      track.histAcc = 0;
      track.histHead = (track.histHead + 1) % HIST_LEN;
      hist[track.histHead * 2] = src.x;
      hist[track.histHead * 2 + 1] = src.z;
      track.histCount = Math.min(HIST_LEN, track.histCount + 1);
    }
    const radius = Math.max(1.2, src.beam * 0.6);
    // Head: a short hull shape with its own bow wave.
    if (inWater > 0.01) {
      const headL = Math.max(3, src.beam * 1.6);
      f.transientBatch.push(f.relX(src.x), f.relZ(src.z), fwdX, fwdZ, headL + 6 + 4 * s, src.beam * 0.5 + 5 + 3 * s, SHAPE_HULL, headL, src.beam * 0.5, s, inWater, Math.min(1.6, 0.4 + src.beam * 0.08) * s, 1, 1, 1, 1);
    }
    // Body: contact foam + slight raise along the path, only while surfaced.
    const surfaced = inWater;
    let prevX = src.x;
    let prevZ = src.z;
    let along = 0;
    const bodyLength = src.length * 0.9;
    const step = Math.max(radius * 1.4, 3);
    let nextStamp = step;
    for (let i = 1; i < track.histCount && along < bodyLength; i++) {
      const idx = (track.histHead - i + HIST_LEN) % HIST_LEN;
      const hx = hist[idx * 2]!;
      const hz = hist[idx * 2 + 1]!;
      const seg = Math.hypot(hx - prevX, hz - prevZ);
      along += seg;
      if (along >= nextStamp) {
        nextStamp += step;
        const taper = 1 - smooth(0.6, 1, along / bodyLength) * 0.6;
        if (surfaced > 0.01) {
          const ax = seg > 1e-3 ? (prevX - hx) / seg : fwdX;
          const az = seg > 1e-3 ? (prevZ - hz) / seg : fwdZ;
          f.transientBatch.push(f.relX(hx), f.relZ(hz), ax, az, step * 0.5 + radius * 1.6 * taper, radius * 1.6 * taper, SHAPE_CAPSULE, step * 0.5, 0.45, 0.35, 0, 0, 0.35 * surfaced * taper, 0, 0.75 * surfaced * taper, 0.7 * surfaced);
        } else if (src.submerged > 0.35 && src.speed > 3) {
          // Ripple bulge over the submerged body.
          f.transientBatch.push(f.relX(hx), f.relZ(hz), 1, 0, radius * 2, radius * 2, SHAPE_BLOB, 1, 0.3, 0.1, 0, 0, 0.25 * taper, 0, 0, 0.3 * taper);
        }
      }
      prevX = hx;
      prevZ = hz;
    }
    if (track.hasPrev && surfaced > 0.05 && src.speed > 1) {
      this.capsule(true, track.prevX, track.prevZ, src.x, src.z, radius * 1.2, 0.5, 0.55 * surfaced, 0.8 * surfaced, 0.3);
    }
  }

  // ───────────────────────────── Run state ─────────────────────────────

  enemy(e: EnemyState, scale: number): void {
    if (e.life === 'dead' || e.defId === 'fort') return;
    const src = this.scratch;
    src.key = e.id;
    src.x = e.x; src.z = e.z; src.heading = e.heading;
    src.speed = e.life === 'sinking' ? 0 : Math.hypot(e.vx, e.vz) || Math.abs(e.speed);
    src.length = e.length; src.beam = e.beam || e.length * 0.3;
    src.sink = e.life === 'sinking' ? Math.max(0.001, e.sink) : 0;
    src.contact = e.life === 'sinking' ? 1 - smooth(0.4, 1, e.sink) : 1;
    let submerged = e.hidden;
    for (let i = 0; i < e.statuses.length; i++) if (e.statuses[i]!.kind === 'submerged') submerged = 1;
    src.submerged = submerged;
    src.airborne = 0;
    src.wake = (e.faction === 'wraith' ? 0.55 : 1) * scale;
    src.serpent = e.defId === 'wyrmling';
    this.source(src);
  }

  boss(b: BossState): void {
    if (b.life === 'dead') return;
    const src = this.scratch;
    src.key = b.id;
    src.x = b.x; src.z = b.z; src.heading = b.heading;
    src.speed = b.life === 'sinking' ? 0 : Math.hypot(b.vx, b.vz) || Math.abs(b.speed);
    src.length = b.length; src.beam = b.beam || b.radius * 1.2;
    src.sink = b.life === 'sinking' ? Math.max(0.001, b.sink) : 0;
    src.contact = b.life === 'sinking' ? 1 - smooth(0.4, 1, b.sink) : 1;
    src.submerged = b.submerged;
    src.airborne = 0;
    src.wake = 1.15;
    src.serpent = b.defId === 'tidewyrm';
    this.source(src);
  }

  hazard(h: HazardState): void {
    if (!h.alive) return;
    const f = this.field;
    switch (h.kind) {
      case 'escort-skiff': {
        const src = this.scratch;
        const speed = Math.hypot(h.vx, h.vz);
        src.key = -1 - h.id;
        src.x = h.x; src.z = h.z;
        src.heading = speed > 0.1 ? Math.atan2(-h.vx, -h.vz) : 0;
        src.speed = speed; src.length = 9; src.beam = 3.4;
        src.contact = 1; src.submerged = 0; src.airborne = 0; src.sink = 0; src.wake = 0.9; src.serpent = false;
        this.source(src);
        break;
      }
      case 'whirlpool': {
        if (!f.contains(h.x, h.z, h.radius + 10)) break;
        const env = smooth(0, 0.6, h.age) * (1 - smooth(h.ttl - 0.8, h.ttl, h.age));
        const r = Math.max(6, h.radius);
        f.transientBatch.push(f.relX(h.x), f.relZ(h.z), 1, 0, r, r, SHAPE_WHIRL, this.time * 1.6 + h.id, 3, (0.8 + r * 0.03) * env, 2.6, 0, 1, 1, env, env);
        f.persistentBatch.push(f.relX(h.x), f.relZ(h.z), 1, 0, r * 0.75, r * 0.75, SHAPE_BLOB, 1, 0.6, 0.2, 0, 0, 0, 0, 0.45 * env, 0.8 * env);
        break;
      }
      case 'wave-front': {
        const speed = Math.hypot(h.vx, h.vz);
        if (speed < 0.1 || !f.contains(h.x, h.z, h.radius + 20)) break;
        const ax = h.vx / speed;
        const az = h.vz / speed;
        const env = smooth(0, 0.4, h.age) * (1 - smooth(h.ttl - 0.8, h.ttl, h.age));
        const w = 6 + h.radius * 0.04;
        f.transientBatch.push(f.relX(h.x), f.relZ(h.z), ax, az, w * 4, Math.max(h.radius, 10), SHAPE_FRONT, w, (2 + h.radius * 0.015) * env, 0, 0, 0, 1, 1, env, env);
        // Foam left behind the breaking crest.
        const bx = h.x - ax * w * 0.8;
        const bz = h.z - az * w * 0.8;
        f.persistentBatch.push(f.relX(bx), f.relZ(bz), -az, ax, Math.max(h.radius, 10), w * 0.5, SHAPE_CAPSULE, Math.max(h.radius, 10) * 0.85, 0.7, 0.2, 0, 0, 0, 0, 0.36 * env, 0.8 * env);
        break;
      }
      case 'mine':
      case 'barrel':
      case 'powder-keg': {
        if (!f.contains(h.x, h.z, 8)) break;
        const r = h.kind === 'mine' ? 1.9 : 1.5;
        const bob = 0.75 + 0.25 * Math.sin(this.time * 2.3 + h.id);
        f.transientBatch.push(f.relX(h.x), f.relZ(h.z), 1, 0, r + 2.2, r + 2.2, SHAPE_RING, r, 0.55, 0, 0, 0, 0.04, 0.04, 0.6 * bob, 0.45);
        break;
      }
      case 'burning-wreck': {
        if (!f.contains(h.x, h.z, h.radius + 10)) break;
        const r = Math.max(4, h.radius * 0.8);
        f.transientBatch.push(f.relX(h.x), f.relZ(h.z), 1, 0, r + 3, r + 3, SHAPE_RING, r, 1.1, 0, 0, 0, 0.1, 0.1, 0.65, 0.6);
        f.persistentBatch.push(f.relX(h.x), f.relZ(h.z), 1, 0, r, r, SHAPE_BLOB, 1, 0.6, 0.3, 0, 0, 0, 0, 0.3, 0.6);
        break;
      }
      default:
        break;
    }
  }

  event(e: SimEvent): void {
    switch (e.type) {
      case 'projectile-hit':
        if (e.target === 'water') this.splash(e.x, e.z, SPLASH_SIZE[e.projectile] ?? 6, e.crit ? 1.25 : 1);
        break;
      case 'explosion': {
        const k = e.kind === 'large' || e.kind === 'powder' ? 1.6 : e.kind === 'medium' || e.kind === 'mine' || e.kind === 'mortar' ? 1.25 : e.kind === 'lightning' ? 1.1 : 0.9;
        this.burst(e.x, e.z, Math.max(5, e.radius), k);
        break;
      }
      case 'hazard-spawned':
        if (e.kind === 'shockwave') this.shock(e.x, e.z, Math.max(20, e.radius), 1.6);
        else if (e.kind === 'lightning-strike') this.burst(e.x, e.z, 10, 1.2);
        else if (e.kind === 'mine' || e.kind === 'barrel' || e.kind === 'powder-keg' || e.kind === 'escort-skiff') this.splash(e.x, e.z, 3.5, 0.8);
        else if (e.kind === 'wave-front') this.splash(e.x, e.z, Math.max(12, e.radius * 0.3), 1.4);
        else if (e.kind === 'whirlpool') this.ring(e.x, e.z, Math.max(10, e.radius), 0.7);
        break;
      case 'hazard-triggered':
        if (e.kind === 'mine' || e.kind === 'powder-keg' || e.kind === 'barrel') this.burst(e.x, e.z, Math.max(8, e.radius), 1.4);
        break;
      case 'enemy-killed':
        this.burst(e.x, e.z, e.elite ? 20 : 14, e.elite ? 1.3 : 1);
        break;
      case 'boss-defeated':
        this.burst(e.x, e.z, 40, 2.4);
        this.shock(e.x, e.z, 120, 1.6);
        break;
      case 'boss-attack':
        if (e.boss === 'tidewyrm') {
          this.shock(e.x, e.z, 55, 1.4);
          this.foam(e.x, e.z, 14, 1);
        }
        break;
      case 'ram':
        this.burst(e.x, e.z, 9, 1);
        break;
      case 'collision':
        if (e.impulse > 2) this.splash(e.x, e.z, 4 + Math.min(e.impulse, 20) * 0.3, 0.9);
        break;
      case 'lightning-strike':
        this.burst(e.x, e.z, 12, 1.3);
        break;
      case 'skill-used':
        if (e.skill === 'seaquake') this.shock(e.x, e.z, 160, 2.2);
        else if (e.skill === 'deep-dive') this.ring(e.x, e.z, 30, 1);
        else if (e.skill === 'tidal-colossus') this.shock(e.x, e.z, 70, 1.6);
        else if (e.skill === 'ramming-speed' || e.skill === 'boost') this.ring(e.x, e.z, 22, 0.6);
        break;
      case 'player-hit':
        if (e.parried) this.ring(e.x, e.z, 20, 0.9);
        break;
      default:
        break;
    }
  }

  /** Stamps a whole run for this frame (player, enemies, bosses, hazards) and handles its events. */
  run(run: Readonly<RunState>, events: readonly SimEvent[], enemyScale = 1): void {
    const p = run.player;
    const src = this.scratch;
    src.key = 0;
    src.x = p.x; src.z = p.z; src.heading = p.heading;
    src.speed = Math.hypot(p.vx, p.vz) || Math.abs(p.speed);
    src.length = p.length; src.beam = p.beam;
    src.contact = p.alive ? 1 : 0;
    src.submerged = p.submerged; src.airborne = p.airborne;
    src.sink = 0; src.wake = 1.1; src.serpent = false;
    this.source(src);
    for (let i = 0; i < run.enemies.length; i++) this.enemy(run.enemies[i]!, enemyScale);
    for (let i = 0; i < run.bosses.length; i++) this.boss(run.bosses[i]!);
    for (let i = 0; i < run.hazards.length; i++) this.hazard(run.hazards[i]!);
    for (let i = 0; i < events.length; i++) this.event(events[i]!);
  }

  // ───────────────────────────── Effects API ─────────────────────────────

  private addEffect(type: number, x: number, z: number, radius: number, strength: number, life: number, dx = 0, dz = 0): void {
    if (this.en >= EFFECT_CAP) return;
    const i = this.en++;
    this.etype[i] = type;
    this.ex[i] = x;
    this.ez[i] = z;
    this.er[i] = radius;
    this.es[i] = strength;
    this.eage[i] = 0;
    this.elife[i] = life;
    this.edx[i] = dx;
    this.edz[i] = dz;
  }

  splash(x: number, z: number, radius: number, strength = 1): void { this.addEffect(EFFECT_SPLASH, x, z, radius, strength, 1.15); }
  burst(x: number, z: number, radius: number, strength = 1): void { this.addEffect(EFFECT_BURST, x, z, radius, strength, 2.1); }
  ring(x: number, z: number, radius: number, strength = 1): void { this.addEffect(EFFECT_RING, x, z, radius, strength, 1.5); }
  shock(x: number, z: number, radius: number, strength = 1): void { this.addEffect(EFFECT_SHOCK, x, z, radius, strength, 2.4); }
  foam(x: number, z: number, radius: number, strength = 1): void { this.addEffect(EFFECT_FOAM, x, z, radius, strength, 0); }
  displace(x: number, z: number, radius: number, height: number): void { this.addEffect(EFFECT_DISPLACE, x, z, radius, height, 0.35); }
  wake(x: number, z: number, dirX: number, dirZ: number, width: number, strength: number): void {
    const len = Math.hypot(dirX, dirZ);
    this.addEffect(EFFECT_WAKE, x, z, width, strength, 0, len > 1e-6 ? dirX / len : 0, len > 1e-6 ? dirZ / len : 1);
  }

  private emitParticle(x: number, z: number, vx: number, vz: number, dx: number, dz: number, life: number, len: number, width: number, strength: number, raise: number): void {
    if (this.pn >= PARTICLE_CAP) return;
    const i = this.pn++;
    this.px[i] = x; this.pz[i] = z; this.pvx[i] = vx; this.pvz[i] = vz; this.pdx[i] = dx; this.pdz[i] = dz;
    this.page[i] = 0; this.plife[i] = life; this.plen[i] = len; this.pwid[i] = width; this.pstr[i] = strength; this.praise[i] = raise;
  }

  /** Capsule between two world points into the persistent (or transient) batch. */
  private capsule(persistent: boolean, x0: number, z0: number, x1: number, z1: number, radius: number, rag: number, foam: number, aeration: number, inner: number): void {
    const f = this.field;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ax = len > 1e-4 ? dx / len : 1;
    const az = len > 1e-4 ? dz / len : 0;
    const half = len * 0.5;
    const batch = persistent ? f.persistentBatch : f.transientBatch;
    batch.push(f.relX((x0 + x1) * 0.5), f.relZ((z0 + z1) * 0.5), ax, az, half + radius, radius, SHAPE_CAPSULE, half, rag, inner, 0, 0, 0, 0, foam, aeration);
  }

  // ───────────────────────────── Frame end ─────────────────────────────

  /** Ages and stamps particles and effects, releases tracks not seen this frame. */
  finish(): void {
    const f = this.field;
    const dt = this.dt;

    // Tracks.
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const track = this.tracks[i]!;
      if (track.used) continue;
      this.trackByKey.delete(track.key);
      this.tracks[i] = this.tracks[this.tracks.length - 1]!;
      this.tracks.pop();
      this.trackPool.push(track);
    }

    // Kelvin particles.
    for (let i = 0; i < this.pn; ) {
      const age = this.page[i]! + dt;
      if (age >= this.plife[i]!) {
        this.removeParticle(i);
        continue;
      }
      this.page[i] = age;
      this.px[i] = this.px[i]! + this.pvx[i]! * dt;
      this.pz[i] = this.pz[i]! + this.pvz[i]! * dt;
      const x = this.px[i]!;
      const z = this.pz[i]!;
      if (f.contains(x, z, 10)) {
        const a = 1 - age / this.plife[i]!;
        const fadeIn = Math.min(1, age / 0.12);
        const w = this.pwid[i]! * (1 + age * 0.32);
        const len = this.plen[i]! * (1 + age * 0.12);
        const foam = this.pstr[i]! * Math.pow(a, 1.25) * fadeIn * 0.95;
        f.transientBatch.push(f.relX(x), f.relZ(z), this.pdx[i]!, this.pdz[i]!, len * 0.5, w * 0.5, SHAPE_BLOB, 1, 0.5, 0.2, 0, 0, this.praise[i]! * a * fadeIn, 0, foam, 0.55 * a * fadeIn * this.pstr[i]!);
      }
      i++;
    }

    // Effects.
    for (let i = 0; i < this.en; ) {
      const age = this.eage[i]!;
      const life = this.elife[i]!;
      this.drawEffect(i, age, life);
      const next = age + dt;
      if (life <= 0 || next >= life) {
        this.removeEffect(i);
        continue;
      }
      this.eage[i] = next;
      i++;
    }
  }

  private drawEffect(i: number, age: number, life: number): void {
    const f = this.field;
    const x = this.ex[i]!;
    const z = this.ez[i]!;
    const r = this.er[i]!;
    const s = this.es[i]!;
    if (!f.contains(x, z, r * 2 + 10)) return;
    const cx = f.relX(x);
    const cz = f.relZ(z);
    const t = life > 0 ? Math.min(1, age / life) : 0;
    const first = age <= 0;
    switch (this.etype[i]) {
      case EFFECT_SPLASH:
      case EFFECT_BURST: {
        const burst = this.etype[i] === EFFECT_BURST;
        const R = r * (0.25 + 1.1 * easeOut(t));
        const W = 0.5 + r * 0.12 + t * r * 0.1;
        const k = 1 - t;
        const height = Math.min(2.5, (burst ? 0.8 : 0.5) * s * k * k * (0.6 + r * 0.05));
        f.transientBatch.push(cx, cz, 1, 0, R + W * 3, R + W * 3, SHAPE_RING, R, W, 0, 0, 0, height, height, 0.95 * Math.pow(k, 1.5), 0.8 * k);
        if (burst && t > 0.12) {
          const t2 = (t - 0.12) / 0.88;
          const R2 = r * (0.2 + 0.8 * easeOut(t2));
          f.transientBatch.push(cx, cz, 1, 0, R2 + W * 3, R2 + W * 3, SHAPE_RING, R2, W * 0.8, 0, 0, 0, height * 0.6, height * 0.6, 0.6 * (1 - t2), 0.5 * (1 - t2));
        }
        // Water column base: brief dome, then a dimple.
        if (burst && t < 0.08) {
          const d = 1 - t / 0.08;
          f.transientBatch.push(cx, cz, 1, 0, r * 0.55, r * 0.55, SHAPE_BLOB, 1, 0.3, 0.2, 0, 0, 1.3 * s * d, 0, 0.9, 1);
        } else if (t < 0.32) {
          const d = 1 - t / 0.32;
          f.transientBatch.push(cx, cz, 1, 0, r * 0.45, r * 0.45, SHAPE_BLOB, 1, 0.3, 0.2, 0, 0, 0, 0.9 * s * d, 0.85 * d, 0.9);
        }
        if (first) {
          f.persistentBatch.push(cx, cz, 1, 0, r * (burst ? 0.75 : 0.6), r * (burst ? 0.75 : 0.6), SHAPE_BLOB, 1, 0.65, 0.3, 0, 0, 0, 0, Math.min(1.15, 0.9 * s), 1);
          f.persistentBatch.push(cx, cz, 1, 0, r * 1.15, r * 1.15, SHAPE_BLOB, 1, 0.5, 0.2, 0, 0, 0, 0, 0, 1);
        }
        f.persistentBatch.push(cx, cz, 1, 0, R + W * 3, R + W * 3, SHAPE_RING, R, W, 0, 0, 0, 0, 0, 0.35 * k, 0.4 * k);
        break;
      }
      case EFFECT_RING:
      case EFFECT_SHOCK: {
        const shock = this.etype[i] === EFFECT_SHOCK;
        const R = r * (shock ? Math.pow(easeOut(t), 0.85) : easeOut(t)) + 1;
        const W = shock ? 1.4 + r * 0.03 : 0.6 + r * 0.06;
        const k = 1 - t;
        const height = Math.min(2.5, (shock ? 0.9 : 0.5) * s * Math.pow(k, 1.5));
        f.transientBatch.push(cx, cz, 1, 0, R + W * 3, R + W * 3, SHAPE_RING, R, W, 0, 0, 0, height, height, Math.min(1, (shock ? 1 : 0.8) * s) * k, 0.7 * k);
        f.persistentBatch.push(cx, cz, 1, 0, R + W * 3, R + W * 3, SHAPE_RING, R, W, 0, 0, 0, 0, 0, (shock ? 0.5 : 0.3) * k, 0.45 * k);
        break;
      }
      case EFFECT_FOAM:
        f.persistentBatch.push(cx, cz, 1, 0, r, r, SHAPE_BLOB, 1, 0.6, 0.3, 0, 0, 0, 0, Math.min(1.2, s), Math.min(1, s));
        f.transientBatch.push(cx, cz, 1, 0, r * 1.2, r * 1.2, SHAPE_BLOB, 1, 0.3, 0.2, 0, 0, 0, 0, 0, Math.min(1, s));
        break;
      case EFFECT_DISPLACE: {
        const k = (1 - t) * (1 - t);
        const h = Math.abs(s) * k;
        f.transientBatch.push(cx, cz, 1, 0, r, r, SHAPE_BLOB, 1.5, 0, 0, 0, 0, s > 0 ? h : 0, s < 0 ? h : 0, 0, Math.min(1, h * 0.5));
        break;
      }
      case EFFECT_WAKE: {
        const dx = this.edx[i]!;
        const dz = this.edz[i]!;
        const len = Math.max(r * 1.5, 2.5);
        this.capsule(true, x - dx * len, z - dz * len, x, z, r * 0.5, 0.45, Math.min(1.2, s), Math.min(1, s), 0.3);
        f.transientBatch.push(cx, cz, dx, dz, r * 0.8, r * 0.6, SHAPE_BLOB, 1, 0.4, 0.2, 0, 0, 0, 0, 0.8 * Math.min(1, s), 0.6 * Math.min(1, s));
        break;
      }
      default:
        break;
    }
  }

  private removeParticle(i: number): void {
    const last = --this.pn;
    if (i === last) return;
    this.px[i] = this.px[last]!; this.pz[i] = this.pz[last]!; this.pvx[i] = this.pvx[last]!; this.pvz[i] = this.pvz[last]!;
    this.pdx[i] = this.pdx[last]!; this.pdz[i] = this.pdz[last]!; this.page[i] = this.page[last]!; this.plife[i] = this.plife[last]!;
    this.plen[i] = this.plen[last]!; this.pwid[i] = this.pwid[last]!; this.pstr[i] = this.pstr[last]!; this.praise[i] = this.praise[last]!;
  }

  private removeEffect(i: number): void {
    const last = --this.en;
    if (i === last) return;
    this.etype[i] = this.etype[last]!; this.ex[i] = this.ex[last]!; this.ez[i] = this.ez[last]!; this.er[i] = this.er[last]!;
    this.es[i] = this.es[last]!; this.eage[i] = this.eage[last]!; this.elife[i] = this.elife[last]!;
    this.edx[i] = this.edx[last]!; this.edz[i] = this.edz[last]!;
  }

  /** Drops all particles/effects/tracks (e.g. new run). */
  clear(): void {
    this.pn = 0;
    this.en = 0;
    for (const track of this.tracks) { this.trackByKey.delete(track.key); this.trackPool.push(track); }
    this.tracks.length = 0;
  }
}
