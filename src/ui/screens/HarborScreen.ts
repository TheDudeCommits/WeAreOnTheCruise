/**
 * Harbor (meta hub): fleet (ship cards + details), seas, shipwright upgrades, doubloons, best-bounty WANTED
 * poster, settings, credits and the big SET SAIL button. Built once; updated in place when the profile changes.
 *
 * Extra tabs come from the harbor pane registry (harborPanes.ts; REPLAY registers quests, logbook, voyage…): they
 * follow Fleet · Seas · Shipwright, are picked up whenever they register (even after mount), cycle with Q/E and
 * LB/RB like the others, and get the keys first while showing (HarborPane.onKey). Long panes (shipwright, extras)
 * scroll inside the panel with fade masks, so nothing ever runs under the key legend.
 */
import { CONTENT } from '../../game/content';
import { META_UPGRADE_IDS, SEA_IDS, SHIP_IDS, type MetaUpgradeId, type SeaId, type ShipId } from '../../game/ids';
import { upgradeCost } from '../../game/meta/save';
import type { MetaProfile, ShipDef } from '../../game/types';
import type { UiCallbacks, UiFrame } from '../contracts';
import { WantedPoster } from '../components/WantedPoster';
import { GoalsCard, goalsFor } from '../components/GoalsCard';
import { h, hex, navButton, play, TextCell } from '../core/dom';
import { fmtClock, fmtInt } from '../core/format';
import { glyph, icon, setIcon } from '../core/icons';
import { BOSS_GLYPH, iconPath, META_GLYPH, SPECIALS, ULTIMATES, WEATHER_LABEL } from '../core/names';
import { focusDefault, focusEl, keyDir, moveFocus, type PadIntent } from '../core/nav';
import { prompt } from '../core/prompts';
import { harborPanes, type HarborPane } from './harborPanes';
import { ScrollFade } from '../core/scroll';
import { SHIP_STATS, statFill, thumbFor } from './shipStats';

/** Built-in tabs, then any registered harbor panes (by pane id). */
type Tab = string;
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'fleet', label: 'Fleet' }, { id: 'seas', label: 'Seas' }, { id: 'shipwright', label: 'Shipwright' },
];

interface ShipCard { el: HTMLButtonElement; status: TextCell; cost: HTMLElement }
interface SeaCard { el: HTMLButtonElement; lock: TextCell }
interface UpgradeTile { el: HTMLElement; pips: HTMLElement[]; buy: HTMLButtonElement; cost: TextCell; rank: TextCell; lastRank: number }

export interface HarborDeps {
  cb: UiCallbacks;
  openSettings(): void;
}

const SEA_DIFF_LABEL = ['Calm', 'Rough', 'Deadly'];

export class HarborScreen {
  readonly el: HTMLElement;
  private tab: Tab = 'fleet';
  private selectedSea: SeaId = 'sunward-shallows';
  private selectedShip: ShipId = 'dawn-ram';
  private profile: Readonly<MetaProfile> | null = null;
  private sig = '';
  private shownDoubloons = -1;
  private targetDoubloons = 0;
  private visible = false;
  private needsFocus = false;

  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  /** Tab order: built-ins, then registered panes as they arrive. */
  private readonly tabOrder: Tab[] = TABS.map((t) => t.id);
  private readonly extPanes = new Map<Tab, HarborPane>();
  private readonly scrollers: ScrollFade[] = [];
  private readonly tabsNav: HTMLElement;
  private readonly tabsEnd: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly shipCards = new Map<ShipId, ShipCard>();
  private readonly seaCards = new Map<SeaId, SeaCard>();
  private readonly tiles = new Map<MetaUpgradeId, UpgradeTile>();
  private readonly balance: TextCell;
  private readonly balanceEl: HTMLElement;
  private readonly poster = new WantedPoster('is-harbor');
  /** REPLAY's nextGoals(profile), between the poster and the voyage block (hidden while there are none). */
  private readonly goals = new GoalsCard(3, 'is-harbor');
  private side!: HTMLElement;
  private readonly setSail: HTMLButtonElement;
  private readonly setSailLabel: TextCell;
  private readonly voyageShip: TextCell;
  private readonly voyageSea: TextCell;
  private readonly voyageDiff: HTMLElement;

