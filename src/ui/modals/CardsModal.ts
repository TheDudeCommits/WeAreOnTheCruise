/**
 * Level-up cards (status 'levelup') and chest reveal (status 'chest'). Cards are dealt with a flip, branch pairs
 * are presented as a fork, Overdrive gets the legendary treatment. Keys 1–4, X reroll, B banish mode.
 */
import { CONTENT } from '../../game/content';
import type { PassiveId, WeaponId } from '../../game/ids';
import type { CardOffer, RunState } from '../../game/types';
import type { UiFrame } from '../contracts';
import { h, navButton, play, TextCell } from '../core/dom';
import { glyph, icon, type GlyphId } from '../core/icons';
import { PASSIVE_GLYPH, STAT_GLYPH, STAT_LABEL, WEAPON_GLYPH } from '../core/names';
import { focusEl, keyDir, moveFocus, type PadIntent } from '../core/nav';
import { keycap, prompt } from '../core/prompts';

export interface CardsDeps {
  choose(index: number): void;
  reroll(): void;
  banish(index: number): void;
}

const KIND_LABEL: Record<CardOffer['kind'], string> = {
  'new-weapon': 'New weapon', 'weapon-level': 'Level up', 'weapon-branch': 'Branch', 'weapon-overdrive': 'Overdrive',
  'new-passive': 'New passive', 'passive-rank': 'Rank up', chip: 'Stat chip', heal: 'Repair', doubloons: 'Doubloons',
};

const TAG_LABEL: Record<string, string> = { projectile: 'Shot', area: 'Area', fire: 'Fire', lightning: 'Lightning', summon: 'Escort', contact: 'Ram', drop: 'Drop' };

function isWeapon(id: string): id is WeaponId { return id in CONTENT.weapons; }
function isPassive(id: string): id is PassiveId { return id in CONTENT.passives; }

export function glyphForOffer(o: CardOffer): GlyphId {
  if (isWeapon(o.id)) return WEAPON_GLYPH[o.id];
  if (isPassive(o.id)) return PASSIVE_GLYPH[o.id];
  if (o.stat) return STAT_GLYPH[o.stat];
  if (o.kind === 'heal') return 'plus';
  if (o.kind === 'doubloons') return 'coin';
  return 'star';
}

interface CardParts { main: string; sub: string; pips: number; level: number; branchPip: boolean; tags: string[] }

function parts(o: CardOffer): CardParts {
  const level = o.level ?? 0;
  if (isWeapon(o.id) && o.kind.includes('weapon')) {
    const def = CONTENT.weapons[o.id];
    if (o.kind === 'weapon-branch') {
      const br = def.branches.find((b) => b.id === o.branch);
      return { main: br?.name ?? o.title, sub: def.name, pips: 6, level: level || 3, branchPip: true, tags: [] };
    }
    if (o.kind === 'weapon-overdrive') return { main: def.overdrive.name, sub: def.name, pips: 6, level: 6, branchPip: true, tags: [] };
    if (o.kind === 'new-weapon') return { main: def.name, sub: 'Joins your gun deck', pips: 6, level: 1, branchPip: true, tags: def.tags.map((t) => TAG_LABEL[t] ?? t) };
    return { main: def.name, sub: `Level ${Math.max(1, level - 1)} → ${level}`, pips: 6, level, branchPip: true, tags: [] };
  }
  if (isPassive(o.id) && o.kind.includes('passive')) {
    const def = CONTENT.passives[o.id];
    return { main: def.name, sub: o.kind === 'new-passive' ? 'New passive' : `Rank ${Math.max(1, level - 1)} → ${level}`, pips: def.maxRank, level: level || 1, branchPip: false, tags: [] };
  }
  if (o.kind === 'chip' && o.stat) {
    const amt = o.amount ?? 0;
    const pct = Math.abs(amt) < 1 && o.stat !== 'armor' && o.stat !== 'luck' && o.stat !== 'amount' && o.stat !== 'revives' ? `${Math.round(amt * 100)}%` : `${amt}`;
    return { main: o.title || STAT_LABEL[o.stat], sub: `${amt >= 0 ? '+' : ''}${pct} ${STAT_LABEL[o.stat]}`, pips: 0, level: 0, branchPip: false, tags: [] };
  }
  return { main: o.title, sub: '', pips: 0, level: 0, branchPip: false, tags: [] };
}

