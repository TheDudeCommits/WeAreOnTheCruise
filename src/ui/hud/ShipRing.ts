/**
 * Bottom-left ship ring (T7 adapted): hull gauge with shield overlay, sail gear telegraph, speed, and the
 * Boost / Brace buttons (the player's keys) with cooldown sweeps; status chips ride above it.
 * Round 2 (FLOW): an "In irons" warning while the bow points into the wind under sail, stored boost charges as
 * pips under the Boost button (Trade Winds / Storm Sails give more than one), the live Momentum bonus on its chip,
 * and an AUTO badge on Brace while its toggle mode is latched on.
 */
import type { StatusKind } from '../../game/ids';
import type { RunState, ShipDef } from '../../game/types';
import { boostChargesOf } from '../../game/sim/stats';
import { controls, type BindAction } from '../../input/Input';
import { ClassCell, h, hex, play, svg, TextCell, VarCell } from '../core/dom';
import { knots } from '../core/format';
import { glyph, type GlyphId } from '../core/icons';
import { GEAR_NAMES } from '../core/names';
import { keycap, padButton } from '../core/prompts';
import { inIrons } from './wind';

/** Director scratch key PACE stores the boost charges under (see src/game/sim/player.ts, boostChargesLeft). */
const BOOST_STORED = 'pace:boostCharges';
const MAX_CHARGE_PIPS = 4;

const R = 92;
const C = 2 * Math.PI * R;
const ARC = 0.75 * C;

const STATUS: readonly { kind: StatusKind; label: string; glyph: GlyphId; tone: 'good' | 'bad' }[] = [
  { kind: 'shielded', label: 'Shield', glyph: 'shield', tone: 'good' },
  { kind: 'frenzy', label: 'Frenzy', glyph: 'flame', tone: 'good' },
  { kind: 'momentum', label: 'Momentum', glyph: 'speed', tone: 'good' },
  { kind: 'invulnerable', label: 'Untouchable', glyph: 'star', tone: 'good' },
  { kind: 'airborne', label: 'Airborne', glyph: 'burst', tone: 'good' },
  { kind: 'submerged', label: 'Submerged', glyph: 'dive', tone: 'good' },
  { kind: 'burning', label: 'Burning', glyph: 'flame', tone: 'bad' },
  { kind: 'slowed', label: 'Slowed', glyph: 'anchor', tone: 'bad' },
  { kind: 'stunned', label: 'Stunned', glyph: 'bolt', tone: 'bad' },
  { kind: 'hooked', label: 'Hooked', glyph: 'harpoon', tone: 'bad' },
];

