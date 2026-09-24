/**
 * Settings, in four tabs (Q/E or LB/RB): Audio (volumes, mute), Display (quality, HUD scale, colour-blind palette,
 * flashing, shake, damage numbers, cinematic camera, FPS), Gameplay (AI captains, first-voyage tips, hold or toggle
 * for Full Broadside and Brace) and Controls (two keys per action, with conflict handling). Settings changes call
 * onSettingsChange; control prefs live in the Input store (cruise.controls.v2).
 *
 * Remapping: pick a key slot, press the new key. A key another action uses swaps over (a notice says which), the
 * run's own keys (Esc, P, Tab) are refused, Delete clears a second key, Esc cancels. The pad layout is fixed.
 */
import type { QualitySetting, Settings } from '../../game/types';
import { CAPTAIN } from '../../game/content/captains';
import {
  BIND_ACTIONS, BIND_LABEL, bindingConflicts, controls, defaultControls, keyLabel, rebind, unbind, type BindAction, type HoldMode,
} from '../../input/Input';
import { h, navButton, play, TextCell } from '../core/dom';
import { glyph, type GlyphId } from '../core/icons';
import { focusDefault, focusEl, keyDir, moveFocus, type PadIntent } from '../core/nav';
import { prompt } from '../core/prompts';

/** `reduceFlashing` is optional on the base contract; the local extension keeps this compiling before the merge. */
export type UiSettings = Settings & { reduceFlashing?: boolean };
type ToggleKey = 'muted' | 'damageNumbers' | 'showFps' | 'reduceFlashing' | 'coach' | 'cinematicCamera';
export type SettingsTab = 'audio' | 'display' | 'gameplay' | 'controls';
/** Toggles whose missing value means on. */
const DEFAULT_ON: ReadonlySet<ToggleKey> = new Set(['coach']);
const toggleValue = (s: UiSettings, key: ToggleKey): boolean => (DEFAULT_ON.has(key) ? s[key] !== false : !!s[key]);
const QUALITIES: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high', 'ultra'];
const COLOR_BLIND: readonly NonNullable<Settings['colorBlind']>[] = ['off', 'deutan', 'protan', 'tritan'];
const COLOR_BLIND_LABEL: Readonly<Record<NonNullable<Settings['colorBlind']>, string>> = { off: 'Off', deutan: 'Deutan', protan: 'Protan', tritan: 'Tritan' };
const TABS: readonly { id: SettingsTab; label: string; glyph: GlyphId }[] = [
  { id: 'audio', label: 'Audio', glyph: 'speaker' },
  { id: 'display', label: 'Display', glyph: 'eye' },
  { id: 'gameplay', label: 'Gameplay', glyph: 'ship' },
  { id: 'controls', label: 'Controls', glyph: 'compass' },
];

interface Row { el: HTMLElement; left(): void; right(): void; activate(): void; sync(s: UiSettings): void }
interface KeySlot { action: BindAction; slot: 0 | 1; btn: HTMLButtonElement; text: TextCell }

export class SettingsPanel {
  readonly el: HTMLElement;
  open = false;
  private settings: UiSettings | null = null;
  private onClose: (() => void) | null = null;
  private readonly rows: Row[] = [];
  private readonly body: HTMLElement;
  private readonly sections = new Map<SettingsTab, HTMLElement>();
  private readonly tabButtons = new Map<SettingsTab, HTMLButtonElement>();
  private section!: HTMLElement;
  private tab: SettingsTab = 'audio';
  private readonly keySlots: KeySlot[] = [];
  private capture: KeySlot | null = null;
  private readonly notice: TextCell;
  private readonly noticeEl: HTMLElement;

