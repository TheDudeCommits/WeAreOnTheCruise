/**
 * Adaptive music (AUDIO-owned): streamed tracks (HTMLAudioElement → MediaElementAudioSourceNode, so long
 * tracks are never fully decoded), bar-synced equal-power crossfades, intensity hysteresis, and stingers.
 *
 * Rules: a track that fades out keeps playing silently for WARM_SECONDS, so flipping back resumes it
 * seamlessly (no restart); after that it pauses and later resumes from where it stopped.
 */
import type { EnemyId } from '../game/ids';
import type { RunState, SimEvent } from '../game/types';
import type { AppScreen } from '../render/frame';
import { smoothstep } from './spatial';
import type { MusicDef } from './types';

export type MusicState =
  | 'silent' | 'title' | 'harbor' | 'calm' | 'combat' | 'horde' | 'boss' | 'boss-final' | 'victory' | 'defeat' | 'results';

export const MUSIC_STATES: readonly MusicState[] = ['silent', 'title', 'harbor', 'calm', 'combat', 'horde', 'boss', 'boss-final', 'victory', 'defeat', 'results'];

const STATE_TRACK: Record<MusicState, string | null> = {
  silent: null, title: 'title', harbor: 'harbor', results: 'harbor',
  calm: 'run-calm', combat: 'run-combat', horde: 'run-horde', boss: 'boss', 'boss-final': 'boss-final',
  victory: null, defeat: null,
};

const WARM_SECONDS = 25;
const MIN_FADE = 1.6;

/** Relative threat of each enemy class for the intensity meter. */
const THREAT: Record<EnemyId, number> = {
  skiff: 0.45, cutter: 0.75, brig: 1, fireship: 1.3, 'mortar-barge': 1.2, frigate: 1.7, 'man-o-war': 2.6,
  'corsair-brig': 1.1, 'corsair-galleon': 2.1, wraith: 1.4, wyrmling: 1, fort: 1.4,
};

type ParamWithHold = AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };

/** Equal-power style fade from the current value to `to` (cancels pending automation first). */
export function fadeParam(param: AudioParam, to: number, duration: number, now: number): void {
  const p = param as ParamWithHold;
  const from = param.value;
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now);
  else { param.cancelScheduledValues(now); param.setValueAtTime(from, now); }
  if (duration <= 0.02 || Math.abs(to - from) < 1e-4) { param.setValueAtTime(to, now + 0.001); return; }
  const n = 24, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    curve[i] = to > from ? from + (to - from) * Math.sin((t * Math.PI) / 2) : to + (from - to) * Math.cos((t * Math.PI) / 2);
  }
  param.setValueCurveAtTime(curve, now + 0.002, duration);
}

/** One streamed track; non-seamless loops alternate two elements with a crossfade over the loop seam. */
class MusicTrack {
  readonly fader: GainNode;
  private readonly els: HTMLAudioElement[] = [];
  private readonly elGains: GainNode[] = [];
  private readonly nodes: MediaElementAudioSourceNode[] = [];
  private lead = 0;
  private seamUntil = 0;
  running = false;
  /** Seconds since this track was last audible (fader > 0). */
  silentSince = 0;
  level = 0;

