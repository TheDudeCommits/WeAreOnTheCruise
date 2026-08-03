import type { AmmoKind, ShipKind, ShipSide, ShipState, WorldState } from '../core/contracts';
import { areFactionsHostile } from '../simulation/factions';
import type { PresentationEvent } from '../ui/presentation';

export type MusicMode = 'exploration' | 'combat' | 'race' | 'storm';

export interface AudioDirectorOptions {
  masterVolume?: number;
  musicVolume?: number;
  effectsVolume?: number;
  ambienceVolume?: number;
  muted?: boolean;
}

interface AudioProfile {
  hullPitch: number;
  cannonPitch: number;
  timber: number;
  sail: number;
  tech: number;
}

interface MixGraph {
  master: GainNode;
  compressor: DynamicsCompressorNode;
  music: GainNode;
  effects: GainNode;
  ambience: GainNode;
  waterGain: GainNode;
  waterFilter: BiquadFilterNode;
  windGain: GainNode;
  windFilter: BiquadFilterNode;
  hullGain: GainNode;
  hullFilter: BiquadFilterNode;
}

const DEFAULTS: Required<AudioDirectorOptions> = {
  masterVolume: 0.72,
  musicVolume: 0.28,
  effectsVolume: 0.82,
  ambienceVolume: 0.5,
  muted: false,
};

const AUDIO_PROFILES: Record<ShipKind, AudioProfile> = {
  'thousand-sunny': { hullPitch: 62, cannonPitch: 76, timber: 0.66, sail: 0.82, tech: 1 },
  'going-merry': { hullPitch: 86, cannonPitch: 98, timber: 1, sail: 1, tech: 0.05 },
  'moby-dick': { hullPitch: 35, cannonPitch: 43, timber: 0.92, sail: 0.72, tech: 0 },
  'red-force': { hullPitch: 48, cannonPitch: 58, timber: 0.84, sail: 0.9, tech: 0.08 },
  'oro-jackson': { hullPitch: 44, cannonPitch: 52, timber: 0.9, sail: 0.86, tech: 0.12 },
  'polar-tang': { hullPitch: 74, cannonPitch: 88, timber: 0.18, sail: 0.18, tech: 0.92 },
  'queen-mama-chanter': { hullPitch: 32, cannonPitch: 39, timber: 0.78, sail: 0.65, tech: 0.22 },
  'baratie': { hullPitch: 42, cannonPitch: 54, timber: 0.94, sail: 0.48, tech: 0.08 },
  'navy-galleon': { hullPitch: 51, cannonPitch: 63, timber: 0.8, sail: 0.76, tech: 0.04 },
};

const SCALES: Record<MusicMode, readonly number[]> = {
  exploration: [0, 2, 4, 7, 9, 12, 14, 16],
  combat: [0, 3, 5, 7, 10, 12, 15, 17],
  race: [0, 2, 4, 7, 9, 11, 12, 16],
  storm: [0, 2, 3, 7, 8, 10, 12, 15],
};

const LEAD_PATTERNS: Record<MusicMode, readonly number[]> = {
  exploration: [0, -1, -1, 2, -1, 4, -1, 3, 5, -1, 4, -1, 2, -1, 1, -1],
  combat: [0, -1, 2, 0, 3, 2, 4, 3, 5, 3, 6, 5, 4, 2, 3, -1],
  race: [0, 2, 4, 5, 4, 6, 7, 6, 5, 4, 2, 4, 3, 2, 1, 3],
  storm: [0, -1, 1, -1, 3, 2, -1, 1, 4, -1, 3, -1, 2, 1, 0, -1],
};

const TEMPOS: Record<MusicMode, number> = {
  exploration: 92,
  combat: 124,
  race: 144,
  storm: 106,
};

/**
 * A no-assets Web Audio soundscape. Constructing it is silent: `unlock()` must be
 * called from a click/key gesture before the graph and its continuous voices exist.
 */
export class AudioDirector {
  private readonly options: Required<AudioDirectorOptions>;
  private context?: AudioContext;
  private graph?: MixGraph;
  private noiseBuffer?: AudioBuffer;
  private waterSource?: AudioBufferSourceNode;
  private windSource?: AudioBufferSourceNode;
  private hullOscillator?: OscillatorNode;
  private muted: boolean;
  private disposed = false;
  private currentMode: MusicMode = 'exploration';
  private currentProfile: AudioProfile = AUDIO_PROFILES['thousand-sunny'];
  private musicStep = 0;
  private nextMusicAt = 0;
  private nextCreakAt = 0;
  private nextThunderAt = 0;
  private randomState = 0x6d2b79f5;
  private lastCountdown = -1;
  private currentPlayerId?: string;
  private lastPlayerKind?: ShipKind;
  private lastWeaponCooldowns?: Record<'port' | 'starboard' | 'bow', number>;
  private reloadStages: Record<'port' | 'starboard' | 'bow', 'idle' | 'started' | 'rammed'> = {
    port: 'idle', starboard: 'idle', bow: 'idle',
  };
  private nextThreatCueAt = 0;
  private lastImpactAt = 0;
  private lastImpactTarget?: string;
  private lastImpactSection?: ShipSide;
  private hitCombo = 0;
  private lastHitConfirmAt = 0;
  private surrenderedShips = new Set<string>();
  private hasObservedSurrenders = false;
  private trackedTargetId?: string;
  private trackedTargetOpening = false;
  private trackedTargetCritical = false;
  private gestureCleanup?: () => void;
  private readonly onVisibilityChange = (): void => {
    if (!this.context) return;
    if (document.hidden) void this.context.suspend();
  };

