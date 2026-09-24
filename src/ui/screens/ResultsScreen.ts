/** Results: WANTED poster with the bounty counting up, voyage log, top guns, bosses, unlocks, sail again. */
import { CONTENT } from '../../game/content';
import { BOSS_IDS, type WeaponId } from '../../game/ids';
import type { RunResult } from '../../game/types';
import type { UiCallbacks, UiFrame } from '../contracts';
import { WantedPoster } from '../components/WantedPoster';
import { h, navButton, play, TextCell } from '../core/dom';
import { fmtClock, fmtCompact, fmtInt } from '../core/format';
import { glyph, icon } from '../core/icons';
import { BOSS_GLYPH, iconPath, WEAPON_GLYPH } from '../core/names';
import { focusEl, keyDir, moveFocus, type PadIntent } from '../core/nav';
import { prompt } from '../core/prompts';

const OUTCOME = {
  victory: { title: 'Victory!', stamp: 'Victory', tone: 'gold' as const, line: 'The Sovereign is sunk. The Brightwater is yours.' },
  defeat: { title: 'Sunk!', stamp: 'Sunk', tone: 'red' as const, line: 'Your ship rests on the seabed. The legend lives on.' },
  retired: { title: 'Retired', stamp: 'Retired', tone: 'ink' as const, line: 'You struck your colours and sailed home.' },
};

const COUNT_TIME = 2.2;

export class ResultsScreen {
  readonly el: HTMLElement;
  private readonly poster = new WantedPoster('is-results');
  private readonly headline: TextCell;
  private readonly headlineEl: HTMLElement;
  private readonly line: TextCell;
  private readonly rows: Record<'time' | 'level' | 'kills' | 'elites' | 'doubloons' | 'damage', TextCell>;
  private readonly bosses: HTMLElement;
  private readonly guns: HTMLElement;
  private readonly unlocks: HTMLElement;
  private readonly unlockBlock: HTMLElement;
  private readonly record: HTMLElement;
  private readonly again: HTMLButtonElement;
  private readonly harbor: HTMLButtonElement;
  private result: Readonly<RunResult> | null = null;
  private key = '';
  private t = 0;
  private stamped = false;
  private doubloonsShown = -1;

  constructor(private readonly cb: UiCallbacks) {
    const headline = h('h2', 'cr-results__headline');
    const line = h('p', 'cr-results__line');
    const cell = () => h('span', 'cr-log__value');
    const time = cell(), level = cell(), kills = cell(), elites = cell(), doubloons = cell(), damage = cell();
    const row = (g: Parameters<typeof glyph>[0], label: string, value: HTMLElement) => h('div', 'cr-log__row', glyph(g, 'cr-log__icon'), h('span', 'cr-log__label', label), value);
    this.bosses = h('div', 'cr-log__bosses');
    this.guns = h('div', 'cr-guns');
    this.unlocks = h('div', 'cr-unlocks');
    this.unlockBlock = h('div', 'cr-log__block is-unlocks', h('div', 'cr-log__heading', glyph('star'), 'New unlocks'), this.unlocks);
    this.record = h('div', 'cr-results__record', glyph('crown'), 'New best bounty!');
    this.harbor = navButton('cr-btn is-ghost', prompt(['ESC'], 'B', ''), h('span', 'cr-btn__label', 'Return to Harbor'));
    this.again = navButton('cr-btn is-primary', prompt(['ENTER'], 'A', ''), h('span', 'cr-btn__label', 'Sail Again'));
    this.again.dataset.navDefault = '';
    this.harbor.addEventListener('click', () => this.cb.onReturnToHarbor());
    this.again.addEventListener('click', () => { if (this.result) this.cb.onStartRun(this.result.shipId, this.result.seaId); });
    this.headlineEl = headline;
    this.el = h('section', 'cr-screen cr-results',
      h('div', 'cr-results__shade'),
      h('div', 'cr-results__rays'),
      h('div', 'cr-results__left', this.poster.el, this.record),
      h('div', 'cr-results__right',
        headline,
        line,
        h('div', 'cr-log cr-brushpanel',
          h('div', 'cr-log__grid',
            row('clock', 'Time survived', time),
            row('xp', 'Level reached', level),
            row('skull', 'Ships sunk', kills),
            row('star', 'Elites sunk', elites),
            row('coin', 'Doubloons earned', doubloons),
            row('burst', 'Damage dealt', damage),
          ),
          h('div', 'cr-log__block', h('div', 'cr-log__heading', glyph('crown'), 'Bosses'), this.bosses),
          h('div', 'cr-log__block', h('div', 'cr-log__heading', glyph('cannon'), 'Top guns'), this.guns),
          this.unlockBlock,
        ),
        h('div', 'cr-results__buttons', this.harbor, this.again),
      ),
    );
    this.headline = new TextCell(headline);
    this.line = new TextCell(line);
    this.rows = { time: new TextCell(time), level: new TextCell(level), kills: new TextCell(kills), elites: new TextCell(elites), doubloons: new TextCell(doubloons), damage: new TextCell(damage) };
    this.el.hidden = true;
  }

