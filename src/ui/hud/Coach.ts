/**
 * First-voyage coach (FLOW). A new captain (fewer than three voyages) gets short contextual prompts during the first
 * two minutes of a voyage, one at a time, each shown once ever:
 *  - sail gears (after a few seconds), auto-fire (first enemy in range), Full Broadside (ready with a target near),
 *    brace and parry (first mortar circle or hit), boost (a little later, or when the hull runs low), and the wind
 *    (sailing in irons, or late in the window).
 * A prompt closes early (with a tick) when the player does the thing; doing it before the prompt shows retires the
 * prompt for good. The first branch card and the first OVERDRIVE card get a one-time explainer on the card screen
 * (any captain), and so does the rival-captains explainer (once, a little after the first captain sails in).
 * Shown hints are reported through `onSeen` (UiCallbacks.onHintSeen → MetaProfile.seenHints).
 * Settings.coach = false turns all of it off. Key labels follow the player's bindings.
 */
import { controls, type BindAction } from '../../input/Input';
import type { CardOffer, RunState } from '../../game/types';
import type { UiFrame } from '../contracts';
import { ClassCell, h, play, StyleCell, TextCell } from '../core/dom';
import { glyph, type GlyphId } from '../core/icons';
import { keycap, padButton, type PadButton } from '../core/prompts';
import { inIrons } from './wind';

export type HintId = 'sail' | 'autofire' | 'broadside' | 'brace' | 'boost' | 'wind' | 'branch' | 'overdrive' | 'rivals';

export interface HintDef {
  id: HintId;
  title: string;
  text: string;
  icon: GlyphId;
  /** Bound actions (shown with the player's keys) or literal keycaps such as 'LMB'. */
  keys: readonly (BindAction | 'LMB')[];
  pad: readonly PadButton[];
  /** Seconds on screen (0 = card explainer, lives with the card screen). */
  ttl: number;
}

export const HINTS: Readonly<Record<HintId, HintDef>> = {
  sail: { id: 'sail', title: 'Set your sails', text: 'Anchor, half or full sail. Half sail turns tightest; full sail is fastest.', icon: 'sail', keys: ['gear-up', 'gear-down'], pad: ['DPAD'], ttl: 9 },
  autofire: { id: 'autofire', title: 'Your guns fire themselves', text: 'Turn your side to the enemy and every gun that bears opens up. Steer, don’t aim.', icon: 'cannon', keys: ['port', 'starboard'], pad: ['LS'], ttl: 8 },
  broadside: { id: 'broadside', title: 'Full Broadside', text: 'Every gun on the side facing your cursor fires at once. It reloads in a few seconds.', icon: 'cannon', keys: ['LMB', 'broadside'], pad: ['RT'], ttl: 9 },
  brace: { id: 'brace', title: 'Brace for impact', text: 'Bracing cuts the damage you take. Brace just before a hit lands to parry it back.', icon: 'shield', keys: ['brace'], pad: ['A'], ttl: 9 },
  boost: { id: 'boost', title: 'Boost', text: 'A burst of speed to slip out of a ring or run down a straggler. It recharges.', icon: 'speed', keys: ['boost'], pad: ['B'], ttl: 8 },
  wind: { id: 'wind', title: 'Mind the wind', text: 'Bow into the wind you crawl (in irons). Sail across it for top speed: the arrow on the minimap rim shows where it blows.', icon: 'wind', keys: [], pad: [], ttl: 9 },
  branch: { id: 'branch', title: 'A weapon forks', text: 'At level 3 a weapon branches. Pick one path; the other closes for this voyage.', icon: 'wind', keys: [], pad: [], ttl: 0 },
  rivals: { id: 'rivals', title: 'Rival captains', text: 'Other captains hunt this sea too. Full Broadside one to pick a fight: it fights back, and sinking it pays its bounty.', icon: 'ship', keys: ['LMB', 'broadside'], pad: ['RT'], ttl: 10 },
  overdrive: { id: 'overdrive', title: 'Overdrive!', text: 'A maxed weapon can transform into its legendary form: the strongest card it has.', icon: 'star', keys: [], pad: [], ttl: 0 },
};

/** Sailing prompts, in the order they may appear. */
const SAILING: readonly HintId[] = ['sail', 'autofire', 'broadside', 'brace', 'boost', 'wind'];
/** The coach watches the first two minutes of a voyage. */
const WINDOW = 120;
/** "New captain": fewer voyages than this. */
const NEW_CAPTAIN_RUNS = 3;
const GAP = 3.2;
const DONE_HOLD = 1.1;