  constructor(options: AudioDirectorOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.muted = this.options.muted;
  }

  get isUnlocked(): boolean {
    return Boolean(this.context && this.context.state !== 'closed');
  }

  get mode(): MusicMode {
    return this.currentMode;
  }

  /**
   * Convenience helper for hosts that do not already route the HUD launch gesture.
   * Returns a cleanup function and removes itself after the first successful gesture.
   */
  bindUnlockGesture(target: Document | HTMLElement = document): () => void {
    this.gestureCleanup?.();
    const unlock = (): void => {
      void this.unlock().then((started) => {
        if (started) cleanup();
      });
    };
    const cleanup = (): void => {
      target.removeEventListener('pointerdown', unlock);
      target.removeEventListener('keydown', unlock);
      if (this.gestureCleanup === cleanup) this.gestureCleanup = undefined;
    };
    target.addEventListener('pointerdown', unlock, { passive: true });
    target.addEventListener('keydown', unlock);
    this.gestureCleanup = cleanup;
    return cleanup;
  }

  /** Call synchronously from a user gesture (for example Hud.onUserGesture). */
  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    if (!this.context) {
      try {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.buildGraph(this.context);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
      } catch {
        this.context = undefined;
        return false;
      }
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context.state === 'running';
  }

  update(state: WorldState, _deltaSeconds = 0): void {
    const context = this.context;
    const graph = this.graph;
    if (!context || !graph || context.state !== 'running') return;

    if (state.seedNumber && this.randomState === 0x6d2b79f5) this.randomState ^= state.seedNumber | 0;
    const player = state.ships.find((ship) => ship.id === state.playerId);
    this.currentPlayerId = state.playerId;
    if (player) {
      this.currentProfile = AUDIO_PROFILES[player.kind];
      if (this.lastPlayerKind !== player.kind) {
        this.lastPlayerKind = player.kind;
        this.lastWeaponCooldowns = undefined;
        this.reloadStages = { port: 'idle', starboard: 'idle', bow: 'idle' };
      }
    }
    const profile = this.currentProfile;
    const now = context.currentTime;
    const speedRatio = player ? this.clamp(Math.abs(player.speed) / Math.max(1, player.maxSpeed)) : 0;
    const storm = state.weather === 'storm' || state.weather === 'maelstrom';
    const wind = this.normalizedLevel(state.windStrength);
    const pausedScale = state.paused ? 0.2 : 1;

    if (player) {
      this.updateReloadAudio(player);
      if (!state.paused) this.updateThreatAudio(state, player, now);
      if (!state.paused) this.updateTargetStatusAudio(state, player);
    }
    this.updateSurrenderAudio(state);

    this.target(graph.master.gain, this.muted ? 0 : this.options.masterVolume * pausedScale, now, 0.12);
    this.target(graph.waterGain.gain, this.options.ambienceVolume * (0.025 + speedRatio * 0.22), now, 0.18);
    this.target(graph.waterFilter.frequency, 520 + speedRatio * 2900, now, 0.16);
    this.target(graph.waterFilter.Q, 0.65 + speedRatio * 2.2, now, 0.2);
    this.target(graph.windGain.gain, this.options.ambienceVolume * (0.012 + wind * 0.08 + (storm ? 0.16 : 0)), now, 0.3);
    this.target(graph.windFilter.frequency, 430 + wind * 1500 + (storm ? 600 : 0), now, 0.25);
    this.target(graph.hullGain.gain, this.options.ambienceVolume * profile.timber * (0.006 + speedRatio * 0.018), now, 0.25);
    this.target(graph.hullFilter.frequency, profile.hullPitch * (1 + speedRatio * 0.15), now, 0.25);
    if (this.hullOscillator) this.target(this.hullOscillator.frequency, profile.hullPitch * (0.92 + speedRatio * 0.18), now, 0.2);

    const nextMode = this.selectMusicMode(state);
    if (nextMode !== this.currentMode) this.transitionMusic(nextMode, now);
    this.scheduleMusic(now, player);

    if (!state.paused && player && now >= this.nextCreakAt) {
      this.playCreak(profile, speedRatio, now);
      this.nextCreakAt = now + 1.3 + this.random() * 3.8 - speedRatio * 0.7 - (storm ? 0.55 : 0);
    }
    if (!state.paused && storm && now >= this.nextThunderAt) {
      this.playThunder(0.45 + this.random() * 0.45, now + 0.05);
      this.nextThunderAt = now + 5 + this.random() * 10;
    }

    const countdown = Math.ceil(state.race.countdown);
    if (state.race.active && countdown >= 0 && countdown <= 3 && countdown !== this.lastCountdown) {
      this.playCountdown(countdown);
    }
    this.lastCountdown = state.race.active ? countdown : -1;
  }