  constructor(ctx: AudioContext, readonly key: string, readonly def: MusicDef, url: string, out: AudioNode) {
    this.fader = ctx.createGain();
    this.fader.gain.value = 0;
    this.fader.connect(out);
    const count = def.loop && !def.seamless ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const el = new Audio();
      el.preload = i === 0 ? 'auto' : 'metadata';
      el.src = url;
      el.loop = def.loop && !!def.seamless;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 1 : 0;
      const node = ctx.createMediaElementSource(el);
      node.connect(g).connect(this.fader);
      this.els.push(el); this.elGains.push(g); this.nodes.push(node);
    }
  }

  get element(): HTMLAudioElement { return this.els[this.lead]!; }

  position(): number { return this.element.currentTime; }

  duration(): number { const d = this.element.duration; return Number.isFinite(d) ? d : 0; }

  /** Seconds until the next beat/bar boundary (0 when unknown). */
  timeToNext(unitBeats: number): number {
    const bpm = this.def.bpm;
    if (!bpm || !this.running) return 0;
    const unit = (60 / bpm) * unitBeats;
    const pos = this.position() - (this.def.offset ?? 0);
    if (pos < 0) return -pos;
    return Math.ceil((pos + 0.03) / unit) * unit - pos;
  }

  barSeconds(): number {
    return this.def.bpm ? (60 / this.def.bpm) * (this.def.beatsPerBar ?? 4) : 2.5;
  }

  play(fromStart = false): void {
    const el = this.element;
    if (fromStart) { try { el.currentTime = this.def.loopStart ?? 0; } catch { /* not seekable yet */ } }
    this.running = true;
    el.play().catch(() => { this.running = false; });
  }

  pause(): void {
    for (const el of this.els) el.pause();
    this.running = false;
  }

  /** Handles the loop seam of non-seamless tracks. */
  update(now: number): void {
    if (!this.running) return;
    if (this.element.paused && !this.element.ended) { this.element.play().catch(() => undefined); }
    if (!this.def.loop) return;
    const dur = this.duration();
    if (this.els.length < 2) {
      if (this.element.ended) this.play(true);
      return;
    }
    if (now < this.seamUntil || dur <= 0) return;
    const xfade = this.def.loopCrossfade ?? 2;
    const loopEnd = Math.min(dur, this.def.loopEnd ?? dur);
    if (this.element.currentTime >= loopEnd - xfade || this.element.ended) {
      const outIdx = this.lead, inIdx = 1 - this.lead;
      const inEl = this.els[inIdx]!, outEl = this.els[outIdx]!;
      try { inEl.currentTime = this.def.loopStart ?? 0; } catch { /* noop */ }
      inEl.play().catch(() => undefined);
      fadeParam(this.elGains[inIdx]!.gain, 1, xfade, now);
      fadeParam(this.elGains[outIdx]!.gain, 0, xfade, now);
      this.lead = inIdx;
      this.seamUntil = now + xfade + 0.1;
      window.setTimeout(() => { if (this.lead !== outIdx) outEl.pause(); }, (xfade + 0.25) * 1000);
    }
  }

  dispose(): void {
    this.pause();
    for (const el of this.els) { el.removeAttribute('src'); el.load(); }
    for (const n of [...this.nodes, ...this.elGains, this.fader]) { try { n.disconnect(); } catch { /* noop */ } }
  }
}

export interface DirectorInput {
  now: number;
  dt: number;
  screen: AppScreen;
  run: Readonly<RunState> | null;
  events: readonly SimEvent[];
}

export interface DirectorHooks {
  /** Plays a stinger cue on the music bus; returns its length in seconds (0 if unavailable). */
  stinger(cue: 'stinger-victory' | 'stinger-defeat'): number;
}

export class MusicDirector {
  state: MusicState = 'silent';
  /** Lab override (null = automatic). */
  override: MusicState | null = null;
  /** Lab override of the intensity meter (null = measured). */
  intensityOverride: number | null = null;
  intensity = 0;
  rawIntensity = 0;
  private activity = 0;
  private current: MusicTrack | null = null;
  private readonly tracks = new Map<string, MusicTrack>();
  private pending: { state: MusicState; at: number; fade: number } | null = null;
  private runState: 'calm' | 'combat' | 'horde' = 'calm';
  private candidate: 'calm' | 'combat' | 'horde' | null = null;
  private candidateTime = 0;
  private dwell = 0;
  private stingerUntil = 0;
  private outcome: 'victory' | 'defeat' | 'retired' | null = null;
  private lastScreen: AppScreen = 'boot';
  private enabled = false;
  readonly transitions: { t: number; from: MusicState; to: MusicState }[] = [];

  constructor(
    private readonly ctx: AudioContext,
    private readonly defs: Record<string, MusicDef>,
    private readonly baseUrl: string,
    private readonly out: AudioNode,
    private readonly hooks: DirectorHooks,
  ) {}

  /** Starts working (after unlock). */
  enable(): void { this.enabled = true; }

