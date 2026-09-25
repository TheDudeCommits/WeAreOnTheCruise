/**
 * Run tracker (REPLAY): reads the SimEvents the runtime already drains every frame and keeps the counters quests
 * need (bounty captains, set pieces won, rogue-wave rides, kraken survivals, no-hit bosses, overdrives, parries).
 * It never touches the sim. `observe` also returns banner events for voyage quests met mid-run, which the runtime
 * appends to the frame's events so the HUD shows them like any 'director-event'.
 *
 * Counters come in two flavours: `run` covers the whole voyage (best-in-one-voyage quests), `delta` only what
 * happened since the last `take()` (ledger quests), so an endless stretch after a victory is not counted twice.
 */
import { questsMetMidRun, rewardText, type RunRecord } from './quests';
import type { MetaProfile, RunResult, RunState, SimEvent } from '../types';
import { MILESTONES } from '../sim/run-mods';

type Counters = Omit<RunRecord, 'result' | 'heat' | 'daily'>;

const zero = (): Counters => ({
  bountyCaptains: 0, eventsWon: 0, rogueRides: 0, krakenSurvived: 0, noHitBosses: 0, bossesSunk: 0, fastWardens: 0,
  overdrives: 0, parries: 0, milestones: 0,
});

/** Seconds within which an Iron Warden must sink for 'Warden Breaker'. */
const FAST_WARDEN = 60;

export class RunTracker {
  private readonly run = zero();
  private delta = zero();
  /** Hull damage taken since each live boss arrived, and when it arrived (by boss id). */
  private readonly bosses = new Map<number, { hurt: number; at: number }>();
  private readonly overdrive = new Set<string>();
  private readonly announced = new Set<string>();
  /** Mid-run quest checks run when a counter moved, or every CHECK_EVERY observed frames (level, elites). */
  private dirty = false;
  private frames = 0;

  constructor(private readonly profile: Readonly<MetaProfile>, readonly heat = 0, readonly daily?: string) {}

  private bump(key: keyof Counters, n = 1): void { this.run[key] += n; this.delta[key] += n; this.dirty = true; }

  /** Folds one frame's events in; returns banner events for quests met just now (may be empty). */
  observe(events: readonly SimEvent[], state: Readonly<RunState> | null): SimEvent[] {
    if (events.length === 0 || !state) return NONE;
    for (const e of events) {
      switch (e.type) {
        case 'boss-spawned': this.bosses.set(e.id, { hurt: 0, at: state.time }); break;
        case 'player-hit':
          if (e.parried) this.bump('parries');
          else if (e.amount > 0) for (const b of this.bosses.values()) b.hurt += e.amount;
          break;
        case 'boss-defeated': {
          this.bump('bossesSunk');
          const b = this.bosses.get(e.id);
          if (b && b.hurt <= 0) this.bump('noHitBosses');
          if (b && e.boss === 'iron-warden' && state.time - b.at <= FAST_WARDEN) this.bump('fastWardens');
          this.bosses.delete(e.id);
          break;
        }
        case 'enemy-killed':
          if (e.elite && isNamed(state, e.id)) this.bump('bountyCaptains');
          break;
        case 'world-event':
          if (e.phase === 'success') { this.bump('eventsWon'); if (e.id === 'rogue-wave') this.bump('rogueRides'); }
          else if (e.phase === 'end' && e.id === 'kraken-rising' && state.player.alive && e.text !== 'Cut short') this.bump('krakenSurvived');
          break;
        case 'weapon-changed':
          if (e.overdrive && !this.overdrive.has(e.weapon)) {
            this.overdrive.add(e.weapon);
            this.run.overdrives = this.overdrive.size;
            this.dirty = true;
          }
          break;
        default: break;
      }
    }
    const milestones = state.director.scratch[MILESTONES] ?? 0;
    if (milestones > this.run.milestones) { this.delta.milestones += milestones - this.run.milestones; this.run.milestones = milestones; this.dirty = true; }
    if (!this.dirty && ++this.frames % CHECK_EVERY !== 0) return NONE;
    this.dirty = false;
    const met = questsMetMidRun(this.profile, { ...this.run, result: pseudoResult(state), heat: this.heat, daily: this.daily }, this.announced);
    if (met.length === 0) return NONE;
    return met.map((q) => ({ type: 'director-event', name: `Quest complete: ${q.name}`, text: `${q.text} ${rewardText(q.reward) ? `Reward: ${rewardText(q.reward)}, banked at the harbor.` : ''}`.trim() }));
  }

  /** The record to bank now: whole-voyage values for voyage quests, and what happened since the last take for ledger quests. */
  take(result: RunResult): { run: RunRecord; delta: RunRecord } {
    const out = {
      run: { ...this.run, result, heat: this.heat, daily: this.daily },
      delta: { ...this.delta, result, heat: this.heat, daily: this.daily },
    };
    this.delta = zero();
    return out;
  }

  /** Current whole-voyage counters (QA, tests). */
  counters(): Readonly<Counters> { return this.run; }
}

const NONE: SimEvent[] = [];
const CHECK_EVERY = 30;

/** A named bounty captain is an elite with a title (FOES bounty.ts); it is still in the list while it sinks. */
function isNamed(state: Readonly<RunState>, id: number): boolean {
  for (const e of state.enemies) if (e.id === id) return !!e.title;
  return false;
}

/** The fields voyage quests read, from the live state (mid-run checks only). */
function pseudoResult(state: Readonly<RunState>): RunResult {
  return {
    outcome: 'retired', shipId: state.shipId, seaId: state.seaId, time: state.time, level: state.player.level,
    stats: state.stats, doubloonsEarned: state.stats.doubloons, newUnlocks: [],
  };
}