  handle(event: PresentationEvent): void {
    switch (event.type) {
      case 'cannon-fired':
        this.playCannon(event.shipKind, event.weight ?? 0.65, event.ammo, event.side);
        break;
      case 'impact': {
        const incoming = event.incoming ?? (!event.targetId || event.targetId === this.currentPlayerId);
        this.playImpact(event.severity ?? 0.5, event.material, event.section, incoming);
        if (!incoming && event.targetId && event.material !== 'water') {
          this.playHitConfirm(event.severity ?? 0.5, event.critical, event.combo);
        }
        if (event.disabled) this.playStatus('disabled');
        this.lastImpactAt = performance.now();
        this.lastImpactTarget = event.targetId;
        this.lastImpactSection = event.section;
        break;
      }
      case 'damage': {
        const pairedImpact = performance.now() - this.lastImpactAt < 80
          && event.targetId === this.lastImpactTarget
          && event.section === this.lastImpactSection;
        if (pairedImpact) break;
        const incoming = event.incoming ?? (!event.targetId || event.targetId === this.currentPlayerId);
        this.playImpact(event.severity ?? 0.5, 'hull', event.section, incoming);
        if (!incoming && event.targetId) this.playHitConfirm(event.severity ?? 0.5, event.critical, event.combo);
        break;
      }
      case 'special':
        this.playSpecial(event.phase ?? 'fire', event.shipKind, event.power ?? 0.8);
        break;
      case 'race-countdown':
        this.playCountdown(event.count);
        break;
      case 'race-start':
        this.playCountdown(0);
        break;
      case 'checkpoint':
        this.playCheckpoint();
        break;
      case 'victory':
        if (event.title?.includes('DISABLED')) this.playStatus('disabled');
        this.playFanfare(true);
        break;
      case 'defeat':
        this.playFanfare(false);
        break;
      case 'discovery':
        this.playDiscovery();
        break;
      case 'crew-callout':
        this.playCalloutCue(event.tone ?? 'info');
        break;
      case 'repair':
        this.playRepair(event.phase);
        break;
      case 'thunder':
        this.playThunder(event.strength ?? 0.7);
        break;
      case 'target-acquired':
        this.playCalloutCue('danger');
        if (event.opening) this.playOpeningCue();
        break;
      case 'target-status':
        if (event.status === 'critical') this.playStatus('critical');
        if (event.status === 'disabled') this.playStatus('disabled');
        if (event.status === 'surrendered') this.playStatus('surrendered');
        if (event.opening) this.playOpeningCue();
        break;
      case 'reload':
        this.playReload(event.side, event.phase);
        break;
      case 'combo':
        this.playHitConfirm(event.critical ? 1 : 0.55, event.critical, event.count);
        break;
      case 'threat':
        this.playThreatCue(
          event.side,
          event.level ?? 'tracking',
          event.bearing === undefined
            ? undefined
            : Math.sin(Math.abs(event.bearing) > Math.PI * 2 ? event.bearing * Math.PI / 180 : event.bearing) * 0.8,
        );
        break;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const context = this.context;
    if (context && this.graph) this.target(this.graph.master.gain, muted ? 0 : this.options.masterVolume, context.currentTime, 0.05);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setVolume(channel: 'master' | 'music' | 'effects' | 'ambience', value: number): void {
    const graph = this.graph;
    const context = this.context;
    const amount = this.clamp(value);
    if (!graph || !context) return;
    if (channel === 'master') this.target(graph.master.gain, this.muted ? 0 : amount, context.currentTime, 0.05);
    else this.target(graph[channel].gain, amount, context.currentTime, 0.05);
  }

  playCannon(
    shipKind?: ShipKind,
    weight = 0.65,
    ammo: AmmoKind = 'round',
    side?: ShipSide,
  ): void {
    const context = this.context;
    const graph = this.graph;
    if (!context || !graph || context.state !== 'running') return;
    const profile = shipKind ? AUDIO_PROFILES[shipKind] : this.currentProfile;
    const now = context.currentTime;
    const force = this.clamp(weight);
    const ammoWeight = ammo === 'heavy' ? 1.22 : ammo === 'explosive' ? 1.14 : ammo === 'chain' ? 0.82 : 1;
    const output = this.pannedOutput(graph.effects, this.sidePan(side));
    const reports = 2 + Math.round(force * 4);
    for (let index = 0; index < reports; index += 1) {
      const offset = index * (0.012 + force * 0.009);
      this.noiseBurst(now + offset, 0.12 + force * 0.08, 420 + profile.cannonPitch * 4 + index * 70, 1.4 + force * 2.4, output, (0.055 + force * 0.025) * ammoWeight);
      this.pitchDrop(profile.cannonPitch * (1.9 + index * 0.08), profile.cannonPitch * 0.62, now + offset, 0.16, 0.024 + force * 0.012, 'square', output);
    }
    this.noiseBurst(now, 0.3 + force * 0.18, 145 + profile.cannonPitch * 1.7, 1.1 + force * 3.8, output, 0.18 * ammoWeight);
    this.pitchDrop(profile.cannonPitch * ammoWeight, profile.cannonPitch * 0.3, now, 0.42, 0.15 + force * 0.11, 'sine', output);
    this.pitchDrop(54 + force * 26, 24, now + 0.035, 0.5, 0.1 + force * 0.08, 'sine', output);
    this.tone(620 + profile.cannonPitch * 2.2, now + 0.075, 0.18, 0.022, 'triangle', output, side === 'port' ? -11 : 11);
    this.noiseBurst(now + 0.08, 0.28, 2600, 0.62, output, 0.035 + force * 0.02, 'highpass');
    if (ammo === 'chain') {
      this.tone(profile.cannonPitch * 5.5, now + 0.03, 0.28, 0.035, 'sawtooth', output, -18);
      this.tone(profile.cannonPitch * 6.2, now + 0.045, 0.24, 0.028, 'sawtooth', output, 22);
    }
    if (ammo === 'explosive') this.noiseBurst(now + 0.16, 0.38, 580, 0.9, output, 0.11);
  }

  playImpact(
    severity = 0.5,
    material: 'hull' | 'water' | 'mast' | 'reef' = 'hull',
    section?: ShipSide,
    incoming = true,
  ): void {
    const context = this.context;
    const graph = this.graph;
    if (!context || !graph || context.state !== 'running') return;
    const now = context.currentTime;
    const force = this.clamp(severity);
    const output = this.pannedOutput(graph.effects, this.sidePan(section) * (incoming ? 1 : 0.45));
    if (material === 'water') {
      this.noiseBurst(now, 0.28 + force * 0.3, 1200 + force * 2400, 0.7, output, 0.09 + force * 0.11, 'highpass');
      this.pitchDrop(180 + force * 80, 70, now, 0.23, 0.04, 'sine', output);
      return;
    }
    const base = material === 'mast' ? 150 : material === 'reef' ? 54 : this.currentProfile.hullPitch;
    this.noiseBurst(now, 0.15 + force * 0.3, material === 'reef' ? 240 : 720, 2.8, output, 0.1 + force * 0.16);
    this.pitchDrop(base * 1.65, base * 0.58, now, 0.24 + force * 0.24, 0.08 + force * 0.1, 'triangle', output);
    this.pitchDrop(72 + force * 48, 26, now + 0.012, 0.36 + force * 0.2, 0.075 + force * 0.09, 'sine', output);
    this.noiseBurst(now + 0.035, 0.19 + force * 0.16, 1900 + force * 1300, 0.85, output, 0.055 + force * 0.07, 'highpass');
    const splinters = 3 + Math.round(force * 6);
    for (let index = 0; index < splinters; index += 1) {
      const offset = 0.018 + index * 0.026 + this.random() * 0.02;
      this.tone(420 + this.random() * 1500, now + offset, 0.035 + this.random() * 0.06, 0.014 + force * 0.009, 'square', output, this.random() * 30 - 15);
    }
    if (incoming && force > 0.68) this.pitchRise(base * 1.7, base * 2.15, now + 0.14, 0.42, 0.026, 'sawtooth', output);
  }

  playReload(side: ShipSide, phase: 'start' | 'ram' | 'ready'): void {
    const context = this.context;
    const graph = this.graph;
    if (!context || !graph || context.state !== 'running') return;
    const output = this.pannedOutput(graph.effects, this.sidePan(side));
    const now = context.currentTime;
    if (phase === 'start') {
      this.noiseBurst(now + 0.18, 0.11, 2100, 1.8, output, 0.026, 'bandpass');
      this.pitchDrop(520, 155, now + 0.2, 0.14, 0.025, 'triangle', output);
      return;
    }
    if (phase === 'ram') {
      this.noiseBurst(now, 0.21, 980, 4.2, output, 0.035, 'bandpass');
      this.pitchDrop(205, 92, now, 0.2, 0.036, 'sawtooth', output);
      this.tone(760, now + 0.13, 0.06, 0.017, 'square', output);
      return;
    }
    this.pitchDrop(1280, 610, now, 0.075, 0.026, 'square', output);
    this.tone(940, now + 0.065, 0.12, 0.025, 'triangle', output);
    this.tone(1480, now + 0.12, 0.1, 0.018, 'square', output);
    this.pitchDrop(118, 62, now + 0.035, 0.16, 0.035, 'sine', output);
  }

  private playHitConfirm(severity: number, critical = false, combo?: number): void {
    const context = this.context;
    const graph = this.graph;
    if (!context || !graph || context.state !== 'running') return;
    const nowMs = performance.now();
    this.hitCombo = combo ?? (nowMs - this.lastHitConfirmAt < 2200 ? this.hitCombo + 1 : 1);
    this.lastHitConfirmAt = nowMs;
    const force = this.clamp(severity);
    const now = context.currentTime;
    const note = 72 + Math.min(7, this.hitCombo - 1);
    this.noiseBurst(now, 0.055, 2600 + force * 1700, 1.2, graph.effects, 0.022 + force * 0.014, 'highpass');
    this.tone(this.midi(note), now, 0.11, 0.025 + force * 0.012, 'square', graph.effects);
    if (this.hitCombo > 1) this.tone(this.midi(note + 7), now + 0.045, 0.13, 0.019, 'triangle', graph.effects);
    if (critical || force >= 0.82) {
      this.pitchDrop(145, 38, now, 0.33, 0.09, 'sine', graph.effects);
      this.noiseBurst(now + 0.025, 0.18, 780, 2.2, graph.effects, 0.065);
    }
  }

  private playOpeningCue(): void {
    if (!this.context || !this.graph || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    [69, 76, 81].forEach((note, index) => this.tone(this.midi(note), now + index * 0.055, 0.14, 0.019, 'square', this.graph!.effects));
  }

  private playStatus(status: 'critical' | 'disabled' | 'surrendered'): void {
    if (!this.context || !this.graph || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (status === 'critical') {
      this.pitchDrop(116, 44, now, 0.28, 0.07, 'sawtooth', this.graph.effects);
      this.tone(this.midi(51), now + 0.08, 0.26, 0.035, 'square', this.graph.effects);
      return;
    }
    const notes = status === 'disabled' ? [55, 60, 67, 72] : [67, 64, 60];
    notes.forEach((note, index) => this.tone(this.midi(note), now + index * 0.1, index === notes.length - 1 ? 0.45 : 0.18, 0.03, status === 'disabled' ? 'square' : 'triangle', this.graph!.effects));
    if (status === 'disabled') this.pitchDrop(88, 28, now, 0.55, 0.075, 'sine', this.graph.effects);
  }

  private playThreatCue(
    side?: ShipSide,
    level: 'tracking' | 'armed' | 'incoming' = 'tracking',
    panOverride?: number,
  ): void {
    if (!this.context || !this.graph || this.context.state !== 'running') return;
    const output = this.pannedOutput(this.graph.effects, panOverride ?? this.sidePan(side));
    const now = this.context.currentTime;
    const notes = level === 'incoming' ? [76, 64, 76] : level === 'armed' ? [67, 61] : [64];
    notes.forEach((note, index) => this.tone(this.midi(note), now + index * 0.07, 0.11, level === 'incoming' ? 0.032 : 0.018, 'square', output));
    if (level === 'incoming') this.noiseBurst(now, 0.055, 4200, 0.7, output, 0.025, 'highpass');
  }

  playSpecial(phase: 'charge' | 'fire' | 'ready', shipKind?: ShipKind, power = 0.8): void {
    const context = this.context;
    const graph = this.graph;
    if (!context || !graph || context.state !== 'running') return;
    const profile = shipKind ? AUDIO_PROFILES[shipKind] : this.currentProfile;
    const now = context.currentTime;
    const force = this.clamp(power);
    if (phase === 'ready') {
      [0, 4, 7].forEach((offset, index) => this.tone(this.midi(76 + offset), now + index * 0.08, 0.18, 0.035, 'square', graph.effects));
      return;
    }
    if (phase === 'charge') {
      this.pitchRise(95 + profile.tech * 65, 880 + profile.tech * 700, now, 0.85, 0.08 + force * 0.06, profile.tech > 0.5 ? 'sawtooth' : 'triangle', graph.effects);
      for (let index = 0; index < 5; index += 1) this.tone(280 + index * 92, now + 0.1 + index * 0.12, 0.1, 0.018 + profile.tech * 0.01, 'square', graph.effects);
      return;
    }
    this.noiseBurst(now, 0.55, 420 + profile.tech * 1200, 0.72, graph.effects, 0.18 + force * 0.12);
    this.pitchDrop(220 + profile.tech * 260, 42, now, 0.75, 0.18 + force * 0.14, 'sawtooth', graph.effects);
    this.tone(54, now, 0.7, 0.15, 'sine', graph.effects);
  }

  playCountdown(count: number): void {
    const context = this.context;
    const graph = this.graph;
    if (!context || !graph || context.state !== 'running') return;
    const now = context.currentTime;
    if (count > 0) {
      this.tone(this.midi(67 + Math.max(0, 3 - count) * 2), now, 0.18, 0.08, 'square', graph.effects);
      this.tone(this.midi(55), now, 0.12, 0.035, 'sine', graph.effects);
    } else {
      this.pitchDrop(this.midi(76), this.midi(64), now, 0.52, 0.095, 'sawtooth', graph.effects);
      this.pitchDrop(this.midi(69), this.midi(57), now + 0.015, 0.62, 0.065, 'square', graph.effects);
      this.noiseBurst(now, 0.11, 1800, 0.8, graph.effects, 0.05);
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gestureCleanup?.();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    try { this.waterSource?.stop(); } catch { /* already stopped */ }
    try { this.windSource?.stop(); } catch { /* already stopped */ }
    try { this.hullOscillator?.stop(); } catch { /* already stopped */ }
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = undefined;
    this.graph = undefined;
  }

  private buildGraph(context: AudioContext): void {
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const music = context.createGain();
    const effects = context.createGain();
    const ambience = context.createGain();
    const waterGain = context.createGain();
    const waterFilter = context.createBiquadFilter();
    const windGain = context.createGain();
    const windFilter = context.createBiquadFilter();
    const hullGain = context.createGain();
    const hullFilter = context.createBiquadFilter();

    master.gain.value = this.muted ? 0 : this.options.masterVolume;
    music.gain.value = this.options.musicVolume;
    effects.gain.value = this.options.effectsVolume;
    ambience.gain.value = this.options.ambienceVolume;
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    music.connect(master);
    effects.connect(master);
    ambience.connect(master);
    master.connect(compressor);
    compressor.connect(context.destination);

    waterFilter.type = 'bandpass';
    waterFilter.frequency.value = 680;
    waterFilter.Q.value = 1;
    waterGain.gain.value = 0.02;
    waterFilter.connect(waterGain).connect(ambience);

    windFilter.type = 'highpass';
    windFilter.frequency.value = 620;
    windGain.gain.value = 0.012;
    windFilter.connect(windGain).connect(ambience);

    hullFilter.type = 'lowpass';
    hullFilter.frequency.value = 70;
    hullFilter.Q.value = 8;
    hullGain.gain.value = 0.005;
    hullFilter.connect(hullGain).connect(ambience);

    this.graph = { master, compressor, music, effects, ambience, waterGain, waterFilter, windGain, windFilter, hullGain, hullFilter };
    this.noiseBuffer = this.makeNoiseBuffer(context, 3);
    this.waterSource = this.loopNoise(context, waterFilter);
    this.windSource = this.loopNoise(context, windFilter, 1.37);
    this.hullOscillator = context.createOscillator();
    this.hullOscillator.type = 'sine';
    this.hullOscillator.frequency.value = this.currentProfile.hullPitch;
    this.hullOscillator.connect(hullFilter);
    this.hullOscillator.start();
    this.nextMusicAt = context.currentTime + 0.05;
    this.nextCreakAt = context.currentTime + 1.2;
    this.nextThunderAt = context.currentTime + 4;
  }

  private loopNoise(context: AudioContext, destination: AudioNode, rate = 1): AudioBufferSourceNode {
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer ?? this.makeNoiseBuffer(context, 3);
    source.loop = true;
    source.playbackRate.value = rate;
    source.connect(destination);
    source.start();
    return source;
  }

  private makeNoiseBuffer(context: AudioContext, duration: number): AudioBuffer {
    const length = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = this.random() * 2 - 1;
      previous = previous * 0.72 + white * 0.28;
      data[index] = white * 0.64 + previous * 0.36;
    }
    return buffer;
  }

  private updateReloadAudio(player: ShipState): void {
    const current = {
      port: player.weapons.portCooldown,
      starboard: player.weapons.starboardCooldown,
      bow: player.weapons.bowCooldown,
    };
    const previous = this.lastWeaponCooldowns;
    this.lastWeaponCooldowns = current;
    if (!previous) return;

    (['port', 'starboard', 'bow'] as const).forEach((side) => {
      if (current[side] > previous[side] + 0.08) {
        this.reloadStages[side] = 'started';
        this.playReload(side, 'start');
      }
      if (this.reloadStages[side] === 'started' && previous[side] > 1 && current[side] <= 1) {
        this.reloadStages[side] = 'rammed';
        this.playReload(side, 'ram');
      }
      if (previous[side] > 0.001 && current[side] <= 0.001) {
        this.reloadStages[side] = 'idle';
        this.playReload(side, 'ready');
      }
    });
  }

  private updateThreatAudio(state: WorldState, player: ShipState, now: number): void {
    if (now < this.nextThreatCueAt) return;
    let nearest: { distance: number; pan: number } | undefined;
    for (const projectile of state.projectiles) {
      if (projectile.ownerId === player.id) continue;
      const toPlayerX = player.position.x - projectile.position.x;
      const toPlayerZ = player.position.z - projectile.position.z;
      const distance = Math.hypot(toPlayerX, toPlayerZ);
      const closing = projectile.velocity.x * toPlayerX + projectile.velocity.z * toPlayerZ > 0;
      if (!closing || distance > 150 || (nearest && distance >= nearest.distance)) continue;
      const bearing = Math.atan2(-(projectile.position.x - player.position.x), -(projectile.position.z - player.position.z));
      const relative = Math.atan2(Math.sin(bearing - player.heading), Math.cos(bearing - player.heading));
      nearest = { distance, pan: Math.sin(relative) * 0.8 };
    }
    if (!nearest) return;
    this.playThreatCue(undefined, 'incoming', nearest.pan);
    this.nextThreatCueAt = now + 1.35;
  }

  private updateSurrenderAudio(state: WorldState): void {
    const surrendered = new Set(state.ships.filter((ship) => ship.surrendered).map((ship) => ship.id));
    if (this.hasObservedSurrenders) {
      for (const shipId of surrendered) {
        if (!this.surrenderedShips.has(shipId) && shipId !== state.playerId) this.playStatus('surrendered');
      }
    }
    this.surrenderedShips = surrendered;
    this.hasObservedSurrenders = true;
  }

  private updateTargetStatusAudio(state: WorldState, player: ShipState): void {
    const explicit = player.targetId ? state.ships.find((ship) => ship.id === player.targetId) : undefined;
    const target = explicit ?? (state.mode === 'combat'
      ? state.ships
        .filter((ship) => ship.id !== player.id && !ship.surrendered
          && (ship.targetId === player.id || areFactionsHostile(ship.faction, player.faction)))
        .sort((first, second) => {
          const firstDistance = Math.hypot(first.position.x - player.position.x, first.position.z - player.position.z);
          const secondDistance = Math.hypot(second.position.x - player.position.x, second.position.z - player.position.z);
          return firstDistance - secondDistance;
        })[0]
      : undefined);
    if (!target) {
      this.trackedTargetId = undefined;
      this.trackedTargetOpening = false;
      this.trackedTargetCritical = false;
      return;
    }
    const opening = state.combat?.weakPointTargetId === target.id && state.combat.weakPointTimer > 0;
    const critical = target.damage.hull >= 0.7;
    if (target.id !== this.trackedTargetId) {
      this.trackedTargetId = target.id;
      this.trackedTargetOpening = opening;
      this.trackedTargetCritical = critical;
      return;
    }
    if (opening && !this.trackedTargetOpening) this.playOpeningCue();
    if (critical && !this.trackedTargetCritical) this.playStatus('critical');
    this.trackedTargetOpening = opening;
    this.trackedTargetCritical = critical;
  }

  private selectMusicMode(state: WorldState): MusicMode {
    if (state.mode === 'race' || state.race.active) return 'race';
    if (state.mode === 'combat' || state.mode === 'boarding') return 'combat';
    if (state.weather === 'storm' || state.weather === 'maelstrom') return 'storm';
    return 'exploration';
  }

  private transitionMusic(mode: MusicMode, now: number): void {
    this.currentMode = mode;
    this.musicStep = 0;
    this.nextMusicAt = Math.max(now + 0.03, this.nextMusicAt);
    if (this.graph) {
      const targetVolume = this.options.musicVolume * (mode === 'combat' ? 1.14 : mode === 'race' ? 1.08 : 1);
      this.target(this.graph.music.gain, targetVolume, now, 0.35);
    }
  }

  private scheduleMusic(now: number, player?: ShipState): void {
    const secondsPerStep = 60 / TEMPOS[this.currentMode] / 4;
    let scheduled = 0;
    while (this.nextMusicAt < now + 0.18 && scheduled < 6) {
      this.scheduleMusicStep(this.currentMode, this.musicStep, this.nextMusicAt, player);
      this.nextMusicAt += secondsPerStep;
      this.musicStep = (this.musicStep + 1) % 64;
      scheduled += 1;
    }
    if (this.nextMusicAt < now - 0.5) this.nextMusicAt = now;
  }

  private scheduleMusicStep(mode: MusicMode, absoluteStep: number, at: number, player?: ShipState): void {
    const graph = this.graph;
    if (!graph) return;
    const step = absoluteStep % 16;
    const bar = Math.floor(absoluteStep / 16);
    const root = mode === 'combat' ? 43 : mode === 'race' ? 50 : mode === 'storm' ? 45 : 48;
    const scale = SCALES[mode];
    const leadIndex = LEAD_PATTERNS[mode][step];
    const intensity = player ? this.clamp(Math.abs(player.speed) / Math.max(1, player.maxSpeed)) : 0.35;

    if (leadIndex >= 0 && (mode !== 'exploration' || bar % 2 === 0 || step % 4 === 0)) {
      const note = root + 12 + scale[leadIndex % scale.length] + (bar % 2) * 12;
      const wave: OscillatorType = mode === 'race' ? 'square' : mode === 'combat' ? 'sawtooth' : 'triangle';
      this.tone(this.midi(note), at, mode === 'exploration' ? 0.32 : 0.16, 0.018 + intensity * 0.012, wave, graph.music, bar % 2 ? 4 : -4);
    }

    if (step % 4 === 0) {
      const bassOffset = [0, 0, 3, 2][Math.floor(step / 4)];
      this.tone(this.midi(root - 12 + scale[bassOffset]), at, mode === 'race' ? 0.19 : 0.32, 0.038, 'triangle', graph.music);
    }
    if (step === 0 || step === 8) this.musicKick(at, mode === 'combat' ? 0.075 : 0.05);
    if ((mode === 'combat' || mode === 'race') && (step === 4 || step === 12)) this.musicSnare(at, 0.052);
    if (mode === 'race' && step % 2 === 0) this.musicHat(at, step % 4 === 2 ? 0.027 : 0.018);
    if (mode === 'combat' && (step === 3 || step === 7 || step === 11 || step === 15)) this.musicHat(at, 0.025);
    if (mode === 'storm' && (step === 2 || step === 10)) this.musicSnare(at, 0.025);

    if (step === 0 && mode !== 'combat') {
      const chord = [0, mode === 'storm' ? 3 : 4, 7];
      chord.forEach((offset, index) => this.tone(this.midi(root + offset), at + index * 0.012, 1.05, 0.009, 'sine', graph.music, index * 3 - 3));
    }
  }

  private musicKick(at: number, gain: number): void {
    if (!this.graph) return;
    this.pitchDrop(120, 42, at, 0.13, gain, 'sine', this.graph.music);
  }

  private musicSnare(at: number, gain: number): void {
    if (!this.graph) return;
    this.noiseBurst(at, 0.09, 1600, 0.9, this.graph.music, gain, 'bandpass');
  }

  private musicHat(at: number, gain: number): void {
    if (!this.graph) return;
    this.noiseBurst(at, 0.035, 5900, 0.7, this.graph.music, gain, 'highpass');
  }

  private playCreak(profile: AudioProfile, speedRatio: number, at: number): void {
    if (!this.graph) return;
    const base = profile.hullPitch * (2.4 + this.random() * 1.5);
    const duration = 0.22 + this.random() * 0.5;
    const amount = (0.018 + speedRatio * 0.024) * profile.timber;
    this.pitchRise(base * 0.86, base * 1.18, at, duration, amount, 'sawtooth', this.graph.ambience);
    this.tone(base * 2.03, at + duration * 0.2, duration * 0.62, amount * 0.35, 'square', this.graph.ambience, -12);
  }

  private playThunder(strength: number, at = this.context?.currentTime ?? 0): void {
    if (!this.graph || !this.context || this.context.state !== 'running') return;
    const force = this.clamp(strength);
    this.noiseBurst(at, 0.65 + force * 0.8, 110 + force * 90, 0.68, this.graph.effects, 0.12 + force * 0.17);
    this.pitchDrop(74, 24, at + 0.03, 0.9, 0.08 + force * 0.1, 'sine', this.graph.effects);
    this.noiseBurst(at + 0.18, 1.2, 260, 0.55, this.graph.effects, 0.06 + force * 0.08);
  }

  private playCheckpoint(): void {
    if (!this.context || !this.graph || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    [72, 76, 79].forEach((note, index) => this.tone(this.midi(note), now + index * 0.055, 0.2, 0.032, 'square', this.graph!.effects));
  }

  private playFanfare(victory: boolean): void {
    if (!this.context || !this.graph || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const notes = victory ? [60, 64, 67, 72, 76] : [60, 58, 55, 48];
    notes.forEach((note, index) => {
      const duration = index === notes.length - 1 ? 0.85 : 0.24;
      this.tone(this.midi(note), now + index * 0.14, duration, 0.055, victory ? 'square' : 'triangle', this.graph!.effects);
      if (victory && index === notes.length - 1) this.tone(this.midi(note - 12), now + index * 0.14, duration, 0.045, 'sawtooth', this.graph!.effects);
    });
  }

  private playDiscovery(): void {
    if (!this.context || !this.graph || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    [67, 72, 76, 79].forEach((note, index) => this.tone(this.midi(note), now + index * 0.11, 0.45, 0.026, 'triangle', this.graph!.effects, index % 2 ? 7 : -7));
  }

  private playCalloutCue(tone: 'info' | 'danger' | 'success' | 'race'): void {
    if (!this.context || !this.graph || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const notes = tone === 'danger' ? [55, 51] : tone === 'success' ? [64, 71] : tone === 'race' ? [67, 69] : [62, 67];
    notes.forEach((note, index) => this.tone(this.midi(note), now + index * 0.075, 0.13, 0.018, 'square', this.graph!.effects));
  }

  private playRepair(phase: 'start' | 'tick' | 'complete'): void {
    if (!this.context || !this.graph || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (phase === 'complete') {
      [60, 64, 67].forEach((note, index) => this.tone(this.midi(note), now + index * 0.07, 0.2, 0.024, 'triangle', this.graph!.effects));
      return;
    }
    this.noiseBurst(now, 0.04, 2200, 1.5, this.graph.effects, 0.026, 'bandpass');
    this.pitchDrop(520, 180, now, 0.06, phase === 'start' ? 0.04 : 0.026, 'square', this.graph.effects);
  }

  private tone(
    frequency: number,
    at: number,
    duration: number,
    peak: number,
    wave: OscillatorType,
    destination: AudioNode,
    detune = 0,
  ): void {
    const context = this.context;
    if (!context || at < context.currentTime - 0.1) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), at);
    oscillator.detune.value = detune;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + Math.min(0.018, duration * 0.18));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  private pitchDrop(
    start: number,
    end: number,
    at: number,
    duration: number,
    peak: number,
    wave: OscillatorType,
    destination: AudioNode,
  ): void {
    const context = this.context;
    if (!context || at < context.currentTime - 0.1) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(Math.max(20, start), at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  private pitchRise(
    start: number,
    end: number,
    at: number,
    duration: number,
    peak: number,
    wave: OscillatorType,
    destination: AudioNode,
  ): void {
    const context = this.context;
    if (!context || at < context.currentTime - 0.1) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(Math.max(20, start), at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + duration * 0.76);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  private noiseBurst(
    at: number,
    duration: number,
    frequency: number,
    q: number,
    destination: AudioNode,
    peak: number,
    filterType: BiquadFilterType = 'lowpass',
  ): void {
    const context = this.context;
    const buffer = this.noiseBuffer;
    if (!context || !buffer || at < context.currentTime - 0.1) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = 0.86 + this.random() * 0.34;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + Math.min(0.006, duration * 0.12));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(at, this.random() * Math.max(0.01, buffer.duration - duration));
    source.stop(at + duration + 0.02);
  }

  private target(parameter: AudioParam, value: number, at: number, constant: number): void {
    parameter.cancelScheduledValues(at);
    parameter.setTargetAtTime(Math.max(0.0001, value), at, constant);
  }

  private pannedOutput(destination: AudioNode, pan: number): AudioNode {
    const context = this.context;
    const amount = Math.min(1, Math.max(-1, pan));
    if (!context || Math.abs(amount) < 0.01) return destination;
    const panner = context.createStereoPanner();
    panner.pan.value = amount;
    panner.connect(destination);
    window.setTimeout(() => panner.disconnect(), 2400);
    return panner;
  }

  private sidePan(side?: ShipSide): number {
    if (side === 'port') return -0.58;
    if (side === 'starboard') return 0.58;
    return 0;
  }

  private midi(note: number): number {
    return 440 * 2 ** ((note - 69) / 12);
  }

  private normalizedLevel(value: number): number {
    return this.clamp(value > 1 ? value / 100 : value);
  }

  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  private random(): number {
    let value = this.randomState | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value | 0;
    return (value >>> 0) / 4_294_967_296;
  }
}