  // Ship details
  private readonly dName: TextCell;
  private readonly dEpithet: TextCell;
  private readonly dDesc: TextCell;
  private readonly dStats: { fill: HTMLElement; value: TextCell }[] = [];
  private readonly dSpecialName: TextCell;
  private readonly dSpecialText: TextCell;
  private readonly dUltName: TextCell;
  private readonly dUltText: TextCell;
  private readonly dSpecialIcon: HTMLElement;
  private readonly dUltIcon: HTMLElement;
  private readonly dLock: HTMLElement;
  private readonly dLockText: TextCell;
  private readonly dUnlock: HTMLButtonElement;
  private readonly dUnlockCost: TextCell;
  private readonly details: HTMLElement;

  constructor(private readonly deps: HarborDeps) {
    // ── Top bar ──
    const tabs = h('nav', 'cr-tabs', prompt(['Q'], 'LB', '', 'cr-tabs__hint'));
    for (const t of TABS) {
      const b = navButton('cr-tab', h('span', 'cr-tab__label', t.label));
      b.dataset.tab = t.id;
      b.addEventListener('click', () => this.setTab(t.id, true));
      this.tabButtons.set(t.id, b);
      tabs.append(b);
    }
    this.tabsEnd = prompt(['E'], 'RB', '', 'cr-tabs__hint');
    tabs.append(this.tabsEnd);
    this.tabsNav = tabs;
    const balanceNum = h('span', 'cr-balance__num', '0');
    this.balanceEl = h('div', 'cr-balance', icon(iconPath('doubloon'), 'coin', 'cr-balance__coin'), balanceNum, h('span', 'cr-balance__label', 'Doubloons'));
    this.balance = new TextCell(balanceNum);
    const settingsBtn = navButton('cr-iconbtn', glyph('gear'), h('span', 'cr-iconbtn__label', 'Settings'));
    settingsBtn.addEventListener('click', () => this.deps.openSettings());
    const credits = h('a', 'cr-iconbtn is-link', glyph('book'), h('span', 'cr-iconbtn__label', 'Credits'));
    credits.href = '/credits.html';
    credits.target = '_blank';
    credits.rel = 'noopener';
    credits.dataset.nav = '';
    const top = h('header', 'cr-harbor__top',
      h('div', 'cr-harbor__title', h('span', 'cr-harbor__title-main', 'The Harbor'), h('span', 'cr-harbor__title-sub', 'Brightwater Port')),
      tabs,
      h('div', 'cr-harbor__meta', this.balanceEl, settingsBtn, credits),
    );

    // ── Fleet pane ──
    const grid = h('div', 'cr-shipgrid');
    for (const id of SHIP_IDS) {
      const ship = CONTENT.ships[id];
      const img = h('img', 'cr-shipcard__img');
      img.src = thumbFor(ship);
      img.alt = '';
      img.draggable = false;
      const status = h('span', 'cr-shipcard__status');
      const cost = h('span', 'cr-shipcard__cost');
      const card = navButton('cr-shipcard',
        h('span', 'cr-shipcard__art', img, h('span', 'cr-shipcard__lock', glyph('lock')), cost),
        h('span', 'cr-shipcard__plate',
          h('span', 'cr-shipcard__name', ship.name),
          status,
        ),
        h('span', 'cr-shipcard__check', glyph('star')),
      );
      card.style.setProperty('--accent', hex(ship.accent));
      card.dataset.ship = id;
      card.addEventListener('focus', () => this.preview(id));
      card.addEventListener('click', () => this.activateShip(id));
      grid.append(card);
      this.shipCards.set(id, { el: card, status: new TextCell(status), cost });
    }

    const dName = h('div', 'cr-details__name');
    const dEpithet = h('div', 'cr-details__epithet');
    const dDesc = h('p', 'cr-details__desc');
    const stats = h('div', 'cr-statbars');
    for (const stat of SHIP_STATS) {
      const fill = h('span', 'cr-statbar__fill');
      const value = h('span', 'cr-statbar__value');
      stats.append(h('div', 'cr-statbar', glyph(stat.glyph, 'cr-statbar__icon'), h('span', 'cr-statbar__label', stat.label), h('span', 'cr-statbar__track', fill), value));
      this.dStats.push({ fill, value: new TextCell(value) });
    }
    const spName = h('span', 'cr-skillinfo__name');
    const spText = h('span', 'cr-skillinfo__text');
    const ulName = h('span', 'cr-skillinfo__name');
    const ulText = h('span', 'cr-skillinfo__text');
    this.dSpecialIcon = icon(null, 'burst', 'cr-skillinfo__icon');
    this.dUltIcon = icon(null, 'sun', 'cr-skillinfo__icon is-ult');
    const skills = h('div', 'cr-skillinfo',
      h('div', 'cr-skillinfo__row', this.dSpecialIcon, h('span', 'cr-skillinfo__body', h('span', 'cr-skillinfo__kind', prompt(['E'], 'LB', ''), 'Special'), spName, spText)),
      h('div', 'cr-skillinfo__row', this.dUltIcon, h('span', 'cr-skillinfo__body', h('span', 'cr-skillinfo__kind is-ult', prompt(['R'], 'RB', ''), 'Ultimate'), ulName, ulText)),
    );
    const lockText = h('span', 'cr-details__locktext');
    const unlockCost = h('span', 'cr-unlock__cost');
    this.dUnlock = navButton('cr-unlock', glyph('lock'), h('span', 'cr-unlock__label', 'Unlock'), icon(iconPath('doubloon'), 'coin', 'cr-unlock__coin'), unlockCost);
    this.dUnlock.addEventListener('click', () => this.tryUnlock());
    this.dLock = h('div', 'cr-details__lock', glyph('lock', 'cr-details__lockicon'), lockText, this.dUnlock);
    this.details = h('section', 'cr-details cr-brushpanel',
      h('div', 'cr-details__head', h('div', '', dName, dEpithet), this.dLock),
      dDesc,
      stats,
      skills,
    );
    this.dName = new TextCell(dName);
    this.dEpithet = new TextCell(dEpithet);
    this.dDesc = new TextCell(dDesc);
    this.dSpecialName = new TextCell(spName);
    this.dSpecialText = new TextCell(spText);
    this.dUltName = new TextCell(ulName);
    this.dUltText = new TextCell(ulText);
    this.dLockText = new TextCell(lockText);
    this.dUnlockCost = new TextCell(unlockCost);
    const fleet = h('div', 'cr-pane cr-pane--fleet', grid, this.details);

    // ── Seas pane ──
    const seas = h('div', 'cr-pane cr-pane--seas');
    for (const id of SEA_IDS) {
      const sea = CONTENT.seas[id];
      const diff = Math.max(0, Math.min(2, Math.round((sea.difficulty - 1) / 0.35)));
      const skulls = h('span', 'cr-seacard__diff');
      for (let i = 0; i < 3; i++) skulls.append(glyph('skull', i <= diff ? 'is-on' : ''));
      skulls.append(h('span', 'cr-seacard__difflabel', SEA_DIFF_LABEL[diff]!));
      const bosses = h('span', 'cr-seacard__bosses');
      for (const b of sea.bosses) {
        const def = CONTENT.bosses[b.boss];
        bosses.append(h('span', 'cr-seacard__boss', glyph(BOSS_GLYPH[b.boss]), h('b', '', fmtClock(b.at)), def.name.replace(/^The /, '')));
      }
      const weather = [...new Set(sea.weather.map((w) => WEATHER_LABEL[w.weather] ?? w.weather))].join(' · ');
      const lock = h('span', 'cr-seacard__locktext');
      const card = navButton(`cr-seacard is-${id}`,
        h('span', 'cr-seacard__art', h('span', 'cr-seacard__sky'), h('span', 'cr-seacard__orb'), h('span', 'cr-seacard__sea'), h('span', 'cr-seacard__fx')),
        h('span', 'cr-seacard__body',
          h('span', 'cr-seacard__top', h('span', 'cr-seacard__name', sea.name), skulls),
          h('span', 'cr-seacard__desc', sea.description),
          h('span', 'cr-seacard__facts', h('span', 'cr-seacard__fact', glyph('clock'), fmtClock(sea.duration)), h('span', 'cr-seacard__fact', glyph('wind'), weather)),
          bosses,
        ),
        h('span', 'cr-seacard__lock', glyph('lock'), lock),
        h('span', 'cr-seacard__check', glyph('star')),
      );
      card.dataset.sea = id;
      card.addEventListener('click', () => this.activateSea(id));
      seas.append(card);
      this.seaCards.set(id, { el: card, lock: new TextCell(lock) });
    }

    // ── Shipwright pane ──
    const shop = h('div', 'cr-pane cr-pane--shipwright');
    const shopGrid = h('div', 'cr-shop');
    for (const id of META_UPGRADE_IDS) {
      const def = CONTENT.metaUpgrades[id];
      const pips = h('span', 'cr-pips');
      const pipEls: HTMLElement[] = [];
      for (let i = 0; i < def.maxRank; i++) { const p = h('i', 'cr-pip'); pips.append(p); pipEls.push(p); }
      const cost = h('span', 'cr-buy__cost');
      const rank = h('span', 'cr-tile__rank');
      const buy = navButton('cr-buy', icon(iconPath('doubloon'), 'coin', 'cr-buy__coin'), cost);
      buy.addEventListener('click', () => this.tryBuy(id));
      const tile = h('div', 'cr-tile',
        icon(iconPath(id), META_GLYPH[id], 'cr-tile__icon'),
        h('div', 'cr-tile__body',
          h('div', 'cr-tile__top', h('span', 'cr-tile__name', def.name), rank),
          h('div', 'cr-tile__desc', def.description),
          pips,
        ),
        buy,
      );
      tile.dataset.upgrade = id;
      tile.title = `${def.name}: ${def.description}`;
      shopGrid.append(tile);
      this.tiles.set(id, { el: tile, pips: pipEls, buy, cost: new TextCell(cost), rank: new TextCell(rank), lastRank: -1 });
    }
    const shopScroll = h('div', 'cr-scroll cr-shop__scroll', shopGrid);
    this.scrollers.push(new ScrollFade(shopScroll));
    shop.append(h('div', 'cr-shop__intro', glyph('hammer'), h('span', '', 'Permanent refits for every ship. Doubloons are banked at the end of each voyage.')), shopScroll);

    this.panes.set('fleet', fleet);
    this.panes.set('seas', seas);
    this.panes.set('shipwright', shop);
    const panel = h('div', 'cr-harbor__panel', fleet, seas, shop);
    this.panel = panel;

    // ── Side column: poster + voyage + SET SAIL ──
    const vShip = h('span', 'cr-voyage__ship');
    const vSea = h('span', 'cr-voyage__sea');
    this.voyageDiff = h('span', 'cr-voyage__diff');
    const sailLabel = h('span', 'cr-setsail__label', 'Set Sail');
    this.setSail = navButton('cr-setsail', h('span', 'cr-setsail__brush'), prompt(['ENTER'], 'START', '', 'cr-setsail__prompt'), sailLabel, glyph('compass', 'cr-setsail__rose'));
    this.setSail.addEventListener('click', () => this.sail());
    this.setSailLabel = new TextCell(sailLabel);
    const side = h('aside', 'cr-harbor__side',
      this.poster.el,
      this.goals.el,
      h('div', 'cr-voyage',
        h('div', 'cr-voyage__row', h('span', 'cr-voyage__label', 'Voyage'), this.voyageDiff),
        h('div', 'cr-voyage__names', vShip, h('span', 'cr-voyage__sep', glyph('wind')), vSea),
        this.setSail,
      ),
    );
    this.voyageShip = new TextCell(vShip);
    this.voyageSea = new TextCell(vSea);
    this.side = side;

    const bar = h('footer', 'cr-harbor__bar',
      prompt(['←', '→'], 'DPAD', 'Browse'),
      prompt(['Q', 'E'], 'LB', 'Tabs'),
      prompt(['ENTER'], 'A', 'Select'),
      prompt(['F'], 'START', 'Set sail'),
      prompt(['ESC'], 'Y', 'Settings'),
    );

    this.el = h('section', 'cr-screen cr-harbor', h('div', 'cr-harbor__shade'), top, panel, side, bar);
    this.el.hidden = true;
    this.syncPanes();
    this.setTab('fleet', false);
  }

