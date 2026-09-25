/**
 * Transient HUD messaging: boss warning band, director event banner, centre stamps (level up, parry, victory…),
 * skill cut-ins for specials/ultimates, and small toasts. Each slot restarts cleanly (Web Animations API).
 */
import { h, play, TextCell } from '../core/dom';
import { glyph, icon, setIcon, type GlyphId } from '../core/icons';

type Tone = 'gold' | 'red' | 'cyan' | 'white' | 'teal';

class Slot {
  readonly el: HTMLElement;
  private timer = 0;
  constructor(el: HTMLElement) { this.el = el; this.el.hidden = true; }
  show(keyframes: Keyframe[], duration: number): void {
    window.clearTimeout(this.timer);
    this.el.hidden = false;
    play(this.el, keyframes, { duration, easing: 'linear', fill: 'forwards' });
    this.timer = window.setTimeout(() => { this.el.hidden = true; }, duration + 30);
  }
  hide(): void { window.clearTimeout(this.timer); this.el.hidden = true; }
}

export class Banners {
  readonly el: HTMLElement;
  private readonly warn: Slot;
  private readonly warnName: TextCell;
  private readonly warnTitle: TextCell;
  private readonly warnEta: TextCell;
  private readonly event: Slot;
  private readonly eventName: TextCell;
  private readonly eventText: TextCell;
  private readonly stamp: Slot;
  private readonly stampText: TextCell;
  private readonly stampSub: TextCell;
  private readonly cutin: Slot;
  private readonly cutName: TextCell;
  private readonly cutKind: TextCell;
  private readonly cutIcon: HTMLElement;
  private readonly toasts: HTMLElement;
  /** Last time each keyed toast showed (repeats inside their cooldown are dropped). */
  private readonly toastAt = new Map<string, number>();
  get toastsEl(): HTMLElement { return this.toasts; }
  private stampPriority = 0;
  private stampUntil = 0;
  private now = 0;
  private suppressed = false;
  private pending: { text: string; sub: string; tone: Tone; priority: number; duration: number; at: number } | null = null;

  constructor() {
    const wn = h('span', 'cr-warn__name');
    const wt = h('span', 'cr-warn__title');
    const we = h('span', 'cr-warn__eta');
    this.warn = new Slot(h('div', 'cr-warn',
      h('div', 'cr-warn__stripes is-top'),
      h('div', 'cr-warn__band', h('span', 'cr-warn__icon', glyph('skull')), h('span', 'cr-warn__text', wn, h('span', 'cr-warn__approaches', 'Approaches')), h('span', 'cr-warn__icon', glyph('skull'))),
      h('div', 'cr-warn__sub', wt, we),
      h('div', 'cr-warn__stripes is-bottom'),
    ));
    this.warnName = new TextCell(wn);
    this.warnTitle = new TextCell(wt);
    this.warnEta = new TextCell(we);

    const en = h('span', 'cr-event__name');
    const et = h('span', 'cr-event__text');
    this.event = new Slot(h('div', 'cr-event', h('span', 'cr-event__flag', glyph('flare')), h('span', 'cr-event__body', en, et)));
    this.eventName = new TextCell(en);
    this.eventText = new TextCell(et);

    const st = h('span', 'cr-stamp__text');
    const ss = h('span', 'cr-stamp__sub');
    this.stamp = new Slot(h('div', 'cr-stamp', h('span', 'cr-stamp__burst'), st, ss));
    this.stampText = new TextCell(st);
    this.stampSub = new TextCell(ss);

    const cn = h('span', 'cr-cutin__name');
    const ck = h('span', 'cr-cutin__kind');
    this.cutIcon = icon(null, 'sun', 'cr-cutin__icon');
    this.cutin = new Slot(h('div', 'cr-cutin', h('div', 'cr-cutin__band', h('span', 'cr-cutin__lines'), this.cutIcon, h('span', 'cr-cutin__words', ck, cn))));
    this.cutName = new TextCell(cn);
    this.cutKind = new TextCell(ck);

    this.toasts = h('div', 'cr-toasts');
    this.el = h('div', 'cr-banners', this.warn.el, this.event.el, this.cutin.el, this.stamp.el, this.toasts);
  }

  tick(time: number): void { this.now = time; }

  /** While a modal covers the centre, stamps are held and the most important one plays when it closes. */
  setSuppressed(on: boolean): void {
    if (on === this.suppressed) return;
    this.suppressed = on;
    if (on) return;
    const p = this.pending;
    this.pending = null;
    if (p && this.now - p.at < 10) this.showStamp(p.text, p.sub, p.tone, p.priority, p.duration);
  }

