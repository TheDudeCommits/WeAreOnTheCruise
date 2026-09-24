/**
 * Bus graph, ducking and master protection (AUDIO-owned).
 *
 *   ui ──────────────────────────────────────────────┐
 *   worldDucked ─(sfx duck)─┐                         │
 *   world ──────────────────┴─ worldBus ─┐            │
 *   ambience ─(ambience duck)────────────┴─ pause LPF ┴─ sfx (volume) ─ glue comp ─┐
 *   music tracks ─ musicMix ─(music duck)─┐                                        │
 *   stingers ─────────────────────────────┴─ music (volume) ───────────────────────┴─ master ─ limiter ─ out
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

export class Mixer {
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
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
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master = g();
    this.master.connect(this.limiter).connect(ctx.destination);

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

  /** Post-limiter analyser (lab meters / QA evidence that sound is flowing). */
  tap(): AnalyserNode {
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.limiter.connect(this.analyser);
    }
    return this.analyser;
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
    if (Math.abs(music - this.duckLevels.music) > 1e-3 || music < 1) this.musicDuck.gain.setTargetAtTime(music, now, tau);
    if (Math.abs(sfx - this.duckLevels.sfx) > 1e-3 || sfx < 1) this.worldDucked.gain.setTargetAtTime(sfx, now, tau);
    if (Math.abs(amb - this.duckLevels.ambience) > 1e-3 || amb < 1) this.ambience.gain.setTargetAtTime(amb, now, tau);
    this.duckLevels.music = music; this.duckLevels.sfx = sfx; this.duckLevels.ambience = amb;
  }

  dispose(): void {
    for (const n of [this.analyser, this.master, this.limiter, this.sfx, this.glue, this.music, this.musicMix, this.musicDuck, this.ui, this.world, this.worldDucked, this.ambience, this.pauseFilter, this.pauseGain, this.worldBus]) {
      try { n?.disconnect(); } catch { /* already disconnected */ }
    }
  }
}
