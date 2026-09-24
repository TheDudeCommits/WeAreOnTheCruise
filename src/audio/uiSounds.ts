/**
 * DOM UI sounds via delegated document listeners (AUDIO-owned; no UI files touched).
 *
 * Any button-like element gets a hover tick and a click. Elements may opt into specific sounds with
 * `data-sfx="click|back|confirm|error|open|close|card|none"` and `data-sfx-hover="none|card|tick"`.
 * Level-up cards ([data-card], .ui-card, .card) get the card slide on hover and stay silent on click,
 * because the sim's 'card-chosen' event plays the select. Reroll buttons are silent here too (the
 * RunState reroll diff plays the shuffle, which also covers the X key).
 */
import type { CueId } from './generated/cueIds';

const INTERACTIVE = 'button, [role="button"], a[href], select, summary, label[for], input[type="checkbox"], input[type="radio"], [data-sfx], [data-sfx-hover]';
const CARD = '[data-card], .ui-card, .card, [data-sfx="card"]';
const SILENT_CLICK = '[data-card], .ui-card, .card, [data-reroll], [data-sfx="none"]';

const CLICK_ATTR: Record<string, CueId | null> = {
  click: 'ui-click', back: 'ui-back', confirm: 'ui-confirm', error: 'ui-error', open: 'ui-open', close: 'ui-close',
  card: null, none: null, select: 'card-select', transition: 'ui-transition',
};

export class UiSounds {
  private lastHover: Element | null = null;
  private lastHoverAt = 0;
  private lastTickAt = 0;
  private attached = false;

  constructor(private readonly play: (cue: CueId, gain?: number) => void) {}

  attach(doc: Document = document): void {
    if (this.attached) return;
    this.attached = true;
    doc.addEventListener('pointerover', this.onOver, true);
    doc.addEventListener('click', this.onClick, true);
    doc.addEventListener('input', this.onInput, true);
  }

  detach(doc: Document = document): void {
    if (!this.attached) return;
    this.attached = false;
    doc.removeEventListener('pointerover', this.onOver, true);
    doc.removeEventListener('click', this.onClick, true);
    doc.removeEventListener('input', this.onInput, true);
  }

  private readonly onOver = (ev: Event): void => {
    const target = ev.target instanceof Element ? ev.target.closest(INTERACTIVE) : null;
    if (!target || target === this.lastHover) return;
    this.lastHover = target;
    if (isDisabled(target)) return;
    const now = performance.now();
    if (now - this.lastHoverAt < 45) return;
    this.lastHoverAt = now;
    const hover = (target as HTMLElement).dataset?.sfxHover;
    if (hover === 'none') return;
    this.play(hover === 'card' || target.matches(CARD) ? 'card-hover' : 'ui-hover');
  };

  private readonly onClick = (ev: Event): void => {
    const target = ev.target instanceof Element ? ev.target.closest(INTERACTIVE) : null;
    if (!target || isDisabled(target)) return;
    const attr = (target as HTMLElement).dataset?.sfx;
    if (attr && attr in CLICK_ATTR) { const cue = CLICK_ATTR[attr]; if (cue) this.play(cue); return; }
    if (target.matches(SILENT_CLICK)) return;
    const text = (target.textContent ?? '').trim().toLowerCase();
    if (/^(back|close|cancel|resume|return)/.test(text) || target.matches('[data-back], [data-close], [data-resume]')) this.play('ui-back');
    else if (/(set sail|sail |start|confirm|buy|unlock|upgrade|retire)/.test(text) || target.matches('[data-go], [data-sea], [data-confirm]')) this.play('ui-confirm');
    else this.play('ui-click');
  };

  private readonly onInput = (ev: Event): void => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'range') return;
    const now = performance.now();
    if (now - this.lastTickAt < 70) return;
    this.lastTickAt = now;
    this.play('ui-tick', 0.7);
  };
}

function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
}