export function buildOfferCard(o: CardOffer, index: number | null, compact = false): HTMLElement {
  const p = parts(o);
  const od = o.kind === 'weapon-overdrive';
  const rarity = od ? 'legendary' : o.rarity;
  const pips = h('span', 'cr-card__pips');
  for (let k = 1; k <= p.pips; k++) {
    const cls = ['cr-card__pip'];
    if (k < p.level) cls.push('is-on');
    if (k === p.level) cls.push('is-new');
    if (p.branchPip && k === 3) cls.push('is-fork');
    if (p.branchPip && k === 6) cls.push('is-star');
    pips.append(h('i', cls.join(' ')));
  }
  const kind = o.kind === 'weapon-branch' && o.branch ? `Branch ${o.branch}` : KIND_LABEL[o.kind] ?? o.kind;
  const el = h('div', `cr-card is-${rarity}${od ? ' is-overdrive' : ''}${o.kind === 'weapon-branch' ? ' is-branch' : ''}${compact ? ' is-compact' : ''}`,
    h('span', 'cr-card__frame'),
    od ? h('span', 'cr-card__rays') : null,
    h('span', 'cr-card__ribbon', od ? glyph('star') : null, kind),
    index !== null ? h('span', 'cr-card__key', keycap(String(index + 1))) : null,
    o.kind === 'weapon-branch' && o.branch ? h('span', 'cr-card__branch', o.branch) : null,
    h('span', 'cr-card__medal', icon(o.icon || null, glyphForOffer(o), 'cr-card__icon')),
    h('span', 'cr-card__title', p.main),
    p.sub ? h('span', 'cr-card__sub', p.sub) : null,
    p.pips ? pips : null,
    h('span', 'cr-card__text', o.text),
    p.tags.length ? h('span', 'cr-card__tags', ...p.tags.map((t) => h('span', 'cr-card__tag', t))) : null,
    h('span', 'cr-card__rarity', od ? 'Legendary' : rarity),
  );
  return el;
}

export class CardsModal {
  readonly el: HTMLElement;
  /** True while the run is waiting on this modal (level-up or chest). */
  open = false;
  private mode: 'levelup' | 'chest' | null = null;
  private offers: readonly CardOffer[] | null = null;
  private buttons: HTMLButtonElement[] = [];
  private banishMode = false;
  private locked = 0;
  private revealT = 0;
  private revealCount = 0;
  private chestDone = false;
  private leaveTimer = 0;

  private readonly levelup: HTMLElement;
  private readonly row: HTMLElement;
  private readonly ghost: HTMLElement;
  private readonly lvText: TextCell;
  private readonly moreText: TextCell;
  private readonly reroll: HTMLButtonElement;
  private readonly rerollCount: TextCell;
  private readonly banish: HTMLButtonElement;
  private readonly banishCount: TextCell;
  private readonly banishHint: HTMLElement;

  private readonly chest: HTMLElement;
  private readonly chestBox: HTMLElement;
  private readonly rewards: HTMLElement;
  private readonly chestPrompt: HTMLElement;
  private rewardEls: HTMLElement[] = [];

