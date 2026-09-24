/** Pause: resume, settings, controls help, retire (with confirmation) and a snapshot of the voyage. */
import { CONTENT } from '../../game/content';
import type { RunState } from '../../game/types';
import { h, navButton, play, TextCell } from '../core/dom';
import { fmtClock, fmtInt } from '../core/format';
import { glyph, icon, type GlyphId } from '../core/icons';
import { iconPath, PASSIVE_GLYPH, SPECIALS, ULTIMATES, WEAPON_GLYPH } from '../core/names';
import { focusDefault, focusEl, keyDir, moveFocus, type PadIntent } from '../core/nav';
import { keycap, padButton, prompt, type PadButton } from '../core/prompts';

export interface PauseDeps {
  resume(): void;
  openSettings(): void;
  retire(): void;
}

type View = 'menu' | 'controls' | 'confirm';

const CONTROLS: readonly { glyph: GlyphId; action: string; keys: string[]; pad: PadButton | null; note?: string }[] = [
  { glyph: 'sail', action: 'Sail gear up / down', keys: ['W', 'S'], pad: 'DPAD', note: 'Anchor · Half · Full — half sail turns tightest' },
  { glyph: 'wheel', action: 'Rudder port / starboard', keys: ['A', 'D'], pad: 'LS' },
  { glyph: 'crosshair', action: 'Aim', keys: ['MOUSE'], pad: 'RS', note: 'Point at the water' },
  { glyph: 'cannon', action: 'Full broadside', keys: ['LMB', 'Q'], pad: 'RT', note: 'Fires the side facing your aim' },
  { glyph: 'burst', action: 'Special', keys: ['E'], pad: 'LB' },
  { glyph: 'sun', action: 'Ultimate (when charged)', keys: ['R'], pad: 'RB' },
  { glyph: 'speed', action: 'Boost', keys: ['SHIFT'], pad: 'B' },
  { glyph: 'shield', action: 'Brace (early = Parry)', keys: ['SPACE'], pad: 'A' },
  { glyph: 'xp', action: 'Pick a card / reroll', keys: ['1–4', 'X'], pad: 'X' },
  { glyph: 'compass', action: 'Orbit / zoom camera', keys: ['RMB', 'WHEEL'], pad: null },
  { glyph: 'gear', action: 'Pause', keys: ['ESC', 'P'], pad: 'START' },
];

export class PauseMenu {
  readonly el: HTMLElement;
  open = false;
  private view: View = 'menu';
  private readonly menu: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly confirmNo: HTMLButtonElement;
  private readonly shipName: TextCell;
  private readonly seaName: TextCell;
  private readonly facts: Record<'time' | 'level' | 'kills' | 'bounty' | 'doubloons', TextCell>;
  private readonly loadout: HTMLElement;
  private readonly skills: HTMLElement;

