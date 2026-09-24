/**
 * Icons: every icon is a medallion that shows /assets/icons/<id>.png when it exists and a hand-drawn SVG glyph
 * (from an inline sprite) until then, so a missing file never breaks layout.
 */
import { h, svg } from './dom';

function star(points: number, outer: number, inner: number, cx = 32, cy = 32, rot = -Math.PI / 2): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / points;
    d += `${i === 0 ? 'M' : 'L'}${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
  }
  return `${d}z`;
}

function gear(teeth: number, outer: number, inner: number, hole: number): string {
  let d = '';
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [[a - step * 0.3, inner], [a - step * 0.18, outer], [a + step * 0.18, outer], [a + step * 0.3, inner], [a + step * 0.5, inner]] as const;
    for (const [ang, r] of pts) d += `${d ? 'L' : 'M'}${(32 + Math.cos(ang) * r).toFixed(1)} ${(32 + Math.sin(ang) * r).toFixed(1)}`;
  }
  return `${d}zM${32 - hole} 32a${hole} ${hole} 0 1 0 ${hole * 2} 0a${hole} ${hole} 0 1 0 ${-hole * 2} 0z`;
}

const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

const GLYPHS = {
  cannon: '<path d="M7.8 27.4 50.4 15.3l3.2 9.4-41.4 15.9z"/><circle cx="8.5" cy="34.5" r="5.5"/><path d="M16 40h24l5 9H12z"/><circle cx="20" cy="51" r="7"/><circle cx="37" cy="51" r="7"/>',
  scope: '<path d="M4 46l9-5 5 9-9 5z"/><path d="M14 39l18-10 6 11-18 10z"/><path d="M31 27l23-13 8 15-23 13z"/>',
  mortar: '<path d="M11 30h42l-6 20H17z"/><rect x="7" y="50" width="50" height="8" rx="2"/><ellipse cx="32" cy="30" rx="21" ry="5.5"/><circle cx="47" cy="11" r="6.5"/>',
  swivel: '<path d="M28 33h8v25h-8z"/><path d="M19 26h26v7H19z"/><path d="M8 19.5l40-8.5a4.2 4.2 0 0 1 1.8 8.2l-40 8.5a4.2 4.2 0 0 1-1.8-8.2z"/>',
  barrel: '<path fill-rule="evenodd" d="M16 28h32c3.5 9 3.5 19 0 28H16c-3.5-9-3.5-19 0-28zm-1.2 8h34.4v3H14.8zm0 9h34.4v3H14.8z"/><path d="M32 2c4 6 11 9 9 17-1 4.5-4.5 6.5-9 6.5s-9-2-10-6.5c-1-5 2-8 5-11 0 3 1 5 3 6 1-4-1-8 2-12z"/>',
  harpoon: `<path d="M9 55 42 22" ${S} stroke-width="6"/><path d="M34 16 58 6 48 30z"/><path d="M30 31c-6 1-11-2-11-9" ${S} stroke-width="4"/>`,
  rocket: '<path d="M58 6c-10 0-20 4-28 12L20 28l16 16 10-10c8-8 12-18 12-28z"/><path d="M20 28l-10 1.5-6 8.5 12 2zM36 44l-1.5 10-8.5 6-2-12z"/><path d="M17 41c-5 2-9 8-11 17 9-2 15-6 17-11z"/>',
  bolt: '<path d="M38 2 11 37h17l-6 25 31-38H35z"/>',
  mine: `<circle cx="32" cy="33" r="16"/><path d="M32 5v12M32 49v11M4 33h12M48 33h12M12 13l8.5 8.5M43.5 44.5l8.5 8.5M12 53l8.5-8.5M43.5 21.5 52 13" ${S} stroke-width="5"/>`,
  ram: '<path fill-rule="evenodd" d="M2 32 28 9h32v46H28zm33-12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0zm13 0a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0zm-13 24a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0zm13 0a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0z"/>',
  skiff: '<path d="M3 40h58l-9 15H12z"/><path d="M31 5h3.5v35H31z"/><path d="M36.5 8c12 8 16 20 14 30h-14z"/><path d="M29 14c-8 6-12 14-12 24h12z"/>',
  vortex: `<path d="M32 32a3 3 0 0 1 6 0 6 6 0 0 1-12 0 9 9 0 0 1 18 0 12 12 0 0 1-24 0 15 15 0 0 1 30 0 18 18 0 0 1-36 0" ${S} stroke-width="4.5"/>`,
  shield: '<path fill-rule="evenodd" d="M32 3 57 11v19c0 17-11.5 27-25 31C18.5 57 7 47 7 30V11zm0 9-16 5v13c0 11 7 18 16 21z"/>',
  sail: '<path d="M30 3h4.5v51H30z"/><path d="M37 7c16 8 18 26 0 36z"/><path d="M28 13c-14 6-16 22 0 28z"/><path d="M7 54h50l-6.5 7H13.5z"/>',
  keg: `<path fill-rule="evenodd" d="M15 22h34c3.5 11 3.5 23 0 35H15c-3.5-12-3.5-24 0-35zm-1 10h36v3H14zm0 10h36v3H14z"/><path d="M32 22c0-8 4-12 10-14" ${S} stroke-width="3.5"/><path d="${star(5, 7, 3, 47, 7)}"/>`,
  crosshair: `<circle cx="32" cy="32" r="19" ${S} stroke-width="6"/><path d="M32 2v17M32 45v17M2 32h17M45 32h17" ${S} stroke-width="6"/><circle cx="32" cy="32" r="5"/>`,
  magnet: '<path d="M9 5h15v27a8 8 0 0 0 16 0V5h15v27a23 23 0 0 1-46 0z"/><path d="M9 5h15v8H9zM40 5h15v8H40z" opacity=".55"/>',
  coin: '<path fill-rule="evenodd" d="M32 3a29 29 0 1 1 0 58 29 29 0 0 1 0-58zm0 10L13 32l19 19 19-19z"/><path d="M32 22l10 10-10 10-10-10z"/>',
  hammer: '<path d="M20 5h25l7 7v11H20l-7-5V9z"/><path d="M28 23h8v35a4 4 0 0 1-8 0z"/>',
  flame: '<path d="M32 2c6 10 21 16 21 34 0 13-9.5 25-21 25S11 49 11 38c0-10 6-14 10-20 1 6 3 8 6 10 1-10 0-16 5-26z"/>',
  eye: '<path fill-rule="evenodd" d="M2 32C10 18 20 11 32 11s22 7 30 21c-8 14-18 21-30 21S10 46 2 32zm30-13a13 13 0 1 0 0 26 13 13 0 0 0 0-26z"/><circle cx="32" cy="32" r="6.5"/>',
  clock: '<path fill-rule="evenodd" d="M32 3a29 29 0 1 1 0 58 29 29 0 0 1 0-58zm0 7a22 22 0 1 0 0 44 22 22 0 0 0 0-44z"/><path d="M29 14h6v17l12 8-3.4 5.2L29 34.5z"/>',
  crate: `<path fill-rule="evenodd" d="M5 11h54v44H5zm6 6v32h42V17z"/><path d="M11 17l42 32M53 17 11 49" ${S} stroke-width="5"/>`,
  plus: '<path d="M23 5h18v18h18v18H41v18H23V41H5V23h18z"/>',
  chest: '<path fill-rule="evenodd" d="M7 30h50v27H7zm21 3v11h8V33z"/><path d="M7 27c0-11 6.5-17 15-17h20c8.5 0 15 6 15 17z"/>',
  skull: '<path fill-rule="evenodd" d="M32 3C17.5 3 7 13.5 7 28c0 8.5 4 14.5 10 17.5V54h30v-8.5c6-3 10-9 10-17.5C57 13.5 46.5 3 32 3zM21.5 23.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm21 0a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM32 37l4.5 7.5h-9z"/><path d="M22 55h5v6h-5zM29.5 55h5v6h-5zM37 55h5v6h-5z"/>',
  star: `<path d="${star(5, 29, 12.5, 32, 33.5)}"/>`,
  wave: '<path d="M3 51C3 29 18 11 39 11c10 0 18 6 20 14-6-4-14-3-18 2 6 0 10 4 10 8-6-2-12 0-14 6-2 6-6 10-14 10z"/><path d="M2 55h60v7H2z"/>',
  sun: `<circle cx="32" cy="32" r="13"/><path d="${star(10, 30, 16)}" opacity=".85"/>`,
  burst: `<path d="${star(12, 30, 15, 32, 32, -Math.PI / 2.2)}"/>`,
  dive: '<path d="M25 3h14v21h11L32 45 14 24h11z"/><path d="M2 49c5 0 5-4 10-4s5 4 10 4 5-4 10-4 5 4 10 4 5-4 10-4 5 4 10 4v7c-5 0-5-4-10-4s-5 4-10 4-5-4-10-4-5 4-10 4-5-4-10-4-5 4-10 4z"/>',
  torpedo: '<path d="M10 25h34c9 0 15 3.5 17 7-2 3.5-8 7-17 7H10z"/><path d="M11 21 3 14v36l8-7z"/><path d="M40 25v14" stroke="#000" stroke-opacity=".3" stroke-width="3"/>',
  pot: `<path d="M8 31h48v4c0 14-10 22-24 22S8 49 8 35z"/><path d="M3 27h58v7H3z"/><path d="M23 3c-4 6 4 10 0 17M33 3c-4 6 4 10 0 17M43 3c-4 6 4 10 0 17" ${S} stroke-width="3.5"/>`,
  flare: `<path d="${star(8, 20, 8, 32, 21)}"/><path d="M30 34h4.5v27H30z"/>`,
  rain: `<circle cx="14" cy="47" r="7.5"/><circle cx="34" cy="53" r="7.5"/><circle cx="52" cy="41" r="7.5"/><path d="M6 6l6 31M27 9l5 34M45 4l5 28" ${S} stroke-width="4"/>`,
  quake: `<circle cx="32" cy="32" r="7"/><circle cx="32" cy="32" r="16" ${S} stroke-width="5"/><circle cx="32" cy="32" r="27" ${S} stroke-width="4" stroke-dasharray="11 6"/>`,
  wind: `<path d="M4 22h32a7 7 0 1 0-7-7M4 34h44a7 7 0 1 1-7 7M4 46h20" ${S} stroke-width="5.5"/>`,
  speed: '<path d="M5 9h15l17 23-17 23H5l17-23zM29 9h15l17 23-17 23H29l17-23z"/>',
  map: '<path fill-rule="evenodd" d="M3 12 22 5l20 7 19-7v47l-19 7-20-7-19 7zm18 0v39h2V12zm20 1v39h2V13z"/>',
  spot: '<path fill-rule="evenodd" d="M32 3a29 29 0 1 1 0 58 29 29 0 0 1 0-58zM21 17l-4 4 11 11-11 11 4 4 11-11 11 11 4-4-11-11 11-11-4-4-11 11z"/>',
  book: '<path d="M3 12c10-2.5 20 0 26.5 6v41C23 53 13 51 3 53zM61 12c-10-2.5-20 0-26.5 6v41C41 53 51 51 61 53z"/>',
  compass: `<circle cx="32" cy="32" r="27" ${S} stroke-width="4.5"/><path d="M32 5l6 21 21 6-21 6-6 21-6-21-21-6 21-6z"/>`,
  lock: '<path fill-rule="evenodd" d="M11 28h42v31H11zm17.5 9v13h7V37z"/><path d="M18 28v-8a14 14 0 0 1 28 0v8h-7.5v-8a6.5 6.5 0 0 0-13 0v8z"/>',
  gear: `<path fill-rule="evenodd" d="${gear(9, 29, 22, 8)}"/>`,
  ship: '<path d="M3 40h58l-9 15H13z"/><path d="M19 7h3.5v33H19zM40 3h3.5v37H40z"/><path d="M24.5 9c10 4 12 12 12 25h-12zM45.5 5c10 6 12 14 12 29h-12z"/><path d="M6 20c4 4 8 10 11 18H6z"/>',
  crown: '<path d="M5 19l15 13 12-21 12 21 15-13-6 31H11z"/><path d="M11 54h42v7H11z"/>',
  wheel: `<circle cx="32" cy="32" r="17" ${S} stroke-width="5"/><circle cx="32" cy="32" r="6"/><path d="M32 2v60M2 32h60M10.8 10.8l42.4 42.4M53.2 10.8 10.8 53.2" ${S} stroke-width="4.5"/>`,
  anchor: `<path d="M28.5 15h7v40h-7z"/><circle cx="32" cy="10" r="6" ${S} stroke-width="4"/><path d="M19 22h26v6H19z"/><path d="M6 35c2 15 12.5 24 26 24s24-9 26-24l-9 4c-2 8-8 13-17 13s-15-5-17-13z"/>`,
  sword: '<path d="M50 4h10v10L28 46l-10-10z"/><path d="M13 35l16 16-4 4-5-2-7 7-5-5 7-7-2-5z"/>',
  xp: `<path d="${star(4, 29, 11)}"/>`,
  speaker: `<path d="M5 23h13l17-15v48L18 41H5z"/><path d="M43 21c6 6 6 16 0 22M50 13c11 11 11 27 0 38" ${S} stroke-width="5"/>`,
  music: '<path d="M22 9 57 2v40a9.5 9.5 0 1 1-6-8.8V15.5L28 20v31a9.5 9.5 0 1 1-6-8.8z"/>',
  mute: `<path d="M5 23h13l17-15v48L18 41H5z"/><path d="M43 23l16 18M59 23 43 41" ${S} stroke-width="5.5"/>`,
} as const;

export type GlyphId = keyof typeof GLYPHS;

let spriteReady = false;

/** Injects the glyph sprite once (idempotent; safe to call from every screen). */
export function ensureGlyphSprite(): void {
  if (spriteReady || typeof document === 'undefined') return;
  spriteReady = true;
  if (document.getElementById('cr-glyphs')) return;
  const symbols = Object.entries(GLYPHS).map(([id, body]) => `<symbol id="crg-${id}" viewBox="0 0 64 64">${body}</symbol>`).join('');
  const host = document.createElement('div');
  host.innerHTML = `<svg id="cr-glyphs" xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>${symbols}</defs></svg>`;
  document.body.prepend(host.firstElementChild!);
}

/** An inline glyph (no PNG). */
export function glyph(id: GlyphId, cls = ''): SVGSVGElement {
  ensureGlyphSprite();
  const el = svg('svg', { class: `cr-glyph ${cls}`.trim(), viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' }, svg('use', { href: `#crg-${id}` }));
  return el;
}

