/** Boss bar: name + title, phase pips and phase name, HP with a lagging damage trail. */
import { CONTENT } from '../../game/content';
import type { BossState, RunState } from '../../game/types';
import { ClassCell, h, play, TextCell } from '../core/dom';
import { glyph } from '../core/icons';
import { BOSS_GLYPH } from '../core/names';

export class BossBar {
  readonly el: HTMLElement;
  private readonly name: TextCell;
  private readonly title: TextCell;
  private readonly phase: TextCell;
  private readonly pct: TextCell;
  private readonly fill: HTMLElement;
  private readonly lag: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly emblem: HTMLElement;
  private readonly on: ClassCell;
  private readonly enraged: ClassCell;
  private bossId = -1;
  private phaseIndex = -1;
  private shown = 1;
  private lagV = 1;
  private lagHold = 0;
  private lastQ = -1;
  private lastLagQ = -1;
  private lastPct = -1;

  constructor() {
    const name = h('span', 'cr-boss__name');
    const title = h('span', 'cr-boss__title');
    const phase = h('span', 'cr-boss__phase');
    const pct = h('span', 'cr-boss__pct');
    this.fill = h('span', 'cr-boss__fill');
    this.lag = h('span', 'cr-boss__lag');
    this.pips = h('span', 'cr-boss__pips');
    this.emblem = h('span', 'cr-boss__emblem', glyph('skull'));
    this.el = h('div', 'cr-boss',
      this.emblem,
      h('div', 'cr-boss__body',
        h('div', 'cr-boss__head', name, title),
        h('div', 'cr-boss__bar', this.lag, this.fill, h('span', 'cr-boss__notch'), pct),
        h('div', 'cr-boss__foot', this.pips, phase),
      ),
    );
    this.name = new TextCell(name);
    this.title = new TextCell(title);
    this.phase = new TextCell(phase);
    this.pct = new TextCell(pct);
    this.on = new ClassCell(this.el, 'is-on');
    this.enraged = new ClassCell(this.el, 'is-enraged');
  }

  reset(): void { this.bossId = -1; this.on.set(false); }

  update(run: Readonly<RunState>, dt: number): void {
    let boss: BossState | null = null;
    for (const b of run.bosses) if (b.life !== 'dead') { boss = b; break; }
    if (!boss) { this.on.set(false); this.bossId = -1; return; }
    const def = CONTENT.bosses[boss.defId];
    if (boss.id !== this.bossId) {
      this.bossId = boss.id;
      this.phaseIndex = -1;
      this.name.set(def.name);
      this.title.set(def.title);
      this.emblem.replaceChildren(glyph(BOSS_GLYPH[boss.defId]));
      this.pips.replaceChildren(...def.phases.map((_, i) => h('i', 'cr-boss__pip', String(i + 1))));
      this.shown = this.lagV = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
      this.lastQ = this.lastLagQ = this.lastPct = -1;
      this.on.set(true);
      play(this.el, [{ opacity: 0, transform: 'translateX(-50%) translateY(-30px) scale(1.2)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,1.3,.3,1)' });
    }
    if (boss.phase !== this.phaseIndex) {
      this.phaseIndex = boss.phase;
      this.phase.set(def.phases[boss.phase]?.name ?? '');
      Array.from(this.pips.children).forEach((pip, i) => { pip.classList.toggle('is-on', i <= boss!.phase); pip.classList.toggle('is-now', i === boss!.phase); });
      this.enraged.set(boss.phase > 0);
    }
    const frac = boss.life === 'alive' && boss.maxHp > 0 ? Math.max(0, Math.min(1, boss.hp / boss.maxHp)) : 0;
    if (frac < this.shown) this.lagHold = 0.5;
    this.shown = frac;
    if (this.lagV > frac) { if (this.lagHold > 0) this.lagHold -= dt; else this.lagV = Math.max(frac, this.lagV - dt * 0.45); }
    else this.lagV = frac;
    const q = Math.round(frac * 1000);
    if (q !== this.lastQ) { this.lastQ = q; this.fill.style.transform = `scaleX(${q / 1000})`; }
    const lq = Math.round(this.lagV * 1000);
    if (lq !== this.lastLagQ) { this.lastLagQ = lq; this.lag.style.transform = `scaleX(${lq / 1000})`; }
    const pct = Math.ceil(frac * 100);
    if (pct !== this.lastPct) { this.lastPct = pct; this.pct.set(`${pct}%`); }
  }

  phaseFlash(): void {
    play(this.el, [
      { filter: 'brightness(1)', transform: 'translateX(-50%) scale(1)' },
      { filter: 'brightness(2.4)', transform: 'translateX(-50%) scale(1.06)', offset: 0.2 },
      { filter: 'brightness(1)', transform: 'translateX(-50%) scale(1)' },
    ], { duration: 700, easing: 'ease-out' });
  }

  hitShake(): void {
    play(this.fill, [{ filter: 'brightness(2.5)' }, { filter: 'brightness(1)' }], { duration: 160 });
  }
}
