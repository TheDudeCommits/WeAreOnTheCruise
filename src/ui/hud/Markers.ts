/**
 * Offscreen arrows for bosses, elites and chests, placed on the screen edge via UiFrame.project().
 * Split into measure() (all project() calls, before any DOM write this frame: project() reads layout) and
 * apply() (DOM writes only).
 */
import type { ScreenPoint, UiFrame } from '../contracts';
import type { RunState } from '../../game/types';
import { h, TextCell } from '../core/dom';
import { glyph } from '../core/icons';
import type { ScreenBasis } from './camera';

type Kind = 'boss' | 'elite' | 'chest';
const MAX = 8;
const TARGETS = 64;

interface Marker { el: HTMLElement; arrow: HTMLElement; icon: HTMLElement; dist: TextCell; kind: Kind | ''; on: boolean; x: number; y: number; a: number; lastDist: number }
interface Target { kind: Kind; x: number; z: number; d: number; rank: number }
interface Placement { kind: Kind; x: number; y: number; a: number; d: number }

export class Markers {
  readonly el: HTMLElement;
  private readonly pool: Marker[] = [];
  private readonly targets: Target[] = [];
  private readonly order: Target[] = [];
  private readonly placed: Placement[] = [];
  private count = 0;
  private readonly sp: ScreenPoint = { x: 0, y: 0, visible: false };
  private readonly v = { x: 0, y: 0 };
  private readonly blocks: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  width = 1600;
  height = 900;

  constructor() {
    this.el = h('div', 'cr-markers');
    for (let i = 0; i < MAX; i++) {
      const arrow = h('span', 'cr-marker__arrow');
      const icon = h('span', 'cr-marker__icon');
      const dist = h('span', 'cr-marker__dist');
      const el = h('div', 'cr-marker', arrow, icon, dist);
      el.hidden = true;
      this.el.append(el);
      this.pool.push({ el, arrow, icon, dist: new TextCell(dist), kind: '', on: false, x: -1e4, y: -1e4, a: 99, lastDist: -1 });
      this.placed.push({ kind: 'chest', x: 0, y: 0, a: 0, d: 0 });
    }
    for (let i = 0; i < TARGETS; i++) this.targets.push({ kind: 'chest', x: 0, z: 0, d: 0, rank: 0 });
  }

  reset(): void { this.count = 0; for (const m of this.pool) { m.on = false; m.el.hidden = true; } }