  constructor(private readonly deps: PauseDeps) {
    const item = (g: GlyphId, label: string, fn: () => void) => {
      const b = navButton('cr-menuitem', glyph(g, 'cr-menuitem__icon'), h('span', 'cr-menuitem__label', label));
      b.addEventListener('click', fn);
      return b;
    };
    this.resumeBtn = item('speed', 'Resume', () => this.deps.resume());
    this.resumeBtn.dataset.navDefault = '';
    this.menu = h('nav', 'cr-pause__menu',
      this.resumeBtn,
      item('gear', 'Settings', () => this.deps.openSettings()),
      item('compass', 'Controls', () => this.setView('controls')),
      item('spot', 'Retire', () => this.setView('confirm')),
    );

    const table = h('div', 'cr-controls__table');
    for (const c of CONTROLS) {
      const keys = h('span', 'cr-controls__keys');
      c.keys.forEach((k, i) => { if (i) keys.append(h('span', 'cr-prompt__or', '/')); keys.append(keycap(k)); });
      table.append(h('div', 'cr-controls__row',
        glyph(c.glyph, 'cr-controls__icon'),
        h('span', 'cr-controls__action', c.action, c.note ? h('small', '', c.note) : null),
        keys,
        h('span', 'cr-controls__pad', c.pad ? padButton(c.pad) : null),
      ));
    }
    const back = navButton('cr-btn is-ghost', prompt(['ESC'], 'B', ''), h('span', 'cr-btn__label', 'Back'));
    back.addEventListener('click', () => this.setView('menu'));
    back.dataset.navDefault = '';
    this.controls = h('section', 'cr-controls cr-brushpanel', h('h3', 'cr-panel-title', glyph('compass'), 'Controls'), table, h('div', 'cr-controls__foot', back));

    this.confirmNo = navButton('cr-btn is-primary', prompt(['ESC'], 'B', ''), h('span', 'cr-btn__label', 'Keep sailing'));
    this.confirmNo.dataset.navDefault = '';
    this.confirmNo.addEventListener('click', () => this.setView('menu'));
    const yes = navButton('cr-btn is-danger', glyph('spot'), h('span', 'cr-btn__label', 'Retire'));
    yes.addEventListener('click', () => this.deps.retire());
    this.confirm = h('section', 'cr-confirm cr-brushpanel',
      h('h3', 'cr-confirm__title', 'Strike your colours?'),
      h('p', 'cr-confirm__text', 'The voyage ends here. Your bounty and doubloons are banked.'),
      h('div', 'cr-confirm__buttons', this.confirmNo, yes),
    );

    const ship = h('div', 'cr-pausecard__ship');
    const sea = h('div', 'cr-pausecard__sea');
    const fact = (g: GlyphId, label: string) => { const v = h('b', ''); return { el: h('div', 'cr-pausecard__fact', glyph(g), h('span', '', label), v), v: new TextCell(v) }; };
    const fTime = fact('clock', 'Time'), fLevel = fact('xp', 'Level'), fKills = fact('skull', 'Sunk'), fBounty = fact('crown', 'Bounty'), fDoub = fact('coin', 'Doubloons');
    this.loadout = h('div', 'cr-pausecard__loadout');
    this.skills = h('div', 'cr-pausecard__skills');
    const card = h('section', 'cr-pausecard cr-brushpanel',
      h('div', 'cr-pausecard__head', ship, sea),
      h('div', 'cr-pausecard__facts', fTime.el, fLevel.el, fKills.el, fBounty.el, fDoub.el),
      h('div', 'cr-pausecard__label', 'Loadout'),
      this.loadout,
      this.skills,
    );
    this.shipName = new TextCell(ship);
    this.seaName = new TextCell(sea);
    this.facts = { time: fTime.v, level: fLevel.v, kills: fKills.v, bounty: fBounty.v, doubloons: fDoub.v };

    this.el = h('div', 'cr-modal cr-pause',
      h('div', 'cr-modal__shade is-dark'),
      h('div', 'cr-pause__left', h('h2', 'cr-pause__title', 'Paused'), this.menu),
      h('div', 'cr-pause__right', card, this.controls, this.confirm),
      h('div', 'cr-pause__bar', prompt(['↑', '↓'], 'DPAD', 'Choose'), prompt(['ENTER'], 'A', 'Select'), prompt(['ESC'], 'START', 'Resume')),
    );
    this.el.hidden = true;
  }

