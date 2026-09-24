/** Weapon (6) and passive (6) slots with icons, level pips, branch letter and Overdrive ★. */
import { CONTENT } from '../../game/content';
import { MAX_PASSIVE_SLOTS, MAX_WEAPON_LEVEL, MAX_WEAPON_SLOTS } from '../../game/constants';
import type { PassiveId, WeaponId } from '../../game/ids';
import type { PlayerState } from '../../game/types';
import { h, play } from '../core/dom';
import { icon, setIcon } from '../core/icons';
import { iconPath, PASSIVE_GLYPH, WEAPON_GLYPH } from '../core/names';

interface Slot {
  el: HTMLElement;
  icon: HTMLElement;
  pips: HTMLElement[];
  pipBox: HTMLElement;
  badge: HTMLElement;
  id: string;
  level: number;
  branch: string;
  od: boolean;
}

function makeSlot(cls: string, pips: number): Slot {
  const ico = icon(null, 'star', 'cr-slot__icon');
  const pipBox = h('span', 'cr-slot__pips');
  const pipEls: HTMLElement[] = [];
  for (let i = 0; i < pips; i++) { const p = h('i', ''); pipBox.append(p); pipEls.push(p); }
  const badge = h('span', 'cr-slot__badge');
  const el = h('div', `cr-slot ${cls} is-empty`, h('span', 'cr-slot__frame'), ico, badge, pipBox);
  return { el, icon: ico, pips: pipEls, pipBox, badge, id: '', level: -1, branch: '', od: false };
}

export class Loadout {
  readonly el: HTMLElement;
  private readonly weapons: Slot[] = [];
  private readonly passives: Slot[] = [];

  constructor() {
    const wRow = h('div', 'cr-loadout__row is-weapons');
    const pRow = h('div', 'cr-loadout__row is-passives');
    for (let i = 0; i < MAX_WEAPON_SLOTS; i++) { const s = makeSlot('is-weapon', MAX_WEAPON_LEVEL); this.weapons.push(s); wRow.append(s.el); }
    for (let i = 0; i < MAX_PASSIVE_SLOTS; i++) { const s = makeSlot('is-passive', 5); this.passives.push(s); pRow.append(s.el); }
    this.el = h('div', 'cr-loadout', wRow, pRow);
  }

  reset(): void {
    for (const s of [...this.weapons, ...this.passives]) { s.id = ''; s.level = -1; s.branch = ''; s.od = false; s.el.classList.add('is-empty'); }
  }

  update(p: Readonly<PlayerState>): void {
    for (let i = 0; i < this.weapons.length; i++) {
      const slot = this.weapons[i]!;
      const w = p.weapons[i];
      if (!w) { if (slot.id) { slot.id = ''; slot.el.classList.add('is-empty'); slot.el.classList.remove('is-od'); slot.badge.textContent = ''; } continue; }
      const branch = w.branch ?? '';
      if (w.id === slot.id && w.level === slot.level && branch === slot.branch && w.overdrive === slot.od) continue;
      if (w.id !== slot.id) {
        setIcon(slot.icon, iconPath(w.id), WEAPON_GLYPH[w.id as WeaponId] ?? 'cannon');
        slot.el.classList.remove('is-empty');
        slot.el.title = CONTENT.weapons[w.id]?.name ?? w.id;
      }
      slot.id = w.id; slot.level = w.level; slot.branch = branch; slot.od = w.overdrive;
      slot.pips.forEach((pip, k) => pip.classList.toggle('is-on', k < w.level));
      slot.el.classList.toggle('is-od', w.overdrive);
      slot.badge.textContent = w.overdrive ? '★' : branch;
      slot.badge.classList.toggle('is-star', w.overdrive);
    }
    for (let i = 0; i < this.passives.length; i++) {
      const slot = this.passives[i]!;
      const ps = p.passives[i];
      if (!ps) { if (slot.id) { slot.id = ''; slot.el.classList.add('is-empty'); } continue; }
      if (ps.id === slot.id && ps.rank === slot.level) continue;
      if (ps.id !== slot.id) {
        setIcon(slot.icon, iconPath(ps.id), PASSIVE_GLYPH[ps.id as PassiveId] ?? 'star');
        slot.el.classList.remove('is-empty');
        slot.el.title = CONTENT.passives[ps.id]?.name ?? ps.id;
        const max = CONTENT.passives[ps.id]?.maxRank ?? 5;
        slot.pips.forEach((pip, k) => { pip.hidden = k >= max; });
      }
      slot.id = ps.id; slot.level = ps.rank;
      slot.pips.forEach((pip, k) => pip.classList.toggle('is-on', k < ps.rank));
      slot.el.classList.toggle('is-max', ps.rank >= (CONTENT.passives[ps.id]?.maxRank ?? 5));
    }
  }

  /** Pops the slot that just changed (weapon-changed / passive-changed). */
  pop(id: string): void {
    const slot = [...this.weapons, ...this.passives].find((s) => s.id === id);
    if (!slot) return;
    play(slot.el, [
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: 'scale(1.35) rotate(-6deg)', filter: 'brightness(2.4)', offset: 0.25 },
      { transform: 'scale(1)', filter: 'brightness(1)' },
    ], { duration: 560, easing: 'cubic-bezier(.2,1.3,.3,1)' });
  }
}