  reset(): void {
    this.warn.hide(); this.event.hide(); this.stamp.hide(); this.cutin.hide();
    this.toasts.replaceChildren();
    this.toastAt.clear();
    this.stampPriority = 0;
    this.pending = null;
    this.suppressed = false;
  }

  bossWarning(name: string, title: string, eta: number): void {
    this.warnName.set(name);
    this.warnTitle.set(title);
    this.warnEta.set(eta > 0 ? `Arrives in ${Math.round(eta)}s` : '');
    this.warn.show([
      { opacity: 0, transform: 'scaleY(0)' },
      { opacity: 1, transform: 'scaleY(1.15)', offset: 0.05 },
      { opacity: 1, transform: 'scaleY(1)', offset: 0.08 },
      { opacity: 1, transform: 'scaleY(1)', offset: 0.88 },
      { opacity: 0, transform: 'scaleY(0.2)' },
    ], 4200);
  }

  directorEvent(name: string, text: string): void {
    this.eventName.set(name);
    this.eventText.set(text);
    this.event.show([
      { opacity: 0, transform: 'translateX(-110%) skewX(-8deg)' },
      { opacity: 1, transform: 'translateX(0) skewX(-8deg)', offset: 0.07 },
      { opacity: 1, transform: 'translateX(0) skewX(-8deg)', offset: 0.88 },
      { opacity: 0, transform: 'translateX(-40%) skewX(-8deg)' },
    ], 3800);
  }

  /** Centre stamp. Higher priority stamps are not interrupted by lower ones while visible. */
  showStamp(text: string, sub: string, tone: Tone, priority = 1, duration = 1300): void {
    if (this.suppressed) {
      if (!this.pending || priority >= this.pending.priority) this.pending = { text, sub, tone, priority, duration, at: this.now };
      return;
    }
    if (priority < this.stampPriority && this.now < this.stampUntil) return;
    this.stampPriority = priority;
    this.stampUntil = this.now + duration / 1000;
    this.stampText.set(text);
    this.stampSub.set(sub);
    this.stamp.el.dataset.tone = tone;
    this.stamp.show([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(2.8) rotate(-10deg)' },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(0.92) rotate(-4deg)', offset: 0.12 },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(-4deg)', offset: 0.18 },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1.03) rotate(-4deg)', offset: 0.82 },
      { opacity: 0, transform: 'translate(-50%,-62%) scale(1.1) rotate(-4deg)' },
    ], duration);
  }

  cutIn(kind: string, name: string, src: string | null, g: GlyphId, accent: string, big: boolean): void {
    this.cutKind.set(kind);
    this.cutName.set(name);
    setIcon(this.cutIcon, src, g);
    this.cutin.el.style.setProperty('--accent', accent);
    this.cutin.el.classList.toggle('is-big', big);
    this.cutin.show(big ? [
      { opacity: 0, transform: 'translateX(60%) skewX(-12deg)' },
      { opacity: 1, transform: 'translateX(0) skewX(-12deg)', offset: 0.14 },
      { opacity: 1, transform: 'translateX(-3%) skewX(-12deg)', offset: 0.8 },
      { opacity: 0, transform: 'translateX(-70%) skewX(-12deg)' },
    ] : [
      { opacity: 0, transform: 'translateX(-100%) skewX(-12deg)' },
      { opacity: 1, transform: 'translateX(0) skewX(-12deg)', offset: 0.16 },
      { opacity: 1, transform: 'translateX(2%) skewX(-12deg)', offset: 0.78 },
      { opacity: 0, transform: 'translateX(-40%) skewX(-12deg)' },
    ], big ? 1500 : 1100);
  }

  /** A small toast above the loadout. With a `key`, the same toast is not repeated within `cooldown` seconds. */
  toast(text: string, g: GlyphId, tone: Tone = 'white', src: string | null = null, key = '', cooldown = 0): void {
    if (key) {
      const last = this.toastAt.get(key);
      if (last !== undefined && this.now - last < cooldown) return;
      this.toastAt.set(key, this.now);
    }
    const t = h('div', `cr-toast is-${tone}`, src ? icon(src, g, 'cr-toast__icon') : glyph(g), h('span', '', text));
    this.toasts.append(t);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild!.remove();
    play(t, [
      { opacity: 0, transform: 'translateX(40px)' },
      { opacity: 1, transform: 'translateX(0)', offset: 0.1 },
      { opacity: 1, transform: 'translateX(0)', offset: 0.85 },
      { opacity: 0, transform: 'translateX(20px)' },
    ], { duration: 2800, fill: 'forwards' })?.finished.then(() => t.remove()).catch(() => undefined);
  }
}