  constructor(private readonly deps: CardsDeps) {
    const lv = h('span', 'cr-levelup__lv');
    const more = h('span', 'cr-levelup__more');
    this.row = h('div', 'cr-cards__row');
    this.ghost = h('div', 'cr-cards__row is-ghost');
    const rc = h('span', 'cr-cardbtn__count');
    const bc = h('span', 'cr-cardbtn__count');
    this.reroll = navButton('cr-cardbtn', prompt(['X'], 'X', ''), glyph('map'), h('span', 'cr-cardbtn__label', 'Reroll'), rc);
    this.reroll.addEventListener('click', () => this.doReroll());
    this.banish = navButton('cr-cardbtn is-banish', prompt(['B'], 'Y', ''), glyph('spot'), h('span', 'cr-cardbtn__label', 'Banish'), bc);
    this.banish.addEventListener('click', () => this.toggleBanish());
    this.banishHint = h('div', 'cr-cards__banishhint', glyph('spot'), 'Banish mode — pick a card to remove it from this voyage', h('small', '', 'Press B again to cancel'));
    this.levelup = h('div', 'cr-levelup',
      h('div', 'cr-levelup__burst'),
      h('header', 'cr-levelup__head', h('span', 'cr-levelup__title', 'Level Up!'), lv, more),
      h('div', 'cr-cards__stage', this.ghost, this.row),
      this.banishHint,
      h('footer', 'cr-levelup__foot', prompt(['1', '2', '3', '4'], 'A', 'Choose'), this.reroll, this.banish),
    );
    this.lvText = new TextCell(lv);
    this.moreText = new TextCell(more);
    this.rerollCount = new TextCell(rc);
    this.banishCount = new TextCell(bc);

    this.chestBox = h('div', 'cr-chestbox', h('span', 'cr-chestbox__glow'), h('span', 'cr-chestbox__lid'), h('span', 'cr-chestbox__body', h('span', 'cr-chestbox__lock')));
    this.rewards = h('div', 'cr-chest__rewards');
    this.chestPrompt = h('div', 'cr-chest__prompt', h('span', '', 'Press any key'), keycap('ANY KEY'));
    this.chest = h('div', 'cr-chest', h('div', 'cr-chest__rays'), h('h2', 'cr-chest__title', 'Treasure!'), this.chestBox, this.rewards, this.chestPrompt);
    this.chest.addEventListener('pointerdown', (e) => { if (e.button === 0) this.chestInput(); });

    this.el = h('div', 'cr-modal cr-cards', h('div', 'cr-modal__shade is-cards'), this.levelup, this.chest);
    this.el.hidden = true;
  }

  update(f: UiFrame): void {
    const run = f.run;
    const status = run?.status;
    if (run && status === 'levelup' && run.offers) {
      if (this.mode !== 'levelup' || run.offers !== this.offers) this.deal(run);
      this.syncFooter(run);
    } else if (run && status === 'chest' && run.offers) {
      if (this.mode !== 'chest' || run.offers !== this.offers) this.openChest(run);
      this.tickChest(f.dt);
    } else if (this.mode) {
      this.close();
    }
    if (this.locked > 0) this.locked -= f.dt;
  }

  /** Hard reset when leaving the run screen. */
  reset(): void {
    this.mode = null; this.offers = null; this.open = false; this.el.hidden = true; this.el.classList.remove('is-leaving');
    window.clearTimeout(this.leaveTimer);
  }

  private showShell(mode: 'levelup' | 'chest'): void {
    window.clearTimeout(this.leaveTimer);
    this.el.hidden = false;
    this.el.classList.remove('is-leaving');
    this.el.dataset.mode = mode;
    this.levelup.hidden = mode !== 'levelup';
    this.chest.hidden = mode !== 'chest';
    this.open = true;
  }

