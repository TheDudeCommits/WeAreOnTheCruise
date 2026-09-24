/**
 * Continuous loops driven by RunState (AUDIO-owned): ocean bed, bow-wash tied to ship speed, wind tied to
 * sea.windStrength, rain tied to sea.rain, harbour bed in menus, and positional fire / whirlpool loops that
 * follow the nearest burning ships and whirlpools. Round 2: the Maelstrom's drone (from its nearest edge), the surf
 * roar of an approaching rogue wave (from the nearest point of its front), and two loops on the player's own hull set
 * by the router's state diffs (watch.ts): the harpoon line creaking and wisps draining the hull.
 * Also schedules sparse one-shots (gulls, hull creaks, distant thunder) so the sea never sounds like a steady hiss.
 */
import type { RunState } from '../game/types';
import type { AppScreen } from '../render/frame';
import { distanceGain, smoothstep, type ListenerFrame } from './spatial';
import type { PlayOptions } from './types';

export type BedId = 'amb-ocean' | 'amb-bow-wash' | 'amb-wind' | 'amb-rain' | 'amb-harbor';
export type SpotId = 'amb-fire' | 'amb-whirlpool' | 'amb-maelstrom' | 'amb-surf';
export type HullLoopId = 'amb-rope' | 'amb-wisp';
export type OneShotCue = 'gull' | 'hull-creak' | 'thunder-far';

export interface AmbienceHooks {
  buffer(cue: string): AudioBuffer | null;
  cueGain(cue: string): number;
  play(cue: OneShotCue, opts: PlayOptions): void;
}

class LoopVoice {
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode;
  readonly panner: StereoPannerNode | null;
  private src: AudioBufferSourceNode | null = null;
  level = 0;
  /** Assigned emitter (0 = free). */
  key = 0;

  constructor(private readonly ctx: AudioContext, out: AudioNode, positional: boolean) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.panner = positional ? ctx.createStereoPanner() : null;
    if (this.panner) this.filter.connect(this.panner).connect(this.gain);
    else this.filter.connect(this.gain);
    this.gain.connect(out);
  }

  get started(): boolean { return this.src !== null; }

  start(buffer: AudioBuffer, offsetFraction: number): void {
    if (this.src) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.filter);
    src.start(this.ctx.currentTime, (offsetFraction % 1) * buffer.duration);
    this.src = src;
  }

  private lastRate = 1;
  private lastCutoff = 20000;
  private lastPan = 0;

  /** Automation is only scheduled when a target really moves (keeps AudioParam timelines short). */
  set(level: number, now: number, tau = 0.25): void {
    const unchanged = Math.abs(level - this.level) < 0.002 && (level === 0) === (this.level === 0);
    if (unchanged) return;
    this.level = level;
    this.gain.gain.setTargetAtTime(level, now, tau);
  }

  rate(r: number, now: number): void {
    if (!this.src || Math.abs(r - this.lastRate) < 0.004) return;
    this.lastRate = r;
    this.src.playbackRate.setTargetAtTime(r, now, 0.3);
  }

  cutoff(hz: number, now: number, tau: number): void {
    if (Math.abs(hz - this.lastCutoff) < this.lastCutoff * 0.02) return;
    this.lastCutoff = hz;
    this.filter.frequency.setTargetAtTime(hz, now, tau);
  }

  pan(p: number, now: number): void {
    if (!this.panner || Math.abs(p - this.lastPan) < 0.01) return;
    this.lastPan = p;
    this.panner.pan.setTargetAtTime(p, now, 0.1);
  }

  stop(): void {
    try { this.src?.stop(); this.src?.disconnect(); } catch { /* noop */ }
    this.src = null;
  }

  dispose(): void {
    this.stop();
    for (const n of [this.gain, this.filter, this.panner]) { try { n?.disconnect(); } catch { /* noop */ } }
  }
}

/** key: enemy id (> 0) or −hazard id. */
interface SpotSource { key: number; x: number; z: number; weight: number }

