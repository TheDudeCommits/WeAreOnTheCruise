/** Screen feedback: low-hull vignette with heartbeat, hit flash, damage-direction wedges, level-up flash. */
import type { PlayerState } from '../../game/types';
import { ClassCell, h, play, smoothstep, StyleCell } from '../core/dom';

const WEDGES = 4;

export class Feedback {
  readonly el: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly vOpacity: StyleCell;
  private readonly critical: ClassCell;
  private readonly hitFlash: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly wedges: HTMLElement[] = [];
  private next = 0;
  private lastQ = -1;

  constructor() {
    this.vignette = h('div', 'cr-vignette', h('span', 'cr-vignette__beat'));
    this.hitFlash = h('div', 'cr-hitflash');
    this.flash = h('div', 'cr-flash');
    const dirs = h('div', 'cr-dirs');
    for (let i = 0; i < WEDGES; i++) { const w = h('div', 'cr-dir', h('span', 'cr-dir__wedge')); dirs.append(w); this.wedges.push(w); }
    this.el = h('div', 'cr-feedback', this.vignette, this.hitFlash, dirs, this.flash);
    this.vOpacity = new StyleCell(this.vignette, 'opacity');
    this.critical = new ClassCell(this.vignette, 'is-critical');
  }

  reset(): void { this.lastQ = -1; this.vOpacity.set('0'); this.critical.set(false); }

  update(p: Readonly<PlayerState>): void {
    const frac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const v = p.alive ? smoothstep(0.5, 0.12, frac) : 1;
    const q = Math.round(v * 50);
    if (q !== this.lastQ) { this.lastQ = q; this.vOpacity.set((q / 50).toFixed(2)); }
    this.critical.set(p.alive && frac <= 0.25);
  }

  /** A hit: edge flash scaled by severity, plus a wedge pointing at the source (angle clockwise from screen-up, px position of the ship). */
  hit(severity: number, angle: number | null, x: number, y: number, braced: boolean): void {
    const s = Math.max(0.25, Math.min(1, severity));
    play(this.hitFlash, [{ opacity: 0.35 + s * 0.55 }, { opacity: 0 }], { duration: 380 + s * 300, easing: 'ease-out' });
    this.hitFlash.classList.toggle('is-braced', braced);
    if (angle === null) return;
    const w = this.wedges[this.next]!;
    this.next = (this.next + 1) % WEDGES;
    w.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px) rotate(${angle.toFixed(3)}rad)`;
    w.classList.toggle('is-braced', braced);
    play(w.firstElementChild!, [
      { opacity: 0, transform: 'translateY(20px) scale(.7)' },
      { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.12 },
      { opacity: 0, transform: 'translateY(-10px) scale(1.05)' },
    ], { duration: 950, easing: 'ease-out', fill: 'forwards' });
  }

  levelFlash(): void {
    play(this.flash, [{ opacity: 0.85 }, { opacity: 0 }], { duration: 520, easing: 'ease-out' });
  }

  whiteFlash(strength = 0.6, duration = 400): void {
    play(this.flash, [{ opacity: strength }, { opacity: 0 }], { duration, easing: 'ease-out' });
  }
}