  /** Adds a tab for every harbor pane registered since the last call (cheap when nothing is new). */
  private syncPanes(): void {
    const list = harborPanes();
    if (list.length === this.extPanes.size) return;
    for (const pane of list) {
      if (this.extPanes.has(pane.id) || this.tabButtons.has(pane.id)) continue;
      const b = navButton('cr-tab is-ext', h('span', 'cr-tab__label', pane.label));
      b.dataset.tab = pane.id;
      b.addEventListener('click', () => this.setTab(pane.id, true));
      this.tabsNav.insertBefore(b, this.tabsEnd);
      this.tabButtons.set(pane.id, b);
      const scroll = h('div', 'cr-scroll cr-pane__scroll', pane.el);
      this.scrollers.push(new ScrollFade(scroll));
      const wrap = h('div', `cr-pane cr-pane--ext`, scroll);
      wrap.dataset.pane = pane.id;
      wrap.hidden = true;
      this.panel.append(wrap);
      this.panes.set(pane.id, wrap);
      this.extPanes.set(pane.id, pane);
      this.tabOrder.push(pane.id);
      try { pane.mount?.(this.deps.cb); } catch (err) { console.error(`harbor pane ${pane.id} failed to mount`, err); }
    }
    this.tabsNav.classList.toggle('has-many', this.tabOrder.length > 3);
    this.el.classList.toggle('has-many-tabs', this.tabOrder.length > 3);
  }

