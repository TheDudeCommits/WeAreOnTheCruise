/**
 * World-event tracker (EVENTS built it; FLOW owns the HUD now): the set piece running now, from `run.worldEvent` —
 * name, objective line, progress (a count, dig seconds, or the clock for survival pieces) and time left — plus its
 * outcome flourish (gold stamp on success, red on failure) from the 'world-event' success|fail phases. It lives in the
 * HUD's top-centre stack (boss ETA · boss bar · tracker), so it can never sit on the boss bar; while a boss bar shows
 * it drops to a compact one-line form. Built once; per-frame work only touches cached cells.
 */
import type { RunState, WorldEventState } from '../../game/types';
import type { UiFrame } from '../contracts';
import { ClassCell, StyleCell, TextCell, h, play } from '../core/dom';
import { glyph, type GlyphId } from '../core/icons';

export const EVENT_GLYPH: Readonly<Record<string, GlyphId>> = {
  'kraken-rising': 'dive',
  'rogue-wave': 'wave',
  maelstrom: 'vortex',
  'admiralty-blockade': 'ship',
  'ghost-fleet': 'skull',
  'volcanic-eruption': 'flame',
  'sunken-treasure': 'chest',
  'bounty-contract': 'crosshair',
  'treasure-convoy': 'coin',
};

/** Objectives measured in seconds (progress = seconds done). */
const SECONDS = new Set(['sunken-treasure']);
/** Objectives the ship must sail to: the tracker shows how far off they are. */
const DISTANCE = new Set(['sunken-treasure', 'admiralty-blockade']);

/** Outcome stamp words. */
const WIN: Readonly<Record<string, string>> = {
  'kraken-rising': 'Repelled!', 'rogue-wave': 'Rode it!', maelstrom: 'Fed!', 'admiralty-blockade': 'Broken!',
  'ghost-fleet': 'Laid to rest!', 'volcanic-eruption': 'Survived!', 'sunken-treasure': 'Raised!', 'bounty-contract': 'Collected!',
  'treasure-convoy': 'Plundered!',
};
const LOSE: Readonly<Record<string, string>> = {
  'kraken-rising': 'Escaped', 'admiralty-blockade': 'Holds', 'ghost-fleet': 'Sunk back', 'sunken-treasure': 'Lost', 'bounty-contract': 'Expired',
  'treasure-convoy': 'Escaped',
};

const FADE_S = 0.42;

export class EventTracker {
  readonly el: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly name: TextCell;
  private readonly goal: TextCell;
  private readonly time: TextCell;
  private readonly count: TextCell;
  private readonly stamp: TextCell;
  private readonly dist: TextCell;
  private readonly fill: StyleCell;
  private readonly on: ClassCell;
  private readonly win: ClassCell;
  private readonly lose: ClassCell;
  private readonly urgent: ClassCell;
  private readonly timer: ClassCell;
  private readonly leaving: ClassCell;
  private current: WorldEventState | null = null;
  /** 0 running, 1 succeeded, 2 failed. */
  private verdict = 0;
  private lastProgress = -1;
  private lastSecond = -1;
  private lastFill = -1;
  private lastDist = -1;
  private hideAt = 0;

  constructor() {
    const name = h('span', 'cr-evtrack__name');
    const goal = h('span', 'cr-evtrack__goal');
    const time = h('span', 'cr-evtrack__time');
    const count = h('span', 'cr-evtrack__count');
    const stamp = h('span', 'cr-evtrack__stamp');
    const dist = h('span', 'cr-evtrack__dist');
    const fill = h('span', 'cr-evtrack__fill');
    this.icon = h('span', 'cr-evtrack__icon');
    this.bar = h('span', 'cr-evtrack__bar', fill, h('span', 'cr-evtrack__notch'), count);
    this.el = h('div', 'cr-evtrack',
      this.icon,
      h('div', 'cr-evtrack__body', h('div', 'cr-evtrack__head', name, dist, time), goal, this.bar),
      stamp,
    );
    this.name = new TextCell(name);
    this.goal = new TextCell(goal);
    this.time = new TextCell(time);
    this.count = new TextCell(count);
    this.stamp = new TextCell(stamp);
    this.dist = new TextCell(dist);
    this.fill = new StyleCell(fill, 'transform');
    this.on = new ClassCell(this.el, 'is-on');
    this.win = new ClassCell(this.el, 'is-win');
    this.lose = new ClassCell(this.el, 'is-lose');
    this.urgent = new ClassCell(this.el, 'is-urgent');
    this.timer = new ClassCell(this.el, 'is-timer');
    this.leaving = new ClassCell(this.el, 'is-leaving');
  }

