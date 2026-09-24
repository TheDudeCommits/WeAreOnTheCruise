/**
 * Crew barks (AUDIO-owned): the bosun and the lookout shout about what matters, sparingly. The router reports
 * moments (router.ts RouterMoment); this picks at most one line at a time, respects a global gap and per-moment
 * cooldowns, holds an urgent line briefly if another is still speaking, and dips the music under the voice.
 *
 * Priorities: 4 must-hear (a grab, victory), 3 teaching or danger (tether, wisps, rogue wave, marked, boss, hull),
 * 2 set pieces, 1 flavour, 0 chatter. Teaching lines name the counter-play ("Boost to snap the line!").
 */
import type { RunState } from '../game/types';
import type { CueId } from './generated/cueIds';
import type { RunLayer } from './heat';
import type { RouterMoment } from './router';
import type { DuckSpec, PlayOptions } from './types';

export interface BarkHooks {
  play(cue: CueId, opts?: PlayOptions): boolean;
  duck(spec: DuckSpec): void;
  cueLength(cue: CueId): number;
}

interface BarkRule { cue: CueId; chance: number; cooldown: number; priority: number }

const RULES: Partial<Record<RouterMoment, BarkRule>> = {
  'kraken-grab': { cue: 'bark-grab', chance: 1, cooldown: 20, priority: 4 },
  victory: { cue: 'bark-victory', chance: 1, cooldown: 60, priority: 4 },
  tethered: { cue: 'bark-harpoon', chance: 1, cooldown: 35, priority: 3 },
  wisps: { cue: 'bark-wisps', chance: 1, cooldown: 35, priority: 3 },
  'rogue-wave': { cue: 'bark-wave', chance: 1, cooldown: 60, priority: 3 },
  marked: { cue: 'bark-marked', chance: 1, cooldown: 30, priority: 3 },
  'boss-warning': { cue: 'bark-boss', chance: 1, cooldown: 30, priority: 3 },
  'low-hull': { cue: 'bark-water', chance: 1, cooldown: 30, priority: 3 },
  kraken: { cue: 'bark-kraken', chance: 1, cooldown: 60, priority: 2 },
  maelstrom: { cue: 'bark-whirlpool', chance: 1, cooldown: 60, priority: 2 },
  'ghost-fleet': { cue: 'bark-ghosts', chance: 1, cooldown: 60, priority: 2 },
  blockade: { cue: 'bark-blockade', chance: 1, cooldown: 60, priority: 2 },
  eruption: { cue: 'bark-eruption', chance: 1, cooldown: 60, priority: 2 },
  'galleon-rising': { cue: 'bark-rising', chance: 0.8, cooldown: 45, priority: 2 },
  'boss-defeated': { cue: 'bark-sink', chance: 1, cooldown: 10, priority: 2 },
  'elite-spawned': { cue: 'bark-elite', chance: 0.6, cooldown: 45, priority: 2 },
  broadside: { cue: 'bark-fire', chance: 0.35, cooldown: 22, priority: 1 },
  brace: { cue: 'bark-brace', chance: 0.3, cooldown: 25, priority: 1 },
  'elite-killed': { cue: 'bark-sink', chance: 0.6, cooldown: 25, priority: 1 },
  'captain-sunk': { cue: 'bark-captain-down', chance: 0.6, cooldown: 45, priority: 1 },
  beacon: { cue: 'bark-beacon', chance: 1, cooldown: 60, priority: 1 },
  'wave-rider': { cue: 'bark-rider', chance: 1, cooldown: 30, priority: 1 },
  treasure: { cue: 'bark-treasure', chance: 0.8, cooldown: 60, priority: 1 },
  'level-up': { cue: 'bark-level', chance: 0.4, cooldown: 90, priority: 0 },
  'kill-streak': { cue: 'bark-sink', chance: 0.5, cooldown: 40, priority: 0 },
  chest: { cue: 'bark-treasure', chance: 0.3, cooldown: 60, priority: 0 },
};

/** Seconds between two barks (priority ≥ 3 may cut it to MIN_GAP_URGENT). */
const MIN_GAP = 7;
const MIN_GAP_URGENT = 2.5;
/** An urgent line that finds the crew still speaking waits this long for its turn, then drops. */
const HOLD = 1.5;

export class CrewBarks {
  /** Barks spoken this run (debug readout). */
  readonly spoken: Record<string, number> = {};
  private readonly lastMoment = new Map<RouterMoment, number>();
  private speakingUntil = 0;
  private lastBark = -100;
  private queued: { rule: BarkRule; until: number } | null = null;
  private combatCalled = false;
  private enabled = true;

  constructor(private readonly h: BarkHooks) {}

  /** Mute or allow the crew (a setting could drive this later). */
  setEnabled(on: boolean): void { this.enabled = on; if (!on) this.queued = null; }

  resetRun(): void {
    this.lastMoment.clear();
    this.queued = null;
    this.combatCalled = false;
    this.speakingUntil = 0;
    this.lastBark = -100;
  }

  /** A moment from the router (or the music layer). */
  moment(kind: RouterMoment, now: number, run: Readonly<RunState> | null): void {
    if (!this.enabled) return;
    const rule = RULES[kind];
    if (!rule) return;
    if (!run || (run.status !== 'running' && kind !== 'victory')) return;
    const last = this.lastMoment.get(kind) ?? -1e9;
    if (now - last < rule.cooldown) return;
    if (rule.chance < 1 && Math.random() > rule.chance) { this.lastMoment.set(kind, now - rule.cooldown * 0.5); return; }
    this.lastMoment.set(kind, now);
    if (!this.speak(rule, now) && rule.priority >= 3 && (!this.queued || this.queued.rule.priority <= rule.priority)) {
      this.queued = { rule, until: now + HOLD };
    }
  }

  /** Per frame: queued urgent lines, and "Man the guns!" when the first fight of a run starts. */
  update(now: number, run: Readonly<RunState> | null, layer: RunLayer | null): void {
    if (!run) return;
    if (this.queued) {
      if (now > this.queued.until) this.queued = null;
      else if (this.speak(this.queued.rule, now)) this.queued = null;
    }
    if (!this.combatCalled && layer === 'combat' && run.status === 'running') {
      this.combatCalled = true;
      this.speak({ cue: 'bark-guns', chance: 1, cooldown: 0, priority: 1 }, now);
    }
  }

  private speak(rule: BarkRule, now: number): boolean {
    if (now < this.speakingUntil) return false;
    const gap = rule.priority >= 3 ? MIN_GAP_URGENT : MIN_GAP;
    if (now - this.lastBark < gap) return false;
    if (!this.h.play(rule.cue)) return false;
    const len = this.h.cueLength(rule.cue) || 2;
    this.lastBark = now;
    this.speakingUntil = now + len;
    this.spoken[rule.cue] = (this.spoken[rule.cue] ?? 0) + 1;
    // Under the music, not over it: a small dip so the words read through the score.
    this.h.duck({ target: 'music', depth: -3, hold: Math.max(0.4, len - 0.4), attack: 0.12, release: 0.5 });
    return true;
  }
}