  /** Keeps a focused item inside its scrolling panel (focus moves with preventScroll). */
  private reveal(el: Element | null): void {
    const box = el instanceof HTMLElement ? el.closest<HTMLElement>('.cr-scroll') : null;
    if (!box || !el) return;
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    const pad = 18;
    if (r.top < b.top + pad) box.scrollTop -= b.top + pad - r.top;
    else if (r.bottom > b.bottom - pad) box.scrollTop += r.bottom - (b.bottom - pad);
  }

  show(f: UiFrame | null): void {
    this.visible = true;
    this.el.hidden = false;
    this.sig = '';
    this.shownDoubloons = -1;
    if (f) {
      this.selectedShip = f.selectedShip;
      if (f.profile.unlockedSeas.includes(f.profile.lastSea)) this.selectedSea = f.profile.lastSea;
      this.sync(f);
    }
    this.el.classList.remove('is-enter');
    void this.el.offsetWidth;
    this.el.classList.add('is-enter');
    this.setTab(this.tab, false);
    this.needsFocus = true;
  }

  hide(): void { this.visible = false; this.el.hidden = true; }

  /** Focus back into the active tab (after a modal closes). */
  refocus(): void { requestAnimationFrame(() => { if (this.visible) this.focusTab(); }); }

  update(f: UiFrame): void {
    this.selectedShip = f.selectedShip;
    this.syncPanes();
    const ext = this.extPanes.get(this.tab);
    if (ext) { try { ext.update(f); } catch (err) { console.error(`harbor pane ${ext.id} failed to update`, err); } }
    this.sync(f);
    if (this.needsFocus) { this.needsFocus = false; this.focusTab(); }
    // Doubloon balance count animation.
    if (this.shownDoubloons !== this.targetDoubloons) {
      const diff = this.targetDoubloons - this.shownDoubloons;
      const step = Math.sign(diff) * Math.max(1, Math.abs(diff) * Math.min(1, f.dt * 9));
      this.shownDoubloons = Math.abs(step) >= Math.abs(diff) ? this.targetDoubloons : this.shownDoubloons + step;
      this.balance.set(fmtInt(this.shownDoubloons));
    }
  }

