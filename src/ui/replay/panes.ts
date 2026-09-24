/**
 * REPLAY harbor panes: Voyage (heat per sea, the daily voyage, starting boons), Quests (next goals and the quest
 * board) and Logbook (captain title, lifetime stats, the last 20 voyages). DOM-only; each pane rebuilds its lists only
 * when the profile (or its own choices) change, and FLOW mounts them as harbor tabs through registerHarborPane().
 */
import { CONTENT } from '../../game/content';
import { HEAT, heatRules } from '../../game/content/director';
import { SEA_IDS, WEAPON_IDS, type SeaId } from '../../game/ids';
import { dailyBest, dailyKey, dailyStreak, dailyVoyage } from '../../game/meta/daily';
import { nextGoals } from '../../game/meta/goals';
import { lifetimeStats } from '../../game/meta/history';
import {
  BOONS, PENNANTS, QUESTS, boonCount, captainTitle, earnedBoons, earnedPennants, earnedTitles, isDone, questState, rewardText,
} from '../../game/meta/quests';
import {
  DEFAULT_BOON_WEAPON, chosenBoonWeapon, chosenHeat, chosenTitle, heatUnlocked, maxHeat, requestDaily, setChosenBoonWeapon,
  setChosenHeat, setChosenTitle,
} from '../../game/meta/voyage';
import type { MetaProfile } from '../../game/types';
import type { UiCallbacks, UiFrame } from '../contracts';
import { h, navButton } from '../core/dom';
import { fmtClock, fmtInt } from '../core/format';
import { glyph } from '../core/icons';
import type { HarborPane } from '../screens/harborPanes';

const OUTCOME_LABEL = { victory: 'Victory', defeat: 'Sunk', retired: 'Retired' } as const;

/** Shared bookkeeping: a pane rebuilds when its signature changes (profile totals + its own choices). */
abstract class ReplayPane implements HarborPane {
  abstract readonly id: string;
  abstract readonly label: string;
  readonly el: HTMLElement;
  protected cb: UiCallbacks | null = null;
  protected profile: Readonly<MetaProfile> | null = null;
  private sig = '';
  /** Bumped by the pane's own buttons (choices live in the voyage store, not the profile). */
  protected version = 0;

  constructor(cls: string) {
    this.el = h('div', `cr-pane rp-pane ${cls}`);
  }

  mount(cb: UiCallbacks): void { this.cb = cb; }