const BEDS: readonly BedId[] = ['amb-ocean', 'amb-bow-wash', 'amb-wind', 'amb-rain', 'amb-harbor'];
const SPOT_IDS: readonly SpotId[] = ['amb-fire', 'amb-whirlpool', 'amb-maelstrom', 'amb-surf'];
const SPOT_SLOTS: Record<SpotId, number> = { 'amb-fire': 3, 'amb-whirlpool': 2, 'amb-maelstrom': 1, 'amb-surf': 2 };
const SPOT_RANGE: Record<SpotId, { ref: number; max: number }> = {
  'amb-fire': { ref: 30, max: 260 },
  'amb-whirlpool': { ref: 45, max: 320 },
  'amb-maelstrom': { ref: 90, max: 650 },
  'amb-surf': { ref: 70, max: 480 },
};
const HULL_LOOPS: readonly HullLoopId[] = ['amb-rope', 'amb-wisp'];

export class AmbienceController {
  private readonly beds = new Map<BedId, LoopVoice>();
  private readonly spots: Record<SpotId, LoopVoice[]>;
  private readonly hull = new Map<HullLoopId, LoopVoice>();
  private readonly hullTarget: Record<HullLoopId, number> = { 'amb-rope': 0, 'amb-wisp': 0 };
  private readonly spotScratch: SpotSource[] = [];
  private readonly spotPool: SpotSource[] = [];
  private spotUsed = 0;
  private nextGull = 6;
  private nextCreak = 5;
  private nextThunder = 12;
  private clock = 0;
  /** Debug readout of current bed/spot levels. */
  readonly levels: Record<string, number> = {};

  constructor(ctx: AudioContext, out: AudioNode, private readonly hooks: AmbienceHooks) {
    for (const id of BEDS) this.beds.set(id, new LoopVoice(ctx, out, false));
    const slots = (id: SpotId): LoopVoice[] => Array.from({ length: SPOT_SLOTS[id] }, () => new LoopVoice(ctx, out, true));
    this.spots = { 'amb-fire': slots('amb-fire'), 'amb-whirlpool': slots('amb-whirlpool'), 'amb-maelstrom': slots('amb-maelstrom'), 'amb-surf': slots('amb-surf') };
    for (const id of HULL_LOOPS) this.hull.set(id, new LoopVoice(ctx, out, false));
  }

  update(now: number, dt: number, screen: AppScreen, run: Readonly<RunState> | null, l: ListenerFrame): void {
    this.clock += dt;
    const inRun = screen === 'run' && !!run;
    const menu = screen === 'title' || screen === 'harbor';
    const targets: Record<BedId, number> = { 'amb-ocean': 0, 'amb-bow-wash': 0, 'amb-wind': 0, 'amb-rain': 0, 'amb-harbor': 0 };
    let washRate = 1, windCutoff = 2500;
    if (menu) {
      targets['amb-ocean'] = 0.4;
      targets['amb-harbor'] = screen === 'harbor' ? 0.85 : 0.55;
      targets['amb-wind'] = 0.12;
    } else if (screen === 'results') {
      targets['amb-ocean'] = 0.35;
    } else if (inRun && run) {
      const p = run.player, sea = run.sea;
      const alive = p.alive || run.status === 'running';
      const boosting = p.skills.boost.active > 0;
      const speedN = Math.min(1.5, Math.abs(p.speed) / 24);
      const submerged = p.submerged > 0.3;
      targets['amb-ocean'] = (0.5 + 0.3 * smoothstep(0.7, 1.7, sea.waveScale)) * (submerged ? 0.35 : 1);
      targets['amb-bow-wash'] = alive ? (0.85 * smoothstep(0.04, 0.85, speedN) + (boosting ? 0.15 : 0)) * (p.airborne > 0.3 ? 0.2 : 1) : 0;
      washRate = 0.82 + 0.3 * Math.min(1.2, speedN) + (boosting ? 0.06 : 0);
      targets['amb-wind'] = (0.1 + 0.55 * sea.windStrength * sea.windStrength + (boosting ? 0.22 : 0)) * (submerged ? 0.2 : 1);
      windCutoff = 700 + 5200 * Math.min(1, sea.windStrength + (boosting ? 0.2 : 0));
      targets['amb-rain'] = 0.8 * sea.rain * (submerged ? 0.3 : 1);
      this.scheduleOneShots(run, l);
    }
    if (menu && this.clock > this.nextGull) {
      this.nextGull = this.clock + 5 + Math.random() * 9;
      const a = Math.random() * Math.PI * 2, r = 50 + Math.random() * 120;
      this.hooks.play('gull', { x: l.x + Math.sin(a) * r, z: l.z + Math.cos(a) * r, gain: 0.45 + Math.random() * 0.25 });
    }

    for (const id of BEDS) {
      const v = this.beds.get(id)!;
      const target = targets[id] * this.hooks.cueGain(id);
      if (!v.started) {
        if (target <= 0) continue;
        const buf = this.hooks.buffer(id);
        if (!buf) continue;
        v.start(buf, Math.random());
      }
      v.set(target, now, id === 'amb-bow-wash' ? 0.35 : 0.8);
      if (id === 'amb-bow-wash') v.rate(washRate, now);
      if (id === 'amb-wind') v.cutoff(windCutoff, now, 0.5);
      this.levels[id] = +target.toFixed(3);
    }

    for (const id of SPOT_IDS) this.updateSpots(id, now, inRun ? run : null, l);

    const running = inRun && run?.status === 'running';
    for (const id of HULL_LOOPS) {
      const v = this.hull.get(id)!;
      const target = running ? this.hullTarget[id] * this.hooks.cueGain(id) : 0;
      if (!v.started) {
        if (target <= 0) continue;
        const buf = this.hooks.buffer(id);
        if (!buf) continue;
        v.start(buf, Math.random());
      }
      v.set(target, now, target > v.level ? 0.12 : 0.35);
      this.levels[id] = +target.toFixed(3);
    }
  }