  trackInfo(): { state: MusicState; track: string | null; position: number; level: number; intensity: number; runState: string; pending: string | null } {
    return {
      state: this.state, track: this.current?.key ?? null, position: +(this.current?.position() ?? 0).toFixed(2),
      level: +(this.current?.fader.gain.value ?? 0).toFixed(3), intensity: +this.intensity.toFixed(3), runState: this.runState,
      pending: this.pending ? `${this.pending.state}@${(this.pending.at - this.ctx.currentTime).toFixed(2)}s` : null,
    };
  }

  /** Preloads the tracks a screen is likely to need (media elements stream; nothing is played). */
  warm(keys: readonly string[]): void {
    for (const k of keys) this.track(k);
  }

  update(input: DirectorInput): void {
    const { now } = input;
    if (input.screen !== this.lastScreen) {
      if (input.screen === 'run') { this.outcome = null; this.runState = 'calm'; this.dwell = 0; this.intensity = 0; this.activity = 0; this.candidate = null; }
      this.lastScreen = input.screen;
    }
    this.measure(input);
    if (!this.enabled) return;
    const desired = this.override ?? this.desiredState(input);
    this.request(desired, now);
    if (this.pending && now >= this.pending.at) {
      const p = this.pending;
      this.pending = null;
      this.apply(p.state, p.fade, now);
    }
    for (const t of this.tracks.values()) {
      t.update(now);
      t.level = t.fader.gain.value;
      if (t !== this.current && t.running) {
        if (t.level < 0.002) { t.silentSince += input.dt; if (t.silentSince > WARM_SECONDS) t.pause(); }
        else t.silentSince = 0;
      }
    }
  }

  /** Forces a state immediately (lab). */
  force(state: MusicState | null): void {
    this.override = state;
    this.pending = null;
    if (state) this.apply(state, MIN_FADE, this.ctx.currentTime);
  }

  stopAll(): void {
    for (const t of this.tracks.values()) t.pause();
    this.current = null;
    this.state = 'silent';
  }

  /** Hidden tab: pause streaming elements; resume on show. */
  suspend(hidden: boolean): void {
    if (hidden) { for (const t of this.tracks.values()) if (t.running) { t.pause(); t.running = true; } }
    else { for (const t of this.tracks.values()) if (t.running) t.play(false); }
  }

  dispose(): void {
    for (const t of this.tracks.values()) t.dispose();
    this.tracks.clear();
    this.current = null;
  }

  // ───────────────────────── internals ─────────────────────────

  private track(key: string): MusicTrack | null {
    const existing = this.tracks.get(key);
    if (existing) return existing;
    const def = this.defs[key];
    if (!def) return null;
    const t = new MusicTrack(this.ctx, key, def, this.baseUrl + def.file, this.out);
    this.tracks.set(key, t);
    return t;
  }

  private desiredState(input: DirectorInput): MusicState {
    const { screen, run, now } = input;
    for (const e of input.events) {
      if (e.type === 'run-ended') this.outcome = e.outcome;
      if (e.type === 'player-died' && !e.reviving) this.outcome = 'defeat';
    }
    if (screen === 'boot') return 'silent';
    if (screen === 'title') return 'title';
    if (screen === 'harbor') return 'harbor';
    if (screen === 'results') return now < this.stingerUntil ? this.state : 'results';
    if (!run) return 'silent';
    if (this.outcome === 'victory' || run.status === 'victory') return 'victory';
    if (this.outcome === 'defeat' || run.status === 'dead') return this.outcome === 'retired' ? 'silent' : 'defeat';
    if (this.outcome === 'retired') return 'silent';
    const liveBoss = run.bosses.find((b) => b.life === 'alive');
    if (liveBoss) return liveBoss.defId === 'sovereign' ? 'boss-final' : 'boss';
    const warning = run.director.bossWarning;
    if (warning) return warning === 'sovereign' ? 'boss-final' : 'boss';
    return this.runState;
  }

