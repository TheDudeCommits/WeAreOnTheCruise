/** Top of the HUD: full-width XP bar with level badge, run timer, kills / doubloons / bounty plate, boss ETA. */
import { CONTENT } from '../../game/content';
import type { RunState } from '../../game/types';
import { ClassCell, h, play, StyleCell, TextCell } from '../core/dom';
import { fmtClock, fmtCompact, fmtInt } from '../core/format';
import { glyph, icon } from '../core/icons';
import { BOSS_GLYPH, iconPath } from '../core/names';

export class TopBar {
  readonly el: HTMLElement;
  private readonly xpFill: StyleCell;
  private readonly xpFillEl: HTMLElement;
  private readonly xpBar: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly level: TextCell;
  private readonly timer: TextCell;
  private readonly timerEl: HTMLElement;
  private readonly kills: TextCell;
  private readonly killsEl: HTMLElement;
  private readonly doubloons: TextCell;
  private readonly doubloonsEl: HTMLElement;
  private readonly bounty: TextCell;
  private readonly eta: HTMLElement;
  private readonly etaText: TextCell;
  private readonly etaName: TextCell;
  private readonly etaIcon: HTMLElement;
  private readonly etaOn: ClassCell;
  private readonly urgent: ClassCell;
  private lastLevel = -1;
  private lastKills = -1;
  private lastDoubloons = -1;
  private lastSecond = -1;
  private lastBounty = -1;
  private lastEta = -1;
  private killPulseAt = 0;
  private etaBoss = '';

  constructor() {
    this.xpFillEl = h('span', 'cr-xp__fill', h('span', 'cr-xp__shine'));
    this.xpBar = h('div', 'cr-xp', h('span', 'cr-xp__track', this.xpFillEl), h('span', 'cr-xp__ticks'));
    const lv = h('span', 'cr-badge__num', '1');
    this.badge = h('div', 'cr-badge', h('span', 'cr-badge__lv', 'LV'), lv);
    const time = h('span', 'cr-timer__time', '00:00');
    this.timerEl = h('div', 'cr-timer', time);
    const kills = h('b', '', '0');
    const doub = h('b', '', '0');
    const bounty = h('b', '', '0');
    this.killsEl = h('span', 'cr-stat is-kills', glyph('skull'), kills);
    this.doubloonsEl = h('span', 'cr-stat is-doubloons', icon(iconPath('doubloon'), 'coin', 'cr-stat__coin'), doub);
    const plate = h('div', 'cr-statplate', this.killsEl, this.doubloonsEl, h('span', 'cr-stat is-bounty', h('small', '', 'Bounty'), bounty));
    const etaText = h('b', '');
    const etaName = h('span', '');
    this.etaIcon = h('span', 'cr-eta__icon', glyph('skull'));
    this.eta = h('div', 'cr-eta', this.etaIcon, etaName, etaText);
    this.el = h('div', 'cr-top', this.xpBar, this.badge, this.timerEl, plate, this.eta);
    this.xpFill = new StyleCell(this.xpFillEl, 'transform');
    this.level = new TextCell(lv);
    this.timer = new TextCell(time);
    this.kills = new TextCell(kills);
    this.doubloons = new TextCell(doub);
    this.bounty = new TextCell(bounty);
    this.etaText = new TextCell(etaText);
    this.etaName = new TextCell(etaName);
    this.etaOn = new ClassCell(this.eta, 'is-on');
    this.urgent = new ClassCell(this.eta, 'is-urgent');
  }

  reset(): void { this.lastLevel = -1; this.lastKills = -1; this.lastDoubloons = -1; this.lastSecond = -1; this.lastBounty = -1; this.lastEta = -1; this.etaBoss = ''; }

  update(run: Readonly<RunState>, time: number): void {
    const p = run.player;
    const frac = p.xpToNext > 0 ? Math.max(0, Math.min(1, p.xp / p.xpToNext)) : 0;
    if (p.level !== this.lastLevel) {
      if (this.lastLevel >= 0 && p.level > this.lastLevel) {
        // Snap to empty without the smoothing transition, then fill.
        this.xpFillEl.style.transition = 'none';
        this.xpFill.set('scaleX(0)');
        void this.xpFillEl.offsetWidth;
        this.xpFillEl.style.transition = '';
      }
      this.lastLevel = p.level;
      this.level.set(p.level);
    }
    this.xpFill.set(`scaleX(${(Math.round(frac * 400) / 400).toFixed(4)})`);
    const sec = Math.floor(run.time);
    if (sec !== this.lastSecond) { this.lastSecond = sec; this.timer.set(fmtClock(sec)); }

    const kills = run.stats.kills;
    if (kills !== this.lastKills) {
      this.kills.set(fmtInt(kills));
      if (this.lastKills >= 0 && time - this.killPulseAt > 0.12) { this.killPulseAt = time; play(this.killsEl, [{ transform: 'scale(1.22)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' }); }
      this.lastKills = kills;
    }
    const d = run.stats.doubloons;
    if (d !== this.lastDoubloons) {
      this.doubloons.set(fmtInt(d));
      if (this.lastDoubloons >= 0 && d > this.lastDoubloons) play(this.doubloonsEl, [{ transform: 'scale(1.3) rotate(-4deg)', color: '#fff6b0' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.2,1.6,.4,1)' });
      this.lastDoubloons = d;
    }
    if (run.stats.bounty !== this.lastBounty) { this.lastBounty = run.stats.bounty; this.bounty.set(fmtCompact(this.lastBounty)); }

    // Next boss countdown (last 60 s), hidden while a boss is on the water.
    const sea = CONTENT.seas[run.seaId];
    const next = sea.bosses[run.director.nextBossIndex];
    const remaining = next ? next.at - run.time : Infinity;
    let bossUp = false;
    for (const b of run.bosses) if (b.life === 'alive') { bossUp = true; break; }
    const show = !!next && remaining > 0 && remaining <= 60 && !bossUp;
    this.etaOn.set(show);
    if (show && next) {
      if (this.etaBoss !== next.boss) {
        this.etaBoss = next.boss;
        this.etaName.set(CONTENT.bosses[next.boss].name);
        this.etaIcon.replaceChildren(glyph(BOSS_GLYPH[next.boss]));
      }
      const eta = Math.ceil(remaining);
      if (eta !== this.lastEta) { this.lastEta = eta; this.etaText.set(fmtClock(eta)); }
      this.urgent.set(remaining <= 10);
    }
  }

  levelUp(): void {
    play(this.badge, [
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: 'scale(1.45) rotate(-8deg)', filter: 'brightness(2.2)', offset: 0.25 },
      { transform: 'scale(1)', filter: 'brightness(1)' },
    ], { duration: 620, easing: 'cubic-bezier(.2,.9,.2,1)' });
    play(this.xpBar, [{ filter: 'brightness(3) saturate(0)' }, { filter: 'brightness(1)' }], { duration: 520, easing: 'ease-out' });
  }
}