  private deal(run: Readonly<RunState>): void {
    const first = this.mode !== 'levelup';
    this.showShell('levelup');
    this.mode = 'levelup';
    const offers = run.offers!;
    this.offers = offers;
    this.banishMode = false;
    this.levelup.classList.remove('is-banish');
    // Old cards leave through the ghost row.
    this.ghost.replaceChildren(...Array.from(this.row.childNodes));
    if (!first) window.setTimeout(() => this.ghost.replaceChildren(), 420);
    else this.ghost.replaceChildren();
    this.row.replaceChildren();
    this.buttons = [];
    const used = new Set<number>();
    const make = (i: number): HTMLButtonElement => {
      const o = offers[i]!;
      const card = buildOfferCard(o, i);
      const b = navButton('cr-cardbtn-wrap');
      b.append(card);
      b.style.setProperty('--i', String(i));
      b.dataset.index = String(i);
      if (i === 0) b.dataset.navDefault = '';
      b.addEventListener('click', () => this.pick(i));
      if (run.banishes > 0) {
        const ban = h('span', 'cr-card__ban', glyph('spot'), 'Banish');
        ban.addEventListener('click', (e) => { e.stopPropagation(); this.doBanish(i); });
        card.append(ban);
      }
      this.buttons[i] = b;
      return b;
    };
    offers.forEach((o, i) => {
      if (used.has(i)) return;
      if (o.kind === 'weapon-branch') {
        const j = offers.findIndex((q, k) => k > i && q.kind === 'weapon-branch' && q.id === o.id);
        if (j > 0) {
          used.add(i); used.add(j);
          const def = isWeapon(o.id) ? CONTENT.weapons[o.id] : null;
          this.row.append(h('div', 'cr-fork',
            h('div', 'cr-fork__head', glyph('wind'), h('span', '', def ? def.name : o.title), h('small', '', 'Choose a path')),
            h('div', 'cr-fork__pair', make(i), h('span', 'cr-fork__or', 'OR'), make(j)),
          ));
          return;
        }
      }
      used.add(i);
      this.row.append(make(i));
    });
    this.lvText.set(`Lv ${run.player.level}`);
    this.moreText.set(run.pendingLevelUps > 1 ? `+${run.pendingLevelUps - 1} more` : '');
    // Deal animation per card (WAAPI: no forced reflow to restart a CSS animation).
    for (const b of this.buttons) {
      if (!b) continue;
      const i = Number(b.dataset.index);
      play(b, [
        { transform: 'translateY(200px) rotateY(80deg) rotate(8deg) scale(.7)', opacity: 0 },
        { opacity: 1, offset: 0.6 },
        { transform: 'none', opacity: 1 },
      ], { duration: 500, delay: i * 80, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'backwards' });
    }
    this.locked = first ? 0.35 : 0.22;
    if (first) play(this.levelup.querySelector('.cr-levelup__title')!, [
      { transform: 'scale(2.4) rotate(-8deg)', opacity: 0 }, { transform: 'scale(.94) rotate(-3deg)', opacity: 1, offset: 0.6 }, { transform: 'scale(1) rotate(-3deg)', opacity: 1 },
    ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    requestAnimationFrame(() => focusEl(this.buttons[0]));
  }

  private syncFooter(run: Readonly<RunState>): void {
    this.reroll.hidden = run.rerolls <= 0;
    this.rerollCount.set(`×${run.rerolls}`);
    this.banish.hidden = run.banishes <= 0;
    this.banishCount.set(`×${run.banishes}`);
    if (run.banishes <= 0 && this.banishMode) this.toggleBanish(false);
  }

  private pick(i: number): void {
    if (this.mode !== 'levelup' || this.locked > 0 || !this.offers?.[i]) return;
    if (this.banishMode) { this.doBanish(i); return; }
    this.locked = 0.3;
    const b = this.buttons[i];
    this.row.classList.add('has-pick');
    b?.classList.add('is-picked');
    this.deps.choose(i);
  }

  private doReroll(): void {
    if (this.mode !== 'levelup' || this.locked > 0 || this.reroll.hidden) return;
    this.locked = 0.25;
    this.deps.reroll();
  }

  private doBanish(i: number): void {
    if (this.mode !== 'levelup' || this.locked > 0 || this.banish.hidden) return;
    this.locked = 0.25;
    this.buttons[i]?.classList.add('is-banished');
    this.deps.banish(i);
  }

  private toggleBanish(on = !this.banishMode): void {
    if (on && this.banish.hidden) return;
    this.banishMode = on;
    this.levelup.classList.toggle('is-banish', on);
  }

  // ── Chest ──

  private openChest(run: Readonly<RunState>): void {
    this.showShell('chest');
    this.mode = 'chest';
    this.offers = run.offers;
    this.revealT = 0;
    this.chestDone = false;
    this.revealCount = 0;
    this.rewardEls = run.offers!.map((o) => {
      const c = buildOfferCard(o, null, true);
      c.classList.add('is-hidden');
      return c;
    });
    this.rewards.replaceChildren(...this.rewardEls);
    this.chest.classList.remove('is-open', 'is-done');
    this.chestPrompt.classList.remove('is-on');
    this.chestBox.classList.remove('is-shake');
    requestAnimationFrame(() => this.chestBox.classList.add('is-shake'));
  }

  private tickChest(dt: number): void {
    this.revealT += dt;
    const t = this.revealT;
    if (t > 0.75 && !this.chest.classList.contains('is-open')) this.chest.classList.add('is-open');
    const due = Math.max(0, Math.min(this.rewardEls.length, Math.floor((t - 0.95) / 0.32) + 1));
    while (this.revealCount < due) {
      const el = this.rewardEls[this.revealCount++]!;
      el.classList.remove('is-hidden');
      play(el, [{ transform: 'translateY(90px) scale(.3) rotate(-12deg)', opacity: 0 }, { transform: 'translateY(-14px) scale(1.08) rotate(2deg)', opacity: 1, offset: 0.65 }, { transform: 'none', opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.2,.9,.2,1)' });
    }
    if (!this.chestDone && this.revealCount >= this.rewardEls.length && t > 0.95 + this.rewardEls.length * 0.32 + 0.25) {
      this.chestDone = true;
      this.chest.classList.add('is-done');
      this.chestPrompt.classList.add('is-on');
    }
  }

  private chestInput(): void {
    if (this.mode !== 'chest') return;
    if (!this.chestDone) { this.revealT = Math.max(this.revealT, 0.95 + this.rewardEls.length * 0.32 + 0.3); return; }
    this.locked = 0.3;
    this.deps.choose(0);
  }

  private close(): void {
    this.mode = null;
    this.offers = null;
    this.open = false;
    this.banishMode = false;
    this.el.classList.add('is-leaving');
    window.clearTimeout(this.leaveTimer);
    this.leaveTimer = window.setTimeout(() => { if (!this.mode) { this.el.hidden = true; this.el.classList.remove('is-leaving'); this.ghost.replaceChildren(); } }, 380);
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.mode === 'chest') {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return false;
      this.chestInput();
      return true;
    }
    if (this.mode !== 'levelup') return false;
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'].indexOf(e.code);
    if (n >= 0) { if (!e.repeat) this.pick(n % 4); return true; }
    if (e.code === 'KeyX') { if (!e.repeat) this.doReroll(); return true; }
    if (e.code === 'KeyB') { if (!e.repeat) this.toggleBanish(); return true; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      if (e.repeat) return true;
      const a = document.activeElement as HTMLElement | null;
      if (a && this.row.contains(a) && a.dataset.index) this.pick(Number(a.dataset.index));
      else if (a && this.el.contains(a)) a.click();
      return true;
    }
    const dir = keyDir(e.code);
    if (dir) { moveFocus(this.levelup, dir); return true; }
    return false;
  }

  onPad(intent: PadIntent): boolean {
    if (this.mode === 'chest') { if (intent === 'confirm' || intent === 'back' || intent === 'start') { this.chestInput(); return true; } return false; }
    if (this.mode !== 'levelup') return false;
    switch (intent) {
      case 'confirm': { const a = document.activeElement as HTMLElement | null; if (a && a.dataset.index) this.pick(Number(a.dataset.index)); else a?.click(); return true; }
      case 'alt': this.doReroll(); return true;
      case 'alt2': this.toggleBanish(); return true;
      case 'back': if (this.banishMode) this.toggleBanish(false); return true;
      case 'up': case 'down': case 'left': case 'right': moveFocus(this.levelup, intent); return true;
      default: return false;
    }
  }
}
