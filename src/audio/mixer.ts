/**
 * Bus graph, ducking and master protection (AUDIO-owned).
 *
 *   ui ──────────────────────────────────────────────┐
 *   worldDucked ─(sfx duck)─┐                         │
 *   world ──────────────────┴─ worldBus ─┐            │
 *   ambience ─(ambience duck)────────────┴─ pause LPF ┴─ sfx (volume) ─ glue comp ─┐
 *   music tracks ─ musicMix ─(music duck)─┐                                        │
 *   stingers ─────────────────────────────┴─ music (volume) ───────────────────────┴─ master ─ makeup ─ limiter ─ ceiling ─ out
 *
 * Loudness (round 2): the assets are normalized per category by the build (one-shots by max 100 ms RMS −13 dBFS,
 * UI −17, beds −21 LUFS, music −16 LUFS, stingers −15 LUFS) and balanced by cue gains; MAKEUP_DB lifts the whole mix
 * toward ≈ −18 LUFS in a fight at the default volumes, the limiter holds the peaks and a soft ceiling keeps every
 * sample under −1 dBFS. K-weighted meters on the master, music and SFX buses measure it (lab and QA).
 */
import type { BusId } from './categories';
import type { DuckSpec } from './types';

interface ActiveDuck {
  target: DuckSpec['target'];
  depth: number; // linear floor (0..1)
  start: number;
  attack: number;
  hold: number;
  release: number;
}

export type PauseMode = 'none' | 'menu' | 'paused';

/** Perceptual volume curve for 0..1 sliders. */
export const volumeCurve = (v: number): number => {
  const x = Math.min(1, Math.max(0, v));
  return x * x;
};

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** Whole-mix makeup gain before the limiter (dB). */
export const MAKEUP_DB = 5;
/** Hard ceiling after the limiter (dBFS). */
export const CEILING_DB = -1;