  private sync(f: UiFrame): void {
    const p = f.profile;
    let sig = `${p.doubloons}|${f.selectedShip}|${this.selectedSea}|${p.unlockedShips.join()}|${p.unlockedSeas.join()}|${p.bestBounty[f.selectedShip] ?? 0}|${p.bestTime[f.selectedShip] ?? 0}|${p.runs}|${p.history?.length ?? 0}`;
    for (const id of META_UPGRADE_IDS) sig += `|${p.upgrades[id] ?? 0}`;
    if (sig === this.sig) return;
    const first = this.sig === '';
    this.sig = sig;
    this.profile = p;
    if (!p.unlockedSeas.includes(this.selectedSea)) this.selectedSea = 'sunward-shallows';
    if (this.shownDoubloons < 0) { this.shownDoubloons = p.doubloons; this.balance.set(fmtInt(p.doubloons)); }
    else if (p.doubloons !== this.targetDoubloons) play(this.balanceEl, [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.2,1.6,.4,1)' });
    this.targetDoubloons = p.doubloons;

    for (const id of SHIP_IDS) {
      const ship = CONTENT.ships[id];
      const card = this.shipCards.get(id)!;
      const unlocked = p.unlockedShips.includes(id);
      const selected = id === f.selectedShip;
      card.el.classList.toggle('is-locked', !unlocked);
      card.el.classList.toggle('is-selected', selected);
      card.el.setAttribute('aria-pressed', String(selected));
      const canBuy = !unlocked && ship.unlock.kind === 'doubloons' && p.doubloons >= ship.unlock.cost;
      card.el.classList.toggle('is-affordable', canBuy);
      if (unlocked) { card.status.set(ship.epithet); card.cost.textContent = ''; }
      else if (ship.unlock.kind === 'doubloons') { card.status.set('Locked'); card.cost.replaceChildren(icon(iconPath('doubloon'), 'coin', 'cr-shipcard__coin'), fmtInt(ship.unlock.cost)); }
      else if (ship.unlock.kind === 'achievement') { card.status.set(ship.unlock.text); card.cost.textContent = ''; }
    }
    this.syncDetails(CONTENT.ships[f.selectedShip], p);

    for (const id of SEA_IDS) {
      const sea = CONTENT.seas[id];
      const card = this.seaCards.get(id)!;
      const unlocked = p.unlockedSeas.includes(id);
      card.el.classList.toggle('is-locked', !unlocked);
      card.el.classList.toggle('is-selected', id === this.selectedSea);
      card.el.setAttribute('aria-disabled', String(!unlocked));
      card.lock.set(sea.unlock.kind === 'achievement' ? sea.unlock.text : '');
    }

    for (const id of META_UPGRADE_IDS) {
      const def = CONTENT.metaUpgrades[id];
      const tile = this.tiles.get(id)!;
      const rank = p.upgrades[id] ?? 0;
      const cost = upgradeCost(p, id);
      tile.pips.forEach((pip, i) => pip.classList.toggle('is-on', i < rank));
      tile.rank.set(`${rank}/${def.maxRank}`);
      const maxed = cost === null;
      tile.el.classList.toggle('is-maxed', maxed);
      const afford = !maxed && p.doubloons >= cost;
      tile.el.classList.toggle('is-affordable', afford);
      tile.buy.setAttribute('aria-disabled', String(!afford));
      tile.cost.set(maxed ? 'Maxed' : fmtInt(cost));
      if (!first && tile.lastRank >= 0 && rank > tile.lastRank) {
        play(tile.el, [{ transform: 'scale(1.04)', filter: 'brightness(1.6)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 520, easing: 'cubic-bezier(.2,1.4,.4,1)' });
        const pip = tile.pips[rank - 1];
        if (pip) play(pip, [{ transform: 'scale(2.2) rotate(45deg)' }, { transform: 'scale(1) rotate(45deg)' }], { duration: 480, easing: 'cubic-bezier(.2,1.6,.4,1)' });
      }
      tile.lastRank = rank;
    }

    // Next goals (REPLAY): the poster shrinks to make room while there are any.
    const hasGoals = this.goals.set(goalsFor(p));
    this.side.classList.toggle('has-goals', hasGoals);

    // Poster + voyage summary.
    const ship = CONTENT.ships[f.selectedShip];
    const sea = CONTENT.seas[this.selectedSea];
    const best = p.bestBounty[f.selectedShip] ?? 0;
    const bestTime = p.bestTime[f.selectedShip] ?? 0;
    this.poster.setShip(ship);
    if (best > 0) this.poster.setBounty('Best bounty', fmtInt(best), `Longest voyage ${fmtClock(bestTime)}`);
    else this.poster.setBounty('Bounty', '—', 'No record yet. Make a name for yourself.');
    this.poster.el.classList.toggle('is-empty', best <= 0);
    this.voyageShip.set(ship.name);
    this.voyageSea.set(sea.name);
    const diff = Math.max(0, Math.min(2, Math.round((sea.difficulty - 1) / 0.35)));
    this.voyageDiff.replaceChildren(...[0, 1, 2].map((i) => glyph('skull', i <= diff ? 'is-on' : '')), h('span', '', SEA_DIFF_LABEL[diff]!));
    const locked = !p.unlockedShips.includes(f.selectedShip);
    this.setSail.classList.toggle('is-locked', locked);
    this.setSail.setAttribute('aria-disabled', String(locked));
    this.setSailLabel.set(locked ? 'Ship locked' : 'Set Sail');
  }

  private syncDetails(ship: ShipDef, p: Readonly<MetaProfile>): void {
    this.dName.set(ship.name);
    this.dEpithet.set(ship.epithet);
    this.dDesc.set(ship.description);
    this.details.style.setProperty('--accent', hex(ship.accent));
    SHIP_STATS.forEach((stat, i) => {
      const row = this.dStats[i]!;
      row.fill.style.transform = `scaleX(${statFill(i, ship).toFixed(3)})`;
      row.value.set(stat.fmt(stat.get(ship)));
    });
    const sp = SPECIALS[ship.special];
    const ul = ULTIMATES[ship.ultimate];
    this.dSpecialName.set(sp.name);
    this.dSpecialText.set(sp.text);
    this.dUltName.set(ul.name);
    this.dUltText.set(ul.text);
    setIcon(this.dSpecialIcon, iconPath(ship.special), sp.glyph);
    setIcon(this.dUltIcon, iconPath(ship.ultimate), ul.glyph);
    const unlocked = p.unlockedShips.includes(ship.id);
    this.dLock.hidden = unlocked;
    this.details.classList.toggle('is-locked', !unlocked);
    if (!unlocked) {
      if (ship.unlock.kind === 'doubloons') {
        const afford = p.doubloons >= ship.unlock.cost;
        this.dLockText.set(afford ? 'Ready to commission' : `Need ${fmtInt(ship.unlock.cost - p.doubloons)} more`);
        this.dUnlock.hidden = false;
        this.dUnlock.setAttribute('aria-disabled', String(!afford));
        this.dUnlock.classList.toggle('is-affordable', afford);
        this.dUnlockCost.set(fmtInt(ship.unlock.cost));
      } else {
        this.dLockText.set(ship.unlock.kind === 'achievement' ? ship.unlock.text : 'Locked');
        this.dUnlock.hidden = true;
      }
    }
  }

  // ── Actions ──

  private preview(id: ShipId): void {
    if (!this.visible || id === this.selectedShip) return;
    this.selectedShip = id;
    this.deps.cb.onSelectShip(id);
  }

  private activateShip(id: ShipId): void {
    this.preview(id);
    const unlocked = this.profile?.unlockedShips.includes(id) ?? false;
    if (unlocked) focusEl(this.setSail);
    else if (!this.dUnlock.hidden) focusEl(this.dUnlock);
  }

  private tryUnlock(): void {
    const p = this.profile;
    const ship = CONTENT.ships[this.selectedShip];
    if (!p || ship.unlock.kind !== 'doubloons') return;
    if (p.doubloons < ship.unlock.cost) { this.nope(this.dUnlock); return; }
    this.deps.cb.onUnlockShip(ship.id);
    play(this.shipCards.get(ship.id)!.el, [{ transform: 'scale(1.12) rotate(-2deg)', filter: 'brightness(1.8)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 650, easing: 'cubic-bezier(.2,1.5,.4,1)' });
    focusEl(this.setSail);
  }

  private activateSea(id: SeaId): void {
    if (!this.profile?.unlockedSeas.includes(id)) { this.nope(this.seaCards.get(id)!.el); return; }
    this.selectedSea = id;
    this.sig = '';
    focusEl(this.setSail);
  }

  private tryBuy(id: MetaUpgradeId): void {
    const p = this.profile;
    if (!p) return;
    const cost = upgradeCost(p, id);
    const tile = this.tiles.get(id)!;
    if (cost === null || p.doubloons < cost) { this.nope(tile.buy); return; }
    this.deps.cb.onPurchaseUpgrade(id);
  }

  private sail(): void {
    const p = this.profile;
    if (!p || !p.unlockedShips.includes(this.selectedShip)) { this.nope(this.setSail); this.setTab('fleet', true); return; }
    if (!p.unlockedSeas.includes(this.selectedSea)) { this.nope(this.setSail); this.setTab('seas', true); return; }
    play(this.setSail, [{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 300 });
    this.deps.cb.onStartRun(this.selectedShip, this.selectedSea);
  }

  private nope(el: HTMLElement): void {
    play(el, [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 320 });
  }

  setTab(tab: Tab, focus: boolean): void {
    if (!this.panes.has(tab)) tab = 'fleet';
    this.tab = tab;
    for (const [id, b] of this.tabButtons) { b.classList.toggle('is-active', id === tab); b.setAttribute('aria-selected', String(id === tab)); }
    for (const [id, pane] of this.panes) {
      const on = id === tab;
      if (pane.hidden === !on) continue;
      pane.hidden = !on;
      if (on) play(pane, [{ opacity: 0, transform: 'translateX(-18px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    requestAnimationFrame(() => { for (const s of this.scrollers) if (!s.el.closest('[hidden]')) s.refresh(); });
    if (focus) this.focusTab();
  }

  private focusTab(): void {
    const pane = this.panes.get(this.tab)!;
    if (this.tab === 'fleet') focusEl(this.shipCards.get(this.selectedShip)?.el);
    else if (this.tab === 'seas') focusEl(this.seaCards.get(this.selectedSea)?.el);
    else if (!focusDefault(pane)) focusEl(this.tabButtons.get(this.tab));
    this.reveal(document.activeElement);
  }

  private cycleTab(delta: number): void {
    const order = this.tabOrder;
    const i = Math.max(0, order.indexOf(this.tab));
    this.setTab(order[(i + delta + order.length) % order.length]!, true);
  }

  onKey(e: KeyboardEvent): boolean {
    const ext = this.extPanes.get(this.tab);
    if (ext?.onKey) { try { if (ext.onKey(e)) return true; } catch (err) { console.error(`harbor pane ${ext.id} key handler failed`, err); } }
    if (e.code === 'KeyQ' || e.code === 'PageUp' || e.code === 'BracketLeft') { this.cycleTab(-1); return true; }
    if (e.code === 'KeyE' || e.code === 'PageDown' || e.code === 'BracketRight') { this.cycleTab(1); return true; }
    if (e.code === 'KeyF') { this.sail(); return true; }
    if (e.code === 'Escape') { this.deps.openSettings(); return true; }
    const dir = keyDir(e.code);
    if (dir) { this.move(dir); return true; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const active = document.activeElement;
      if (!active || active === document.body || !this.el.contains(active)) { this.sail(); return true; }
    }
    return false;
  }

  private move(dir: Parameters<typeof moveFocus>[1]): void {
    if (!moveFocus(this.el, dir)) this.focusTab();
    this.reveal(document.activeElement);
  }

  onPad(intent: PadIntent): boolean {
    switch (intent) {
      case 'prev': this.cycleTab(-1); return true;
      case 'next': this.cycleTab(1); return true;
      case 'start': this.sail(); return true;
      case 'alt2': this.deps.openSettings(); return true;
      case 'confirm': { const a = document.activeElement as HTMLElement | null; if (a && this.el.contains(a)) a.click(); else this.sail(); return true; }
      case 'up': case 'down': case 'left': case 'right': this.move(intent); return true;
      default: return false;
    }
  }
}
