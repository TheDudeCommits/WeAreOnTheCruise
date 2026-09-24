/**
 * Pooled one-shot voices with per-category caps and priority stealing (AUDIO-owned).
 * Each voice owns a persistent node chain (filter → panner → gain → bus); a play only creates the
 * AudioBufferSourceNode (+ a tiny envelope gain so a stolen tail can fade out independently).
 */
import { CATEGORIES, CATEGORY_IDS, MAX_VOICES } from './categories';
import type { Mixer } from './mixer';
import type { CategoryId } from './types';

class Voice {
  readonly gain: GainNode;
  readonly panner: StereoPannerNode | null;
  readonly filter: BiquadFilterNode | null;
  readonly input: AudioNode;
  src: AudioBufferSourceNode | null = null;
  env: GainNode | null = null;
  cue = '';
  start = 0;
  end = 0;
  priority = 0;

  constructor(ctx: AudioContext, out: AudioNode, spatial: boolean) {
    this.gain = ctx.createGain();
    this.gain.connect(out);
    if (spatial) {
      this.panner = ctx.createStereoPanner();
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 20000;
      this.filter.Q.value = 0.4;
      this.filter.connect(this.panner).connect(this.gain);
      this.input = this.filter;
    } else {
      this.panner = null;
      this.filter = null;
      this.input = this.gain;
    }
  }

  busy(now: number): boolean {
    return this.src !== null && this.end > now;
  }
}

export interface VoiceParams {
  cue: string;
  when: number;
  gain: number;
  rate: number;
  pan: number;
  cutoff: number;
  priority: number;
}

export type DropReason = 'cap' | 'global-cap';

export class VoicePool {
  private readonly voices: Record<CategoryId, Voice[]>;
  steals = 0;
  readonly drops: Record<DropReason, number> = { cap: 0, 'global-cap': 0 };
  lastDrop: DropReason | null = null;

  constructor(private readonly ctx: AudioContext, mixer: Mixer) {
    const voices = {} as Record<CategoryId, Voice[]>;
    for (const id of CATEGORY_IDS) {
      const spec = CATEGORIES[id];
      const out = mixer.bus(spec.bus);
      // Ambience beds run on dedicated loop voices (ambience.ts); two one-shot voices remain for previews.
      const count = id === 'ambience' ? 2 : spec.cap;
      voices[id] = Array.from({ length: count }, () => new Voice(ctx, out, spec.spatial));
    }
    this.voices = voices;
  }

  active(category: CategoryId, now = this.ctx.currentTime): number {
    let n = 0;
    for (const v of this.voices[category]) if (v.busy(now)) n++;
    return n;
  }

  activeAll(now = this.ctx.currentTime): Record<CategoryId, number> {
    const out = {} as Record<CategoryId, number>;
    for (const id of CATEGORY_IDS) out[id] = this.active(id, now);
    return out;
  }

  total(now = this.ctx.currentTime): number {
    let n = 0;
    for (const id of CATEGORY_IDS) n += this.active(id, now);
    return n;
  }

  /** Starts a buffer on a voice of the category. Returns false if the cue lost the priority contest. */
  play(buffer: AudioBuffer, category: CategoryId, p: VoiceParams): boolean {
    const now = this.ctx.currentTime;
    const list = this.voices[category];
    this.lastDrop = null;
    if (this.total(now) >= MAX_VOICES && p.priority < 60) { this.drops['global-cap']++; this.lastDrop = 'global-cap'; return false; }
    let voice: Voice | null = null;
    for (const v of list) if (!v.busy(now)) { voice = v; break; }
    if (!voice) {
      // Steal the weakest voice: low priority and near its end goes first.
      let best: Voice | null = null, bestScore = Infinity;
      for (const v of list) {
        const len = Math.max(0.05, v.end - v.start);
        const remaining = Math.min(1, Math.max(0, (v.end - now) / len));
        const score = v.priority * (0.35 + 0.65 * remaining);
        if (score < bestScore) { bestScore = score; best = v; }
      }
      if (!best || p.priority < bestScore) { this.drops.cap++; this.lastDrop = 'cap'; return false; }
      this.release(best, now, true);
      voice = best;
      this.steals++;
    }
    this.startOn(voice, buffer, p);
    return true;
  }

  stopAll(fade = 0.08): void {
    const now = this.ctx.currentTime;
    for (const id of CATEGORY_IDS) for (const v of this.voices[id]) if (v.src) this.release(v, now, true, fade);
  }

  dispose(): void {
    this.stopAll(0.01);
    for (const id of CATEGORY_IDS) for (const v of this.voices[id]) {
      for (const n of [v.gain, v.panner, v.filter]) { try { n?.disconnect(); } catch { /* noop */ } }
    }
  }

  private startOn(v: Voice, buffer: AudioBuffer, p: VoiceParams): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = p.rate;
    const env = ctx.createGain();
    src.connect(env).connect(v.input);
    const when = Math.max(ctx.currentTime, p.when);
    v.gain.gain.setValueAtTime(p.gain, when);
    if (v.panner) v.panner.pan.setValueAtTime(p.pan, when);
    if (v.filter) v.filter.frequency.setValueAtTime(p.cutoff, when);
    v.src = src;
    v.env = env;
    v.cue = p.cue;
    v.start = when;
    v.end = when + buffer.duration / Math.max(0.05, p.rate);
    v.priority = p.priority;
    src.onended = () => {
      try { src.disconnect(); env.disconnect(); } catch { /* noop */ }
      if (v.src === src) { v.src = null; v.env = null; v.cue = ''; }
    };
    src.start(when);
  }

  private release(v: Voice, now: number, fade: boolean, fadeTime = 0.03): void {
    const src = v.src, env = v.env;
    v.src = null; v.env = null; v.cue = '';
    if (!src || !env) return;
    try {
      if (fade) {
        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(env.gain.value, now);
        env.gain.linearRampToValueAtTime(0, now + fadeTime);
        src.stop(now + fadeTime + 0.01);
      } else src.stop(now);
    } catch { /* already stopped */ }
  }
}
