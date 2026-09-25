/**
 * Bottom-centre skill bar: Full Broadside, special, ultimate (charge ring), cooldown sweeps, READY pulses. Keycaps
 * follow the player's bindings; Full Broadside shows AUTO while its toggle mode is latched on.
 */
import type { PlayerState, ShipDef } from '../../game/types';
import { controls, type BindAction } from '../../input/Input';
import { ClassCell, h, play, TextCell, VarCell } from '../core/dom';
import { icon, setIcon, type GlyphId } from '../core/icons';
import { iconPath, SPECIALS, ULTIMATES } from '../core/names';
import { keycap, padButton, type PadButton } from '../core/prompts';

class SkillSlotView {
  readonly el: HTMLElement;
  readonly icon: HTMLElement;
  private readonly cd: VarCell;
  private readonly charge: VarCell;
  private readonly secs: TextCell;
  private readonly name: TextCell;
  private readonly ready: ClassCell;
  private readonly active: ClassCell;
  private readonly charging: ClassCell;
  private lastSec = -1;
  private lastPct = -1;
  private readonly keyRow: HTMLElement;
  private keyVersion = -1;
  readonly auto: ClassCell;

  constructor(cls: string, private readonly action: BindAction, private readonly pad: PadButton, g: GlyphId, src: string, label: string) {
    const secs = h('span', 'cr-skill__secs');
    const name = h('span', 'cr-skill__name', label);
    this.icon = icon(src, g, 'cr-skill__icon');
    this.keyRow = h('span', 'cr-skill__keys');
    this.el = h('div', `cr-skill ${cls}`,
      h('span', 'cr-skill__disc', h('span', 'cr-skill__charge'), this.icon, h('span', 'cr-skill__sweep'), secs, h('span', 'cr-skill__ready', 'Ready'), h('span', 'cr-skill__auto', 'Auto')),
      this.keyRow,
      name,
    );
    this.auto = new ClassCell(this.el, 'is-auto');
    this.syncKeys();
    this.cd = new VarCell(this.el, '--cd', 1 / 120);
    this.charge = new VarCell(this.el, '--charge', 1 / 200);
    this.secs = new TextCell(secs);
    this.name = new TextCell(name);
    this.ready = new ClassCell(this.el, 'is-ready');
    this.active = new ClassCell(this.el, 'is-active');
    this.charging = new ClassCell(this.el, 'is-charging');
  }

  setName(name: string): void { this.name.set(name); }

  /** The player's key for this slot (primary binding) and the pad button. */
  syncKeys(): void {
    if (this.keyVersion === controls.version) return;
    this.keyVersion = controls.version;
    this.keyRow.replaceChildren(keycap(controls.labels(this.action)[0] ?? '—'), padButton(this.pad));
  }

  cooldown(cooldown: number, max: number, active: number): void {
    const frac = max > 0 ? Math.max(0, Math.min(1, cooldown / max)) : 0;
    this.cd.set(frac);
    this.ready.set(cooldown <= 0 && active <= 0);
    this.active.set(active > 0);
    const s = cooldown > 0 ? Math.ceil(cooldown) : 0;
    if (s !== this.lastSec) { this.lastSec = s; this.secs.set(s > 0 ? String(s) : ''); }
  }

  ultimate(charge: number, active: number): void {
    const c = Math.max(0, Math.min(1, charge));
    this.charge.set(c);
    this.ready.set(c >= 1 && active <= 0);
    this.active.set(active > 0);
    this.charging.set(c < 1);
    const pct = c >= 1 ? 100 : Math.floor(c * 100);
    if (pct !== this.lastPct) { this.lastPct = pct; this.secs.set(c >= 1 || active > 0 ? '' : `${pct}%`); }
  }

  pulse(big = false): void {
    play(this.el.firstElementChild!, [
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: `scale(${big ? 1.4 : 1.25})`, filter: 'brightness(2.2)', offset: 0.3 },
      { transform: 'scale(1)', filter: 'brightness(1)' },
    ], { duration: big ? 700 : 480, easing: 'cubic-bezier(.2,1.2,.3,1)' });
  }

  press(): void {
    play(this.el.firstElementChild!, [{ transform: 'scale(.86)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
  }
}

export class SkillBar {
  readonly el: HTMLElement;
  private readonly q = new SkillSlotView('is-q', 'broadside', 'RT', 'cannon', iconPath('broadside'), 'Broadside');
  private readonly e = new SkillSlotView('is-e', 'special', 'LB', 'burst', '', 'Special');
  private readonly r = new SkillSlotView('is-r', 'ultimate', 'RB', 'sun', '', 'Ultimate');
  private shipId = '';
  private ultReady = true;
  /** Set when the ultimate becomes charged this frame (the sim has no event for it). */
  ultJustReady = false;

  constructor() {
    this.el = h('div', 'cr-skills', this.q.el, this.e.el, this.r.el);
  }

  reset(): void { this.shipId = ''; this.ultReady = true; }

  update(p: Readonly<PlayerState>, ship: ShipDef): void {
    if (ship.id !== this.shipId) {
      this.shipId = ship.id;
      const sp = SPECIALS[ship.special], ul = ULTIMATES[ship.ultimate];
      this.e.setName(sp.name);
      this.r.setName(ul.name);
      setIcon(this.e.icon, iconPath(ship.special), sp.glyph);
      setIcon(this.r.icon, iconPath(ship.ultimate), ul.glyph);
    }
    const s = p.skills;
    this.q.syncKeys(); this.e.syncKeys(); this.r.syncKeys();
    this.q.auto.set(controls.latched.broadside);
    this.q.cooldown(s.broadside.cooldown, s.broadside.cooldownMax, s.broadside.active);
    this.e.cooldown(s.special.cooldown, s.special.cooldownMax, s.special.active);
    this.r.ultimate(s.ultimate.charge, s.ultimate.active);
    const ready = s.ultimate.charge >= 1;
    this.ultJustReady = ready && !this.ultReady;
    if (this.ultJustReady) this.r.pulse(true);
    this.ultReady = ready;
  }

  ready(slot: 'broadside' | 'special' | 'ultimate'): void {
    (slot === 'broadside' ? this.q : slot === 'special' ? this.e : this.r).pulse(slot === 'ultimate');
  }

  used(slot: 'broadside' | 'special' | 'ultimate'): void {
    (slot === 'broadside' ? this.q : slot === 'special' ? this.e : this.r).press();
  }
}
