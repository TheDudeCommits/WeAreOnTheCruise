/**
 * Captains roster (CAPTAINS-owned): who is sailing this sea (you + AI captains), their level and bounty, a small
 * kill feed, and nameplates over captain ships. Contract stub. measure() runs in the HUD's read phase (project()
 * lives there); update() in the write phase. Styles go in src/styles/roster.css.
 */
import type { RunState } from '../../game/types';
import type { UiFrame } from '../contracts';
import { h } from '../core/dom';

export class Roster {
  readonly el: HTMLElement = h('div', 'cr-roster');
  reset(): void {}
  measure(_f: UiFrame, _run: Readonly<RunState>): void {}
  update(_run: Readonly<RunState>, _f: UiFrame): void {}
}
