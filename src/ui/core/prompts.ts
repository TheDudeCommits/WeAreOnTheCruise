/** Input prompts: keycaps and gamepad button glyphs. The root toggles `is-pad` to swap keyboard/pad prompts. */
import { h, type Child } from './dom';

export type PadButton = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'START' | 'DPAD' | 'LS' | 'RS';

export function keycap(label: string, cls = ''): HTMLElement {
  const k = h('kbd', `cr-key ${label.length > 2 ? 'is-wide' : ''} ${cls}`.trim(), label);
  return k;
}

export function padButton(btn: PadButton, cls = ''): HTMLElement {
  const label = btn === 'START' ? '≡' : btn === 'DPAD' ? '✚' : btn;
  return h('span', `cr-pad cr-pad--${btn.toLowerCase()} ${cls}`.trim(), label);
}

/** A prompt chip: keyboard keys (shown with keyboard/mouse) and a pad button (shown with a gamepad) plus a label. */
export function prompt(keys: readonly string[], pad: PadButton | null, label: Child, cls = ''): HTMLElement {
  const kb = h('span', 'cr-prompt__kb');
  keys.forEach((k, i) => { if (i > 0) kb.append(h('span', 'cr-prompt__or', '/')); kb.append(keycap(k)); });
  const el = h('span', `cr-prompt ${cls}`.trim(), kb);
  if (pad) el.append(h('span', 'cr-prompt__pad', padButton(pad)));
  if (label !== null && label !== undefined && label !== false && label !== '') el.append(h('span', 'cr-prompt__label', label));
  return el;
}