  show(): void {
    this.el.hidden = false;
    this.key = '';
  }

  hide(): void { this.el.hidden = true; }

  update(f: UiFrame): void {
    const r = f.result;
    if (!r) return;
    const key = `${r.outcome}:${r.time}:${r.stats.bounty}:${r.shipId}`;
    if (key !== this.key) { this.key = key; this.build(r, f); }
    this.t += f.dt;
    const k = Math.min(1, this.t / COUNT_TIME);
    const e = 1 - Math.pow(1 - k, 3);
    this.poster.amount.set(fmtInt(r.stats.bounty * e));
    const dk = Math.min(1, Math.max(0, (this.t - 0.6) / 1.2));
    const dv = Math.round(r.doubloonsEarned * dk);
    if (dv !== this.doubloonsShown) { this.doubloonsShown = dv; this.rows.doubloons.set(`+${fmtInt(dv)}`); }
    if (k >= 1 && !this.stamped) {
      this.stamped = true;
      const o = OUTCOME[r.outcome];
      this.poster.setStamp(o.stamp, o.tone);
      play(this.poster.el.querySelector('.cr-wanted__stamp')!, [
        { transform: 'translate(-50%,-50%) rotate(-14deg) scale(2.6)', opacity: 0 },
        { transform: 'translate(-50%,-50%) rotate(-14deg) scale(0.92)', opacity: 1, offset: 0.7 },
        { transform: 'translate(-50%,-50%) rotate(-14deg) scale(1)', opacity: 1 },
      ], { duration: 360, easing: 'cubic-bezier(.3,.0,.2,1)' });
      play(this.poster.el, [{ transform: 'rotate(-2.5deg) translate(0,0)' }, { transform: 'rotate(-2.5deg) translate(3px,5px)' }, { transform: 'rotate(-2.5deg) translate(0,0)' }], { duration: 220, delay: 240 });
      this.record.classList.toggle('is-on', this.isRecord(r, f));
    }
  }

  private isRecord(r: Readonly<RunResult>, f: UiFrame): boolean {
    return r.stats.bounty > 0 && (f.profile.bestBounty[r.shipId] ?? 0) <= r.stats.bounty;
  }

