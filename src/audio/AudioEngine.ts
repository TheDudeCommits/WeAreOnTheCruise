/**
 * Audio engine (AUDIO-owned; the AudioSystem surface is contract).
 *
 * Sample playback of CC0/CC-BY assets from public/audio (see public/audio/CREDITS.md), listener-relative
 * spatial SFX with pooled voices and per-category caps, ducking, a gentle glue compressor + master limiter,
 * streamed adaptive music with bar-synced crossfades, and RunState-driven ambience loops.
 *
 * Nothing is created or played before unlock() (called from a user gesture). Before that, only the manifest
 * and encoded bytes are fetched.
 */
import type { RunState, Settings, SimEvent } from '../game/types';
import type { AppScreen } from '../render/frame';
import { AmbienceController, type OneShotCue } from './ambience';
import { SampleBank, type LoadTier } from './bank';
import { CATEGORIES, CATEGORY_IDS } from './categories';
import type { AudioFrame, AudioSystem } from './contracts';
import { CUE_IDS, type CueId, MUSIC_KEYS } from './generated/cueIds';
import { Mixer, dbToGain, type PauseMode } from './mixer';
import { MusicDirector, type MusicState } from './music';
import { EventRouter } from './router';
import { listenerFromCamera, spatialize, type ListenerFrame, type SpatialResult } from './spatial';
import type { AudioManifest, CategoryId, CueDef, DuckSpec, PlayOptions } from './types';
import { UiSounds } from './uiSounds';
import { VoicePool } from './voices';

export interface AudioEngineOptions {
  /** Base URL of public/audio (default '/audio/'). */
  baseUrl?: string;
  /** Install window.__CRUISE_AUDIO__ (default true). */
  debugGlobal?: boolean;
}

export type DropReason = 'locked' | 'missing' | 'rate' | 'frame' | 'distance' | 'not-ready' | 'cap' | 'global-cap';

export interface AudioStatsSnapshot {
  unlocked: boolean;
  contextState: string;
  screen: AppScreen;
  requested: Record<string, number>;
  played: Record<string, number>;
  dropped: Record<string, number>;
  bySource: Record<string, number>;
  voices: Record<CategoryId, number>;
  totalVoices: number;
  peakVoices: Record<CategoryId, number>;
  steals: number;
  bank: { total: number; fetched: number; decoded: number; failed: number; bytes: number };
  music: ReturnType<MusicDirector['trackInfo']> | null;
  musicTransitions: { t: number; from: MusicState; to: MusicState }[];
  loops: Record<string, number>;
  ducks: { music: number; sfx: number; ambience: number };
}

export interface AudioLogEntry { t: number; cue: CueId; src: string; played: boolean; reason?: DropReason; gain?: number; d?: number; pan?: number }

const MENU_TIER_CUES = new Set<string>(['amb-ocean', 'amb-harbor', 'amb-wind', 'gull']);
const RECENT_LOG = 400;

export class AudioEngine implements AudioSystem {
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private pool: VoicePool | null = null;
  private director: MusicDirector | null = null;
  private ambience: AmbienceController | null = null;
  private readonly router: EventRouter;
  private readonly ui: UiSounds;
  private readonly bank: SampleBank;
  private readonly baseUrl: string;
  private manifest: AudioManifest | null = null;
  private manifestPromise: Promise<AudioManifest | null> | null = null;
  private settings: Settings | null = null;
  private unlocking: Promise<void> | null = null;
  private isUnlocked = false;
  private screen: AppScreen = 'boot';
  private run: Readonly<RunState> | null = null;
  private readonly listener: ListenerFrame = { x: 0, z: 0, rightX: 1, rightZ: 0, fwdX: 0, fwdZ: -1 };
  private readonly spatialScratch: SpatialResult = { gain: 1, pan: 0, cutoff: 20000, distance: 0 };
  private readonly lastPlayed = new Map<string, number>();
  private readonly frameCounts = new Map<string, number>();
  private readonly lastVariant = new Map<string, number>();
  private readonly prefetched = new Set<LoadTier>();
  private readonly requested: Record<string, number> = {};
  private readonly played: Record<string, number> = {};
  private readonly dropped: Record<string, number> = {};
  private readonly bySource: Record<string, number> = {};
  private readonly peakVoices = {} as Record<CategoryId, number>;
  private readonly recent: AudioLogEntry[] = [];
  private noteSource = 'direct';
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  private hidden = false;
  private disposed = false;