  /** Loops on the player's hull (0..1): the harpoon line and the wisps draining it (watch.ts sets them each frame). */
  setHullLoops(rope: number, wisp: number): void {
    this.hullTarget['amb-rope'] = rope * 0.7;
    this.hullTarget['amb-wisp'] = wisp * 0.65;
  }

  /** Stops every loop (e.g. when the audio engine is disposed). */
  dispose(): void {
    for (const v of this.beds.values()) v.dispose();
    for (const list of Object.values(this.spots)) for (const v of list) v.dispose();
    for (const v of this.hull.values()) v.dispose();
  }

  private scheduleOneShots(run: Readonly<RunState>, l: ListenerFrame): void {
    if (run.status !== 'running') return;
    const p = run.player, sea = run.sea;
    const day = sea.timeOfDay > 6 && sea.timeOfDay < 19.5;
    if (this.clock > this.nextGull) {
      this.nextGull = this.clock + 9 + Math.random() * 14;
      if (day && (sea.weather === 'clear' || sea.weather === 'breezy') && sea.rain < 0.2) {
        const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 150;
        this.hooks.play('gull', { x: l.x + Math.sin(a) * r, z: l.z + Math.cos(a) * r, gain: 0.5 + Math.random() * 0.3 });
      }
    }
    if (this.clock > this.nextCreak) {
      const lowHull = p.hp < p.maxHp * 0.3;
      const turning = Math.abs(p.yawRate) > 0.22 || sea.waveScale > 1.25;
      this.nextCreak = this.clock + (lowHull ? 3 + Math.random() * 3 : 6 + Math.random() * 8);
      if (p.alive && (turning || lowHull)) this.hooks.play('hull-creak', { gain: lowHull ? 0.75 : 0.45, pitch: lowHull ? -2 : 0 });
    }
    if (this.clock > this.nextThunder) {
      this.nextThunder = this.clock + 10 + Math.random() * 16;
      if (sea.rain > 0.45) {
        const a = Math.random() * Math.PI * 2, r = 350 + Math.random() * 600;
        this.hooks.play('thunder-far', { x: l.x + Math.sin(a) * r, z: l.z + Math.cos(a) * r, gain: 0.6 + Math.random() * 0.4 });
      }
    }
  }