  update(f: UiFrame): void {
    const p = f.profile;
    const sig = `${this.version}|${dailyKey()}|${p.runs}|${p.wins}|${p.doubloons}|${p.totalKills}|${p.history?.length ?? 0}|${p.history?.[0]?.at ?? 0}|`
      + `${SEA_IDS.map((s) => p.heat?.[s] ?? 0).join(',')}|${Object.keys(p.daily ?? {}).length}|${QUESTS.filter((q) => isDone(p, q.id)).length}|${p.unlockedShips.length}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.profile = p;
    this.render(p);
  }

  /** Re-renders after one of the pane's own choices (heat, boon weapon, title) changed. */
  protected changed(): void { this.version++; this.sig = ''; if (this.profile) this.render(this.profile); }

  protected abstract render(p: Readonly<MetaProfile>): void;
}

// ───────────────────────── Voyage ─────────────────────────

export class VoyagePane extends ReplayPane {
  readonly id = 'voyage';
  readonly label = 'Voyage';
  constructor() { super('rp-voyage'); }

  protected render(p: Readonly<MetaProfile>): void {
    this.el.replaceChildren(this.heatSection(p), this.dailySection(p), this.boonSection(p));
  }

  private heatSection(p: Readonly<MetaProfile>): HTMLElement {
    const open = heatUnlocked(p);
    const note = open
      ? `Every level: enemy hulls +${Math.round(HEAT.hpPerLevel * 100)}%, fire +${Math.round(HEAT.damagePerLevel * 100)}%, rewards +${Math.round(HEAT.reward * 100)}%, plus its rule.`
      : 'Win a voyage to open the heat ladder.';
    const box = h('section', 'rp-card rp-heat',
      h('header', 'rp-card__head', glyph('flame', 'rp-card__icon'), h('span', 'rp-card__title', 'Heat'), h('span', 'rp-card__note', note)),
    );
    for (const sea of SEA_IDS) {
      if (!p.unlockedSeas.includes(sea)) continue;
      const max = maxHeat(p, sea);
      const chosen = chosenHeat(p, sea);
      const cleared = p.heat?.[sea] ?? 0;
      const ladder = h('div', 'rp-ladder');
      for (let lv = 0; lv <= HEAT.max; lv++) {
        const locked = lv > max;
        const b = navButton(`rp-rung${lv === chosen ? ' is-on' : ''}${locked ? ' is-locked' : ''}${lv > 0 && lv <= cleared ? ' is-cleared' : ''}`, lv === 0 ? '—' : String(lv));
        b.title = lv === 0 ? 'No heat' : locked ? `Win heat ${lv - 1} here to open heat ${lv}` : `Heat ${lv}`;
        b.setAttribute('aria-disabled', String(locked));
        b.dataset.sea = sea;
        b.dataset.heat = String(lv);
        if (!locked) b.addEventListener('click', () => { setChosenHeat(sea, lv); this.changed(); });
        ladder.append(b);
      }
      const rules = heatRules(chosen);
      const ruleList = h('div', 'rp-rules');
      if (chosen === 0) ruleList.append(h('span', 'rp-rule is-none', open ? 'No heat: the sea as it comes.' : 'The heat ladder is closed.'));
      for (const r of rules) ruleList.append(h('span', 'rp-rule', h('b', '', `${r.level} · ${r.name}`), ` ${r.text}`));
      box.append(h('div', `rp-sea is-${sea}`,
        h('div', 'rp-sea__top',
          h('span', 'rp-sea__name', CONTENT.seas[sea].name),
          h('span', 'rp-sea__mul', chosen > 0 ? `×${(1 + HEAT.reward * chosen).toFixed(2)} ◈ & bounty` : ''),
          h('span', 'rp-sea__best', cleared > 0 ? `Cleared: heat ${cleared}` : ''),
        ),
        ladder,
        ruleList,
      ));
    }
    return box;
  }

  private dailySection(p: Readonly<MetaProfile>): HTMLElement {
    const key = dailyKey();
    const d = dailyVoyage(key);
    const ship = CONTENT.ships[d.shipId];
    const sea = CONTENT.seas[d.seaId];
    const lent = !p.unlockedShips.includes(d.shipId);
    const best = dailyBest(p, key);
    const streak = dailyStreak(p, key);
    const sail = navButton('rp-sail', glyph('compass'), h('span', '', best > 0 ? 'Sail it again' : 'Sail the daily voyage'));
    sail.dataset.action = 'daily';
    sail.addEventListener('click', () => { requestDaily(key, d.shipId, d.seaId); this.cb?.onStartRun(d.shipId, d.seaId); });
    return h('section', 'rp-card rp-daily',
      h('header', 'rp-card__head', glyph('sun', 'rp-card__icon'), h('span', 'rp-card__title', 'Daily voyage'), h('span', 'rp-card__note', `${key} · new voyage at 00:00 UTC`)),
      h('div', 'rp-daily__line',
        h('span', 'rp-daily__ship', ship.name, lent ? h('i', 'rp-tag', 'lent for the day') : null),
        h('span', 'rp-daily__sep', '·'),
        h('span', 'rp-daily__sea', sea.name),
      ),
      h('div', 'rp-rules', ...d.rules.map((r) => h('span', 'rp-rule', h('b', '', r.name), ` ${r.text}`))),
      h('div', 'rp-daily__foot',
        h('span', 'rp-stat', h('small', '', 'Best today'), h('b', '', best > 0 ? fmtInt(best) : '—')),
        h('span', 'rp-stat', h('small', '', 'Streak'), h('b', '', streak > 0 ? `${streak} day${streak === 1 ? '' : 's'}` : '—')),
        sail,
      ),
      h('p', 'rp-fine', 'Heat and starting boons stay ashore; harbor refits sail. Same seed, ship, sea and rules for every captain today.'),
    );
  }

  private boonSection(p: Readonly<MetaProfile>): HTMLElement {
    const boons = earnedBoons(p);
    const box = h('section', 'rp-card rp-boons', h('header', 'rp-card__head', glyph('anchor', 'rp-card__icon'), h('span', 'rp-card__title', 'Starting boons'), h('span', 'rp-card__note', 'Earned with quests; every ordinary voyage')));
    if (boons.length === 0) { box.append(h('p', 'rp-fine', 'None yet. Quests such as Old Salt, Set-Piece Master and Full Broadside grant them.')); return box; }
    for (const id of boons) {
      const n = boonCount(p, id);
      const row = h('div', 'rp-boon', h('b', '', `${BOONS[id].name}${n > 1 ? ` ×${n}` : ''}`), h('span', '', BOONS[id].text));
      if (id === 'armourer') {
        const current = chosenBoonWeapon() ?? DEFAULT_BOON_WEAPON;
        const pick = navButton('rp-pick', glyph('cannon'), h('span', '', CONTENT.weapons[current].name), glyph('wheel'));
        pick.title = 'Choose the weapon';
        pick.addEventListener('click', () => {
          const i = WEAPON_IDS.indexOf(current);
          let next = WEAPON_IDS[(i + 1) % WEAPON_IDS.length]!;
          if (next === 'broadside') next = WEAPON_IDS[(i + 2) % WEAPON_IDS.length]!;
          setChosenBoonWeapon(next);
          this.changed();
        });
        row.append(pick);
      }
      box.append(row);
    }
    return box;
  }

  onKey(e: KeyboardEvent): boolean {
    // [ and ] step the heat of the sea sailed last.
    if (!this.profile || (e.key !== '[' && e.key !== ']')) return false;
    const sea: SeaId = this.profile.lastSea;
    const cur = chosenHeat(this.profile, sea);
    const next = Math.max(0, Math.min(maxHeat(this.profile, sea), cur + (e.key === ']' ? 1 : -1)));
    if (next === cur) return true;
    setChosenHeat(sea, next);
    this.changed();
    return true;
  }
}

// ───────────────────────── Quests ─────────────────────────

export class QuestsPane extends ReplayPane {
  readonly id = 'quests';
  readonly label = 'Quests';
  constructor() { super('rp-quests'); }

  protected render(p: Readonly<MetaProfile>): void {
    const goals = h('section', 'rp-card rp-goals', h('header', 'rp-card__head', glyph('compass', 'rp-card__icon'), h('span', 'rp-card__title', 'Next goals')));
    for (const g of nextGoals(p)) {
      goals.append(h('div', 'rp-goal',
        h('div', 'rp-goal__top', h('b', '', g.title), g.reward ? h('span', 'rp-goal__reward', g.reward) : null),
        h('span', 'rp-goal__detail', g.detail),
        bar(g.progress),
      ));
    }
    const done = QUESTS.filter((q) => isDone(p, q.id));
    const open = QUESTS.filter((q) => !isDone(p, q.id))
      .map((q) => ({ q, st: questState(p, q.id) }))
      .sort((a, b) => b.st.progress / b.q.goal - a.st.progress / a.q.goal);
    const list = h('section', 'rp-card rp-board',
      h('header', 'rp-card__head', glyph('map', 'rp-card__icon'), h('span', 'rp-card__title', 'Quest board'), h('span', 'rp-card__note', `${done.length} of ${QUESTS.length} complete`)),
    );
    for (const { q, st } of open) {
      const ready = st.progress >= q.goal;
      list.append(h('div', `rp-quest${ready ? ' is-ready' : ''}`,
        h('div', 'rp-quest__top', h('b', '', q.name), h('span', 'rp-quest__kind', q.kind === 'voyage' ? 'One voyage' : 'Ledger')),
        h('span', 'rp-quest__text', q.text),
        h('div', 'rp-quest__foot', bar(q.goal > 0 ? st.progress / q.goal : 0), h('span', 'rp-quest__count', ready ? 'banked after your next voyage' : progressText(q.goal, st.progress))),
        h('span', 'rp-quest__reward', rewardText(q.reward)),
      ));
    }
    for (const q of done) {
      list.append(h('div', 'rp-quest is-done',
        h('div', 'rp-quest__top', h('b', '', q.name), glyph('star', 'rp-quest__check')),
        h('span', 'rp-quest__text', q.text),
        h('span', 'rp-quest__reward', rewardText(q.reward)),
      ));
    }
    this.el.replaceChildren(goals, list);
  }
}

// ───────────────────────── Logbook ─────────────────────────

export class LogbookPane extends ReplayPane {
  readonly id = 'logbook';
  readonly label = 'Logbook';
  constructor() { super('rp-logbook'); }

  protected render(p: Readonly<MetaProfile>): void {
    const life = lifetimeStats(p);
    const titles = earnedTitles(p);
    const title = captainTitle(p, chosenTitle());
    const pennants = earnedPennants(p);
    const flag = h('span', 'rp-pennant');
    flag.style.setProperty('--pennant', PENNANTS[pennants[pennants.length - 1] ?? 'crimson'].color);
    flag.classList.toggle('is-plain', pennants.length === 0);
    const cycle = navButton('rp-pick', h('span', '', titles.length > 1 ? 'Change title' : 'Earn titles with quests'), glyph('wheel'));
    cycle.addEventListener('click', () => {
      if (titles.length < 2) return;
      setChosenTitle(titles[(titles.indexOf(title) + 1) % titles.length]);
      this.changed();
    });
    const head = h('section', 'rp-card rp-captain',
      flag,
      h('div', 'rp-captain__body', h('small', '', 'Captain'), h('span', 'rp-captain__title', title), h('span', 'rp-fine', `${titles.length} title${titles.length === 1 ? '' : 's'} earned · ${pennants.length} pennant${pennants.length === 1 ? '' : 's'}`)),
      cycle,
    );
    const pennantRow = h('div', 'rp-pennants');
    for (const id of pennants) { const sw = h('i', 'rp-swatch'); sw.style.background = PENNANTS[id].color; sw.title = PENNANTS[id].name; pennantRow.append(sw); }
    if (pennants.length) head.querySelector('.rp-captain__body')!.append(pennantRow);

    const stat = (label: string, value: string) => h('span', 'rp-stat', h('small', '', label), h('b', '', value));
    const stats = h('section', 'rp-card rp-life',
      h('header', 'rp-card__head', glyph('book', 'rp-card__icon'), h('span', 'rp-card__title', 'Lifetime')),
      h('div', 'rp-life__grid',
        stat('Voyages', fmtInt(life.voyages)),
        stat('Victories', `${fmtInt(life.wins)}${life.voyages ? ` (${Math.round(life.winRate * 100)}%)` : ''}`),
        stat('Ships sunk', fmtInt(life.kills)),
        stat('Best bounty', life.bestBounty > 0 ? fmtInt(life.bestBounty) : '—'),
        stat('Longest voyage', life.longestVoyage > 0 ? fmtClock(life.longestVoyage) : '—'),
        stat('Favourite ship', life.favouriteShip ? CONTENT.ships[life.favouriteShip].name : '—'),
        ...SEA_IDS.map((s) => stat(`${CONTENT.seas[s].name.replace(/^The /, '')} heat`, life.heat[s] > 0 ? String(life.heat[s]) : '—')),
        stat('Daily streak', `${dailyStreak(p)}`),
      ),
    );
    const table = h('div', 'rp-log');
    table.append(h('div', 'rp-log__row is-head', h('span', '', 'Voyage'), h('span', '', 'Sea'), h('span', '', 'Heat'), h('span', '', 'Result'), h('span', '', 'Time'), h('span', '', 'Lv'), h('span', '', 'Sunk'), h('span', '', 'Bounty'), h('span', '', '◈')));
    const history = p.history ?? [];
    for (const r of history) {
      const when = r.at > 0 ? new Date(r.at) : null;
      table.append(h('div', `rp-log__row is-${r.outcome}`,
        h('span', 'rp-log__ship', h('b', '', CONTENT.ships[r.shipId].name), h('small', '', when ? `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : '')),
        h('span', '', CONTENT.seas[r.seaId].name.replace(/^The /, '').replace(/ (Shallows|Reach)$/, '')),
        h('span', '', r.daily ? 'daily' : r.heat > 0 ? String(r.heat) : '—'),
        h('span', 'rp-log__outcome', OUTCOME_LABEL[r.outcome]),
        h('span', '', fmtClock(r.time)),
        h('span', '', String(r.level)),
        h('span', '', fmtInt(r.kills)),
        h('span', '', fmtInt(r.bounty)),
        h('span', '', fmtInt(r.doubloons)),
      ));
    }
    if (history.length === 0) table.append(h('p', 'rp-fine', 'No voyages logged yet. Every voyage you finish is written here (the last 20).'));
    const log = h('section', 'rp-card rp-history', h('header', 'rp-card__head', glyph('anchor', 'rp-card__icon'), h('span', 'rp-card__title', 'Last voyages'), h('span', 'rp-card__note', `${history.length} of 20`)), table);
    this.el.replaceChildren(head, stats, log);
  }
}

function bar(progress: number): HTMLElement {
  const fill = h('i', 'rp-bar__fill');
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  return h('span', 'rp-bar', fill);
}

function progressText(goal: number, progress: number): string {
  if (goal >= 60 && goal % 60 === 0 && goal <= 3600) return `${fmtClock(progress)} / ${fmtClock(goal)}`;
  return `${fmtInt(progress)} / ${fmtInt(goal)}`;
}