  private build(r: Readonly<RunResult>, f: UiFrame): void {
    this.result = r;
    this.t = 0;
    this.stamped = false;
    this.doubloonsShown = -1;
    const o = OUTCOME[r.outcome];
    const ship = CONTENT.ships[r.shipId];
    this.el.dataset.outcome = r.outcome;
    this.headline.set(o.title);
    play(this.headlineEl, [
      { transform: 'scale(2.2) rotate(-8deg)', opacity: 0 },
      { transform: 'scale(.95) rotate(-3deg)', opacity: 1, offset: 0.7 },
      { transform: 'scale(1) rotate(-3deg)', opacity: 1 },
    ], { duration: 520, delay: 200, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    this.line.set(`${ship.name} · ${CONTENT.seas[r.seaId].name} — ${o.line}`);
    this.poster.setShip(ship);
    this.poster.setBounty('Bounty', '0', `Last seen: ${CONTENT.seas[r.seaId].name}, ${fmtClock(r.time)}`);
    this.poster.setStamp(null);
    this.record.classList.remove('is-on');
    this.rows.time.set(fmtClock(r.time));
    this.rows.level.set(String(r.level));
    this.rows.kills.set(fmtInt(r.stats.kills));
    this.rows.elites.set(fmtInt(r.stats.eliteKills));
    this.rows.doubloons.set('+0');
    this.rows.damage.set(fmtCompact(r.stats.damageDealt));

    this.bosses.replaceChildren();
    for (const id of BOSS_IDS) {
      const def = CONTENT.bosses[id];
      const down = r.stats.bossesDefeated.includes(id);
      this.bosses.append(h('span', `cr-bosschip${down ? ' is-down' : ''}`, glyph(BOSS_GLYPH[id]), h('span', '', def.name.replace(/^The /, '')), down ? glyph('star', 'cr-bosschip__tick') : null));
    }

    const entries = (Object.entries(r.stats.damageByWeapon) as [WeaponId, number][]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const top = entries[0]?.[1] ?? 1;
    this.guns.replaceChildren();
    if (entries.length === 0) this.guns.append(h('span', 'cr-guns__empty', 'No shots landed.'));
    entries.forEach(([id, dmg], i) => {
      const def = CONTENT.weapons[id];
      const fill = h('span', 'cr-gun__fill');
      fill.style.setProperty('--w', (dmg / top).toFixed(3));
      fill.style.animationDelay = `${0.5 + i * 0.12}s`;
      this.guns.append(h('div', 'cr-gun', icon(iconPath(id), WEAPON_GLYPH[id], 'cr-gun__icon'), h('span', 'cr-gun__name', def?.name ?? id), h('span', 'cr-gun__track', fill), h('span', 'cr-gun__value', fmtCompact(dmg)), h('span', 'cr-gun__kills', `${fmtInt(r.stats.killsByWeapon[id] ?? 0)} sunk`)));
    });

    this.unlocks.replaceChildren(...r.newUnlocks.map((u) => h('span', 'cr-unlock-chip', glyph(u.startsWith('New sea') ? 'map' : 'ship'), u)));
    this.unlockBlock.hidden = r.newUnlocks.length === 0;
    this.el.classList.remove('is-enter');
    void this.el.offsetWidth;
    this.el.classList.add('is-enter');
    void f;
    requestAnimationFrame(() => focusEl(this.again));
  }

  /** Any first input finishes the count-up; further input activates buttons. */
  private skip(): boolean {
    if (this.t < COUNT_TIME) { this.t = COUNT_TIME; return true; }
    return false;
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape' || e.code === 'Backspace') { this.cb.onReturnToHarbor(); return true; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      if (this.skip()) return true;
      const a = document.activeElement as HTMLElement | null;
      if (a && this.el.contains(a)) a.click(); else this.again.click();
      return true;
    }
    const dir = keyDir(e.code);
    if (dir) { moveFocus(this.el, dir); return true; }
    return false;
  }

  onPad(intent: PadIntent): boolean {
    if (intent === 'back') { this.cb.onReturnToHarbor(); return true; }
    if (intent === 'confirm' || intent === 'start') {
      if (this.skip()) return true;
      const a = document.activeElement as HTMLElement | null;
      if (a && this.el.contains(a)) a.click(); else this.again.click();
      return true;
    }
    if (intent === 'up' || intent === 'down' || intent === 'left' || intent === 'right') { moveFocus(this.el, intent); return true; }
    return false;
  }
}
