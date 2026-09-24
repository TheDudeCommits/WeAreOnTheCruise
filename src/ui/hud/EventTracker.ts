/**
 * World-event tracker (EVENTS-owned): the running set piece from `run.worldEvent` (name, objective progress,
 * time left) and its outcome. Contract stub. Styles go in src/styles/events.css.
 */
import type { RunState } from '../../game/types';
import type { UiFrame } from '../contracts';
import { h } from '../core/dom';

export class EventTracker {
  readonly el: HTMLElement = h('div', 'cr-evtrack');
  reset(): void {}
  update(_run: Readonly<RunState>, _f: UiFrame): void {}
}
