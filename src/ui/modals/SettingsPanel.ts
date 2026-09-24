/** Settings: volumes, mute, camera shake, damage numbers, quality, FPS. Every change calls onSettingsChange. */
import type { QualitySetting, Settings } from '../../game/types';
import { h, navButton, play } from '../core/dom';
import { glyph, type GlyphId } from '../core/icons';
import { focusDefault, keyDir, moveFocus, type PadIntent } from '../core/nav';
import { prompt } from '../core/prompts';

type SliderKey = 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'cameraShake';
type ToggleKey = 'muted' | 'damageNumbers' | 'showFps';
const QUALITIES: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high', 'ultra'];

interface Row { el: HTMLElement; left(): void; right(): void; activate(): void; sync(s: Settings): void }

export class SettingsPanel {
  readonly el: HTMLElement;
  open = false;
  private settings: Settings | null = null;
  private onClose: (() => void) | null = null;
  private readonly rows: Row[] = [];
  private readonly body: HTMLElement;

  constructor(private readonly onChange: (s: Settings) => void) {
    this.body = h('div', 'cr-settings__rows');
    this.slider('masterVolume', 'Master volume', 'speaker');
    this.slider('musicVolume', 'Music', 'music');
    this.slider('sfxVolume', 'Effects', 'cannon');
    this.toggle('muted', 'Mute all audio', 'mute');
    this.slider('cameraShake', 'Camera shake', 'quake');
    this.toggle('damageNumbers', 'Damage numbers', 'burst');
    this.quality();
    this.toggle('showFps', 'Show FPS', 'clock');
    const back = navButton('cr-btn is-primary cr-settings__done', prompt(['ESC'], 'B', ''), h('span', 'cr-btn__label', 'Done'));
    back.addEventListener('click', () => this.close());
    this.el = h('div', 'cr-modal cr-settings',
      h('div', 'cr-modal__shade'),
      h('div', 'cr-settings__card cr-brushpanel',
        h('div', 'cr-settings__head', glyph('gear', 'cr-settings__gear'), h('h2', 'cr-settings__title', 'Settings'), h('span', 'cr-settings__saved', 'Saved automatically')),
        this.body,
        h('div', 'cr-settings__foot', prompt(['↑', '↓'], 'DPAD', 'Choose'), prompt(['←', '→'], null, 'Adjust'), prompt(['ENTER'], 'A', 'Toggle'), back),
      ),
    );
    this.el.hidden = true;
    this.el.querySelector('.cr-modal__shade')!.addEventListener('pointerdown', () => this.close());
  }

  show(settings: Readonly<Settings>, onClose: () => void): void {
    this.settings = { ...settings };
    this.onClose = onClose;
    this.open = true;
    this.el.hidden = false;
    for (const r of this.rows) r.sync(this.settings);
    play(this.el.querySelector('.cr-settings__card')!, [{ opacity: 0, transform: 'translateY(24px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.9,.2,1)' });
    requestAnimationFrame(() => focusDefault(this.body));
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.hidden = true;
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private commit(): void {
    if (!this.settings) return;
    const next = { ...this.settings };
    this.onChange(next);
    for (const r of this.rows) r.sync(next);
  }

  private row(label: string, g: GlyphId, control: HTMLElement): HTMLElement {
    const el = h('div', 'cr-setting', glyph(g, 'cr-setting__icon'), h('span', 'cr-setting__label', label), control);
    this.body.append(el);
    return el;
  }

  private slider(key: SliderKey, label: string, g: GlyphId): void {
    const input = h('input', 'cr-range');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '5';
    input.dataset.nav = '';
    input.setAttribute('aria-label', label);
    const value = h('span', 'cr-setting__value');
    const control = h('span', 'cr-setting__control', input, value);
    const el = this.row(label, g, control);
    const set = (v: number) => {
      if (!this.settings) return;
      this.settings[key] = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
      this.commit();
    };
    input.addEventListener('input', () => set(Number(input.value) / 100));
    const sync = (s: Settings) => {
      const v = Math.round(s[key] * 100);
      if (input.value !== String(v)) input.value = String(v);
      input.style.setProperty('--v', String(v / 100));
      value.textContent = `${v}%`;
    };
    this.rows.push({ el, left: () => set((this.settings?.[key] ?? 0) - 0.05), right: () => set((this.settings?.[key] ?? 0) + 0.05), activate: () => undefined, sync });
    if (key === 'masterVolume') input.dataset.navDefault = '';
  }

  private toggle(key: ToggleKey, label: string, g: GlyphId): void {
    const btn = navButton('cr-toggle', h('span', 'cr-toggle__knob'), h('span', 'cr-toggle__on', 'On'), h('span', 'cr-toggle__off', 'Off'));
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', label);
    const el = this.row(label, g, h('span', 'cr-setting__control', btn));
    const flip = (v?: boolean) => {
      if (!this.settings) return;
      this.settings[key] = v ?? !this.settings[key];
      this.commit();
    };
    btn.addEventListener('click', () => flip());
    const sync = (s: Settings) => { btn.classList.toggle('is-on', s[key]); btn.setAttribute('aria-checked', String(s[key])); };
    this.rows.push({ el, left: () => flip(false), right: () => flip(true), activate: () => flip(), sync });
  }

  private quality(): void {
    const group = h('span', 'cr-segment');
    const buttons = QUALITIES.map((q) => {
      const b = navButton('cr-segment__opt', q === 'auto' ? 'Auto' : q[0]!.toUpperCase() + q.slice(1));
      b.addEventListener('click', () => { if (this.settings) { this.settings.quality = q; this.commit(); } });
      group.append(b);
      return b;
    });
    const el = this.row('Graphics quality', 'eye', h('span', 'cr-setting__control', group));
    const step = (d: number) => {
      if (!this.settings) return;
      const i = QUALITIES.indexOf(this.settings.quality);
      this.settings.quality = QUALITIES[Math.max(0, Math.min(QUALITIES.length - 1, i + d))]!;
      this.commit();
    };
    const sync = (s: Settings) => buttons.forEach((b, i) => b.classList.toggle('is-on', QUALITIES[i] === s.quality));
    this.rows.push({ el, left: () => step(-1), right: () => step(1), activate: () => step(1), sync });
  }

  private activeRow(): Row | null {
    const a = document.activeElement;
    return this.rows.find((r) => a && r.el.contains(a)) ?? null;
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape' || e.code === 'Backspace') { this.close(); return true; }
    const dir = keyDir(e.code);
    if (dir === 'up' || dir === 'down') { moveFocus(this.el, dir); return true; }
    if (dir === 'left' || dir === 'right') {
      const row = this.activeRow();
      if (row) { if (dir === 'left') row.left(); else row.right(); return true; }
      moveFocus(this.el, dir);
      return true;
    }
    return false;
  }

  onPad(intent: PadIntent): boolean {
    if (intent === 'back' || intent === 'start') { this.close(); return true; }
    if (intent === 'up' || intent === 'down') { moveFocus(this.el, intent); return true; }
    if (intent === 'left' || intent === 'right') { const row = this.activeRow(); if (row) { if (intent === 'left') row.left(); else row.right(); } return true; }
    if (intent === 'confirm') { const a = document.activeElement as HTMLElement | null; const row = this.activeRow(); if (a instanceof HTMLButtonElement) a.click(); else row?.activate(); return true; }
    return false;
  }
}