  reset(): void {
    this.current = null;
    this.verdict = 0;
    this.hideAt = 0;
    this.on.set(false); this.win.set(false); this.lose.set(false); this.leaving.set(false);
  }

  update(run: Readonly<RunState>, f: UiFrame): void {
    const ev = run.worldEvent;
    if (ev && ev !== this.current) this.begin(ev);
    for (let i = 0; i < f.events.length; i++) {
      const e = f.events[i]!;
      if (e.type !== 'world-event' || !this.current || e.id !== this.current.id || this.verdict) continue;
      if (e.phase === 'success') this.outcome(true);
      else if (e.phase === 'fail') this.outcome(false);
    }
    if (!ev) {
      if (this.current) { this.current = null; this.leaving.set(true); this.hideAt = f.time + FADE_S; }
      if (this.hideAt > 0 && f.time >= this.hideAt) { this.hideAt = 0; this.on.set(false); this.leaving.set(false); }
      return;
    }
    this.render(ev, run);
  }

  private begin(ev: WorldEventState): void {
    this.current = ev;
    this.verdict = 0;
    this.hideAt = 0;
    this.lastProgress = -1;
    this.lastSecond = -1;
    this.lastFill = -1;
    this.lastDist = -1;
    this.dist.set('');
    this.el.dataset.event = ev.id;
    this.icon.replaceChildren(glyph(EVENT_GLYPH[ev.id] ?? 'flare'));
    this.name.set(ev.name);
    this.goal.set(ev.text);
    this.stamp.set('');
    this.win.set(false); this.lose.set(false); this.leaving.set(false); this.urgent.set(false);
    const hasGoal = ev.goal !== undefined && ev.goal > 0;
    this.timer.set(!hasGoal);
    this.bar.style.setProperty('--seg', String(hasGoal && !SECONDS.has(ev.id) ? Math.min(16, ev.goal!) : 1));
    this.on.set(true);
    play(this.el, [
      { opacity: 0, transform: 'translateY(-18px) scale(1.12)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration: 380, easing: 'cubic-bezier(.2,1.3,.3,1)' });
  }

  private render(ev: WorldEventState, run: Readonly<RunState>): void {
    const left = Math.max(0, ev.duration - ev.time);
    const sec = Math.ceil(left);
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      this.time.set(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
      this.urgent.set(sec <= 10 && this.verdict === 0);
    }
    const goal = ev.goal ?? 0;
    let frac: number;
    if (goal > 0) {
      const p = Math.max(0, Math.min(goal, ev.progress ?? 0));
      frac = p / goal;
      const shown = SECONDS.has(ev.id) ? Math.floor(p) : Math.round(p);
      if (shown !== this.lastProgress) {
        if (this.lastProgress >= 0 && shown > this.lastProgress) play(this.bar, [{ filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }], { duration: 280 });
        this.lastProgress = shown;
        this.count.set(SECONDS.has(ev.id) ? `${shown}s / ${goal}s` : `${shown} / ${goal}`);
      }
    } else {
      frac = ev.duration > 0 ? left / ev.duration : 0;
      if (this.lastProgress !== -2) { this.lastProgress = -2; this.count.set('Survive'); }
    }
    const q = Math.round(frac * 400);
    if (q !== this.lastFill) { this.lastFill = q; this.fill.set(`scaleX(${(q / 400).toFixed(4)})`); }
    // How far off a sail-to objective is (hidden once the ship is there or the verdict is in).
    let dm = 0;
    if (DISTANCE.has(ev.id) && ev.x !== undefined && ev.z !== undefined && this.verdict === 0) {
      const d = Math.hypot(ev.x - run.player.x, ev.z - run.player.z) - (ev.radius ?? 0);
      dm = d > 15 ? Math.round(d / 10) * 10 : 0;
    }
    if (dm !== this.lastDist) { this.lastDist = dm; this.dist.set(dm > 0 ? `${dm} m` : ''); }
  }

  private outcome(success: boolean): void {
    const id = this.current?.id ?? '';
    this.verdict = success ? 1 : 2;
    this.win.set(success);
    this.lose.set(!success);
    this.urgent.set(false);
    this.stamp.set(success ? WIN[id] ?? 'Complete!' : LOSE[id] ?? 'Failed');
    play(this.el, success
      ? [
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(1.08)', filter: 'brightness(1.8)', offset: 0.25 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ]
      : [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-10px)', offset: 0.2 },
        { transform: 'translateX(8px)', offset: 0.4 },
        { transform: 'translateX(-5px)', offset: 0.6 },
        { transform: 'translateX(0)' },
      ], { duration: success ? 620 : 480, easing: 'ease-out' });
  }
}
