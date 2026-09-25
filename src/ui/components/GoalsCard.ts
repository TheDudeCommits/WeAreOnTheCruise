/**
 * "Next up" goals (FLOW renders REPLAY's `nextGoals(profile)`): title, detail, a progress bar and the reward, for the
 * harbor's side column and the results log. Hidden while there are none (the round-2 stub returns none).
 * The provider can be swapped for the UI lab (setGoalsProvider) without touching REPLAY's module.
 */
import { nextGoals, type Goal } from '../../game/meta/goals';
import type { MetaProfile } from '../../game/types';
import { h } from '../core/dom';
import { glyph } from '../core/icons';

let provider: (profile: Readonly<MetaProfile>) => Goal[] = nextGoals;

/** UI lab / QA only: feed made-up goals. */
export function setGoalsProvider(fn: (profile: Readonly<MetaProfile>) => Goal[]): void { provider = fn; }

export function goalsFor(profile: Readonly<MetaProfile>): Goal[] {
  try { return provider(profile) ?? []; } catch (err) { console.error('nextGoals failed', err); return []; }
}

export class GoalsCard {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private sig = '\u0000';

  constructor(private readonly max: number, cls = '') {
    this.list = h('div', 'cr-goals__list');
    this.el = h('section', `cr-goals ${cls}`.trim(), h('div', 'cr-goals__head', glyph('compass'), 'Next up'), this.list);
    this.el.hidden = true;
  }

  /** Re-renders when the goals change; returns whether any show. */
  set(goals: readonly Goal[]): boolean {
    const shown = goals.slice(0, this.max);
    const sig = shown.map((g) => `${g.id}:${g.title}:${g.detail}:${Math.round(g.progress * 100)}:${g.reward ?? ''}`).join('|');
    if (sig === this.sig) return shown.length > 0;
    this.sig = sig;
    this.list.replaceChildren(...shown.map((g) => {
      const fill = h('span', 'cr-goal__fill');
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, g.progress)).toFixed(3)})`;
      return h('div', `cr-goal${g.progress >= 1 ? ' is-done' : ''}`,
        h('div', 'cr-goal__top', h('span', 'cr-goal__title', g.title), g.reward ? h('span', 'cr-goal__reward', glyph('star'), g.reward) : null),
        h('span', 'cr-goal__detail', g.detail),
        h('span', 'cr-goal__bar', fill, h('span', 'cr-goal__pct', `${Math.round(Math.max(0, Math.min(1, g.progress)) * 100)}%`)),
      );
    }));
    this.el.hidden = shown.length === 0;
    return shown.length > 0;
  }
}