  constructor(private readonly onChange: (s: Settings) => void) {
    const tabs = h('nav', 'cr-settings__tabs', prompt(['Q'], 'LB', '', 'cr-tabs__hint'));
    for (const t of TABS) {
      const b = navButton('cr-settings__tab', glyph(t.glyph), h('span', '', t.label));
      b.dataset.tab = t.id;
      b.addEventListener('click', () => this.setTab(t.id, false));
      tabs.append(b);
      this.tabButtons.set(t.id, b);
    }
    tabs.append(prompt(['E'], 'RB', '', 'cr-tabs__hint'));
    this.body = h('div', 'cr-settings__rows cr-scroll');

    this.begin('audio');
    this.slider('Master volume', 'speaker', (s) => s.masterVolume, (s, v) => { s.masterVolume = v; }, true);
    this.slider('Music', 'music', (s) => s.musicVolume, (s, v) => { s.musicVolume = v; });
    this.slider('Effects', 'cannon', (s) => s.sfxVolume, (s, v) => { s.sfxVolume = v; });
    this.toggle('muted', 'Mute all audio', 'mute');

    this.begin('display');
    this.quality();
    this.slider('HUD scale', 'xp', (s) => ((s.hudScale ?? 1) - 0.8) / 0.4, (s, v) => { s.hudScale = Math.round((0.8 + v * 0.4) * 20) / 20; }, false, (s) => `${Math.round((s.hudScale ?? 1) * 100)}%`, 0.125);
    this.segment('Colour-blind palette', 'eye', COLOR_BLIND.map((c) => COLOR_BLIND_LABEL[c]),
      (s) => Math.max(0, COLOR_BLIND.indexOf(s.colorBlind ?? 'off')), (s, i) => { s.colorBlind = COLOR_BLIND[i]!; },
      'Recolours danger telegraphs and the HUD for red-green (deutan, protan) or blue-yellow (tritan) colour blindness.');
    this.toggle('reduceFlashing', 'Reduce flashing', 'bolt');
    this.slider('Camera shake', 'quake', (s) => Math.min(1, s.cameraShake), (s, v) => { s.cameraShake = v; });
    this.toggle('damageNumbers', 'Damage numbers', 'burst');
    this.toggle('cinematicCamera', 'Cinematic camera', 'compass', 'A lower camera while the sea is quiet.');
    this.toggle('showFps', 'Show FPS', 'clock');

    this.begin('gameplay');
    this.captains();
    this.toggle('coach', 'First-voyage tips', 'book', 'Short tips during your first voyages, and the first time a branch or OVERDRIVE card appears.');
    this.holdMode('broadsideMode', 'Full Broadside', 'cannon');
    this.holdMode('braceMode', 'Brace', 'shield');

    this.begin('controls');
    this.bindings();
    const reset = navButton('cr-btn is-ghost cr-settings__reset', glyph('wheel'), h('span', 'cr-btn__label', 'Default keys'));
    reset.addEventListener('click', () => { controls.set({ ...controls.get(), bindings: defaultControls().bindings }); this.endCapture(); this.say('Default keys restored.'); this.syncKeys(); });
    this.noticeEl = h('span', 'cr-settings__notice');
    this.notice = new TextCell(this.noticeEl);
    this.section.append(h('div', 'cr-settings__keyfoot', reset, this.noticeEl, h('span', 'cr-settings__keynote', 'Esc, P and Tab are the run’s own keys. The pad layout is fixed.')));

    const back = navButton('cr-btn is-primary cr-settings__done', prompt(['ESC'], 'B', ''), h('span', 'cr-btn__label', 'Done'));
    back.addEventListener('click', () => this.close());
    this.el = h('div', 'cr-modal cr-settings',
      h('div', 'cr-modal__shade'),
      h('div', 'cr-settings__card cr-brushpanel',
        h('div', 'cr-settings__head', glyph('gear', 'cr-settings__gear'), h('h2', 'cr-settings__title', 'Settings'), h('span', 'cr-settings__saved', 'Saved automatically')),
        tabs,
        this.body,
        h('div', 'cr-settings__foot', prompt(['↑', '↓'], 'DPAD', 'Choose'), prompt(['←', '→'], null, 'Adjust'), prompt(['ENTER'], 'A', 'Select'), back),
      ),
    );
    this.el.hidden = true;
    this.el.querySelector('.cr-modal__shade')!.addEventListener('pointerdown', () => this.close());
    this.setTab('audio', false);
  }