  /** Intensity meter + calm/combat/horde hysteresis (run only). */
  private measure(input: DirectorInput): void {
    const { run, dt } = input;
    if (!run || input.screen !== 'run') { this.intensity += (0 - this.intensity) * Math.min(1, dt / 3); return; }
    const p = run.player;
    const active = run.status === 'running';
    if (!active) return;
    let threat = 0;
    for (const e of run.enemies) {
      if (e.life !== 'alive') continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d > 340) continue;
      threat += (THREAT[e.defId] ?? 1) * (e.elite ? 2.2 : 1) * (1 - smoothstep(120, 340, d));
    }
    for (const ev of input.events) {
      if (ev.type === 'player-hit') this.activity += Math.min(1.5, (ev.amount / Math.max(1, p.maxHp)) * 6);
      else if (ev.type === 'enemy-fired') { if (Math.hypot(ev.x - p.x, ev.z - p.z) < 260) this.activity += 0.035 * Math.min(4, ev.count); }
      else if (ev.type === 'enemy-killed') this.activity += 0.06;
    }
    this.activity *= Math.exp(-dt / 4);
    const threatN = 1 - Math.exp(-threat / 5);
    const actN = 1 - Math.exp(-this.activity);
    const timeN = smoothstep(120, 780, run.time);
    const raw = Math.min(1, 0.66 * Math.max(threatN, actN) + 0.18 * Math.min(threatN, actN) + 0.24 * timeN * (threatN > 0.12 ? 1 : 0.35));
    this.rawIntensity = this.intensityOverride ?? raw;
    const target = this.rawIntensity;
    const tau = target > this.intensity ? 1.2 : 5;
    this.intensity += (target - this.intensity) * Math.min(1, dt / tau);

    // Hysteresis with minimum dwell.
    this.dwell += dt;
    const i = this.intensity;
    let next: 'calm' | 'combat' | 'horde' = this.runState;
    let hold = 0;
    if (this.runState === 'calm' && i > 0.34) { next = 'combat'; hold = 1.5; }
    else if (this.runState === 'combat' && (i > 0.85 || (i > 0.68 && run.time > 360))) { next = 'horde'; hold = 3; }
    else if (this.runState === 'combat' && i < 0.18) { next = 'calm'; hold = 9; }
    else if (this.runState === 'horde' && i < 0.45) { next = 'combat'; hold = 10; }
    if (next === this.runState) { this.candidate = null; this.candidateTime = 0; return; }
    if (this.candidate !== next) { this.candidate = next; this.candidateTime = 0; }
    this.candidateTime += dt;
    if (this.candidateTime >= hold && this.dwell >= 14) {
      this.runState = next; this.candidate = null; this.candidateTime = 0; this.dwell = 0;
    }
  }

  private request(state: MusicState, now: number): void {
    if (this.pending) {
      if (this.pending.state === state) return;
      if (state === this.state) { this.pending = null; return; } // flip-back before the bar: cancel, nothing restarts
    } else if (state === this.state) return;
    const urgent = state === 'boss' || state === 'boss-final' || state === 'victory' || state === 'defeat' || state === 'silent' || this.state === 'silent';
    const cur = this.current;
    let wait = 0, fade = MIN_FADE;
    if (cur && cur.running) {
      const bar = cur.barSeconds();
      if (urgent) { wait = Math.min(0.8, cur.timeToNext(1)); fade = MIN_FADE; }
      else { wait = Math.min(4, cur.timeToNext(cur.def.beatsPerBar ?? 4)); fade = Math.min(4, Math.max(MIN_FADE, bar)); }
    }
    if (state === 'victory' || state === 'defeat') wait = 0;
    this.pending = { state, at: now + wait, fade };
  }

  private apply(state: MusicState, fade: number, now: number): void {
    const from = this.state;
    if (from === state) return;
    this.state = state;
    this.transitions.push({ t: +now.toFixed(2), from, to: state });
    if (this.transitions.length > 40) this.transitions.shift();
    if (state === 'victory' || state === 'defeat') {
      if (this.current) fadeParam(this.current.fader.gain, 0, 1.2, now);
      this.current = null;
      const len = this.hooks.stinger(state === 'victory' ? 'stinger-victory' : 'stinger-defeat');
      this.stingerUntil = now + Math.max(2, len);
      return;
    }
    const key = STATE_TRACK[state];
    const next = key ? this.track(key) : null;
    if (this.current && this.current !== next) fadeParam(this.current.fader.gain, 0, fade, now);
    if (next) {
      const def = next.def;
      if (!next.running) next.play(false);
      next.silentSince = 0;
      fadeParam(next.fader.gain, def.gain, this.current === null ? Math.max(fade, 2.5) : fade, now);
    }
    this.current = next;
  }
}