type IconState = 'ok' | 'bad' | 'loading';
const iconState = new Map<string, IconState>();
const waiting = new Map<string, Set<HTMLElement>>();

function resolve(src: string, ok: boolean): void {
  iconState.set(src, ok ? 'ok' : 'bad');
  const set = waiting.get(src);
  waiting.delete(src);
  if (!set) return;
  for (const wrap of set) if (wrap.dataset.src === src) applyImage(wrap, src, ok);
}

function applyImage(wrap: HTMLElement, src: string, ok: boolean): void {
  let img = wrap.querySelector<HTMLImageElement>('img');
  if (!ok) { img?.remove(); wrap.classList.remove('has-img'); return; }
  if (!img) {
    img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    wrap.append(img);
  }
  if (img.getAttribute('src') !== src) img.src = src;
  wrap.classList.add('has-img');
}

function request(src: string): void {
  if (iconState.has(src)) return;
  iconState.set(src, 'loading');
  const probe = new Image();
  probe.decoding = 'async';
  probe.onload = () => resolve(src, probe.naturalWidth > 0);
  probe.onerror = () => resolve(src, false);
  probe.src = src;
}

/** Points an icon medallion at a PNG (or none) and a fallback glyph. Cheap to call repeatedly with the same values. */
export function setIcon(wrap: HTMLElement, src: string | null, id: GlyphId): void {
  if (wrap.dataset.glyph !== id) {
    wrap.dataset.glyph = id;
    wrap.querySelector('use')?.setAttribute('href', `#crg-${id}`);
  }
  const current = wrap.dataset.src ?? '';
  if ((src ?? '') === current) return;
  if (src) wrap.dataset.src = src; else delete wrap.dataset.src;
  if (!src) { applyImage(wrap, '', false); return; }
  const state = iconState.get(src);
  if (state === 'ok') { applyImage(wrap, src, true); return; }
  applyImage(wrap, src, false);
  if (state === 'bad') return;
  let set = waiting.get(src);
  if (!set) { set = new Set(); waiting.set(src, set); }
  set.add(wrap);
  request(src);
}

/** Icon medallion: PNG when available, glyph otherwise. */
export function icon(src: string | null, id: GlyphId, cls = ''): HTMLElement {
  const wrap = h('span', `cr-ico ${cls}`.trim());
  wrap.append(glyph(id, 'cr-ico__glyph'));
  setIcon(wrap, src, id);
  return wrap;
}

/** Warms the icon cache so screens that open later show PNGs without a glyph flash. */
export function prefetchIcons(srcs: Iterable<string>): void {
  for (const src of srcs) request(src);
}
