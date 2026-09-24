/**
 * Menu navigation for keyboard and gamepad: spatial focus movement between [data-nav] elements inside a scope,
 * plus a small gamepad poller that turns pad buttons into menu intents (only used while menus are up).
 */

export type NavDir = 'up' | 'down' | 'left' | 'right';
export type PadIntent = NavDir | 'confirm' | 'back' | 'start' | 'prev' | 'next' | 'alt' | 'alt2' | 'select';

export function navItems(scope: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of scope.querySelectorAll<HTMLElement>('[data-nav]')) {
    if (el.closest('[hidden]') || el.closest('[inert]')) continue;
    if ((el as HTMLButtonElement).disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.push(el);
  }
  return out;
}

export function focusEl(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  return true;
}

/** Focuses the default item of a scope ([data-nav-default] first, else the first item). */
export function focusDefault(scope: ParentNode): boolean {
  const items = navItems(scope);
  return focusEl(items.find((el) => el.hasAttribute('data-nav-default')) ?? items[0]);
}

/** Moves focus to the nearest item in a direction; returns false if nothing is there. */
export function moveFocus(scope: ParentNode, dir: NavDir): boolean {
  const items = navItems(scope);
  if (items.length === 0) return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || !items.includes(active)) return focusDefault(scope);
  const a = active.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === active) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = cx - ax, dy = cy - ay;
    let primary: number, cross: number, overlap: boolean;
    if (dir === 'left' || dir === 'right') {
      primary = dir === 'left' ? -dx : dx;
      cross = Math.abs(dy);
      overlap = r.top < a.bottom && r.bottom > a.top;
    } else {
      primary = dir === 'up' ? -dy : dy;
      cross = Math.abs(dx);
      overlap = r.left < a.right && r.right > a.left;
    }
    if (primary <= 2) continue;
    const score = primary + cross * (overlap ? 0.35 : 2.2);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return focusEl(best);
}

const DIR_KEYS: Record<string, NavDir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};

export function keyDir(code: string): NavDir | null {
  return DIR_KEYS[code] ?? null;
}

/** Edge-triggered gamepad reader for menus (D-pad + left stick with key-repeat). */
export class PadReader {
  private prev: boolean[] = [];
  private stickDir: NavDir | null = null;
  private repeat = 0;
  anyPressed = false;

  poll(dt: number, out: PadIntent[]): void {
    out.length = 0;
    this.anyPressed = false;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) { this.prev.length = 0; this.stickDir = null; return; }
    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => !!pressed[i] && !this.prev[i];
    if (edge(0)) out.push('confirm');
    if (edge(1)) out.push('back');
    if (edge(2)) out.push('alt');
    if (edge(3)) out.push('alt2');
    if (edge(4)) out.push('prev');
    if (edge(5)) out.push('next');
    if (edge(8)) out.push('select');
    if (edge(9)) out.push('start');
    for (let i = 0; i < pressed.length; i++) if (edge(i)) this.anyPressed = true;
    // D-pad (edge) and stick (with repeat).
    if (edge(12)) out.push('up');
    if (edge(13)) out.push('down');
    if (edge(14)) out.push('left');
    if (edge(15)) out.push('right');
    const lx = pad.axes[0] ?? 0, ly = pad.axes[1] ?? 0;
    let dir: NavDir | null = null;
    if (Math.max(Math.abs(lx), Math.abs(ly)) > 0.55) dir = Math.abs(lx) > Math.abs(ly) ? (lx < 0 ? 'left' : 'right') : (ly < 0 ? 'up' : 'down');
    if (dir !== this.stickDir) { this.stickDir = dir; this.repeat = 0.38; if (dir) { out.push(dir); this.anyPressed = true; } }
    else if (dir) { this.repeat -= dt; if (this.repeat <= 0) { this.repeat = 0.13; out.push(dir); } }
    this.prev = pressed;
  }
}