  constructor(options: AudioEngineOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/audio/';
    this.bank = new SampleBank(this.baseUrl);
    for (const id of CATEGORY_IDS) this.peakVoices[id] = 0;
    this.router = new EventRouter({
      play: (cue, opts) => this.play(cue, opts),
      duck: (spec) => this.duck(spec),
      cueLength: (cue) => this.cueLength(cue),
      note: (source) => { this.noteSource = source; this.bySource[source] = (this.bySource[source] ?? 0) + 1; },
    });
    this.ui = new UiSounds((cue, gain) => { this.noteSource = 'ui'; this.play(cue, { gain }); });
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.ui.attach();
      document.addEventListener('visibilitychange', this.onVisibility);
      // Keyboard-only players: the first key press is a user gesture too (GameApp wires pointer gestures).
      window.addEventListener('keydown', this.onKeyGesture, true);
      if (options.debugGlobal !== false) (window as unknown as { __CRUISE_AUDIO__?: unknown }).__CRUISE_AUDIO__ = this.debugApi();
      void this.loadManifest();
    }
  }

  get unlocked(): boolean { return this.isUnlocked; }

  /** The AudioContext (null before unlock) — for the lab. */
  get context(): AudioContext | null { return this.ctx; }

  get music(): MusicDirector | null { return this.director; }

  getManifest(): AudioManifest | null { return this.manifest; }

  // ───────────────────────── contract ─────────────────────────

  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.ctx && this.ctx.state === 'suspended' && !this.hidden) void this.ctx.resume().catch(() => undefined);
    if (this.unlocking) { this.director?.retryBlocked(); return this.unlocking; }
    // Create + resume synchronously inside the gesture (Chrome autoplay policy).
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const resumed = ctx.resume();
    this.unlocking = (async () => {
      await resumed.catch(() => undefined);
      const manifest = await this.loadManifest();
      if (this.disposed) return;
      this.mixer = new Mixer(ctx);
      this.pool = new VoicePool(ctx, this.mixer);
      this.bank.attach(ctx);
      if (manifest) {
        this.director = new MusicDirector(ctx, manifest.music, this.baseUrl, this.mixer.musicMix, {
          stinger: (cue) => { this.noteSource = 'music'; this.play(cue, { force: true }); return this.cueLength(cue); },
        });
        this.director.warm(['title', 'harbor']);
        this.director.enable();
      }
      this.ambience = new AmbienceController(ctx, this.mixer.ambience, {
        buffer: (cue) => this.bufferFor(cue),
        cueGain: (cue) => this.manifest?.cues[cue]?.gain ?? 1,
        play: (cue: OneShotCue, opts) => { this.noteSource = 'ambience'; this.play(cue, opts); },
      });
      if (this.settings) this.applySettings(this.settings);
      this.isUnlocked = true;
    })();
    return this.unlocking;
  }

  update(frame: AudioFrame): void {
    if (this.disposed) return;
    const screenChanged = frame.screen !== this.screen;
    this.screen = frame.screen;
    this.run = frame.run;
    if (this.manifest) {
      if (!this.prefetched.has('menu')) this.prefetch('menu');
      if (!this.prefetched.has('run') && (frame.screen !== 'title' || frame.time > 2.5)) this.prefetch('run');
    }
    const focus = frame.screen === 'run' && frame.run ? frame.run.player : null;
    listenerFromCamera(frame.listener, focus, this.listener);
    if (!this.isUnlocked || !this.ctx || !this.mixer) return;
    const now = this.ctx.currentTime;
    this.frameCounts.clear();
    if (screenChanged && this.director && (frame.screen === 'harbor' || frame.screen === 'run')) this.director.warm(['run-calm', 'run-combat']);
    this.mixer.update(now);
    this.mixer.setPauseMode(this.pauseMode(frame));
    if (frame.run?.status === 'paused' && frame.screen === 'run') this.mixer.duck({ target: 'music', depth: -6, hold: 0.2, attack: 0.15, release: 0.5 }, now);
    this.router.route(now, frame.screen, frame.run, frame.events, this.listener);
    this.director?.update({ now, dt: frame.dt, screen: frame.screen, run: frame.run, events: frame.events });
    this.ambience?.update(now, frame.dt, frame.screen, frame.run, this.listener);
    if (this.pool) {
      const active = this.pool.activeAll(now);
      for (const id of CATEGORY_IDS) if (active[id] > this.peakVoices[id]) this.peakVoices[id] = active[id];
    }
  }

  setSettings(settings: Settings): void {
    this.settings = { ...settings };
    if (this.mixer) this.applySettings(settings);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ui.detach();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyGesture, true);
    this.director?.dispose();
    this.ambience?.dispose();
    this.pool?.dispose();
    this.mixer?.dispose();
    this.bank.dispose();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    if (typeof window !== 'undefined') {
      const w = window as unknown as { __CRUISE_AUDIO__?: { engine?: unknown } };
      if (w.__CRUISE_AUDIO__?.engine === this) delete w.__CRUISE_AUDIO__;
    }
  }

  // ───────────────────────── public helpers (lab / debug) ─────────────────────────

  /** Plays a cue directly (lab, debug). Returns true if a voice started. */
  playCue(cue: CueId, opts: PlayOptions = {}): boolean {
    this.noteSource = 'direct';
    this.bySource.direct = (this.bySource.direct ?? 0) + 1;
    return this.play(cue, opts);
  }

  /** Routes synthetic SimEvents through the real mapping (lab). */
  routeEvents(events: readonly SimEvent[]): void {
    if (!this.ctx) return;
    this.router.route(this.ctx.currentTime, this.screen, this.run, events, this.listener);
  }

  listenerFrame(): Readonly<ListenerFrame> { return this.listener; }

  /** Post-limiter analyser (null before unlock). */
  tap(): AnalyserNode | null { return this.mixer?.tap() ?? null; }

  /** Instantaneous output level (dBFS) from the post-limiter tap. */
  meter(): { rmsDb: number; peakDb: number } | null {
    const a = this.tap();
    if (!a) return null;
    const buf = this.meterBuf && this.meterBuf.length === a.fftSize ? this.meterBuf : (this.meterBuf = new Float32Array(a.fftSize));
    a.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (let i = 0; i < buf.length; i++) { const v = buf[i]!; sum += v * v; const m = Math.abs(v); if (m > peak) peak = m; }
    return { rmsDb: +(10 * Math.log10(sum / buf.length + 1e-12)).toFixed(1), peakDb: +(20 * Math.log10(peak + 1e-9)).toFixed(1) };
  }

  stats(): AudioStatsSnapshot {
    const now = this.ctx?.currentTime ?? 0;
    return {
      unlocked: this.isUnlocked,
      contextState: this.ctx?.state ?? 'none',
      screen: this.screen,
      requested: { ...this.requested },
      played: { ...this.played },
      dropped: { ...this.dropped },
      bySource: { ...this.bySource },
      voices: this.pool ? this.pool.activeAll(now) : ({} as Record<CategoryId, number>),
      totalVoices: this.pool?.total(now) ?? 0,
      peakVoices: { ...this.peakVoices },
      steals: this.pool?.steals ?? 0,
      bank: this.bank.counts(),
      music: this.director?.trackInfo() ?? null,
      musicTransitions: this.director ? [...this.director.transitions] : [],
      loops: { ...(this.ambience?.levels ?? {}) },
      ducks: { ...(this.mixer?.duckLevels ?? { music: 1, sfx: 1, ambience: 1 }) },
    };
  }

  recentLog(n = 60): AudioLogEntry[] { return this.recent.slice(-n); }

  resetStats(): void {
    for (const o of [this.requested, this.played, this.dropped, this.bySource]) for (const k of Object.keys(o)) delete o[k];
    for (const id of CATEGORY_IDS) this.peakVoices[id] = 0;
    this.recent.length = 0;
    if (this.pool) this.pool.steals = 0;
  }

  /** Resolves when every sample of the tier is decoded (lab/QA; requires unlock). */
  async ready(tier: LoadTier = 'run'): Promise<void> {
    await this.loadManifest();
    this.prefetch('menu');
    this.prefetch(tier);
    if (this.unlocking) await this.unlocking;
    if (this.isUnlocked) await this.bank.whenTierReady(tier);
  }

  // ───────────────────────── internals ─────────────────────────

  private loadManifest(): Promise<AudioManifest | null> {
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(`${this.baseUrl}manifest.json`)
        .then((r) => (r.ok ? (r.json() as Promise<AudioManifest>) : null))
        .then((m) => {
          if (!m || this.disposed) return null;
          this.manifest = m;
          for (const [id, def] of Object.entries(m.cues)) {
            const tier: LoadTier = def.category === 'ui' || MENU_TIER_CUES.has(id) ? 'menu' : 'run';
            for (const f of def.files) this.bank.register(f, tier);
          }
          const missing = CUE_IDS.filter((id) => !m.cues[id]);
          if (missing.length) console.warn('[audio] manifest lacks cues', missing);
          const missingMusic = MUSIC_KEYS.filter((k) => !m.music[k]);
          if (missingMusic.length) console.warn('[audio] manifest lacks music', missingMusic);
          return m;
        })
        .catch((err: unknown) => { console.warn('[audio] manifest failed', err); return null; });
    }
    return this.manifestPromise;
  }

  private prefetch(tier: LoadTier): void {
    if (!this.manifest || this.prefetched.has(tier)) return;
    this.prefetched.add(tier);
    this.bank.prefetch(tier);
  }

  private applySettings(s: Settings): void {
    this.mixer?.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume, s.muted);
  }

  private pauseMode(frame: AudioFrame): PauseMode {
    if (frame.screen !== 'run' || !frame.run) return 'none';
    const st = frame.run.status;
    if (st === 'paused') return 'paused';
    if (st === 'levelup' || st === 'chest') return 'menu';
    return 'none';
  }

  private duck(spec: DuckSpec, delay = 0): void {
    if (this.mixer && this.ctx) this.mixer.duck(spec, this.ctx.currentTime + delay);
  }

  private bufferFor(cue: string): AudioBuffer | null {
    const def = this.manifest?.cues[cue];
    if (!def || def.files.length === 0) return null;
    return this.bank.get(def.files[0]!);
  }

  private cueLength(cue: CueId): number {
    return this.bufferFor(cue)?.duration ?? 0;
  }

  private pickFile(cue: string, def: CueDef, forced?: number): string {
    const n = def.files.length;
    if (n === 1) return def.files[0]!;
    let i: number;
    if (forced !== undefined) i = ((forced % n) + n) % n;
    else {
      const last = this.lastVariant.get(cue) ?? -1;
      i = Math.floor(Math.random() * (last >= 0 ? n - 1 : n));
      if (last >= 0 && i >= last) i++;
    }
    this.lastVariant.set(cue, i);
    return def.files[i]!;
  }

  private drop(cue: CueId, reason: DropReason, gain?: number, d?: number): false {
    this.dropped[reason] = (this.dropped[reason] ?? 0) + 1;
    this.log({ t: +(this.ctx?.currentTime ?? 0).toFixed(3), cue, src: this.noteSource, played: false, reason, gain, d });
    return false;
  }

  private log(entry: AudioLogEntry): void {
    this.recent.push(entry);
    if (this.recent.length > RECENT_LOG) this.recent.splice(0, this.recent.length - RECENT_LOG);
  }

  private play(cue: CueId, opts: PlayOptions = {}): boolean {
    this.requested[cue] = (this.requested[cue] ?? 0) + 1;
    const ctx = this.ctx, pool = this.pool, mixer = this.mixer;
    if (!ctx || !pool || !mixer || !this.isUnlocked) return this.drop(cue, 'locked');
    const def = this.manifest?.cues[cue];
    if (!def || def.files.length === 0) return this.drop(cue, 'missing');
    const now = ctx.currentTime;
    const delay = Math.max(0, opts.delay ?? 0);
    const when = now + delay;
    if (!opts.force) {
      const last = this.lastPlayed.get(cue);
      if (def.minInterval && last !== undefined && Math.abs(when - last) < def.minInterval) return this.drop(cue, 'rate');
      const count = this.frameCounts.get(cue) ?? 0;
      if (def.maxPerFrame && count >= def.maxPerFrame) return this.drop(cue, 'frame');
    }
    const cat = CATEGORIES[def.category];
    let gain = def.gain * (opts.gain ?? 1);
    let pan = 0, cutoff = 20000, spatialGain = 1;
    let distance: number | undefined;
    if (cat.spatial && opts.x !== undefined && opts.z !== undefined) {
      const s = spatialize(this.listener, opts.x, opts.z, { ref: def.ref ?? cat.ref, rolloff: cat.rolloff, maxDistance: def.maxDistance ?? cat.maxDistance }, this.spatialScratch);
      distance = Math.round(s.distance);
      if (s.gain < 0.004) return this.drop(cue, 'distance', 0, distance);
      spatialGain = s.gain; pan = s.pan; cutoff = s.cutoff;
      gain *= s.gain;
    }
    gain *= dbToGain((Math.random() * 2 - 1) * (def.gainJitter ?? 1));
    gain /= Math.sqrt(1 + cat.density * pool.active(def.category, now));
    const semis = (opts.pitch ?? 0) + (Math.random() * 2 - 1) * (def.pitch ?? 0);
    const rate = Math.pow(2, semis / 12);
    const file = this.pickFile(cue, def, opts.variant);
    const buffer = this.bank.get(file);
    if (!buffer) return this.drop(cue, 'not-ready', gain, distance);
    const priority = ((def.priority ?? cat.priority) + (opts.priority ?? 0)) * (0.45 + 0.55 * spatialGain);
    const ok = pool.play(buffer, def.category, { cue, when, gain, rate, pan, cutoff, priority });
    if (!ok) return this.drop(cue, pool.lastDrop ?? 'cap', gain, distance);
    this.lastPlayed.set(cue, when);
    this.frameCounts.set(cue, (this.frameCounts.get(cue) ?? 0) + 1);
    this.played[cue] = (this.played[cue] ?? 0) + 1;
    this.log({ t: +when.toFixed(3), cue, src: this.noteSource, played: true, gain: +gain.toFixed(3), d: distance, pan: distance !== undefined ? +pan.toFixed(2) : undefined });
    if (def.duck) this.duck(def.duck, delay);
    return true;
  }

  private readonly onKeyGesture = (ev: KeyboardEvent): void => {
    if (ev.repeat || ev.isTrusted === false) return;
    void this.unlock().then(() => { if (this.settings) this.applySettings(this.settings); }).catch(() => undefined);
    if (this.isUnlocked) window.removeEventListener('keydown', this.onKeyGesture, true);
  };

  private readonly onVisibility = (): void => {
    this.hidden = document.hidden;
    if (!this.ctx || !this.isUnlocked) return;
    if (document.hidden) { this.director?.suspend(true); void this.ctx.suspend().catch(() => undefined); }
    else { void this.ctx.resume().catch(() => undefined); this.director?.suspend(false); }
  };

  private debugApi(): Record<string, unknown> {
    return {
      engine: this,
      stats: () => this.stats(),
      log: (n?: number) => this.recentLog(n),
      reset: () => this.resetStats(),
      play: (cue: CueId, opts?: PlayOptions) => this.playCue(cue, opts),
      meter: () => this.meter(),
    };
  }
}