  /** Candidate emitters within range, strongest first. Reuses pooled records (no per-frame allocation). */
  private collect(kind: SpotId, run: Readonly<RunState>, l: ListenerFrame): SpotSource[] {
    const out = this.spotScratch;
    out.length = 0;
    this.spotUsed = 0;
    const range = SPOT_RANGE[kind].max, ref = SPOT_RANGE[kind].ref;
    if (kind === 'amb-fire') {
      for (const e of run.enemies) {
        if (e.life === 'dead') continue;
        let burning = false;
        for (const st of e.statuses) if (st.kind === 'burning' && st.time > 0) { burning = true; break; }
        if (burning) this.consider(out, e.id, e.x, e.z, 1, l, ref, range);
      }
      for (const h of run.hazards) if (h.alive && (h.kind === 'fire-patch' || h.kind === 'burning-wreck')) this.consider(out, -h.id, h.x, h.z, h.kind === 'burning-wreck' ? 1.1 : 0.8, l, ref, range);
    } else if (kind === 'amb-whirlpool') {
      for (const h of run.hazards) if (h.alive && h.kind === 'whirlpool') this.consider(out, -h.id, h.x, h.z, 1, l, ref, range);
    } else if (kind === 'amb-maelstrom') {
      // Heard from its nearest edge (inside it, all around the ship); swells in and out with the vortex.
      for (const h of run.hazards) {
        if (!h.alive || h.kind !== 'maelstrom') continue;
        const dx = l.x - h.x, dz = l.z - h.z, d = Math.hypot(dx, dz) || 1;
        const k = Math.min(d, h.radius * 0.75) / d;
        const env = Math.max(0, Math.min(1, h.age / 3, (h.ttl - h.age) / 3));
        this.consider(out, -h.id, h.x + dx * k, h.z + dz * k, 1.2 * env, l, ref, range);
      }
    } else {
      // A rogue wave's face: the nearest point along its crest, rising as it builds.
      for (const h of run.hazards) {
        if (!h.alive || h.kind !== 'rogue-wave') continue;
        const sp = Math.hypot(h.vx, h.vz) || 1;
        const px = h.vz / sp, pz = -h.vx / sp;
        const lat = Math.max(-h.radius, Math.min(h.radius, (l.x - h.x) * px + (l.z - h.z) * pz));
        const rise = Math.min(1, h.age / 2.5);
        this.consider(out, -h.id, h.x + px * lat, h.z + pz * lat, 1.3 * rise, l, ref, range);
      }
    }
    out.sort((a, b) => b.weight - a.weight);
    return out;
  }

  private consider(out: SpotSource[], key: number, x: number, z: number, weight: number, l: ListenerFrame, ref: number, range: number): void {
    const d = Math.hypot(x - l.x, z - l.z);
    if (d >= range) return;
    let rec = this.spotPool[this.spotUsed];
    if (!rec) { rec = { key: 0, x: 0, z: 0, weight: 0 }; this.spotPool.push(rec); }
    this.spotUsed++;
    rec.key = key; rec.x = x; rec.z = z; rec.weight = weight * distanceGain(d, ref, 1, range);
    out.push(rec);
  }

  private updateSpots(kind: SpotId, now: number, run: Readonly<RunState> | null, l: ListenerFrame): void {
    const slots = this.spots[kind];
    const sources = run ? this.collect(kind, run, l) : this.spotScratch;
    if (!run) sources.length = 0;
    const n = Math.min(sources.length, slots.length);
    const cueGain = this.hooks.cueGain(kind);
    // Keep existing assignments stable; free slots whose source vanished.
    for (const v of slots) {
      if (!v.key) continue;
      let kept = false;
      for (let i = 0; i < n; i++) if (sources[i]!.key === v.key) { kept = true; break; }
      if (!kept) { v.key = 0; v.set(0, now, 0.35); }
    }
    for (let i = 0; i < n; i++) {
      const s = sources[i]!;
      let v: LoopVoice | undefined;
      for (const x of slots) if (x.key === s.key) { v = x; break; }
      if (!v) {
        for (const x of slots) if (!x.key) { v = x; break; }
        if (!v) continue;
        v.key = s.key;
      }
      if (!v.started) {
        const buf = this.hooks.buffer(kind);
        if (!buf) continue;
        v.start(buf, Math.random());
      }
      const dx = s.x - l.x, dz = s.z - l.z, d = Math.hypot(dx, dz) || 1;
      const pan = Math.max(-0.85, Math.min(0.85, ((dx * l.rightX + dz * l.rightZ) / d) * 0.9 * smoothstep(4, 30, d)));
      v.pan(pan, now);
      v.cutoff(20000 * Math.pow(2, -3 * smoothstep(60, SPOT_RANGE[kind].max, d)), now, 0.2);
      v.set(Math.min(1, s.weight) * 0.8 * cueGain, now, 0.2);
    }
    let sum = 0;
    for (const v of slots) sum += v.level;
    this.levels[kind] = +sum.toFixed(3);
  }
}
