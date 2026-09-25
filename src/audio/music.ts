/**
 * Adaptive music (AUDIO-owned): streamed tracks (HTMLAudioElement → MediaElementAudioSourceNode, so long
 * tracks are never fully decoded), bar-synced equal-power crossfades, combat-heat layers with hysteresis, per-sea run
 * tracks, and stingers.
 *
 * Rules: a track that fades out keeps playing silently for WARM_SECONDS, so flipping back resumes it
 * seamlessly (no restart); after that it pauses and later resumes from where it stopped.
 *
 * Run layers (calm / combat / horde) follow the combat heat (heat.ts): kills per minute, threat nearby, the player's
 * own guns, hull taken, set pieces. Each sea has its own three layers (SEA_SUFFIX), falling back to Sunward's.
 */
import type { SeaId } from '../game/ids';
import type { RunState, SimEvent } from '../game/types';
import type { AppScreen } from '../render/frame';
import { CombatHeat, LayerSelector, type RunLayer } from './heat';
import type { MusicDef } from './types';

export type MusicState =
  | 'silent' | 'title' | 'harbor' | 'calm' | 'combat' | 'horde' | 'boss' | 'boss-final' | 'victory' | 'defeat' | 'results';

export const MUSIC_STATES: readonly MusicState[] = ['silent', 'title', 'harbor', 'calm', 'combat', 'horde', 'boss', 'boss-final', 'victory', 'defeat', 'results'];

const STATE_TRACK: Record<MusicState, string | null> = {
  silent: null, title: 'title', harbor: 'harbor', results: 'harbor',
  calm: 'run-calm', combat: 'run-combat', horde: 'run-horde', boss: 'boss', 'boss-final': 'boss-final',
  victory: null, defeat: null,
};

/** Per-sea variants of the run layers: `run-calm` + suffix (missing keys fall back to the base track). */
const SEA_SUFFIX: Record<SeaId, string> = { 'sunward-shallows': '', 'stormwrack-reach': '-storm', 'the-gloam': '-gloam' };

const WARM_SECONDS = 25;
const MIN_FADE = 1.6;

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
  /** play() was refused (autoplay policy); retried on the next user gesture. */
  blocked = false;
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
    this.blocked = false;
    el.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return; // superseded by pause()
      this.running = false;
      this.blocked = true;
    });
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
  /** Combat heat meter (drives the run layers; the barks read it too). */
  readonly heat = new CombatHeat();
  private readonly layers = new LayerSelector();
  private current: MusicTrack | null = null;
  private readonly tracks = new Map<string, MusicTrack>();
  private pending: { state: MusicState; at: number; fade: number } | null = null;
  private runState: RunLayer = 'calm';
  private sea: SeaId | null = null;
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

  trackInfo(): {
    state: MusicState; track: string | null; position: number; level: number; intensity: number; runState: string; pending: string | null;
    heat: CombatHeat['parts'] & { lull: number };
  } {
    return {
      state: this.state, track: this.current?.key ?? null, position: +(this.current?.position() ?? 0).toFixed(2),
      level: +(this.current?.fader.gain.value ?? 0).toFixed(3), intensity: +this.intensity.toFixed(3), runState: this.runState,
      pending: this.pending ? `${this.pending.state}@${(this.pending.at - this.ctx.currentTime).toFixed(2)}s` : null,
      heat: { ...this.heat.parts, lull: +this.heat.lull.toFixed(1) },
    };
  }

  /** The run layer the heat asks for (calm / combat / horde), whatever is playing right now. */
  get runLayer(): RunLayer { return this.runState; }

  /** Streams the run layers of a sea ahead of need. */
  warmSea(sea: SeaId, layers: readonly RunLayer[] = ['calm', 'combat']): void {
    for (const l of layers) { const k = this.keyFor(l, sea); if (k) this.track(k); }
  }

  /** Preloads the tracks a screen is likely to need (media elements stream; nothing is played). */
  warm(keys: readonly string[]): void {
    for (const k of keys) this.track(k);
  }

  update(input: DirectorInput): void {
    const { now } = input;
    if (input.screen !== this.lastScreen) {
      if (input.screen === 'run') { this.outcome = null; this.runState = 'calm'; this.intensity = 0; this.heat.reset(); this.layers.reset(); }
      this.lastScreen = input.screen;
    }
    if (input.run && input.screen === 'run') this.sea = input.run.seaId;
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

  /** Called inside a user gesture: restarts tracks whose play() the autoplay policy refused. */
  retryBlocked(): void {
    for (const t of this.tracks.values()) if (t.blocked && (t === this.current || t.fader.gain.value > 0.001)) t.play(false);
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

  /** Combat heat → calm/combat/horde layer with hysteresis (run only). */
  private measure(input: DirectorInput): void {
    const { run, dt } = input;
    if (!run || input.screen !== 'run') { this.intensity += (0 - this.intensity) * Math.min(1, dt / 3); return; }
    this.heat.update(run, input.events, dt, this.intensityOverride);
    this.rawIntensity = this.heat.raw;
    this.intensity = this.heat.heat;
    if (run.status !== 'running') return;
    this.runState = this.layers.update(this.heat, run.time, dt);
  }

  /** Track key of a run layer in a sea (the sea's own variant when the manifest has it). */
  private keyFor(state: MusicState, sea: SeaId | null): string | null {
    const base = STATE_TRACK[state];
    if (!base || !sea || !base.startsWith('run-')) return base;
    const k = base + SEA_SUFFIX[sea];
    return this.defs[k] ? k : base;
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
    const key = this.keyFor(state, this.sea);
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