  /** Read phase: gathers targets and computes edge placements (calls project()). */
  measure(f: UiFrame, run: Readonly<RunState>, basis: ScreenBasis): void {
    const p = run.player;
    const order = this.order;
    order.length = 0;
    let n = 0;
    for (const b of run.bosses) {
      if (b.life !== 'alive' || n >= TARGETS) continue;
      const t = this.targets[n++]!; t.kind = 'boss'; t.x = b.x; t.z = b.z; t.d = Math.hypot(b.x - p.x, b.z - p.z); t.rank = t.d; order.push(t);
    }
    for (const e of run.enemies) {
      if (!e.elite || e.life !== 'alive' || n >= TARGETS) continue;
      const t = this.targets[n++]!; t.kind = 'elite'; t.x = e.x; t.z = e.z; t.d = Math.hypot(e.x - p.x, e.z - p.z); t.rank = 1e6 + t.d; order.push(t);
    }
    for (const k of run.pickups) {
      if (!k.alive || k.kind !== 'chest' || n >= TARGETS) continue;
      const t = this.targets[n++]!; t.kind = 'chest'; t.x = k.x; t.z = k.z; t.d = Math.hypot(k.x - p.x, k.z - p.z); t.rank = 1e6 + t.d; order.push(t);
    }
    // Insertion sort by rank (bosses first, then nearest).
    for (let i = 1; i < order.length; i++) {
      const t = order[i]!;
      let j = i - 1;
      while (j >= 0 && order[j]!.rank > t.rank) { order[j + 1] = order[j]!; j--; }
      order[j + 1] = t;
    }
    const W = this.width, H = this.height;
    const u = Math.max(0.72, Math.min(1.7, Math.min(W / 1600, H / 900)));
    let bossUp = false;
    for (const b of run.bosses) if (b.life !== 'dead') { bossUp = true; break; }
    const L = 56 * u, T = (bossUp ? 200 : 124) * u, R = W - 56 * u, B = H - 214 * u;
    // Fixed HUD blocks the markers must stay out of (minimap; ship ring + status chips).
    const blocks = this.blocks;
    blocks[0] = W - 262 * u; blocks[1] = 0; blocks[2] = W; blocks[3] = 266 * u;
    blocks[4] = 0; blocks[5] = H - 334 * u; blocks[6] = 436 * u; blocks[7] = H;
    let used = 0;
    for (let i = 0; i < order.length && used < MAX; i++) {
      const t = order[i]!;
      f.project(t.x, 4, t.z, this.sp);
      const inside = this.sp.visible && this.sp.x > L && this.sp.x < R && this.sp.y > T && this.sp.y < B;
      if (inside || !basis.ok) continue;
      basis.dir(t.x - p.x, t.z - p.z, this.v);
      const len = Math.hypot(this.v.x, this.v.y);
      if (len < 1e-6) continue;
      const dx = this.v.x / len, dy = this.v.y / len;
      const ox = Math.min(Math.max(basis.sx, L + 1), R - 1), oy = Math.min(Math.max(basis.sy, T + 1), B - 1);
      let s = Infinity;
      if (dx > 1e-6) s = Math.min(s, (R - ox) / dx);
      if (dx < -1e-6) s = Math.min(s, (L - ox) / dx);
      if (dy > 1e-6) s = Math.min(s, (B - oy) / dy);
      if (dy < -1e-6) s = Math.min(s, (T - oy) / dy);
      for (let k = 0; k < blocks.length; k += 4) s = Math.min(s, rayEntry(ox, oy, dx, dy, blocks[k]!, blocks[k + 1]!, blocks[k + 2]!, blocks[k + 3]!));
      if (!Number.isFinite(s)) continue;
      let x = ox + dx * s, y = oy + dy * s;
      // De-overlap markers that land on the same spot (slide along the dominant edge).
      const onSide = Math.abs(dx) * (B - T) > Math.abs(dy) * (R - L);
      for (let k = 0; k < used; k++) {
        const o = this.placed[k]!;
        if (Math.abs(o.x - x) < 46 * u && Math.abs(o.y - y) < 50 * u) { if (onSide) y = o.y + (y >= o.y ? 52 : -52) * u; else x = o.x + (x >= o.x ? 50 : -50) * u; }
      }
      const pl = this.placed[used++]!;
      pl.kind = t.kind; pl.x = x; pl.y = y; pl.a = Math.atan2(dx, -dy); pl.d = t.d;
    }
    this.count = used;
  }

  /** Write phase. */
  apply(): void {
    for (let i = 0; i < MAX; i++) {
      const m = this.pool[i]!;
      if (i >= this.count) { if (m.on) { m.on = false; m.el.hidden = true; } continue; }
      const pl = this.placed[i]!;
      if (!m.on) { m.on = true; m.el.hidden = false; }
      if (m.kind !== pl.kind) {
        m.kind = pl.kind;
        m.el.dataset.kind = pl.kind;
        m.icon.replaceChildren(glyph(pl.kind === 'boss' ? 'skull' : pl.kind === 'elite' ? 'star' : 'chest'));
      }
      if (Math.abs(pl.x - m.x) >= 1 || Math.abs(pl.y - m.y) >= 1) { m.x = pl.x; m.y = pl.y; m.el.style.transform = `translate3d(${pl.x.toFixed(0)}px,${pl.y.toFixed(0)}px,0)`; }
      if (Math.abs(pl.a - m.a) > 0.02) { m.a = pl.a; m.arrow.style.transform = `rotate(${pl.a.toFixed(2)}rad)`; }
      const d = Math.round(pl.d / 10) * 10;
      if (d !== m.lastDist) { m.lastDist = d; m.dist.set(`${d}m`); }
    }
  }
}

/** Distance along a ray (origin outside the box) to where it enters an axis-aligned box; Infinity if it misses. */
function rayEntry(ox: number, oy: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number): number {
  if (ox >= x0 && ox <= x1 && oy >= y0 && oy <= y1) return Infinity;
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) return Infinity; }
  else { let a = (x0 - ox) / dx, b = (x1 - ox) / dx; if (a > b) { const c = a; a = b; b = c; } tmin = Math.max(tmin, a); tmax = Math.min(tmax, b); }
  if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return Infinity; }
  else { let a = (y0 - oy) / dy, b = (y1 - oy) / dy; if (a > b) { const c = a; a = b; b = c; } tmin = Math.max(tmin, a); tmax = Math.min(tmax, b); }
  if (tmax < tmin || tmin <= 0) return Infinity;
  return tmin;
}