export class Coach {
  readonly el: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly keysEl: HTMLElement;
  private readonly title: TextCell;
  private readonly text: TextCell;
  private readonly timer: StyleCell;
  private readonly on: ClassCell;
  private readonly done: ClassCell;
  /** Hints never to show again (profile + restored + retired this session). */
  private readonly seen = new Set<string>();
  private current: HintId | null = null;
  private shownAt = 0;
  private doneAt = -1;
  private gapUntil = 0;
  private gearAtShow = -1;
  private wantBrace = false;
  private ironsT = 0;
  private scan = 0;
  private nearest = Infinity;
  private keysVersion = -1;
  private seed = '';
  /** QA: the hint on screen (or '') and every prompt shown this session with its voyage time. */
  get showing(): string { return this.current ?? ''; }
  readonly log: { id: HintId; t: number }[] = [];

  constructor(private readonly onSeen: (id: HintId) => void) {
    this.iconEl = h('span', 'cr-coach__icon');
    this.keysEl = h('span', 'cr-coach__keys');
    const title = h('b', 'cr-coach__title');
    const text = h('span', 'cr-coach__text');
    const timer = h('span', 'cr-coach__timer');
    this.timer = new StyleCell(timer, 'transform');
    this.el = h('div', 'cr-coach',
      h('span', 'cr-coach__tag', 'Tip'),
      this.iconEl,
      h('span', 'cr-coach__body', h('span', 'cr-coach__head', this.keysEl, title), text),
      timer,
    );
    this.title = new TextCell(title);
    this.text = new TextCell(text);
    this.on = new ClassCell(this.el, 'is-on');
    this.done = new ClassCell(this.el, 'is-done');
    this.el.hidden = true;
  }

  /** Hint ids recovered from storage (see Ui: the profile loader may drop them). */
  restore(ids: readonly string[]): void { for (const id of ids) this.seen.add(id); }

  reset(): void {
    this.hide();
    this.gapUntil = 0; this.wantBrace = false; this.ironsT = 0; this.scan = 0; this.nearest = Infinity;
  }

  private enabled(f: UiFrame): boolean { return f.settings.coach !== false; }

  private isSeen(f: UiFrame, id: HintId): boolean {
    return this.seen.has(id) || !!f.profile.seenHints?.includes(id);
  }