/** Soft-knee ceiling: linear below 80% of the ceiling, then a tanh shoulder that never exceeds it. */
function ceilingCurve(ceilingDb: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = dbToGain(ceilingDb), knee = c * 0.8, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    const y = a <= knee ? a : knee + (c - knee) * Math.tanh((a - knee) / (c - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/** A K-weighted meter (ITU-R BS.1770 pre-filter approximated with two biquads) on one node. */
interface KMeter { hp: BiquadFilterNode; shelf: BiquadFilterNode; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> }

export class Mixer {
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly makeup: GainNode;
  readonly ceiling: WaveShaperNode;
  private readonly kMeters = new Map<'master' | 'music' | 'sfx', KMeter>();
  readonly sfx: GainNode;
  readonly glue: DynamicsCompressorNode;
  readonly music: GainNode;
  readonly musicMix: GainNode;
  readonly musicDuck: GainNode;
  readonly ui: GainNode;
  readonly world: GainNode;
  readonly worldDucked: GainNode;
  readonly ambience: GainNode;
  readonly pauseFilter: BiquadFilterNode;
  readonly pauseGain: GainNode;
  private readonly worldBus: GainNode;
  private analyser: AnalyserNode | null = null;
  private readonly ducks: ActiveDuck[] = [];
  private pauseMode: PauseMode = 'none';
  /** Last applied duck values (debug readout). */
  readonly duckLevels = { music: 1, sfx: 1, ambience: 1 };

  constructor(private readonly ctx: AudioContext) {
    const g = (value = 1): GainNode => { const n = ctx.createGain(); n.gain.value = value; return n; };
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 1;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.1;
    this.ceiling = ctx.createWaveShaper();
    this.ceiling.curve = ceilingCurve(CEILING_DB);
    this.ceiling.oversample = '2x';
    this.makeup = g(dbToGain(MAKEUP_DB));
    this.master = g();
    this.master.connect(this.makeup).connect(this.limiter).connect(this.ceiling).connect(ctx.destination);

    // SFX: gentle glue compression (2:1, soft knee, slow-ish release) so fleet fights don't pump.
    this.glue = ctx.createDynamicsCompressor();
    this.glue.threshold.value = -16;
    this.glue.knee.value = 12;
    this.glue.ratio.value = 2;
    this.glue.attack.value = 0.008;
    this.glue.release.value = 0.25;
    this.sfx = g();
    this.sfx.connect(this.glue).connect(this.master);

    this.pauseFilter = ctx.createBiquadFilter();
    this.pauseFilter.type = 'lowpass';
    this.pauseFilter.frequency.value = 20000;
    this.pauseFilter.Q.value = 0.5;
    this.pauseGain = g();
    this.pauseFilter.connect(this.pauseGain).connect(this.sfx);

    this.worldBus = g();
    this.worldBus.connect(this.pauseFilter);
    this.world = g();
    this.world.connect(this.worldBus);
    this.worldDucked = g();
    this.worldDucked.connect(this.worldBus);
    this.ambience = g();
    this.ambience.connect(this.pauseFilter);
    this.ui = g();
    this.ui.connect(this.sfx);

    this.music = g();
    this.music.connect(this.master);
    this.musicDuck = g();
    this.musicDuck.connect(this.music);
    this.musicMix = g();
    this.musicMix.connect(this.musicDuck);
  }

  /** Post-ceiling analyser (lab meters / QA evidence that sound is flowing). */
  tap(): AnalyserNode {
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.ceiling.connect(this.analyser);
    }
    return this.analyser;
  }

  /**
   * Short-term K-weighted level (LUFS-like, 85 ms window) of the output ('master', after the ceiling) or of a bus
   * ('music' after its volume and ducks, 'sfx' after its volume and glue). Meters are created on first use.
   */
  kLevel(which: 'master' | 'music' | 'sfx'): number {
    let m = this.kMeters.get(which);
    if (!m) {
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
      const shelf = this.ctx.createBiquadFilter();
      shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4;
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 4096;
      const src: AudioNode = which === 'master' ? this.ceiling : which === 'music' ? this.music : this.glue;
      src.connect(hp); hp.connect(shelf).connect(analyser);
      m = { hp, shelf, analyser, buf: new Float32Array(analyser.fftSize) };
      this.kMeters.set(which, m);
    }
    m.analyser.getFloatTimeDomainData(m.buf);
    let sum = 0;
    for (let i = 0; i < m.buf.length; i++) sum += m.buf[i]! * m.buf[i]!;
    return -0.691 + 10 * Math.log10(sum / m.buf.length + 1e-12);
  }

  bus(id: BusId): AudioNode {
    switch (id) {
      case 'ui': return this.ui;
      case 'music': return this.music;
      case 'world': return this.world;
      case 'worldDucked': return this.worldDucked;
      case 'ambience': return this.ambience;
    }
  }

  setVolumes(master: number, music: number, sfx: number, muted: boolean): void {
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : volumeCurve(master), now, 0.03);
    this.music.gain.setTargetAtTime(volumeCurve(music), now, 0.03);
    this.sfx.gain.setTargetAtTime(volumeCurve(sfx), now, 0.03);
  }

  duck(spec: DuckSpec, now: number): void {
    const depth = dbToGain(Math.min(0, spec.depth));
    // Re-trigger instead of stacking identical ducks.
    const same = this.ducks.find((d) => d.target === spec.target && Math.abs(d.depth - depth) < 1e-3);
    const entry: ActiveDuck = { target: spec.target, depth, start: now, attack: spec.attack ?? 0.06, hold: spec.hold, release: spec.release ?? 0.8 };
    if (same) Object.assign(same, entry);
    else this.ducks.push(entry);
  }

  setPauseMode(mode: PauseMode): void {
    if (mode === this.pauseMode) return;
    this.pauseMode = mode;
    const now = this.ctx.currentTime;
    const cutoff = mode === 'paused' ? 650 : mode === 'menu' ? 1500 : 20000;
    const level = mode === 'paused' ? 0.5 : mode === 'menu' ? 0.7 : 1;
    this.pauseFilter.frequency.setTargetAtTime(cutoff, now, mode === 'none' ? 0.12 : 0.06);
    this.pauseGain.gain.setTargetAtTime(level, now, 0.08);
  }

  /** Applies duck envelopes (called once per frame). */
  update(now: number): void {
    let music = 1, sfx = 1, amb = 1;
    for (let i = this.ducks.length - 1; i >= 0; i--) {
      const d = this.ducks[i]!;
      const t = now - d.start;
      let env: number;
      if (t < d.attack) env = t / d.attack;
      else if (t < d.attack + d.hold) env = 1;
      else if (t < d.attack + d.hold + d.release) env = 1 - (t - d.attack - d.hold) / d.release;
      else { this.ducks.splice(i, 1); continue; }
      const v = 1 - (1 - d.depth) * Math.max(0, env);
      if (d.target === 'music') music = Math.min(music, v);
      else if (d.target === 'sfx') sfx = Math.min(sfx, v);
      else amb = Math.min(amb, v);
    }
    const tau = 0.02;
    if (Math.abs(music - this.duckLevels.music) > 2e-3) this.musicDuck.gain.setTargetAtTime(music, now, tau);
    if (Math.abs(sfx - this.duckLevels.sfx) > 2e-3) this.worldDucked.gain.setTargetAtTime(sfx, now, tau);
    if (Math.abs(amb - this.duckLevels.ambience) > 2e-3) this.ambience.gain.setTargetAtTime(amb, now, tau);
    this.duckLevels.music = music; this.duckLevels.sfx = sfx; this.duckLevels.ambience = amb;
  }

  dispose(): void {
    for (const m of this.kMeters.values()) for (const n of [m.hp, m.shelf, m.analyser]) { try { n.disconnect(); } catch { /* noop */ } }
    for (const n of [this.analyser, this.master, this.makeup, this.limiter, this.ceiling, this.sfx, this.glue, this.music, this.musicMix, this.musicDuck, this.ui, this.world, this.worldDucked, this.ambience, this.pauseFilter, this.pauseGain, this.worldBus]) {
      try { n?.disconnect(); } catch { /* already disconnected */ }
    }
  }
}