class MiniSkill {
  readonly el: HTMLElement;
  private readonly cd: VarCell;
  private readonly secs: TextCell;
  private readonly ready: ClassCell;
  private readonly active: ClassCell;
  private readonly keyEl: HTMLElement;
  private keyVersion = -1;
  private lastSec = -1;
  /** Charge pips (boost) and the AUTO badge (brace toggle mode). */
  readonly pips: HTMLElement;
  readonly auto: ClassCell;
  constructor(cls: string, g: GlyphId, private readonly action: BindAction, pad: Parameters<typeof padButton>[0], label: string) {
    const secs = h('span', 'cr-mini__secs');
    this.keyEl = h('span', 'cr-mini__kb');
    this.pips = h('span', 'cr-mini__charges');
    this.el = h('div', `cr-mini ${cls}`,
      h('span', 'cr-mini__disc', glyph(g, 'cr-mini__glyph'), h('span', 'cr-mini__sweep'), secs, h('span', 'cr-mini__auto', 'Auto')),
      h('span', 'cr-mini__key', this.keyEl, padButton(pad)),
      this.pips,
      h('span', 'cr-mini__label', label));
    this.cd = new VarCell(this.el, '--cd', 1 / 120);
    this.secs = new TextCell(secs);
    this.ready = new ClassCell(this.el, 'is-ready');
    this.active = new ClassCell(this.el, 'is-active');
    this.auto = new ClassCell(this.el, 'is-auto');
    this.syncKey();
  }
  /** Shows the player's current key for this action (rebinding updates it). */
  syncKey(): void {
    if (this.keyVersion === controls.version) return;
    this.keyVersion = controls.version;
    this.keyEl.replaceChildren(keycap(controls.labels(this.action)[0] ?? '—'));
  }
  update(cooldown: number, max: number, active: number): void {
    const frac = max > 0 ? Math.max(0, Math.min(1, cooldown / max)) : 0;
    this.cd.set(frac);
    this.ready.set(cooldown <= 0);
    this.active.set(active > 0);
    const s = cooldown > 0 ? Math.ceil(cooldown) : 0;
    if (s !== this.lastSec) { this.lastSec = s; this.secs.set(s > 0 ? String(s) : ''); }
  }
  pulse(): void {
    play(this.el.firstElementChild!, [{ transform: 'scale(1.35)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 420, easing: 'cubic-bezier(.2,1.5,.4,1)' });
  }
}

export class ShipRing {
  readonly el: HTMLElement;
  private readonly hull: SVGCircleElement;
  private readonly shield: SVGCircleElement;
  private readonly hullNum: TextCell;
  private readonly hullMax: TextCell;
  private readonly gearName: TextCell;
  private readonly gearBars: HTMLElement[] = [];
  private readonly speed: TextCell;
  private readonly boost: MiniSkill;
  private readonly brace: MiniSkill;
  private readonly statusChips = new Map<StatusKind, { el: HTMLElement; on: ClassCell }>();
  private readonly momentumText: TextCell;
  private lastMomentum = -1;
  private readonly irons: ClassCell;
  private readonly chargePips: HTMLElement[] = [];
  private lastCharges = -1;
  private lastChargeMax = -1;
  private readonly toneLow: ClassCell;
  private readonly toneMid: ClassCell;
  private readonly braced: ClassCell;
  private readonly hasShield: ClassCell;
  private readonly emblem: SVGSVGElement;
  /** Status chips above the ring (the HUD keeps markers off them). */
  readonly statusesEl: HTMLElement;
  private lastHullQ = -1;
  private lastShieldQ = -1;
  private lastHp = -1;
  private lastMax = -1;
  private lastGear = -1;
  private lastSpeed = -1;
  private shipId = '';

  constructor() {
    this.hull = svg('circle', { class: 'cr-ring__hull', cx: 120, cy: 120, r: R, 'stroke-dasharray': `${ARC} ${C}`, transform: 'rotate(135 120 120)' });
    this.shield = svg('circle', { class: 'cr-ring__shield', cx: 120, cy: 120, r: R + 13, 'stroke-dasharray': `0 ${C * 2}`, transform: 'rotate(135 120 120)' });
    const ticks = svg('g', { class: 'cr-ring__ticks' });
    for (let i = 0; i <= 10; i++) {
      const a = ((135 + i * 27) * Math.PI) / 180;
      const r1 = R - 12, r2 = R - (i % 5 === 0 ? 20 : 16);
      ticks.append(svg('line', { x1: 120 + Math.cos(a) * r1, y1: 120 + Math.sin(a) * r1, x2: 120 + Math.cos(a) * r2, y2: 120 + Math.sin(a) * r2 }));
    }
    const ring = svg('svg', { class: 'cr-ring__svg', viewBox: '0 0 240 240', 'aria-hidden': 'true' },
      svg('circle', { class: 'cr-ring__disc', cx: 120, cy: 120, r: R + 22 }),
      svg('circle', { class: 'cr-ring__track', cx: 120, cy: 120, r: R, 'stroke-dasharray': `${ARC} ${C}`, transform: 'rotate(135 120 120)' }),
      this.hull,
      svg('circle', { class: 'cr-ring__shieldtrack', cx: 120, cy: 120, r: R + 13, 'stroke-dasharray': `${ARC} ${C}`, transform: 'rotate(135 120 120)' }),
      this.shield,
      ticks,
    );
    this.emblem = glyph('ship', 'cr-ring__ship');
    const hullNum = h('b', 'cr-ring__hp');
    const hullMax = h('span', 'cr-ring__max');
    const gearName = h('span', 'cr-gear__name');
    const gearBars = h('span', 'cr-gear__bars');
    for (let i = 0; i < 3; i++) { const b = h('i', ''); gearBars.append(b); this.gearBars.push(b); }
    const speed = h('span', 'cr-ring__speed');
    const center = h('div', 'cr-ring__center',
      this.emblem,
      h('div', 'cr-ring__hull-read', hullNum, hullMax),
      h('div', 'cr-gear', h('span', 'cr-gear__keys', keycap('W'), keycap('S')), gearBars, gearName),
      speed,
    );
    this.boost = new MiniSkill('is-boost', 'speed', 'boost', 'B', 'Boost');
    this.brace = new MiniSkill('is-brace', 'shield', 'brace', 'A', 'Brace');
    for (let i = 0; i < MAX_CHARGE_PIPS; i++) { const pip = h('i', ''); this.boost.pips.append(pip); this.chargePips.push(pip); }
    const statuses = h('div', 'cr-statuses');
    this.statusesEl = statuses;
    let momentumLabel: HTMLElement | null = null;
    for (const s of STATUS) {
      const label = h('span', '', s.label);
      if (s.kind === 'momentum') momentumLabel = label;
      const el = h('span', `cr-status is-${s.tone}`, glyph(s.glyph), label);
      statuses.append(el);
      this.statusChips.set(s.kind, { el, on: new ClassCell(el, 'is-on') });
    }
    this.momentumText = new TextCell(momentumLabel!);
    const ironsChip = h('span', 'cr-ring__irons', glyph('wind'), 'In irons');
    this.el = h('div', 'cr-shipring', statuses, h('div', 'cr-ring', ring, center, h('span', 'cr-ring__label', 'Hull'), ironsChip), h('div', 'cr-ring__minis', this.boost.el, this.brace.el));
    this.irons = new ClassCell(this.el, 'is-irons');
    this.hullNum = new TextCell(hullNum);
    this.hullMax = new TextCell(hullMax);
    this.gearName = new TextCell(gearName);
    this.speed = new TextCell(speed);
    this.toneLow = new ClassCell(this.el, 'is-low');
    this.toneMid = new ClassCell(this.el, 'is-mid');
    this.braced = new ClassCell(this.el, 'is-braced');
    this.hasShield = new ClassCell(this.el, 'has-shield');
  }

  reset(): void {
    this.lastHullQ = this.lastShieldQ = this.lastHp = this.lastMax = this.lastGear = this.lastSpeed = -1; this.shipId = '';
    this.lastMomentum = this.lastCharges = this.lastChargeMax = -1;
  }

  update(run: Readonly<RunState>, ship: ShipDef): void {
    const p = run.player;
    if (ship.id !== this.shipId) { this.shipId = ship.id; this.el.style.setProperty('--accent', hex(ship.accent)); }
    const frac = p.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0;
    const q = Math.round(frac * 400);
    if (q !== this.lastHullQ) {
      this.lastHullQ = q;
      this.hull.setAttribute('stroke-dasharray', `${((ARC * q) / 400).toFixed(1)} ${C.toFixed(1)}`);
      this.toneLow.set(frac <= 0.25);
      this.toneMid.set(frac > 0.25 && frac <= 0.5);
    }
    const sq = p.maxHp > 0 ? Math.round(Math.min(1, p.shield / p.maxHp) * 400) : 0;
    if (sq !== this.lastShieldQ) {
      this.lastShieldQ = sq;
      this.shield.setAttribute('stroke-dasharray', `${((ARC * sq) / 400).toFixed(1)} ${(C * 2).toFixed(1)}`);
      this.hasShield.set(sq > 0);
    }
    const hp = Math.ceil(p.hp);
    if (hp !== this.lastHp) { this.lastHp = hp; this.hullNum.set(hp); }
    const max = Math.ceil(p.maxHp);
    if (max !== this.lastMax) { this.lastMax = max; this.hullMax.set(`/${max}`); }
    if (p.gear !== this.lastGear) {
      this.lastGear = p.gear;
      this.gearName.set(GEAR_NAMES[p.gear] ?? '');
      this.gearBars.forEach((b, i) => b.classList.toggle('is-on', i < p.gear || (p.gear === 0 && i === 0)));
      this.el.dataset.gear = String(p.gear);
    }
    const kn = knots(p.speed);
    if (kn !== this.lastSpeed) { this.lastSpeed = kn; this.speed.set(`${kn} kn`); }
    // In irons: under sail with the bow into the wind (the polar crawls there).
    this.irons.set(p.alive && p.gear > 0 && inIrons(p.heading, run.sea));
    // Boost charges (PACE: Trade Winds / Storm Sails): pips while more than one can be stored.
    const maxCharges = boostChargesOf(p.stats);
    const stored = Math.max(0, Math.min(maxCharges, run.director.scratch[BOOST_STORED] ?? maxCharges));
    if (stored !== this.lastCharges || maxCharges !== this.lastChargeMax) {
      this.lastCharges = stored; this.lastChargeMax = maxCharges;
      this.boost.pips.hidden = maxCharges < 2;
      this.chargePips.forEach((pip, i) => { pip.hidden = i >= Math.min(MAX_CHARGE_PIPS, maxCharges); pip.classList.toggle('is-on', i < stored); });
    }
    this.boost.syncKey();
    this.brace.syncKey();
    this.brace.auto.set(controls.latched.brace);
    this.boost.update(p.skills.boost.cooldown, p.skills.boost.cooldownMax, p.skills.boost.active);
    this.brace.update(p.skills.brace.cooldown, p.skills.brace.cooldownMax, p.skills.brace.active);
    this.braced.set(p.skills.brace.active > 0);
    for (const [kind, chip] of this.statusChips) {
      let on = false;
      for (const st of p.statuses) if (st.kind === kind && st.time > 0) { on = true; break; }
      if (kind === 'shielded' && p.shield > 0) on = true;
      if (kind === 'airborne' && p.airborne > 0.05) on = true;
      if (kind === 'submerged' && p.submerged > 0.05) on = true;
      chip.on.set(on);
      if (kind === 'momentum' && on) {
        let mag = 0;
        for (const st of p.statuses) if (st.kind === 'momentum') { mag = st.magnitude; break; }
        const pct = Math.round(Math.max(0, mag) * 100);
        if (pct !== this.lastMomentum) { this.lastMomentum = pct; this.momentumText.set(`Momentum +${pct}%`); }
      }
    }
  }

  ready(slot: 'boost' | 'brace'): void { (slot === 'boost' ? this.boost : this.brace).pulse(); }

  hit(): void {
    play(this.el.querySelector('.cr-ring')!, [
      { transform: 'translate(0,0)' }, { transform: 'translate(-5px,3px)' }, { transform: 'translate(4px,-3px)' }, { transform: 'translate(-2px,1px)' }, { transform: 'translate(0,0)' },
    ], { duration: 260 });
  }
}