  show(settings: Readonly<Settings>, onClose: () => void, tab: SettingsTab = this.tab): void {
    this.settings = { ...(settings as UiSettings) };
    this.onClose = onClose;
    this.open = true;
    this.el.hidden = false;
    this.endCapture();
    this.say('');
    for (const r of this.rows) r.sync(this.settings);
    this.syncKeys();
    this.setTab(tab, false);
    play(this.el.querySelector('.cr-settings__card')!, [{ opacity: 0, transform: 'translateY(24px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.9,.2,1)' });
    requestAnimationFrame(() => this.focusSection());
  }

  close(): void {
    if (!this.open) return;
    this.endCapture();
    this.open = false;
    this.el.hidden = true;
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private setTab(tab: SettingsTab, focus: boolean): void {
    this.tab = tab;
    for (const [id, b] of this.tabButtons) { b.classList.toggle('is-active', id === tab); b.setAttribute('aria-selected', String(id === tab)); }
    for (const [id, sec] of this.sections) sec.hidden = id !== tab;
    this.body.scrollTop = 0;
    this.endCapture();
    if (focus) this.focusSection();
  }

  private focusSection(): void {
    const sec = this.sections.get(this.tab)!;
    if (!focusDefault(sec)) focusEl(this.tabButtons.get(this.tab));
  }

  private cycleTab(d: number): void {
    const i = TABS.findIndex((t) => t.id === this.tab);
    this.setTab(TABS[(i + d + TABS.length) % TABS.length]!.id, true);
  }

  private commit(): void {
    if (!this.settings) return;
    const next = { ...this.settings };
    this.onChange(next);
    for (const r of this.rows) r.sync(next);
  }

  // ── Row builders ──

  private begin(tab: SettingsTab): void {
    const sec = h('div', 'cr-settings__section');
    sec.dataset.tab = tab;
    this.body.append(sec);
    this.sections.set(tab, sec);
    this.section = sec;
  }

  private row(label: string, g: GlyphId, control: HTMLElement, hint?: string): HTMLElement {
    const el = h('div', 'cr-setting', glyph(g, 'cr-setting__icon'), h('span', 'cr-setting__label', label, hint ? h('small', 'cr-setting__hint', hint) : null), control);
    this.section.append(el);
    return el;
  }

  /** A 0–1 slider (display as %, or `fmt`), `step` of the 0–1 range per arrow press. */
  private slider(label: string, g: GlyphId, get: (s: UiSettings) => number, set: (s: UiSettings, v: number) => void, first = false, fmt?: (s: UiSettings) => string, step = 0.05): void {
    const input = h('input', 'cr-range');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = String(Math.round(step * 100));
    input.dataset.nav = '';
    input.setAttribute('aria-label', label);
    if (first) input.dataset.navDefault = '';
    const value = h('span', 'cr-setting__value');
    const el = this.row(label, g, h('span', 'cr-setting__control', input, value));
    const apply = (v: number) => {
      if (!this.settings) return;
      set(this.settings, Math.max(0, Math.min(1, Math.round(v / step) * step)));
      this.commit();
    };
    input.addEventListener('input', () => apply(Number(input.value) / 100));
    const sync = (s: UiSettings) => {
      const v = Math.round(get(s) * 100);
      if (input.value !== String(v)) input.value = String(v);
      input.style.setProperty('--v', String(v / 100));
      value.textContent = fmt ? fmt(s) : `${v}%`;
    };
    this.rows.push({ el, left: () => apply(get(this.settings!) - step), right: () => apply(get(this.settings!) + step), activate: () => undefined, sync });
  }

  private toggle(key: ToggleKey, label: string, g: GlyphId, hint?: string): void {
    const btn = navButton('cr-toggle', h('span', 'cr-toggle__knob'), h('span', 'cr-toggle__on', 'On'), h('span', 'cr-toggle__off', 'Off'));
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', label);
    const el = this.row(label, g, h('span', 'cr-setting__control', btn), hint);
    const flip = (v?: boolean) => {
      if (!this.settings) return;
      this.settings[key] = v ?? !toggleValue(this.settings, key);
      this.commit();
    };
    btn.addEventListener('click', () => flip());
    const sync = (s: UiSettings) => { const on = toggleValue(s, key); btn.classList.toggle('is-on', on); btn.setAttribute('aria-checked', String(on)); };
    this.rows.push({ el, left: () => flip(false), right: () => flip(true), activate: () => flip(), sync });
  }

  /** A segmented choice over Settings. */
  private segment(label: string, g: GlyphId, options: readonly string[], get: (s: UiSettings) => number, set: (s: UiSettings, i: number) => void, hint?: string): void {
    const group = h('span', 'cr-segment');
    const buttons = options.map((o, i) => {
      const b = navButton('cr-segment__opt', o);
      b.addEventListener('click', () => { if (this.settings) { set(this.settings, i); this.commit(); } });
      group.append(b);
      return b;
    });
    const el = this.row(label, g, h('span', 'cr-setting__control', group), hint);
    const step = (d: number) => {
      if (!this.settings) return;
      set(this.settings, Math.max(0, Math.min(options.length - 1, get(this.settings) + d)));
      this.commit();
    };
    const sync = (s: UiSettings) => { const c = get(s); buttons.forEach((b, i) => b.classList.toggle('is-on', i === c)); };
    this.rows.push({ el, left: () => step(-1), right: () => step(1), activate: () => step(1), sync });
  }

  private quality(): void {
    this.segment('Graphics quality', 'eye', QUALITIES.map((q) => (q === 'auto' ? 'Auto' : q[0]!.toUpperCase() + q.slice(1))),
      (s) => Math.max(0, QUALITIES.indexOf(s.quality)), (s, i) => { s.quality = QUALITIES[i]!; });
  }

  /** AI captains sailing with you (0–4; applies to the next voyage). CAPTAINS. */
  private captains(): void {
    const counts = Array.from({ length: CAPTAIN.max + 1 }, (_, i) => i);
    const current = (s: UiSettings) => Math.max(0, Math.min(CAPTAIN.max, Math.round(s.captains ?? CAPTAIN.defaultCount)));
    this.segment('AI captains', 'ship', counts.map((n) => (n === 0 ? 'Off' : String(n))), current, (s, i) => { s.captains = i; },
      'Other captains sailing your sea while no live captains are online (from the next voyage).');
  }

  /** Hold or toggle for Full Broadside / Brace (control prefs, not Settings). */
  private holdMode(key: 'broadsideMode' | 'braceMode', label: string, g: GlyphId): void {
    const modes: readonly HoldMode[] = ['hold', 'toggle'];
    const group = h('span', 'cr-segment');
    const set = (m: HoldMode) => { controls.set({ ...controls.get(), [key]: m }); sync(); };
    const buttons = modes.map((m) => {
      const b = navButton('cr-segment__opt', m === 'hold' ? 'Hold' : 'Toggle');
      b.addEventListener('click', () => set(m));
      group.append(b);
      return b;
    });
    const hint = key === 'broadsideMode'
      ? 'Hold: fires, and keeps firing as it reloads while held. Toggle: one press keeps it firing until the next.'
      : 'Hold: braces, and braces again as soon as it can while held. Toggle: one press keeps bracing until the next.';
    const el = this.row(`${label}: hold or toggle`, g, h('span', 'cr-setting__control', group), hint);
    const sync = () => { const m = controls.get()[key]; buttons.forEach((b, i) => b.classList.toggle('is-on', modes[i] === m)); };
    this.rows.push({ el, left: () => set('hold'), right: () => set('toggle'), activate: () => set(controls.get()[key] === 'hold' ? 'toggle' : 'hold'), sync: () => sync() });
  }

  // ── Controls: key remapping ──

  private bindings(): void {
    const table = h('div', 'cr-keys');
    for (const action of BIND_ACTIONS) {
      const slots = ([0, 1] as const).map((slot) => {
        const text = h('span', 'cr-keys__cap');
        const btn = navButton('cr-keys__slot', text);
        btn.dataset.slot = String(slot);
        const ks: KeySlot = { action, slot, btn, text: new TextCell(text) };
        btn.addEventListener('click', () => this.startCapture(ks));
        this.keySlots.push(ks);
        return btn;
      });
      if (action === 'gear-up') slots[0]!.dataset.navDefault = '';
      table.append(h('div', 'cr-keys__row', h('span', 'cr-keys__action', BIND_LABEL[action], action === 'broadside' ? h('small', '', '+ Left click') : null), ...slots));
    }
    this.section.append(table);
  }

  private syncKeys(): void {
    const b = controls.get().bindings;
    const clash = bindingConflicts(b);
    for (const ks of this.keySlots) {
      const code = b[ks.action][ks.slot];
      ks.text.set(this.capture === ks ? 'Press a key…' : code ? keyLabel(code) : ks.slot === 1 ? '+' : '—');
      ks.btn.classList.toggle('is-empty', !code);
      ks.btn.classList.toggle('is-clash', !!code && clash.has(code));
      ks.btn.classList.toggle('is-capturing', this.capture === ks);
    }
  }

  private startCapture(ks: KeySlot): void {
    this.capture = ks;
    this.say('Press the new key. Esc cancels, Delete clears a second key.');
    this.syncKeys();
  }

  private endCapture(): void {
    if (!this.capture) return;
    this.capture = null;
    this.syncKeys();
  }

  private say(text: string): void { this.notice?.set(text); }

  /** A key pressed while a slot waits for one. */
  private captureKey(code: string): void {
    const ks = this.capture!;
    const prefs = controls.get();
    if (code === 'Escape') { this.capture = null; this.say(''); this.syncKeys(); return; }
    if (code === 'Delete' || code === 'Backspace') {
      const other = prefs.bindings[ks.action][ks.slot === 0 ? 1 : 0];
      if (!other) { this.say(`${BIND_LABEL[ks.action]} needs at least one key.`); return; }
      controls.set({ ...prefs, bindings: unbind(prefs.bindings, ks.action, ks.slot) });
      this.capture = null; this.say(`${BIND_LABEL[ks.action]}: key cleared.`); this.syncKeys();
      return;
    }
    const res = rebind(prefs.bindings, ks.action, ks.slot, code);
    if (!res.ok) { this.say(`${keyLabel(code)} is one of the run's own keys (Esc, P, Tab). Pick another.`); return; }
    controls.set({ ...prefs, bindings: res.bindings });
    this.capture = null;
    this.say(res.swapped ? `${keyLabel(code)} was on ${BIND_LABEL[res.swapped]}: the two swapped keys.` : `${BIND_LABEL[ks.action]}: ${keyLabel(code)}.`);
    this.syncKeys();
    play(ks.btn, [{ transform: 'scale(1.12)', filter: 'brightness(1.6)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 320, easing: 'ease-out' });
  }

  // ── Input ──

  private activeRow(): Row | null {
    const a = document.activeElement;
    return this.rows.find((r) => a && r.el.contains(a)) ?? null;
  }

  private reveal(): void {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !this.body.contains(el)) return;
    const r = el.getBoundingClientRect(), b = this.body.getBoundingClientRect();
    if (r.top < b.top + 8) this.body.scrollTop -= b.top + 8 - r.top;
    else if (r.bottom > b.bottom - 8) this.body.scrollTop += r.bottom - (b.bottom - 8);
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.capture) { if (!e.repeat) this.captureKey(e.code); return true; }
    if (e.code === 'Escape' || e.code === 'Backspace') { this.close(); return true; }
    if (e.code === 'KeyQ' || e.code === 'PageUp') { this.cycleTab(-1); return true; }
    if (e.code === 'KeyE' || e.code === 'PageDown') { this.cycleTab(1); return true; }
    const dir = keyDir(e.code);
    if (dir === 'up' || dir === 'down') { moveFocus(this.el, dir); this.reveal(); return true; }
    if (dir === 'left' || dir === 'right') {
      const row = this.activeRow();
      if (row) { if (dir === 'left') row.left(); else row.right(); return true; }
      moveFocus(this.el, dir);
      return true;
    }
    return false;
  }

  onPad(intent: PadIntent): boolean {
    if (this.capture) { if (intent === 'back') this.captureKey('Escape'); return true; }
    if (intent === 'back' || intent === 'start') { this.close(); return true; }
    if (intent === 'prev') { this.cycleTab(-1); return true; }
    if (intent === 'next') { this.cycleTab(1); return true; }
    if (intent === 'up' || intent === 'down') { moveFocus(this.el, intent); this.reveal(); return true; }
    if (intent === 'left' || intent === 'right') { const row = this.activeRow(); if (row) { if (intent === 'left') row.left(); else row.right(); } else moveFocus(this.el, intent); return true; }
    if (intent === 'confirm') { const a = document.activeElement as HTMLElement | null; const row = this.activeRow(); if (a instanceof HTMLButtonElement) a.click(); else row?.activate(); return true; }
    return false;
  }
}
