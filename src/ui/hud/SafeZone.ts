/**
 * Where world-anchored HUD (offscreen markers, nameplates, captain plates) may sit: the viewport minus the fixed HUD
 * widgets (top-left badge + stat plate, top-centre timer/boss/tracker stack, minimap + roster column, ship ring and
 * status chips, skill bar, loadout, toasts, coach prompt). Widget rects are read in the HUD's read phase (after
 * project() has already flushed layout) every few frames, so the zone follows the roster growing, the boss bar
 * appearing or the HUD scale changing without any per-widget constants.
 */

const MAX_BLOCKS = 16;
const REMEASURE_FRAMES = 6;

export class SafeZone {
  width = 1600;
  height = 900;
  /** HUD unit in CSS px (1 at 1600×900, times Settings.hudScale). */
  u = 1;
  /** Blocks as x0, y0, x1, y1 (CSS px in the HUD root). */
  readonly blocks = new Float32Array(MAX_BLOCKS * 4);
  count = 0;
  private readonly els: HTMLElement[] = [];
  private frame = 0;
  private dirty = true;
  private originX = 0;
  private originY = 0;

  /** Widgets to keep clear (measured; hidden or empty ones are skipped). */
  track(...els: HTMLElement[]): void { for (const el of els) if (!this.els.includes(el)) this.els.push(el); this.dirty = true; }

  resize(w: number, h: number, scale: number): void {
    const u = Math.max(0.72, Math.min(1.7, Math.min(w / 1600, h / 900))) * scale;
    if (w === this.width && h === this.height && u === this.u) return;
    this.width = w; this.height = h; this.u = u;
    this.dirty = true;
  }

  /** Something moved (boss bar, tracker, roster mode…): re-read the rects this frame. */
  invalidate(): void { this.dirty = true; }

  /** Read phase only (getBoundingClientRect). `origin` is the HUD root. */
  measure(origin: HTMLElement): void {
    if (!this.dirty && ++this.frame < REMEASURE_FRAMES) return;
    this.frame = 0;
    this.dirty = false;
    const o = origin.getBoundingClientRect();
    this.originX = o.left; this.originY = o.top;
    let n = 0;
    for (const el of this.els) {
      if (n >= MAX_BLOCKS) break;
      if (el.hidden || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const b = n * 4;
      this.blocks[b] = r.left - this.originX; this.blocks[b + 1] = r.top - this.originY;
      this.blocks[b + 2] = r.right - this.originX; this.blocks[b + 3] = r.bottom - this.originY;
      n++;
    }
    this.count = n;
  }

  /** True when a box of half-size (rx, ry) centred on (x, y) touches a HUD widget. */
  hits(x: number, y: number, rx: number, ry: number): boolean {
    const bl = this.blocks;
    for (let i = 0; i < this.count; i++) {
      const b = i * 4;
      if (x + rx > bl[b]! && x - rx < bl[b + 2]! && y + ry > bl[b + 1]! && y - ry < bl[b + 3]!) return true;
    }
    return false;
  }

  /** Distance along a ray to where it first enters a widget grown by (rx, ry); Infinity if it never does. */
  rayEntry(ox: number, oy: number, dx: number, dy: number, rx: number, ry: number): number {
    let best = Infinity;
    const bl = this.blocks;
    for (let i = 0; i < this.count; i++) {
      const b = i * 4;
      const t = rayBox(ox, oy, dx, dy, bl[b]! - rx, bl[b + 1]! - ry, bl[b + 2]! + rx, bl[b + 3]! + ry);
      if (t < best) best = t;
    }
    return best;
  }
}

/** Distance along a ray (origin outside the box) to where it enters an axis-aligned box; Infinity if it misses. */
export function rayBox(ox: number, oy: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number): number {
  if (ox >= x0 && ox <= x1 && oy >= y0 && oy <= y1) return Infinity;
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) return Infinity; }
  else { let a = (x0 - ox) / dx, b = (x1 - ox) / dx; if (a > b) { const c = a; a = b; b = c; } tmin = Math.max(tmin, a); tmax = Math.min(tmax, b); }
  if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return Infinity; }
  else { let a = (y0 - oy) / dy, b = (y1 - oy) / dy; if (a > b) { const c = a; a = b; b = c; } tmin = Math.max(tmin, a); tmax = Math.min(tmax, b); }
  if (tmax < tmin || tmin <= 0) return Infinity;
  return tmin;
}