  private markSeen(id: HintId): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.onSeen(id);
  }

  update(f: UiFrame, run: Readonly<RunState>, over: boolean): void {
    if (run.seed !== this.seed) { this.seed = run.seed; this.reset(); }
    const p = run.player;
    const t = run.time;
    // Retire prompts the player has already mastered (they did it unprompted), and finish the one showing.
    for (let i = 0; i < f.events.length; i++) {
      const e = f.events[i]!;
      if (e.type === 'skill-used') {
        const id: HintId | null = e.slot === 'broadside' ? 'broadside' : e.slot === 'brace' ? 'brace' : e.slot === 'boost' ? 'boost' : null;
        if (id) this.finish(f, id);
      } else if (e.type === 'telegraph' && e.team === 'enemy' && Math.hypot(e.x - p.x, e.z - p.z) < 160) this.wantBrace = true;
      else if (e.type === 'player-hit' && e.amount > 0) this.wantBrace = true;
    }
    if (this.current === 'sail' && this.gearAtShow >= 0 && p.gear !== this.gearAtShow) this.finish(f, 'sail');
    else if (!this.current && t < 3 && p.gear !== 1) this.finish(f, 'sail'); // voyages start at half sail
    if (this.current && this.keysVersion !== controls.version) this.renderKeys(HINTS[this.current]);

    const running = run.status === 'running' && !over;
    if (this.current) {
      if (!this.enabled(f) || over) { this.hide(); return; }
      if (!running) return; // a card screen or pause holds the prompt
      const age = t - this.shownAt, ttl = HINTS[this.current].ttl;
      this.timer.set(`scaleX(${(Math.round(Math.max(0, 1 - age / ttl) * 100) / 100).toFixed(2)})`);
      if (this.doneAt >= 0 ? t - this.doneAt > DONE_HOLD : age > ttl) this.hide(t);
      return;
    }
    // Rivals (every captain, once ever): after the first rival has sailed in and the presence line has gone.
    if (this.enabled(f) && running && !run.endless && t >= 16 && t >= this.gapUntil && !this.isSeen(f, 'rivals') && run.captains.some((k) => k.alive)) {
      this.show(f, 'rivals', run);
      return;
    }
    if (!this.enabled(f) || !running || run.endless || t > WINDOW || f.profile.runs >= NEW_CAPTAIN_RUNS || t < this.gapUntil) return;
    // Cheap scan at ~5 Hz: the nearest live enemy.
    this.scan -= f.dt;
    if (this.scan <= 0) {
      this.scan = 0.2;
      let best = Infinity;
      for (const e of run.enemies) if (e.life === 'alive' && e.hidden < 1) { const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < best) best = d; }
      this.nearest = best;
    }
    this.ironsT = p.gear > 0 && Math.abs(p.speed) > 0.5 && inIrons(p.heading, run.sea) ? this.ironsT + f.dt : 0;
    for (const id of SAILING) {
      if (this.isSeen(f, id)) continue;
      if (this.due(id, run)) { this.show(f, id, run); return; }
    }
  }

  private due(id: HintId, run: Readonly<RunState>): boolean {
    const t = run.time, p = run.player, sk = p.skills;
    switch (id) {
      case 'sail': return t >= 3;
      case 'autofire': return t >= 6 && this.nearest < 200;
      case 'broadside': return t >= 12 && sk.broadside.cooldown <= 0 && this.nearest < 190;
      case 'brace': return t >= 10 && this.wantBrace && sk.brace.cooldown <= 0;
      case 'boost': return sk.boost.cooldown <= 0 && (t >= 42 || p.hp < p.maxHp * 0.55);
      case 'wind': return (this.ironsT > 1.8 && t >= 15) || t >= 80;
      default: return false;
    }
  }

  private show(f: UiFrame, id: HintId, run: Readonly<RunState>): void {
    const def = HINTS[id];
    this.current = id;
    this.shownAt = run.time;
    if (this.log.length < 40) this.log.push({ id, t: +run.time.toFixed(1) });
    this.doneAt = -1;
    this.gearAtShow = id === 'sail' ? run.player.gear : -1;
    this.el.dataset.hint = id;
    this.iconEl.replaceChildren(glyph(def.icon));
    this.title.set(def.title);
    this.text.set(def.text);
    this.renderKeys(def);
    this.timer.set('scaleX(1)');
    this.done.set(false);
    this.el.hidden = false;
    this.on.set(true);
    play(this.el, [
      { opacity: 0, transform: 'translate(-50%, 18px) scale(.94)' },
      { opacity: 1, transform: 'translate(-50%, 0) scale(1)' },
    ], { duration: 320, easing: 'cubic-bezier(.2,1.2,.3,1)' });
    this.markSeen(id);
    void f;
  }

  private renderKeys(def: HintDef): void {
    this.keysVersion = controls.version;
    const nodes: Node[] = [];
    const kb = h('span', 'cr-coach__kb');
    def.keys.forEach((k, i) => {
      if (i) kb.append(h('span', 'cr-prompt__or', '/'));
      kb.append(keycap(k === 'LMB' ? 'LMB' : controls.labels(k)[0] ?? '—'));
    });
    if (def.keys.length) nodes.push(kb);
    if (def.pad.length) nodes.push(h('span', 'cr-coach__pad', ...def.pad.map((b) => padButton(b))));
    this.keysEl.replaceChildren(...nodes);
    this.keysEl.hidden = nodes.length === 0;
  }

  /** The player did it: tick the prompt if it is showing, or retire it before it ever shows. */
  private finish(f: UiFrame, id: HintId): void {
    if (this.current === id && this.doneAt < 0) {
      this.doneAt = f.run?.time ?? 0;
      this.done.set(true);
      play(this.el, [{ transform: 'translate(-50%, 0) scale(1)' }, { transform: 'translate(-50%, 0) scale(1.06)', offset: 0.3 }, { transform: 'translate(-50%, 0) scale(1)' }], { duration: 360, easing: 'ease-out' });
      return;
    }
    if (!this.current && this.enabled(f) && f.profile.runs < NEW_CAPTAIN_RUNS) this.markSeen(id);
  }

  private hide(t = 0): void {
    if (this.current) this.gapUntil = t + GAP;
    this.current = null;
    this.on.set(false);
    this.el.hidden = true;
  }

  /**
   * One-time explainer for the card screen: the first branch pair or OVERDRIVE card this captain sees (null if none
   * is due or the coach is off). Marks it seen.
   */
  cardTip(f: UiFrame, offers: readonly CardOffer[]): HintDef | null {
    if (!this.enabled(f)) return null;
    let id: HintId | null = null;
    if (offers.some((o) => o.kind === 'weapon-overdrive') && !this.isSeen(f, 'overdrive')) id = 'overdrive';
    else if (offers.some((o) => o.kind === 'weapon-branch') && !this.isSeen(f, 'branch')) id = 'branch';
    if (!id) return null;
    this.markSeen(id);
    return HINTS[id];
  }
}
