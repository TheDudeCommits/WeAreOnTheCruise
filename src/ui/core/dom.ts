/** Tiny DOM helpers for the UI. Everything is built once; per-frame code only touches cached nodes. */

export type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  append(el, children);
  return el;
}

export function append(el: Element, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: Node[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

/** A button that participates in keyboard/gamepad spatial navigation. */
export function navButton(cls: string, ...children: Child[]): HTMLButtonElement {
  const b = h('button', cls, ...children);
  b.type = 'button';
  b.dataset.nav = '';
  return b;
}

/** Writes textContent only when the value changes. */
export class TextCell {
  private value: string | number | undefined = undefined;
  constructor(readonly el: HTMLElement | SVGElement) {}
  set(value: string | number): void {
    if (value === this.value) return;
    this.value = value;
    this.el.textContent = typeof value === 'number' ? String(value) : value;
  }
}

/** Toggles a class only when the boolean changes. */
export class ClassCell {
  private on: boolean | undefined = undefined;
  constructor(readonly el: Element, readonly cls: string) {}
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle(this.cls, on);
  }
}

/** Writes a CSS custom property only when the (quantised) value changes. */
export class VarCell {
  private value = Number.NaN;
  constructor(readonly el: HTMLElement | SVGElement, readonly name: string, readonly step = 0.001) {}
  set(v: number): void {
    const q = Math.round(v / this.step) * this.step;
    if (q === this.value) return;
    this.value = q;
    this.el.style.setProperty(this.name, q.toFixed(4));
  }
}

/** Writes a style property only when the string changes. */
export class StyleCell {
  private value = '';
  constructor(readonly el: HTMLElement | SVGElement, readonly prop: 'transform' | 'opacity' | 'width' | 'color' | 'background' | 'strokeDashoffset' | 'visibility') {}
  set(v: string): void {
    if (v === this.value) return;
    this.value = v;
    (this.el.style as unknown as Record<string, string>)[this.prop] = v;
  }
}

/** Restartable one-shot animation (Web Animations API; compositor-friendly when it only animates transform/opacity). */
export function play(el: Element, keyframes: Keyframe[], options: number | KeyframeAnimationOptions): Animation | null {
  if (typeof (el as HTMLElement).animate !== 'function') return null;
  for (const a of el.getAnimations()) if ((a as Animation & { __crOneShot?: boolean }).__crOneShot) a.cancel();
  const anim = (el as HTMLElement).animate(keyframes, options);
  (anim as Animation & { __crOneShot?: boolean }).__crOneShot = true;
  return anim;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