  show(run: Readonly<RunState> | null): void {
    this.open = true;
    this.el.hidden = false;
    if (run) this.fill(run);
    this.setView('menu');
    play(this.el.querySelector('.cr-pause__left')!, [{ opacity: 0, transform: 'translateX(-40px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.2,1)' });
    play(this.el.querySelector('.cr-pause__right')!, [{ opacity: 0, transform: 'translateX(40px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.2,1)' });
  }

  hide(): void { this.open = false; this.el.hidden = true; }

  /** Returns focus to the menu (after settings closes). */
  refocus(): void { requestAnimationFrame(() => focusDefault(this.view === 'menu' ? this.menu : this.view === 'controls' ? this.controls : this.confirm)); }

  private fill(run: Readonly<RunState>): void {
    const ship = CONTENT.ships[run.shipId];
    this.shipName.set(ship.name);
    this.seaName.set(`${CONTENT.seas[run.seaId].name} · ${ship.epithet}`);
    this.facts.time.set(fmtClock(run.time));
    this.facts.level.set(String(run.player.level));
    this.facts.kills.set(fmtInt(run.stats.kills));
    this.facts.bounty.set(fmtInt(run.stats.bounty));
    this.facts.doubloons.set(fmtInt(run.stats.doubloons));
    this.loadout.replaceChildren(
      ...run.player.weapons.map((w) => {
        const def = CONTENT.weapons[w.id];
        const branch = w.branch ? def.branches.find((b) => b.id === w.branch)?.name : null;
        return h('div', `cr-kit${w.overdrive ? ' is-od' : ''}`, icon(iconPath(w.id), WEAPON_GLYPH[w.id], 'cr-kit__icon'),
          h('span', 'cr-kit__name', w.overdrive ? def.overdrive.name : def.name, branch && !w.overdrive ? h('small', '', branch) : null),
          h('span', 'cr-kit__lv', w.overdrive ? '★' : `Lv ${w.level}`));
      }),
      ...run.player.passives.map((p) => {
        const def = CONTENT.passives[p.id];
        return h('div', 'cr-kit is-passive', icon(iconPath(p.id), PASSIVE_GLYPH[p.id], 'cr-kit__icon'), h('span', 'cr-kit__name', def.name), h('span', 'cr-kit__lv', `${p.rank}/${def.maxRank}`));
      }),
    );
    const sp = SPECIALS[ship.special], ul = ULTIMATES[ship.ultimate];
    this.skills.replaceChildren(
      h('div', 'cr-pausecard__skill', icon(iconPath(ship.special), sp.glyph, 'cr-kit__icon'), keycap('E'), h('span', '', h('b', '', sp.name), sp.text)),
      h('div', 'cr-pausecard__skill is-ult', icon(iconPath(ship.ultimate), ul.glyph, 'cr-kit__icon'), keycap('R'), h('span', '', h('b', '', ul.name), ul.text)),
    );
  }

  private setView(view: View): void {
    this.view = view;
    this.controls.hidden = view !== 'controls';
    this.confirm.hidden = view !== 'confirm';
    this.el.querySelector<HTMLElement>('.cr-pausecard')!.hidden = view !== 'menu';
    this.menu.toggleAttribute('inert', view !== 'menu');
    this.menu.classList.toggle('is-dim', view !== 'menu');
    const scope = view === 'menu' ? this.menu : view === 'controls' ? this.controls : this.confirm;
    if (view !== 'menu') play(scope, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.9,.2,1)' });
    requestAnimationFrame(() => { if (view === 'confirm') focusEl(this.confirmNo); else focusDefault(scope); });
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'Backspace') {
      if (this.view !== 'menu') this.setView('menu'); else this.deps.resume();
      return true;
    }
    const dir = keyDir(e.code);
    if (dir) { moveFocus(this.scope(), dir); return true; }
    return false;
  }

  onPad(intent: PadIntent): boolean {
    if (intent === 'back') { if (this.view !== 'menu') this.setView('menu'); else this.deps.resume(); return true; }
    if (intent === 'start') { this.deps.resume(); return true; }
    if (intent === 'confirm') { (document.activeElement as HTMLElement | null)?.click(); return true; }
    if (intent === 'up' || intent === 'down' || intent === 'left' || intent === 'right') { moveFocus(this.scope(), intent); return true; }
    return false;
  }

  private scope(): HTMLElement { return this.view === 'menu' ? this.menu : this.view === 'controls' ? this.controls : this.confirm; }
}
